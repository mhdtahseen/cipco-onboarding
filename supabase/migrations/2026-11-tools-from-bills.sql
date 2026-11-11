-- Purchases into Tools & equipment: the lines of a recorded Inventory bill can be added to the register at the bill's site, one by one, by choice.
-- Safe to run more than once. Run AFTER 2026-11-tools-register.sql and 2026-11-inventory-approval.sql.
--
--   * Each chosen bill line becomes a "received (purchase)" movement at the bill's project, linked to the line, so an item's history opens the bill it came from.
--     A line can be added once (until that movement is voided). The quantity can be less than the line's (say some of it was used at once), never more.
--   * The line is matched to a catalogue item (the app suggests one by fuzzy matching), or a new catalogue item is made from it.
--   * The name as written on the bill is remembered against the item it was matched to (tool_item_aliases), so the same name is matched at once next time.
--   * If the bill is later reopened or voided in Inventory, what it added to the register is taken off again (voided, with the reason).
--   * Gas deliveries stay in Site supplies and are never added here. Admin and Operations only.

alter table public.tool_moves add column if not exists bill_item_id uuid references public.inventory_bill_items(id) on delete set null;
create unique index if not exists tool_moves_bill_item_once on public.tool_moves (bill_item_id) where bill_item_id is not null and voided_at is null;

create table if not exists public.tool_item_aliases (
  alias text primary key,                               -- the bill's name, normalized by the app (src/lib/toolMatch.ts normName)
  tool_item_id uuid not null references public.tool_items(id) on delete cascade,
  uses int not null default 1,
  created_by uuid default auth.uid(), updated_at timestamptz not null default now()
);
alter table public.tool_item_aliases enable row level security;
drop policy if exists "tool aliases read" on public.tool_item_aliases;
create policy "tool aliases read" on public.tool_item_aliases for select to authenticated using (public.is_staff() or public.is_viewer());   -- written only by the function below

-- p_lines: [{"bill_item_id": "…", "qty": 4, "tool_item_id": "…"} or, for a new catalogue item, {"bill_item_id": "…", "qty": 4,
--           "new_item": {"category": "…", "name": "…", "spec": "…", "unit": "Nos", "kind": "tool"}}, with "alias": the normalized bill name to remember]
create or replace function public.tool_receive_from_bill(p_bill uuid, p_lines jsonb) returns int language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; l jsonb; bi public.inventory_bill_items; tid uuid; q numeric; ni jsonb; n int := 0; al text;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can add purchases to Tools & equipment.'; end if;
  select * into b from public.inventory_bills where id = p_bill; if not found then raise exception 'Bill not found.'; end if;
  if b.voided_at is not null or b.status <> 'recorded' then raise exception 'Only a recorded bill can be added to Tools & equipment.'; end if;
  if b.kind = 'gas' then raise exception 'Gas deliveries are kept in Site supplies.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Choose at least one line.'; end if;
  for l in select x.v from jsonb_array_elements(p_lines) as x(v) loop
    select * into bi from public.inventory_bill_items where id = (l ->> 'bill_item_id')::uuid and bill_id = p_bill;
    if not found then raise exception 'That line is not on this bill.'; end if;
    if exists (select 1 from public.tool_moves where bill_item_id = bi.id and voided_at is null) then raise exception '% is already in Tools & equipment.', bi.name; end if;
    q := (l ->> 'qty')::numeric;
    if q is null or q <= 0 or q > bi.qty then raise exception 'For %, add between 1 and % (the quantity on the bill).', bi.name, bi.qty; end if;
    tid := nullif(l ->> 'tool_item_id', '')::uuid; ni := l -> 'new_item';
    if tid is null then
      if ni is null or btrim(coalesce(ni ->> 'category', '')) = '' or btrim(coalesce(ni ->> 'name', '')) = '' then raise exception 'For %, choose an item or give the new item a category and a name.', bi.name; end if;
      select id into tid from public.tool_items where lower(btrim(category)) = lower(btrim(ni ->> 'category')) and lower(btrim(name)) = lower(btrim(ni ->> 'name')) and lower(btrim(spec)) = lower(btrim(coalesce(ni ->> 'spec', '')));
      if tid is null then
        insert into public.tool_items (category, name, spec, unit, kind, sort_order)
          values (btrim(ni ->> 'category'), btrim(ni ->> 'name'), btrim(coalesce(ni ->> 'spec', '')), coalesce(nullif(btrim(ni ->> 'unit'), ''), 'Nos'),
                  case when ni ->> 'kind' = 'consumable' then 'consumable' else 'tool' end, 10000) returning id into tid;
      end if;
    elsif not exists (select 1 from public.tool_items where id = tid) then raise exception 'Item not found.'; end if;
    insert into public.tool_moves (item_id, project_id, kind, d_ok, moved_on, note, bill_item_id)
      values (tid, b.project_id, 'received', q, b.bill_date,
              'Bill ' || case when btrim(b.bill_no) <> '' then btrim(b.bill_no) || ' ' else '' end || 'from ' || coalesce(nullif(btrim(b.vendor_name), ''), 'the supplier'), bi.id);
    al := left(btrim(coalesce(l ->> 'alias', '')), 200);
    if al <> '' then
      insert into public.tool_item_aliases (alias, tool_item_id) values (al, tid)
        on conflict (alias) do update set tool_item_id = excluded.tool_item_id, uses = public.tool_item_aliases.uses + 1, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- a bill reopened or voided in Inventory takes back what it added to the register
create or replace function public.tool_bill_taken_back() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.status = 'recorded' and new.status <> 'recorded') or (old.voided_at is null and new.voided_at is not null) then
    update public.tool_moves set voided_at = now(), voided_by = auth.uid(), void_reason = 'The bill was ' || case when new.voided_at is not null then 'voided' else 'reopened' end || ' in Inventory'
      where voided_at is null and bill_item_id in (select id from public.inventory_bill_items where bill_id = new.id);
  end if;
  return null;
end $$;
drop trigger if exists tool_bill_taken_back_trg on public.inventory_bills;
create trigger tool_bill_taken_back_trg after update of status, voided_at on public.inventory_bills for each row execute function public.tool_bill_taken_back();

revoke all on function public.tool_bill_taken_back() from public, anon, authenticated;
revoke all on function public.tool_receive_from_bill(uuid, jsonb) from public, anon;
grant execute on function public.tool_receive_from_bill(uuid, jsonb) to authenticated;
