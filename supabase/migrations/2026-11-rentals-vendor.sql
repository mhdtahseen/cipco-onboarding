-- Rented items, phase 2: several deliveries from one vendor (Site supplies → Equipment → Rented).
--  1. rental_vendor_terms   how a rental vendor bills, set per vendor: calendar month at month end (the default), calendar month in advance, a fixed number of
--                           days in advance (30), or once on return. With fixed-day cycles a later delivery either joins the first delivery's cycle
--                           (its first bill runs only to that cycle's end; the default) or has its own. Also the vendor's usual minimum days and GST,
--                           which a new delivery starts with (each delivery keeps its own, as negotiated). The cycle only says when a bill is expected:
--                           bills are compared and approved under Bills & payments, like Meals.
--  2. rental_quotes         a vendor's quotation: number, date, amount, note, file and its rates per item. Reference only: never owed, never an expense.
--  3. rental_returns        returns are recorded per vendor: what went back (and what did not come back), taken off the oldest delivery first.
--                           Partial returns: rent stops for what went back. A delivery counts as returned once all of it has gone back.
--  4. Vendor bills and payments (site_bills, site_payments): an Admin can edit them at any time (number, dates, period, amounts, note, file); the
--     payment's expense follows. Operations still record, approve, pay and void as before.
--  5. rental_update (edit a delivery) works on a partly returned delivery, but not below what has gone back.
-- Safe to run more than once. Run AFTER 2026-11-rentals.sql, 2026-11-rentals-edit-portal.sql and 2026-11-consumables.sql.

-- ---------- 1. how each vendor bills ----------
create table if not exists public.rental_vendor_terms (
  vendor_id uuid primary key references public.gas_vendors(id) on delete cascade,
  billing text not null default 'month_end' check (billing in ('month_end', 'month_advance', 'advance', 'on_return')),
  period_days int not null default 30 check (period_days between 1 and 366),
  join_cycle boolean not null default true,              -- fixed-day cycles: a later delivery joins the first delivery's cycle
  min_days int not null default 0 check (min_days between 0 and 366),
  gst_pct numeric(5,2) not null default 0 check (gst_pct between 0 and 40),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.rental_vendor_terms enable row level security;
drop policy if exists "rental_vendor_terms staff" on public.rental_vendor_terms;
create policy "rental_vendor_terms staff" on public.rental_vendor_terms for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.rental_vendor_terms to authenticated;
-- vendors already renting: start from their first delivery's terms
insert into public.rental_vendor_terms (vendor_id, billing, period_days, min_days, gst_pct)
select distinct on (r.vendor_id) r.vendor_id, t.billing, t.period_days, t.min_days, t.gst_pct
from public.rentals r join public.rental_terms t on t.rental_id = r.id where r.voided_at is null order by r.vendor_id, r.delivered_on, r.created_at
on conflict (vendor_id) do nothing;
alter table public.rental_terms drop constraint if exists rental_terms_billing_check;
alter table public.rental_terms add constraint rental_terms_billing_check check (billing in ('month_end', 'month_advance', 'advance', 'on_return'));

-- ---------- 2. quotations ----------
create table if not exists public.rental_quotes (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.gas_vendors(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  quote_no text not null default '',
  quote_date date not null,
  amount numeric(12,2) check (amount >= 0),
  note text not null default '',
  file_path text,
  lines jsonb not null default '[]',                     -- [{ "name": "Clamp", "unit": "No", "rate": 1 }]: rate per unit per day, before GST
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz
);
create index if not exists rental_quotes_vendor on public.rental_quotes (vendor_id, quote_date desc);
alter table public.rental_quotes enable row level security;
drop policy if exists "rental_quotes staff" on public.rental_quotes;
create policy "rental_quotes staff" on public.rental_quotes for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.rental_quotes to authenticated;

-- ---------- 3. returns per vendor ----------
create table if not exists public.rental_returns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor_id uuid not null references public.gas_vendors(id),
  returned_on date not null,
  vehicle text not null default '',
  doc_path text,
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz
);
create index if not exists rental_returns_vendor on public.rental_returns (project_id, vendor_id, returned_on);
create table if not exists public.rental_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.rental_returns(id) on delete cascade,
  item_id uuid not null references public.rental_items(id) on delete restrict,
  qty numeric(12,3) not null default 0 check (qty >= 0),          -- went back
  missing numeric(12,3) not null default 0 check (missing >= 0),  -- did not come back (rent stops; the loss comes off the deposit)
  check (qty + missing > 0)
);
create index if not exists rental_return_lines_item on public.rental_return_lines (item_id);
create index if not exists rental_return_lines_return on public.rental_return_lines (return_id);
alter table public.rental_returns enable row level security;
alter table public.rental_return_lines enable row level security;
drop policy if exists "rental_returns read" on public.rental_returns; create policy "rental_returns read" on public.rental_returns for select to authenticated using (public.is_staff());
drop policy if exists "rental_return_lines read" on public.rental_return_lines; create policy "rental_return_lines read" on public.rental_return_lines for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.rental_returns, public.rental_return_lines from authenticated, anon;
grant select on public.rental_returns, public.rental_return_lines to authenticated;

-- a delivery's state from its returns: what did not come back, and the return date once all of it has gone back
create or replace function public.rental_sync(p_rental uuid) returns void language plpgsql security definer set search_path = public as $$
declare last public.rental_returns; open_left numeric;
begin
  update public.rental_items i set missing_qty = coalesce((select sum(l.missing) from public.rental_return_lines l join public.rental_returns x on x.id = l.return_id where l.item_id = i.id and x.voided_at is null), 0)
    where i.rental_id = p_rental;
  select coalesce(sum(greatest(0, i.qty - coalesce((select sum(l.qty + l.missing) from public.rental_return_lines l join public.rental_returns x on x.id = l.return_id where l.item_id = i.id and x.voided_at is null), 0))), 0)
    into open_left from public.rental_items i where i.rental_id = p_rental;
  select x.* into last from public.rental_returns x where x.voided_at is null and exists (select 1 from public.rental_return_lines l join public.rental_items i on i.id = l.item_id where l.return_id = x.id and i.rental_id = p_rental)
    order by x.returned_on desc, x.created_at desc limit 1;
  if open_left <= 0 and last.id is not null then
    update public.rentals set returned_on = last.returned_on, return_vehicle = last.vehicle, return_doc_path = last.doc_path, return_note = last.note, returned_by = last.created_by where id = p_rental;
  else
    update public.rentals set returned_on = null, return_vehicle = '', return_doc_path = null, return_note = '', returned_by = null where id = p_rental;
  end if;
end $$;

-- record a return to a vendor. p_lines: [{ "name": "Clamp", "unit": "No", "qty": 15, "missing": 1 }] — matched by name and unit to the vendor's deliveries
-- on this project that are on site, oldest delivery first.
create or replace function public.rental_vendor_return(p_project uuid, p_vendor uuid, p_returned_on date, p_vehicle text, p_doc_path text, p_note text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid; ln jsonb; nm text; un text; want_q numeric; want_m numeric; avail numeric; it record; take numeric; touched uuid[] := '{}'; r uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can record a return.'; end if;
  if p_returned_on is null or p_returned_on > today then raise exception 'The return date cannot be in the future.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or not exists (select 1 from jsonb_array_elements(p_lines) e where coalesce((e ->> 'qty')::numeric, 0) + coalesce((e ->> 'missing')::numeric, 0) > 0) then
    raise exception 'Enter how many of each item went back.'; end if;
  insert into public.rental_returns (project_id, vendor_id, returned_on, vehicle, doc_path, note)
    values (p_project, p_vendor, p_returned_on, upper(regexp_replace(btrim(coalesce(p_vehicle, '')), '\s+', ' ', 'g')), nullif(p_doc_path, ''), btrim(coalesce(p_note, ''))) returning id into rid;
  for ln in select * from jsonb_array_elements(p_lines) loop
    nm := lower(btrim(coalesce(ln ->> 'name', ''))); un := coalesce(nullif(btrim(ln ->> 'unit'), ''), 'No');
    want_q := greatest(0, coalesce((ln ->> 'qty')::numeric, 0)); want_m := greatest(0, coalesce((ln ->> 'missing')::numeric, 0));
    if want_q + want_m <= 0 then continue; end if;
    select coalesce(sum(i.qty - coalesce((select sum(l.qty + l.missing) from public.rental_return_lines l join public.rental_returns x on x.id = l.return_id where l.item_id = i.id and x.voided_at is null and x.id <> rid), 0)), 0)
      into avail from public.rental_items i join public.rentals r2 on r2.id = i.rental_id
      where r2.project_id = p_project and r2.vendor_id = p_vendor and r2.voided_at is null and r2.delivered_on <= p_returned_on and lower(btrim(i.name)) = nm and i.unit = un;
    if want_q + want_m > avail then raise exception 'Only % % of "%" are on site from deliveries up to that date.', trim(to_char(avail, 'FM999999990.###')), un, ln ->> 'name'; end if;
    -- oldest delivery first: what went back, then what did not come back
    for it in select i.id, i.rental_id, i.qty - coalesce((select sum(l.qty + l.missing) from public.rental_return_lines l join public.rental_returns x on x.id = l.return_id where l.item_id = i.id and x.voided_at is null), 0) as open_qty
      from public.rental_items i join public.rentals r2 on r2.id = i.rental_id
      where r2.project_id = p_project and r2.vendor_id = p_vendor and r2.voided_at is null and r2.delivered_on <= p_returned_on and lower(btrim(i.name)) = nm and i.unit = un
      order by r2.delivered_on, r2.created_at, i.line_no loop
      exit when want_q + want_m <= 0;
      if it.open_qty <= 0 then continue; end if;
      take := least(it.open_qty, want_q);
      if take > 0 or least(it.open_qty - take, want_m) > 0 then
        insert into public.rental_return_lines (return_id, item_id, qty, missing) values (rid, it.id, take, least(it.open_qty - take, want_m));
        want_m := want_m - least(it.open_qty - take, want_m); want_q := want_q - take;
        touched := touched || it.rental_id;
      end if;
    end loop;
  end loop;
  for r in select distinct t from unnest(touched) t loop perform public.rental_sync(r); end loop;
  return rid;
end $$;

-- undo a return (it stays in the list, marked void)
create or replace function public.rental_return_void(p_return uuid) returns void language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can undo a return.'; end if;
  update public.rental_returns set voided_at = now() where id = p_return and voided_at is null;
  for r in select distinct i.rental_id from public.rental_return_lines l join public.rental_items i on i.id = l.item_id where l.return_id = p_return loop perform public.rental_sync(r); end loop;
end $$;

-- returns recorded the old way (one per delivery, all together) become vendor returns, once
do $$
declare r record; rid uuid;
begin
  for r in select * from public.rentals x where x.returned_on is not null and x.voided_at is null
    and not exists (select 1 from public.rental_return_lines l join public.rental_items i on i.id = l.item_id where i.rental_id = x.id) loop
    insert into public.rental_returns (project_id, vendor_id, returned_on, vehicle, doc_path, note, created_by)
      values (r.project_id, r.vendor_id, r.returned_on, r.return_vehicle, r.return_doc_path, r.return_note, r.returned_by) returning id into rid;
    insert into public.rental_return_lines (return_id, item_id, qty, missing) select rid, i.id, i.qty - i.missing_qty, i.missing_qty from public.rental_items i where i.rental_id = r.id;
  end loop;
end $$;

-- the old one-delivery return is replaced by rental_vendor_return
create or replace function public.rental_return(p_rental uuid, p_returned_on date, p_vehicle text, p_doc_path text, p_note text, p_missing jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin raise exception 'Returns are now recorded per vendor: reload the page and use "Items returned" on the vendor.'; end $$;
create or replace function public.rental_undo_return(p_rental uuid) returns void language plpgsql security definer set search_path = public as $$
begin raise exception 'Returns are now undone from the vendor''s list of returns: reload the page.'; end $$;

-- ---------- 5. edit a delivery: also when part of it has gone back, never below what has gone back ----------
create or replace function public.rental_update(p_rental uuid, p_delivered_on date, p_vehicle text, p_note_no text, p_note text, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x public.rentals; b public.inventory_bills; on_portal boolean := false; it jsonb; n int := 0; iid uuid; keep uuid[] := '{}'; back numeric; first_back date;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  veh text := upper(regexp_replace(btrim(coalesce(p_vehicle, '')), '\s+', ' ', 'g'));
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can change a rental.'; end if;
  select * into x from public.rentals where id = p_rental for update;
  if x.id is null then raise exception 'Rental not found.'; end if;
  if x.voided_at is not null then raise exception 'This rental is void.'; end if;
  if x.returned_on is not null then raise exception 'All of it has gone back. Undo the return first to change the delivery.'; end if;
  if p_delivered_on is null or p_delivered_on > today then raise exception 'The delivery date cannot be in the future.'; end if;
  select min(r.returned_on) into first_back from public.rental_returns r join public.rental_return_lines l on l.return_id = r.id join public.rental_items i on i.id = l.item_id where i.rental_id = p_rental and r.voided_at is null;
  if first_back is not null and p_delivered_on > first_back then raise exception 'Some of it went back on %, so the delivery cannot be after that.', to_char(first_back, 'DD Mon YYYY'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Keep at least one item.'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if btrim(coalesce(it ->> 'name', '')) = '' or coalesce((it ->> 'qty')::numeric, 0) <= 0 then raise exception 'Every item needs a name and a quantity.'; end if;
    if coalesce(nullif(btrim(it ->> 'unit'), ''), 'No') not in ('FT', 'Inch', 'Kg', 'Meter', 'mm', 'MT', 'No', 'Pcs') then raise exception 'Choose the unit from the list (No, Pcs, Meter, FT, Kg...): "%" is not one the JSL portal knows.', it ->> 'unit'; end if;
    if nullif(it ->> 'id', '') is not null then
      if not exists (select 1 from public.rental_items where id = (it ->> 'id')::uuid and rental_id = p_rental) then raise exception 'An item does not belong to this rental. Reload and try again.'; end if;
      select coalesce(sum(l.qty + l.missing), 0) into back from public.rental_return_lines l join public.rental_returns r on r.id = l.return_id where l.item_id = (it ->> 'id')::uuid and r.voided_at is null;
      if (it ->> 'qty')::numeric < back then raise exception '% of "%" have already gone back, so the quantity cannot be less than that.', trim(to_char(back, 'FM999999990.###')), it ->> 'name'; end if;
    end if;
  end loop;
  for it in select * from jsonb_array_elements(p_items) loop
    if nullif(it ->> 'id', '') is not null then keep := keep || (it ->> 'id')::uuid; end if;
  end loop;
  if exists (select 1 from public.rental_items i where i.rental_id = p_rental and not (i.id = any (keep)) and exists (select 1 from public.rental_return_lines l join public.rental_returns r on r.id = l.return_id where l.item_id = i.id and r.voided_at is null)) then
    raise exception 'An item that has partly gone back cannot be removed from the delivery.'; end if;

  if x.inventory_bill_id is not null then
    select * into b from public.inventory_bills where id = x.inventory_bill_id for update;
    if b.id is not null and b.voided_at is null and b.jsl_status not in ('none', 'authorized', 'failed') then on_portal := true; end if;   -- left as submitted
  end if;

  update public.rentals set delivered_on = p_delivered_on, delivery_vehicle = veh, delivery_note_no = btrim(coalesce(p_note_no, '')), note = btrim(coalesce(p_note, '')) where id = p_rental;
  delete from public.rental_return_lines l using public.rental_returns r where r.id = l.return_id and r.voided_at is not null and l.item_id in (select id from public.rental_items where rental_id = p_rental and not (id = any (keep)));
  delete from public.rental_items where rental_id = p_rental and not (id = any (keep));
  update public.rental_items set line_no = line_no + 1000 where rental_id = p_rental;
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    if nullif(it ->> 'id', '') is not null then
      iid := (it ->> 'id')::uuid;
      update public.rental_items set line_no = n, name = btrim(it ->> 'name'), qty = (it ->> 'qty')::numeric, unit = coalesce(nullif(btrim(it ->> 'unit'), ''), 'No') where id = iid;
    else
      insert into public.rental_items (rental_id, line_no, name, qty, unit) values (p_rental, n, btrim(it ->> 'name'), (it ->> 'qty')::numeric, coalesce(nullif(btrim(it ->> 'unit'), ''), 'No')) returning id into iid;
    end if;
    if nullif(it ->> 'rate', '') is not null and (it ->> 'rate')::numeric >= 0 then
      insert into public.rental_item_rates (item_id, rate) values (iid, (it ->> 'rate')::numeric) on conflict (item_id) do update set rate = excluded.rate, updated_at = now();
    end if;
  end loop;
  perform public.rental_sync(p_rental);

  if b.id is not null and b.voided_at is null and not on_portal then
    perform set_config('app.inventory', '1', true);
    update public.inventory_bills set bill_date = p_delivered_on, bill_no = btrim(coalesce(p_note_no, '')),
      note = 'Rented from ' || vendor_name || ', returns to the vendor' || case when veh <> '' then '. Vehicle ' || veh else '' end,
      jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null where id = b.id;
    delete from public.inventory_bill_items where bill_id = b.id;
    insert into public.inventory_bill_items (bill_id, line_no, name, qty, unit, rate, gst_pct)
      select b.id, i.line_no, i.name, i.qty, i.unit, 0, 0 from public.rental_items i where i.rental_id = p_rental order by i.line_no;
    update public.inventory_gatepass set vehicle_no = replace(veh, ' ', ''), updated_at = now() where bill_id = b.id and received_by = 'vehicle' and veh <> '';
    perform set_config('app.inventory', '', true);
  end if;
end $$;

-- ---------- 4. vendor bills and payments: an Admin may edit them; the payment's expense follows ----------
alter table public.site_bills add column if not exists edited_at timestamptz;
alter table public.site_bills add column if not exists edited_by uuid;
alter table public.site_payments add column if not exists edited_at timestamptz;
alter table public.site_payments add column if not exists edited_by uuid;

create or replace function public.site_bill_edit_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bill_no is distinct from old.bill_no or new.bill_date is distinct from old.bill_date or new.period_from is distinct from old.period_from or new.period_to is distinct from old.period_to
     or new.bill_amount is distinct from old.bill_amount or new.note is distinct from old.note or new.bill_path is distinct from old.bill_path
     or new.vendor_id is distinct from old.vendor_id or new.project_id is distinct from old.project_id or new.kind is distinct from old.kind
     or (old.status = 'approved' and new.status = 'approved' and new.approved_amount is distinct from old.approved_amount) then
    if not public.is_admin() then raise exception 'Only an Admin can edit a bill. Operations can void it and record it again.'; end if;
    if new.period_from > new.period_to then raise exception 'The first day is after the last day.'; end if;
    new.edited_at := now(); new.edited_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists site_bill_edit_guard_trg on public.site_bills;
create trigger site_bill_edit_guard_trg before update on public.site_bills for each row execute function public.site_bill_edit_guard();

create or replace function public.site_payment_edit_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.paid_on is distinct from old.paid_on or new.amount is distinct from old.amount or new.reference is distinct from old.reference or new.note is distinct from old.note
     or new.site_bill_id is distinct from old.site_bill_id or new.vendor_id is distinct from old.vendor_id or new.project_id is distinct from old.project_id or new.kind is distinct from old.kind then
    if not public.is_admin() then raise exception 'Only an Admin can edit a payment. Operations can void it and record it again.'; end if;
    if new.amount <= 0 then raise exception 'The amount must be more than 0.'; end if;
    new.edited_at := now(); new.edited_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists site_payment_edit_guard_trg on public.site_payments;
create trigger site_payment_edit_guard_trg before update on public.site_payments for each row execute function public.site_payment_edit_guard();

-- the payment's expense: now follows an edited amount, date and reference too
create or replace function public.post_site_payment_expense() returns trigger language plpgsql security definer set search_path = public as $$
declare cat uuid; cname text; who text;
begin
  if to_regclass('public.project_expenses') is null then return new; end if;
  cname := case new.kind when 'gas' then 'Gas' else 'Equipment hire' end;
  select name into who from public.gas_vendors where id = new.vendor_id;
  if tg_op = 'UPDATE' then
    perform set_config('app.posting', '1', true);
    if new.voided_at is not null and old.voided_at is null then delete from public.project_expenses where source = 'site_payment' and source_id = new.id;
    elsif new.voided_at is null then
      update public.project_expenses set bill_path = new.bill_path, amount = new.amount, expense_date = new.paid_on, project_id = new.project_id,
        description = cname || ' · ' || coalesce(who, '') || coalesce(' · ' || nullif(btrim(new.reference), ''), '') where source = 'site_payment' and source_id = new.id;
    end if;
    perform set_config('app.posting', '', true);
    return new;
  end if;
  select id into cat from public.expense_categories where lower(btrim(name)) = lower(cname) limit 1;
  if cat is null then insert into public.expense_categories (name) values (cname) returning id into cat; end if;
  insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by, bill_path)
  values (new.project_id, cat, new.paid_on, new.amount, cname || ' · ' || coalesce(who, '') || coalesce(' · ' || nullif(btrim(new.reference), ''), ''), 'site_payment', new.id, auth.uid(), new.bill_path);
  return new;
end $$;

-- ---------- who may call what ----------
revoke all on function public.rental_sync(uuid) from public, anon, authenticated;
revoke all on function public.rental_vendor_return(uuid, uuid, date, text, text, text, jsonb), public.rental_return_void(uuid) from public, anon;
grant execute on function public.rental_vendor_return(uuid, uuid, date, text, text, text, jsonb), public.rental_return_void(uuid) to authenticated;
revoke all on function public.rental_update(uuid, date, text, text, text, jsonb) from public, anon;
grant execute on function public.rental_update(uuid, date, text, text, text, jsonb) to authenticated;
