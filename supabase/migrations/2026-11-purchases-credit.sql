-- Purchases and vendor credit (the Inventory page becomes "Purchases"; Tools & equipment becomes "Inventory"). Safe to run more than once.
-- Run AFTER 2026-11-inventory.sql, 2026-11-inventory-approval.sql, 2026-11-inventory-jsl-pick.sql, 2026-11-tools-from-bills.sql and 2026-11-consumables.sql.
--  1. purchase_vendors     the vendors bills are bought from: name, GSTIN, phone, address, credit vendor (yes/no) and an optional credit limit (a warning only).
--                          Bank details are in payee_bank (kind 'purchase_vendor'). A bill's vendor name is linked to the list by itself; a new name on a bill
--                          adds the vendor. The vendors already on bills are added once.
--  2. Each bill says whether it is paid: pay_status 'paid' (paid now: by the office by bank/UPI with a reference, or in site cash by someone) or 'to_pay'
--     (owed; due at the end of the bill's month). The cost still goes to the project's expenses when the bill is recorded, as before; paying never adds a
--     second expense. Bills already recorded stay paid. Operations or an Admin change it on a recorded bill with purchase_bill_set_paid.
--  3. purchase_payments    paying a vendor: tick the bills it pays, or a lump sum that clears the oldest bills first. Part payments are fine. Voiding a payment
--                          puts its bills back to owed. An Admin can edit a payment. A bill with payments cannot be voided or cut below what is paid.
--  4. The JSL portal: each ticked line can go with a smaller quantity than the bill's (jsl_qty). The robot's job sends that quantity.
--  5. Lines that are not stock (used at once) can be marked so, and leave the new Inventory page's "To add" list.

-- ---------- 1. vendors ----------
create table if not exists public.purchase_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  gstin text not null default '',
  phone text not null default '',
  address text not null default '',
  credit boolean not null default false,
  credit_limit numeric(12,2) check (credit_limit is null or credit_limit >= 0),
  note text not null default '',
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists purchase_vendors_name on public.purchase_vendors (lower(btrim(name)));
alter table public.purchase_vendors enable row level security;
drop policy if exists "purchase_vendors read" on public.purchase_vendors;
create policy "purchase_vendors read" on public.purchase_vendors for select to authenticated using (public.is_staff() or public.is_viewer() or public.app_role() in ('site_engineer', 'supervisor', 'attendance'));
drop policy if exists "purchase_vendors write" on public.purchase_vendors;
create policy "purchase_vendors write" on public.purchase_vendors for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update on public.purchase_vendors to authenticated;

-- bank details for paying them (the shared payee_bank table)
do $$ declare c text; begin
  if to_regclass('public.payee_bank') is not null then
    for c in select conname from pg_constraint where conrelid = 'public.payee_bank'::regclass and contype = 'c' loop execute format('alter table public.payee_bank drop constraint %I', c); end loop;
    alter table public.payee_bank add constraint payee_bank_kind_check check (kind in ('food_vendor', 'vehicle', 'room', 'gas_vendor', 'equipment_vendor', 'landlord', 'purchase_vendor'));
  end if;
end $$;

-- ---------- 2. a bill's vendor and whether it is paid ----------
alter table public.inventory_bills add column if not exists vendor_id uuid references public.purchase_vendors(id);
alter table public.inventory_bills add column if not exists pay_status text not null default 'paid';
alter table public.inventory_bills add column if not exists paid_how text not null default '';
alter table public.inventory_bills add column if not exists paid_by text not null default '';
alter table public.inventory_bills add column if not exists paid_ref text not null default '';
alter table public.inventory_bills add column if not exists paid_on date;
alter table public.inventory_bills drop constraint if exists inventory_bills_pay_status_check;
alter table public.inventory_bills add constraint inventory_bills_pay_status_check check (pay_status in ('paid', 'to_pay'));
alter table public.inventory_bills drop constraint if exists inventory_bills_paid_how_check;
alter table public.inventory_bills add constraint inventory_bills_paid_how_check check (paid_how in ('', 'office', 'site_cash'));
create index if not exists inventory_bills_vendor on public.inventory_bills (vendor_id, bill_date);

-- the vendor list follows the names typed on bills: a bill's vendor is found by name, and a new name on a bill adds the vendor
create or replace function public.inventory_bill_vendor() returns trigger language plpgsql security definer set search_path = public as $$
declare vid uuid; nm text := btrim(coalesce(new.vendor_name, ''));
begin
  if new.kind not in ('bill', 'no_bill') or nm = '' then new.vendor_id := null; return new; end if;
  if tg_op = 'UPDATE' and new.vendor_name is not distinct from old.vendor_name and new.vendor_id is not null then return new; end if;
  select id into vid from public.purchase_vendors where lower(btrim(name)) = lower(nm);
  if vid is null and new.kind = 'bill' then
    insert into public.purchase_vendors (name, gstin) values (regexp_replace(nm, '\s+', ' ', 'g'), upper(btrim(coalesce(new.vendor_gstin, '')))) on conflict do nothing returning id into vid;
    if vid is null then select id into vid from public.purchase_vendors where lower(btrim(name)) = lower(nm); end if;
  end if;
  new.vendor_id := vid;
  return new;
end $$;
drop trigger if exists inventory_bill_vendor_trg on public.inventory_bills;
create trigger inventory_bill_vendor_trg before insert or update of vendor_name, kind on public.inventory_bills for each row execute function public.inventory_bill_vendor();

-- the vendors already on bills, once
insert into public.purchase_vendors (name, gstin)
select distinct on (lower(btrim(vendor_name))) regexp_replace(btrim(vendor_name), '\s+', ' ', 'g'), upper(btrim(vendor_gstin))
from public.inventory_bills where kind = 'bill' and btrim(vendor_name) <> '' order by lower(btrim(vendor_name)), created_at desc
on conflict do nothing;
do $$ begin
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills b set vendor_id = v.id from public.purchase_vendors v
    where b.vendor_id is null and b.kind in ('bill', 'no_bill') and btrim(b.vendor_name) <> '' and lower(btrim(b.vendor_name)) = lower(btrim(v.name));
  perform set_config('app.inventory', '', true);
end $$;

-- ---------- 3. paying vendors ----------
create table if not exists public.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.purchase_vendors(id),
  paid_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'bank' check (method in ('bank', 'upi', 'cheque', 'cash')),
  reference text not null default '',
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid,
  edited_at timestamptz, edited_by uuid
);
create index if not exists purchase_payments_vendor on public.purchase_payments (vendor_id, paid_on desc);
create table if not exists public.purchase_payment_bills (
  payment_id uuid not null references public.purchase_payments(id) on delete cascade,
  bill_id uuid not null references public.inventory_bills(id),
  amount numeric(12,2) not null check (amount > 0),
  primary key (payment_id, bill_id)
);
create index if not exists purchase_payment_bills_bill on public.purchase_payment_bills (bill_id);
alter table public.purchase_payments enable row level security;
alter table public.purchase_payment_bills enable row level security;
drop policy if exists "purchase_payments read" on public.purchase_payments; create policy "purchase_payments read" on public.purchase_payments for select to authenticated using (public.is_staff() or public.is_viewer());
drop policy if exists "purchase_payment_bills read" on public.purchase_payment_bills; create policy "purchase_payment_bills read" on public.purchase_payment_bills for select to authenticated using (public.is_staff() or public.is_viewer());
revoke insert, update, delete on public.purchase_payments, public.purchase_payment_bills from authenticated, anon;
grant select on public.purchase_payments, public.purchase_payment_bills to authenticated;

-- what is paid on a bill by live payments
create or replace function public.purchase_bill_paid(p_bill uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.amount), 0) from public.purchase_payment_bills l join public.purchase_payments p on p.id = l.payment_id where l.bill_id = p_bill and p.voided_at is null $$;

-- share a payment out over bills: the ones given (in date order), or every open bill of the vendor, oldest first
create or replace function public.purchase_allocate(p_payment uuid, p_vendor uuid, p_amount numeric, p_bills uuid[]) returns void language plpgsql security definer set search_path = public as $$
declare left_ numeric := p_amount; b record; take numeric; open_total numeric := 0;
begin
  for b in select x.id, x.bill_total - public.purchase_bill_paid(x.id) as open from public.inventory_bills x
    where x.vendor_id = p_vendor and x.status = 'recorded' and x.voided_at is null and x.pay_status = 'to_pay' and x.bill_total > 0 and (p_bills is null or x.id = any (p_bills))
    order by x.bill_date, x.created_at loop
    if b.open <= 0 then continue; end if;
    open_total := open_total + b.open;
    exit when left_ <= 0;
    take := least(b.open, left_);
    insert into public.purchase_payment_bills (payment_id, bill_id, amount) values (p_payment, b.id, take);
    left_ := left_ - take;
  end loop;
  if left_ > 0.004 then raise exception 'That is ₹% more than is owed on %.', trim(to_char(left_, 'FM99999999990.00')), case when p_bills is null then 'this vendor''s bills' else 'the bills ticked' end; end if;
end $$;

-- record a payment to a vendor. p_bills: the bills it pays (null = oldest first)
create or replace function public.purchase_pay(p_vendor uuid, p_paid_on date, p_amount numeric, p_method text, p_ref text, p_note text, p_bills uuid[] default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can record a payment.'; end if;
  if p_paid_on is null or p_paid_on > today then raise exception 'The payment date cannot be in the future.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount paid.'; end if;
  if not exists (select 1 from public.purchase_vendors where id = p_vendor) then raise exception 'Vendor not found.'; end if;
  insert into public.purchase_payments (vendor_id, paid_on, amount, method, reference, note) values (p_vendor, p_paid_on, round(p_amount, 2), coalesce(nullif(p_method, ''), 'bank'), btrim(coalesce(p_ref, '')), btrim(coalesce(p_note, ''))) returning id into pid;
  perform public.purchase_allocate(pid, p_vendor, round(p_amount, 2), case when cardinality(p_bills) > 0 then p_bills end);
  return pid;
end $$;

create or replace function public.purchase_payment_void(p_payment uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can void a payment.'; end if;
  update public.purchase_payments set voided_at = now(), voided_by = auth.uid() where id = p_payment and voided_at is null;
end $$;

-- an Admin edits a payment; a new amount is shared out again over the same bills
create or replace function public.purchase_payment_update(p_payment uuid, p_paid_on date, p_amount numeric, p_method text, p_ref text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.purchase_payments; bills uuid[]; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin() then raise exception 'Only an Admin can edit a payment. Operations can void it and record it again.'; end if;
  select * into p from public.purchase_payments where id = p_payment for update;
  if p.id is null or p.voided_at is not null then raise exception 'This payment is void.'; end if;
  if p_paid_on is null or p_paid_on > today then raise exception 'The payment date cannot be in the future.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount paid.'; end if;
  if round(p_amount, 2) <> p.amount then
    select array_agg(bill_id) into bills from public.purchase_payment_bills where payment_id = p_payment;
    delete from public.purchase_payment_bills where payment_id = p_payment;
    perform public.purchase_allocate(p_payment, p.vendor_id, round(p_amount, 2), bills);
  end if;
  update public.purchase_payments set paid_on = p_paid_on, amount = round(p_amount, 2), method = coalesce(nullif(p_method, ''), method), reference = btrim(coalesce(p_ref, '')), note = btrim(coalesce(p_note, '')),
    edited_at = now(), edited_by = auth.uid() where id = p_payment;
end $$;

-- a recorded bill: paid now, or to pay (Operations / Admin)
create or replace function public.purchase_bill_set_paid(p_bill uuid, p_status text, p_how text, p_by text, p_ref text, p_on date) returns void
language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can change whether a bill is paid.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null or b.voided_at is not null then raise exception 'This bill is void.'; end if;
  if p_status not in ('paid', 'to_pay') then raise exception 'Choose paid or to pay.'; end if;
  if p_status = 'paid' and public.purchase_bill_paid(p_bill) > 0 then raise exception 'Payments to the vendor are recorded against this bill. Record a payment for the rest, or void those payments first.'; end if;
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set pay_status = p_status,
    paid_how = case when p_status = 'paid' then coalesce(nullif(p_how, ''), '') else '' end,
    paid_by = case when p_status = 'paid' then btrim(coalesce(p_by, '')) else '' end,
    paid_ref = case when p_status = 'paid' then btrim(coalesce(p_ref, '')) else '' end,
    paid_on = case when p_status = 'paid' then coalesce(p_on, b.bill_date) end where id = p_bill;
  perform set_config('app.inventory', '', true);
end $$;

-- a bill with payments cannot be voided or cut below what is paid, and cannot be called "paid now"
create or replace function public.inventory_bill_paid_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare paid numeric;
begin
  if not exists (select 1 from public.purchase_payment_bills where bill_id = new.id) then return new; end if;
  paid := public.purchase_bill_paid(new.id); if paid <= 0 then return new; end if;
  if old.voided_at is null and new.voided_at is not null then raise exception '₹% is paid to the vendor on this bill. Void those payments first.', trim(to_char(paid, 'FM99999999990.00')); end if;
  if new.bill_total < paid - 0.004 then raise exception '₹% is already paid on this bill, so its total cannot be less than that.', trim(to_char(paid, 'FM99999999990.00')); end if;
  if new.vendor_id is distinct from old.vendor_id then raise exception 'Payments to this vendor are recorded against this bill, so its vendor cannot change.'; end if;
  if new.pay_status = 'paid' and old.pay_status = 'to_pay' then raise exception 'Payments to the vendor are recorded against this bill. Void them first.'; end if;
  return new;
end $$;
drop trigger if exists inventory_bill_paid_guard_trg on public.inventory_bills;
create trigger inventory_bill_paid_guard_trg before update on public.inventory_bills for each row execute function public.inventory_bill_paid_guard();

-- ---------- 4. the JSL portal: a smaller quantity for a line ----------
alter table public.inventory_bill_items add column if not exists jsl_qty numeric(12,3);
alter table public.inventory_bill_items drop constraint if exists inventory_bill_items_jsl_qty_check;
alter table public.inventory_bill_items add constraint inventory_bill_items_jsl_qty_check check (jsl_qty is null or (jsl_qty > 0 and jsl_qty <= qty));

create or replace function public.inventory_jsl_qty(p_item uuid, p_qty numeric) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; i public.inventory_bill_items;
begin
  if not public.is_admin() then raise exception 'Only an Admin can choose what goes to the JSL portal.'; end if;
  select * into i from public.inventory_bill_items where id = p_item; if i.id is null then raise exception 'Item not found.'; end if;
  select * into b from public.inventory_bills where id = i.bill_id for update;
  if b.voided_at is not null or b.jsl_status not in ('none', 'authorized', 'failed') then raise exception 'This bill has already gone to the portal (it is %), so its items can no longer be changed.', b.jsl_status; end if;
  if p_qty is not null and (p_qty <= 0 or p_qty > i.qty) then raise exception 'For %, send between 0 and % (the quantity on the bill).', i.name, trim(to_char(i.qty, 'FM999999990.###')); end if;
  update public.inventory_bill_items set jsl_qty = case when p_qty is null or p_qty = i.qty then null else p_qty end where id = p_item;
end $$;

-- the portal guard: once on the portal, the quantity sent stays too
create or replace function public.inventory_item_portal_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare st text; ref text;
begin
  select jsl_status, jsl_ref into st, ref from public.inventory_bills where id = coalesce(new.bill_id, old.bill_id);
  if st is distinct from 'submitted' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then new.jsl_send := false; return new; end if;   -- added after the MRR: not on it
  if tg_op = 'DELETE' then
    if old.jsl_send then raise exception '% is on the JSL portal (MRR %), so it cannot be removed. Only its price can be changed.', old.name, coalesce(ref, '?'); end if;
    return old;
  end if;
  if new.jsl_send is distinct from old.jsl_send or new.jsl_qty is distinct from old.jsl_qty then raise exception 'This bill is already on the JSL portal, so the items sent cannot be changed.'; end if;
  if old.jsl_send and (new.name is distinct from old.name or new.qty is distinct from old.qty or new.unit is distinct from old.unit or new.bill_id is distinct from old.bill_id) then
    raise exception '% is on the JSL portal (MRR %): its name, quantity and unit stay as sent. Only the rate, GST and HSN can be changed.', old.name, coalesce(ref, '?');
  end if;
  return new;
end $$;

-- the robot's job, as before, with each line's portal quantity
create or replace function public.inventory_jsl_job(p_bill uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; r public.inventory_jsl_run; g public.inventory_gatepass; e public.employees; items jsonb; j jsonb;
  idk text; idn text; nm text;
begin
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null or b.jsl_status <> 'sending' then raise exception 'This bill is not waiting for the robot (it is %).', coalesce(b.jsl_status, 'missing'); end if;
  select * into r from public.inventory_jsl_run where bill_id = p_bill;
  if r.claimed_at is not null then raise exception 'This send was already picked up.'; end if;
  select * into g from public.inventory_gatepass where bill_id = p_bill;
  if g.bill_id is null or btrim(g.wo_no) = '' then raise exception 'The portal details or work order are missing.'; end if;
  select jsonb_agg(jsonb_build_object('name', i.name, 'qty', least(coalesce(i.jsl_qty, i.qty), i.qty), 'unit', i.unit) order by i.line_no) into items from public.inventory_bill_items i where i.bill_id = p_bill and i.jsl_send;   -- only the items ticked to send, at their portal quantity
  if items is null then raise exception 'No items on this bill are ticked to send to the portal.'; end if;
  j := jsonb_build_object('receivedBy', g.received_by, 'wo', btrim(g.wo_no), 'department', 'MECHANICAL', 'items', items);
  if g.received_by = 'hand' then
    if g.person_source = 'employee' then
      select * into e from public.employees where id = g.person_employee_id;
      if e.id is null or e.aadhaar !~ '^\d{12}$' then raise exception 'The person bringing the material has no valid Aadhaar on their employee record.'; end if;
      nm := e.full_name; idk := 'aadhaar'; idn := e.aadhaar;
    else nm := g.person_name; idk := case when lower(g.person_id_type) like 'aadhaar%' then 'aadhaar' when lower(g.person_id_type) like 'voter%' then 'voter' end; idn := g.person_id_no; end if;
    if btrim(coalesce(nm, '')) = '' or idk is null or btrim(coalesce(idn, '')) = '' then raise exception 'The person bringing the material is incomplete.'; end if;
    j := j || jsonb_build_object('hand', jsonb_build_object('name', upper(btrim(nm)), 'idType', idk, 'idNo', upper(btrim(idn))));
  else
    if btrim(g.vehicle_no) = '' or btrim(g.driver_name) = '' or btrim(g.driver_dl_no) = '' then raise exception 'The vehicle details are incomplete.'; end if;
    j := j || jsonb_build_object('vehicle', jsonb_build_object('vehicleNo', upper(btrim(g.vehicle_no)), 'driverName', upper(btrim(g.driver_name)), 'driverDl', upper(btrim(g.driver_dl_no))));
    if btrim(g.codriver_name) <> '' then
      idk := case when lower(g.codriver_id_type) like 'aadhaar%' then 'aadhaar' when lower(g.codriver_id_type) like 'voter%' then 'voter' end;
      if idk is null or btrim(g.codriver_id_no) = '' then raise exception 'The co-driver details are incomplete.'; end if;
      j := jsonb_set(j, '{vehicle,coDriver}', jsonb_build_object('name', upper(btrim(g.codriver_name)), 'idType', idk, 'idNo', upper(btrim(g.codriver_id_no))));
    end if;
  end if;
  update public.inventory_jsl_run set claimed_at = now(), updated_at = now() where bill_id = p_bill;
  perform public.inventory_jsl_note(p_bill, 'claimed', '');
  return j;
end $$;

-- ---------- 5. lines that are not stock ----------
alter table public.inventory_bill_items add column if not exists stock_skip boolean not null default false;
create or replace function public.inventory_item_stock_skip(p_item uuid, p_skip boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can do this.'; end if;
  update public.inventory_bill_items set stock_skip = coalesce(p_skip, false) where id = p_item;
end $$;

-- ---------- who may call what ----------
revoke all on function public.purchase_bill_paid(uuid), public.purchase_allocate(uuid, uuid, numeric, uuid[]) from public, anon, authenticated;
grant execute on function public.purchase_bill_paid(uuid) to authenticated;
revoke all on function public.purchase_pay(uuid, date, numeric, text, text, text, uuid[]), public.purchase_payment_void(uuid), public.purchase_payment_update(uuid, date, numeric, text, text, text),
  public.purchase_bill_set_paid(uuid, text, text, text, text, date), public.inventory_jsl_qty(uuid, numeric), public.inventory_item_stock_skip(uuid, boolean) from public, anon;
grant execute on function public.purchase_pay(uuid, date, numeric, text, text, text, uuid[]), public.purchase_payment_void(uuid), public.purchase_payment_update(uuid, date, numeric, text, text, text),
  public.purchase_bill_set_paid(uuid, text, text, text, text, date), public.inventory_jsl_qty(uuid, numeric), public.inventory_item_stock_skip(uuid, boolean) to authenticated;
revoke all on function public.inventory_jsl_job(uuid) from public, anon, authenticated;
