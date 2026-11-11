-- Tools & equipment register: the things the company owns (the container list) and where each one is. Safe to run more than once.
-- NOT run by Claude: run it yourself in the Supabase SQL editor. Run AFTER 2026-11-viewer-role.sql. Then load the opening stock with supabase/seed/tools-opening-csl.sql.
--
-- HOW STOCK WORKS. Nobody types a stock number. Every change is a movement (tool_moves) with a date, a person and a reason, and the stock at a site is the sum of its
-- movements, split into good (d_ok) and damaged (d_damaged). A movement is never edited; a wrong one is voided (with a reason) and entered again.
--   opening       what was already at a site before the app (the container list at CSL)
--   used          a consumable used up (grinding wheels, electrodes, cable…)          good −
--   damaged       a good item found damaged                                             good −, damaged +
--   repaired      a damaged item repaired                                               damaged −, good +
--   lost          lost or stolen (from good or damaged)                                 −
--   written_off   a damaged item thrown away                                            damaged −
--   count         a recount: sets the number to what was actually counted; the difference is recorded with the reason
--   transfer_out / transfer_in   a move between sites (below)
--   received      (later) items from a recorded purchase bill
-- No site can go below zero of anything; the functions refuse it.
--
-- TRANSFERS (tool_transfers) have two steps. Dispatch takes the items out of the sending site at once (they are "in transit"). The receiving site then confirms
-- what actually arrived, line by line; anything short is kept on the transfer as missing. An in-transit transfer can be cancelled, which puts everything back.
-- Each transfer has an internal number (TR/2026/0001) and prints as the company's Delivery Challan ("on returnable basis"), with the DC number from the challan book,
-- an optional declared value and the receiving client's name and address.
--
-- WHO. Admin and Operations do everything; the Viewer can look. (Site roles can be added later.)

-- ── the catalogue ──
create table if not exists public.tool_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (btrim(category) <> ''),
  name text not null check (btrim(name) <> ''),
  spec text not null default '',                       -- size / capacity: "20-22", "50 mm", "17 TON"
  unit text not null default 'Nos',
  kind text not null default 'tool' check (kind in ('tool', 'consumable')),
  note text not null default '',
  active boolean not null default true,
  sort_order int not null default 100,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create unique index if not exists tool_items_unique on public.tool_items (lower(btrim(category)), lower(btrim(name)), lower(btrim(spec)));

-- ── transfers ──
create table if not exists public.tool_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no text not null unique,
  from_project uuid not null references public.projects(id),
  to_project uuid not null references public.projects(id),
  status text not null default 'in_transit' check (status in ('in_transit', 'received', 'cancelled')),
  dispatched_on date not null,
  vehicle_no text not null default '', carried_by text not null default '', note text not null default '',
  dc_no text not null default '',                       -- the Delivery Challan number from the challan book (DC-110…)
  order_ref text not null default '',                   -- "Your order no." on the challan, if any
  declared_value numeric(14,2) check (declared_value >= 0),   -- the lumpsum value printed on the challan (returnable basis), if any
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  received_on date, received_by uuid, received_at timestamptz, received_note text not null default '',
  cancelled_by uuid, cancelled_at timestamptz, cancel_reason text not null default '',
  check (from_project <> to_project)
);
create table if not exists public.tool_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.tool_transfers(id) on delete cascade,
  item_id uuid not null references public.tool_items(id),
  condition text not null default 'ok' check (condition in ('ok', 'damaged')),
  qty numeric(12,3) not null check (qty > 0),
  qty_received numeric(12,3) check (qty_received >= 0 and qty_received <= qty)
);
create index if not exists tool_transfer_lines_transfer on public.tool_transfer_lines (transfer_id);

-- ── movements ──
create table if not exists public.tool_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.tool_items(id),
  project_id uuid not null references public.projects(id),
  kind text not null check (kind in ('opening', 'received', 'used', 'damaged', 'repaired', 'lost', 'written_off', 'count', 'transfer_out', 'transfer_in')),
  d_ok numeric(12,3) not null default 0,
  d_damaged numeric(12,3) not null default 0,
  moved_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  transfer_id uuid references public.tool_transfers(id),
  note text not null default '',
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid, void_reason text not null default ''
);
create index if not exists tool_moves_site on public.tool_moves (project_id, item_id) where voided_at is null;
create index if not exists tool_moves_item on public.tool_moves (item_id);

-- what each site has now (good and damaged), for the screens
create or replace view public.tool_stock with (security_invoker = true) as
  select item_id, project_id, sum(d_ok) as ok, sum(d_damaged) as damaged from public.tool_moves where voided_at is null group by item_id, project_id;

alter table public.tool_items enable row level security;
alter table public.tool_transfers enable row level security;
alter table public.tool_transfer_lines enable row level security;
alter table public.tool_moves enable row level security;
drop policy if exists "tools read" on public.tool_items; create policy "tools read" on public.tool_items for select to authenticated using (public.is_staff() or public.is_viewer());
drop policy if exists "tools write" on public.tool_items; create policy "tools write" on public.tool_items for insert to authenticated with check (public.is_staff());
drop policy if exists "tools edit" on public.tool_items; create policy "tools edit" on public.tool_items for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "tool transfers read" on public.tool_transfers; create policy "tool transfers read" on public.tool_transfers for select to authenticated using (public.is_staff() or public.is_viewer());
drop policy if exists "tool lines read" on public.tool_transfer_lines; create policy "tool lines read" on public.tool_transfer_lines for select to authenticated using (public.is_staff() or public.is_viewer());
drop policy if exists "tool moves read" on public.tool_moves; create policy "tool moves read" on public.tool_moves for select to authenticated using (public.is_staff() or public.is_viewer());
-- movements and transfers are written only by the functions below

-- ── helpers ──
create or replace function public.tool_balance(p_item uuid, p_project uuid, out ok numeric, out damaged numeric) language sql stable security definer set search_path = public as $$
  select coalesce(sum(d_ok), 0), coalesce(sum(d_damaged), 0) from public.tool_moves where item_id = p_item and project_id = p_project and voided_at is null $$;

create or replace function public.tool_label(p_item uuid) returns text language sql stable security definer set search_path = public as $$
  select btrim(name || case when btrim(spec) <> '' then ' ' || btrim(spec) else '' end) from public.tool_items where id = p_item $$;

create or replace function public.tool_check(p_item uuid, p_project uuid) returns void language plpgsql stable security definer set search_path = public as $$
declare b record;
begin
  select * into b from public.tool_balance(p_item, p_project);
  if b.ok < 0 or b.damaged < 0 then
    raise exception 'Not enough % at this site: this would leave % good and % damaged.', coalesce(public.tool_label(p_item), 'of this item'), b.ok, b.damaged;
  end if;
end $$;

-- ── one change at one site ──
-- p_qty: how many. For 'count' it is the number actually counted (of the chosen condition). p_condition: which ones ('ok' | 'damaged') for lost and count.
create or replace function public.tool_move(p_item uuid, p_project uuid, p_kind text, p_qty numeric, p_condition text default 'ok', p_date date default null, p_note text default '') returns uuid language plpgsql security definer set search_path = public as $$
declare b record; dok numeric := 0; ddm numeric := 0; mid uuid; k text; it public.tool_items;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can change tools and equipment.'; end if;
  select * into it from public.tool_items where id = p_item; if not found then raise exception 'Item not found.'; end if;
  if not exists (select 1 from public.projects where id = p_project) then raise exception 'Site not found.'; end if;
  if p_qty is null or p_qty < 0 or (p_kind <> 'count' and p_qty = 0) then raise exception 'Enter how many.'; end if;
  if p_condition not in ('ok', 'damaged') then raise exception 'Bad condition.'; end if;
  if coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date) > (now() at time zone 'Asia/Kolkata')::date then raise exception 'The date cannot be in the future.'; end if;
  if p_kind in ('lost', 'written_off', 'count') and btrim(coalesce(p_note, '')) = '' then raise exception 'Give a reason.'; end if;
  k := p_kind;
  if k = 'opening' then if p_condition = 'ok' then dok := p_qty; else ddm := p_qty; end if;
  elsif k = 'used' then if it.kind <> 'consumable' then raise exception 'Only consumables are used up. For a tool, mark it damaged, lost or written off.'; end if; dok := -p_qty;
  elsif k = 'damaged' then dok := -p_qty; ddm := p_qty;
  elsif k = 'repaired' then dok := p_qty; ddm := -p_qty;
  elsif k = 'lost' then if p_condition = 'ok' then dok := -p_qty; else ddm := -p_qty; end if;
  elsif k = 'written_off' then ddm := -p_qty;
  elsif k = 'count' then
    select * into b from public.tool_balance(p_item, p_project);
    if p_condition = 'ok' then dok := p_qty - b.ok; else ddm := p_qty - b.damaged; end if;
    if dok = 0 and ddm = 0 then raise exception 'The count matches what is recorded: nothing to change.'; end if;
  else raise exception 'Choose what happened.'; end if;
  insert into public.tool_moves (item_id, project_id, kind, d_ok, d_damaged, moved_on, note)
    values (p_item, p_project, k, dok, ddm, coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date), btrim(coalesce(p_note, ''))) returning id into mid;
  perform public.tool_check(p_item, p_project);
  return mid;
end $$;

create or replace function public.tool_move_void(p_move uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare m public.tool_moves;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can change tools and equipment.'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason.'; end if;
  select * into m from public.tool_moves where id = p_move for update; if not found then raise exception 'Entry not found.'; end if;
  if m.voided_at is not null then raise exception 'This entry is already void.'; end if;
  if m.transfer_id is not null then raise exception 'This is part of a transfer. Cancel the transfer instead.'; end if;
  update public.tool_moves set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where id = p_move;
  perform public.tool_check(m.item_id, m.project_id);
end $$;

-- ── transfers ──
-- p_lines: [{"item_id": "…", "condition": "ok", "qty": 2}, …]
create or replace function public.tool_transfer_dispatch(p_from uuid, p_to uuid, p_date date, p_vehicle text, p_carried_by text, p_note text, p_lines jsonb,
  p_dc_no text default '', p_order_ref text default '', p_value numeric default null) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; y int := extract(year from (now() at time zone 'Asia/Kolkata'))::int; n int; l jsonb; q numeric; c text; iid uuid;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can move tools and equipment.'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Choose two different sites.'; end if;
  if p_date is null or p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Enter the dispatch date (not in the future).'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item.'; end if;
  insert into public.ref_counters (kind, year, last) values ('tool_transfer', y, 1) on conflict (kind, year) do update set last = public.ref_counters.last + 1 returning last into n;
  if p_value is not null and p_value < 0 then raise exception 'The declared value cannot be negative.'; end if;
  insert into public.tool_transfers (transfer_no, from_project, to_project, dispatched_on, vehicle_no, carried_by, note, dc_no, order_ref, declared_value)
    values ('TR/' || y || '/' || lpad(n::text, 4, '0'), p_from, p_to, p_date, btrim(coalesce(p_vehicle, '')), btrim(coalesce(p_carried_by, '')), btrim(coalesce(p_note, '')),
            btrim(coalesce(p_dc_no, '')), btrim(coalesce(p_order_ref, '')), p_value) returning id into tid;
  for l in select x.v from jsonb_array_elements(p_lines) as x(v) loop
    iid := (l ->> 'item_id')::uuid; q := (l ->> 'qty')::numeric; c := coalesce(l ->> 'condition', 'ok');
    if q is null or q <= 0 then continue; end if;
    if c not in ('ok', 'damaged') then raise exception 'Bad condition.'; end if;
    insert into public.tool_transfer_lines (transfer_id, item_id, condition, qty) values (tid, iid, c, q);
    insert into public.tool_moves (item_id, project_id, kind, d_ok, d_damaged, moved_on, transfer_id, note)
      values (iid, p_from, 'transfer_out', case when c = 'ok' then -q else 0 end, case when c = 'damaged' then -q else 0 end, p_date, tid, '');
    perform public.tool_check(iid, p_from);
  end loop;
  if not exists (select 1 from public.tool_transfer_lines where transfer_id = tid) then raise exception 'Add at least one item.'; end if;
  return tid;
end $$;

-- p_lines: [{"line_id": "…", "qty_received": 2}, …]; a line left out is taken as fully received
create or replace function public.tool_transfer_receive(p_transfer uuid, p_date date, p_lines jsonb, p_note text default '') returns void language plpgsql security definer set search_path = public as $$
declare t public.tool_transfers; ln public.tool_transfer_lines; got numeric; short numeric := 0;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can receive tools and equipment.'; end if;
  select * into t from public.tool_transfers where id = p_transfer for update; if not found then raise exception 'Transfer not found.'; end if;
  if t.status <> 'in_transit' then raise exception 'This transfer is already %.', replace(t.status, '_', ' '); end if;
  if p_date is null or p_date < t.dispatched_on or p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Enter the date it arrived (not before it was sent, not in the future).'; end if;
  for ln in select * from public.tool_transfer_lines where transfer_id = p_transfer loop
    got := coalesce((select (x.v ->> 'qty_received')::numeric from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as x(v) where (x.v ->> 'line_id')::uuid = ln.id limit 1), ln.qty);
    if got < 0 or got > ln.qty then raise exception 'For %, between 0 and % can have arrived.', public.tool_label(ln.item_id), ln.qty; end if;
    update public.tool_transfer_lines set qty_received = got where id = ln.id;
    short := short + (ln.qty - got);
    if got > 0 then
      insert into public.tool_moves (item_id, project_id, kind, d_ok, d_damaged, moved_on, transfer_id, note)
        values (ln.item_id, t.to_project, 'transfer_in', case when ln.condition = 'ok' then got else 0 end, case when ln.condition = 'damaged' then got else 0 end, p_date, p_transfer, '');
    end if;
  end loop;
  if short > 0 and btrim(coalesce(p_note, '')) = '' then raise exception 'Some items did not arrive. Say what happened.'; end if;
  update public.tool_transfers set status = 'received', received_on = p_date, received_by = auth.uid(), received_at = now(), received_note = btrim(coalesce(p_note, '')) where id = p_transfer;
end $$;

create or replace function public.tool_transfer_cancel(p_transfer uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare t public.tool_transfers;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can cancel a transfer.'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason.'; end if;
  select * into t from public.tool_transfers where id = p_transfer for update; if not found then raise exception 'Transfer not found.'; end if;
  if t.status <> 'in_transit' then raise exception 'Only a transfer still in transit can be cancelled.'; end if;
  update public.tool_moves set voided_at = now(), voided_by = auth.uid(), void_reason = 'Transfer cancelled: ' || btrim(p_reason) where transfer_id = p_transfer and voided_at is null;
  update public.tool_transfers set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p_transfer;
end $$;

revoke all on function public.tool_balance(uuid, uuid), public.tool_check(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tool_label(uuid), public.tool_move(uuid, uuid, text, numeric, text, date, text), public.tool_move_void(uuid, text),
  public.tool_transfer_dispatch(uuid, uuid, date, text, text, text, jsonb, text, text, numeric), public.tool_transfer_receive(uuid, date, jsonb, text), public.tool_transfer_cancel(uuid, text) from public, anon;
grant execute on function public.tool_label(uuid), public.tool_move(uuid, uuid, text, numeric, text, date, text), public.tool_move_void(uuid, text),
  public.tool_transfer_dispatch(uuid, uuid, date, text, text, text, jsonb, text, text, numeric), public.tool_transfer_receive(uuid, date, jsonb, text), public.tool_transfer_cancel(uuid, text) to authenticated;
grant select on public.tool_stock to authenticated;
