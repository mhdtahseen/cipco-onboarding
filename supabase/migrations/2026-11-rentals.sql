-- Rented items (Site supplies → Equipment → Rented): scaffolding, props and the like, hired by quantity and by the day, delivered by a vehicle, returned
-- (usually all together) and paid for as rent. Any vendor, any items: e.g. 2 frames and 12 clamps, a deposit, a minimum of 15 days.
--  - rentals / rental_items: the delivery and what came on it. Admin and Operations only: Supervisors,
--    Site Engineers and Viewers cannot see or record rentals.
--    On a project that uses the JSL portal (projects.jsl_portal, today CSL), recording it also makes an Inventory entry, like a gas delivery: kind
--    'rental', no amount (rent is billed by the vendor, so nothing posts to expenses here), already recorded. Whether it goes to the portal, and by hand
--    or by vehicle, is chosen on the delivery; an Admin then authorizes it (or the 08:30 automatic send takes it). Other projects get no Inventory entry.
--    Items cannot be changed afterwards: void the rental and record it again (only while its entry is not on the portal).
--  - the return: one action for the whole rental, with what did not come back (missing quantities). Rent stops that day (or at the minimum days).
--    inventory_bills.direction 'out' is already there if the JSL portal ever needs an outgoing entry for the return; nothing creates one yet.
--  - rental_terms / rental_item_rates: the money, for Operations and Admin only: how rent is billed (in advance per period, at each month end, or once on
--    return), the period, the minimum days, GST, the rate per item per day, and the deposit (paid, deductions, refund). The deposit is money held, never
--    an expense. The vendor's rent invoices are recorded as equipment bills on Site supplies (site_bills), so they reach Payments due, Expenses and Bills.
-- Safe to run more than once. Run after 2026-11-consumables.sql and 2026-11-inventory-gas.sql.

-- ---------- 1. inventory entries can come from a rental ----------
alter table public.inventory_bills drop constraint if exists inventory_bills_kind_check;
alter table public.inventory_bills add constraint inventory_bills_kind_check check (kind in ('bill', 'no_bill', 'gas', 'rental'));

-- Which projects use the JSL portal (today only CSL). Set on the project's Edit form; switched on here for every project that has already sent to the portal.
alter table public.projects add column if not exists jsl_portal boolean not null default false;
update public.projects p set jsl_portal = true where not p.jsl_portal and exists (select 1 from public.inventory_bills b where b.project_id = p.id and (b.jsl_wanted or b.jsl_status <> 'none'));

-- ---------- 2. tables ----------
create table if not exists public.rentals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor_id uuid not null references public.gas_vendors(id),
  delivered_on date not null,
  delivery_vehicle text not null default '',
  delivery_note_no text not null default '',
  delivery_doc_path text,
  note text not null default '',
  returned_on date,
  return_vehicle text not null default '',
  return_doc_path text,
  return_note text not null default '',
  returned_by uuid,
  inventory_bill_id uuid references public.inventory_bills(id),
  entered_by uuid default auth.uid(),
  entered_role text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text not null default '',
  check (returned_on is null or returned_on >= delivered_on)
);
create index if not exists rentals_project on public.rentals (project_id, delivered_on desc);

create table if not exists public.rental_items (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete cascade,
  line_no int not null default 1,
  name text not null check (btrim(name) <> ''),
  qty numeric(12,3) not null check (qty > 0),
  unit text not null default 'No' check (btrim(unit) <> ''),
  missing_qty numeric(12,3) not null default 0 check (missing_qty >= 0),   -- did not come back on return
  created_at timestamptz not null default now(),
  check (missing_qty <= qty)
);
create index if not exists rental_items_rental on public.rental_items (rental_id, line_no);

create table if not exists public.rental_terms (           -- money: Operations / Admin only
  rental_id uuid primary key references public.rentals(id) on delete cascade,
  billing text not null default 'advance' check (billing in ('advance', 'month_end', 'on_return')),
  period_days int not null default 30 check (period_days between 1 and 366),
  min_days int not null default 0 check (min_days between 0 and 366),
  gst_pct numeric(5,2) not null default 0 check (gst_pct between 0 and 40),
  deposit numeric(12,2) not null default 0 check (deposit >= 0),
  deposit_paid_on date,
  deposit_ref text not null default '',
  deduction numeric(12,2) not null default 0 check (deduction >= 0),   -- kept back from the deposit (missing or damaged items)
  deduction_note text not null default '',
  refund_amount numeric(12,2) check (refund_amount >= 0),
  refund_on date,
  refund_ref text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists public.rental_item_rates (       -- money: Operations / Admin only
  item_id uuid primary key references public.rental_items(id) on delete cascade,
  rate numeric(12,2) not null check (rate >= 0),               -- per unit per day, before GST
  updated_at timestamptz not null default now()
);

-- ---------- 3. who can see what ----------
alter table public.rentals enable row level security;
alter table public.rental_items enable row level security;
alter table public.rental_terms enable row level security;
alter table public.rental_item_rates enable row level security;
drop policy if exists "rentals read" on public.rentals;
create policy "rentals read" on public.rentals for select to authenticated using (public.is_staff());
drop policy if exists "rental_items read" on public.rental_items;
create policy "rental_items read" on public.rental_items for select to authenticated using (public.is_staff());
drop policy if exists "rental_terms write" on public.rental_terms;
create policy "rental_terms write" on public.rental_terms for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "rental_item_rates write" on public.rental_item_rates;
create policy "rental_item_rates write" on public.rental_item_rates for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- rentals and their items are written only through the functions below
revoke insert, update, delete on public.rentals, public.rental_items from authenticated, anon;
grant select on public.rentals, public.rental_items to authenticated;
grant select, insert, update, delete on public.rental_terms, public.rental_item_rates to authenticated;

-- ---------- 4. record a delivery (and, on a JSL portal project, its Inventory entry) ----------
-- p_items: [{ "name": "Scaffolding frame", "qty": 2, "unit": "Set" }, ...]
-- p_jsl, only on a project that uses the JSL portal: null = record it in Inventory without raising an MRR (it can be switched on there later), or
--   { "received_by": "vehicle", "driver_name", "driver_dl_no", "codriver_name", "codriver_id_type", "codriver_id_no" }  (vehicle number = p_vehicle)
--   { "received_by": "hand", "person_employee_id" }  or  { "received_by": "hand", "person_name", "person_id_type", "person_id_no" }
-- The details go to inventory_gatepass exactly as if typed on the Inventory entry; an Admin authorizes it there (or the 08:30 automatic send takes it).
drop function if exists public.rental_create(uuid, uuid, date, text, text, text, text, jsonb);
create or replace function public.rental_create(p_project uuid, p_vendor uuid, p_delivered_on date, p_vehicle text, p_note_no text, p_doc_path text, p_note text, p_items jsonb, p_jsl jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); rid uuid; bid uuid; vname text; vkind text; it jsonb; n int := 0; today date := (now() at time zone 'Asia/Kolkata')::date;
  portal boolean; how text; t text;
  veh text := upper(regexp_replace(btrim(coalesce(p_vehicle, '')), '\s+', ' ', 'g'));
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can record rented items.'; end if;
  if exists (select 1 from public.projects where id = p_project and status = 'closed') then raise exception 'This project is closed.'; end if;
  select name, kind into vname, vkind from public.gas_vendors where id = p_vendor and active;
  if vname is null or vkind <> 'equipment' then raise exception 'Choose an equipment vendor.'; end if;
  if not exists (select 1 from public.gas_project_vendors where project_id = p_project and vendor_id = p_vendor) then
    insert into public.gas_project_vendors (project_id, vendor_id) values (p_project, p_vendor) on conflict do nothing;
  end if;
  if p_delivered_on is null or p_delivered_on > today then raise exception 'The delivery date cannot be in the future.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  select coalesce(jsl_portal, false) into portal from public.projects where id = p_project;
  if p_jsl is not null and jsonb_typeof(p_jsl) = 'object' then
    if not portal then raise exception 'This project does not use the JSL portal.'; end if;
    how := p_jsl ->> 'received_by'; t := coalesce(p_jsl ->> 'person_id_type', '');
    if how = 'vehicle' then
      if veh = '' or btrim(coalesce(p_jsl ->> 'driver_name', '')) = '' or btrim(coalesce(p_jsl ->> 'driver_dl_no', '')) = '' then raise exception 'For the JSL portal, enter the vehicle number, driver''s name and driver''s licence number.'; end if;
      if btrim(coalesce(p_jsl ->> 'codriver_name', '')) <> '' and (btrim(coalesce(p_jsl ->> 'codriver_id_type', '')) = '' or btrim(coalesce(p_jsl ->> 'codriver_id_no', '')) = '') then raise exception 'Enter the co-driver''s ID type and number.'; end if;
    elsif how = 'hand' then
      if nullif(p_jsl ->> 'person_employee_id', '') is not null then
        if not public.inventory_person_ok((p_jsl ->> 'person_employee_id')::uuid, p_project) then raise exception 'The person bringing it is not on this project.'; end if;
      elsif btrim(coalesce(p_jsl ->> 'person_name', '')) = '' or t = '' or btrim(coalesce(p_jsl ->> 'person_id_no', '')) = '' then raise exception 'Enter the name, ID type and ID number of the person bringing it.';
      elsif t = 'Aadhaar' and btrim(p_jsl ->> 'person_id_no') !~ '^\d{12}$' then raise exception 'An Aadhaar number has 12 digits.'; end if;
    else raise exception 'Choose by hand or by vehicle for the JSL portal.'; end if;
  else p_jsl := null; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if btrim(coalesce(it ->> 'name', '')) = '' or coalesce((it ->> 'qty')::numeric, 0) <= 0 then raise exception 'Every item needs a name and a quantity.'; end if;
  end loop;

  insert into public.rentals (project_id, vendor_id, delivered_on, delivery_vehicle, delivery_note_no, delivery_doc_path, note, entered_by, entered_role)
  values (p_project, p_vendor, p_delivered_on, veh, btrim(coalesce(p_note_no, '')), nullif(p_doc_path, ''), btrim(coalesce(p_note, '')), auth.uid(), r) returning id into rid;
  insert into public.rental_terms (rental_id) values (rid);
  -- on a JSL portal project, its Inventory entry: recorded, no amount, marked as rented; sent to the portal only when p_jsl was given
  if portal then
    insert into public.inventory_bills (project_id, kind, vendor_name, bill_no, bill_date, bill_total, bill_path, note, status, recorded_by, recorded_at, created_by, source, source_ref, jsl_wanted)
    values (p_project, 'rental', vname, btrim(coalesce(p_note_no, '')), p_delivered_on, 0, nullif(p_doc_path, ''),
            'Rented from ' || vname || ', returns to the vendor' || case when veh <> '' then '. Vehicle ' || veh else '' end,
            'recorded', auth.uid(), now(), auth.uid(), 'rental', rid::text, p_jsl is not null) returning id into bid;
    if p_jsl is not null then
      insert into public.inventory_gatepass (bill_id, received_by, person_source, person_employee_id, person_name, person_id_type, person_id_no, vehicle_no, driver_name, driver_dl_no, codriver_name, codriver_id_type, codriver_id_no)
      values (bid, how,
        case when how = 'hand' and nullif(p_jsl ->> 'person_employee_id', '') is null then 'other' else 'employee' end,
        case when how = 'hand' then nullif(p_jsl ->> 'person_employee_id', '')::uuid end,
        case when how = 'hand' then btrim(coalesce(p_jsl ->> 'person_name', '')) else '' end,
        case when how = 'hand' then t else '' end,
        case when how = 'hand' then upper(btrim(coalesce(p_jsl ->> 'person_id_no', ''))) else '' end,
        case when how = 'vehicle' then replace(veh, ' ', '') else '' end,
        case when how = 'vehicle' then btrim(p_jsl ->> 'driver_name') else '' end,
        case when how = 'vehicle' then upper(btrim(p_jsl ->> 'driver_dl_no')) else '' end,
        case when how = 'vehicle' then btrim(coalesce(p_jsl ->> 'codriver_name', '')) else '' end,
        case when how = 'vehicle' then coalesce(p_jsl ->> 'codriver_id_type', '') else '' end,
        case when how = 'vehicle' then upper(btrim(coalesce(p_jsl ->> 'codriver_id_no', ''))) else '' end);
    end if;
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    insert into public.rental_items (rental_id, line_no, name, qty, unit) values (rid, n, btrim(it ->> 'name'), (it ->> 'qty')::numeric, coalesce(nullif(btrim(it ->> 'unit'), ''), 'No'));
    if bid is not null then
      insert into public.inventory_bill_items (bill_id, line_no, name, qty, unit, rate, gst_pct) values (bid, n, btrim(it ->> 'name'), (it ->> 'qty')::numeric, coalesce(nullif(btrim(it ->> 'unit'), ''), 'No'), 0, 0);
    end if;
  end loop;
  if bid is not null then update public.rentals set inventory_bill_id = bid where id = rid; end if;
  return rid;
end $$;

-- ---------- 5. the return (all together), and undoing it ----------
-- p_missing: [{ "item_id": "...", "qty": 1 }, ...] for what did not come back
create or replace function public.rental_return(p_rental uuid, p_returned_on date, p_vehicle text, p_doc_path text, p_note text, p_missing jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x public.rentals; m jsonb; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into x from public.rentals where id = p_rental for update;
  if not public.is_staff() then raise exception 'Only Operations or an Admin can record a return.'; end if;
  if x.id is null then raise exception 'Rental not found.'; end if;
  if x.voided_at is not null then raise exception 'This rental is void.'; end if;
  if x.returned_on is not null then raise exception 'This rental is already returned.'; end if;
  if p_returned_on is null or p_returned_on < x.delivered_on or p_returned_on > today then raise exception 'The return date must be between the delivery date and today.'; end if;
  update public.rental_items set missing_qty = 0 where rental_id = p_rental;
  if jsonb_typeof(p_missing) = 'array' then
    for m in select * from jsonb_array_elements(p_missing) loop
      update public.rental_items set missing_qty = least(qty, greatest(0, coalesce((m ->> 'qty')::numeric, 0))) where id = (m ->> 'item_id')::uuid and rental_id = p_rental;
    end loop;
  end if;
  update public.rentals set returned_on = p_returned_on, return_vehicle = upper(btrim(coalesce(p_vehicle, ''))), return_doc_path = nullif(p_doc_path, ''), return_note = btrim(coalesce(p_note, '')), returned_by = auth.uid() where id = p_rental;
end $$;
create or replace function public.rental_undo_return(p_rental uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can undo a return.'; end if;
  update public.rentals set returned_on = null, return_vehicle = '', return_doc_path = null, return_note = '', returned_by = null where id = p_rental and voided_at is null;
  update public.rental_items set missing_qty = 0 where rental_id = p_rental;
end $$;

-- ---------- 6. void (a wrong entry): also voids its portal entry, unless that is on the portal ----------
create or replace function public.rental_void(p_rental uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare x public.rentals; b public.inventory_bills;
begin
  select * into x from public.rentals where id = p_rental for update;
  if x.id is null or x.voided_at is not null then raise exception 'This rental is already void.'; end if;
  if not public.is_staff() then raise exception 'Only Operations or an Admin can void a rental.'; end if;
  select * into b from public.inventory_bills where id = x.inventory_bill_id for update;
  if b.id is not null and b.voided_at is null then
    if b.jsl_status not in ('none', 'authorized', 'failed') then raise exception 'This delivery is on the JSL portal (or may be), so it cannot be voided here. Settle it on the portal first.'; end if;
    perform set_config('app.inventory', '1', true);
    update public.inventory_bills set voided_at = now(), void_reason = 'The rental was voided on Site supplies.', jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null where id = b.id;
    perform set_config('app.inventory', '', true);
  end if;
  update public.rentals set voided_at = now(), void_reason = btrim(coalesce(p_reason, '')) where id = p_rental;
end $$;

revoke all on function public.rental_create(uuid, uuid, date, text, text, text, text, jsonb, jsonb) from public, anon;
revoke all on function public.rental_return(uuid, date, text, text, text, jsonb) from public, anon;
revoke all on function public.rental_undo_return(uuid) from public, anon;
revoke all on function public.rental_void(uuid, text) from public, anon;
grant execute on function public.rental_create(uuid, uuid, date, text, text, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.rental_return(uuid, date, text, text, text, jsonb) to authenticated;
grant execute on function public.rental_undo_return(uuid) to authenticated;
grant execute on function public.rental_void(uuid, text) to authenticated;
