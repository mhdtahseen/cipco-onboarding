-- Gas deliveries become Inventory entries, automatically, so they can go to the JSL portal like any other items.
-- Recording a truck visit on Site supplies (cylinders delivered) creates ONE Inventory entry for that visit, already recorded: the gas order was approved, so the entry needs no review.
-- It carries no money: the gas money already flows through the vendor's bills and payments, so nothing here posts to expenses and nothing is counted twice.
-- Voiding a delivery on Site supplies takes it off the entry (and voids the entry when nothing is left), unless the entry has already gone to the portal.
-- An Admin can send the entry to the JSL portal exactly as for a bill (2026-11-inventory-jsl-optional.sql); the vehicle and driver are entered in its "Details for the JSL portal".
-- Safe to run more than once. Run AFTER 2026-11-gas.sql and 2026-11-inventory-approval.sql.
--
-- direction: 'in' for what comes to site. 'out' is there for later: if the empties going back ever need their own portal pass, an outgoing entry can be created the same way.

alter table public.inventory_bills add column if not exists source text;
alter table public.inventory_bills add column if not exists source_ref text;
alter table public.inventory_bills add column if not exists direction text not null default 'in';
alter table public.inventory_bills drop constraint if exists inventory_bills_direction_check;
alter table public.inventory_bills add constraint inventory_bills_direction_check check (direction in ('in', 'out'));
alter table public.inventory_bills drop constraint if exists inventory_bills_kind_check;
alter table public.inventory_bills add constraint inventory_bills_kind_check check (kind in ('bill', 'no_bill', 'gas'));
-- only a purchase bill needs a vendor, a bill number and a total above zero
alter table public.inventory_bills drop constraint if exists inventory_bills_vendor_name_check, drop constraint if exists inventory_bills_bill_no_check, drop constraint if exists inventory_bills_bill_total_check;
alter table public.inventory_bills add constraint inventory_bills_vendor_name_check check (kind <> 'bill' or btrim(vendor_name) <> '');
alter table public.inventory_bills add constraint inventory_bills_bill_no_check check (kind <> 'bill' or btrim(bill_no) <> '');
alter table public.inventory_bills add constraint inventory_bills_bill_total_check check ((kind = 'bill' and bill_total > 0) or (kind <> 'bill' and bill_total >= 0));
-- one entry per truck visit
drop index if exists public.inventory_bills_source;
create unique index inventory_bills_source on public.inventory_bills (source, source_ref) where source is not null;

-- ---------- how a delivery is named, and which visit it belongs to ----------
-- "LPG" with capacity "19KG" becomes LPG CYLINDER 19KG, the name the portal's material list uses.
create or replace function public.inventory_gas_name(p_product uuid) returns text language sql stable security definer set search_path = public as $$
  select upper(btrim(p.name)) || ' CYLINDER' || case when btrim(coalesce(p.capacity, '')) <> '' then ' ' || upper(btrim(p.capacity)) else '' end from public.gas_products p where p.id = p_product $$;

-- A visit is recorded as one row per product, so rows belong together when the project, vendor, date, challan number and challan photo are the same.
create or replace function public.inventory_gas_key(p_project uuid, p_vendor uuid, p_date date, p_challan text, p_photo text) returns text language sql immutable as $$
  select md5(concat_ws('|', p_project, p_vendor, p_date, coalesce(btrim(p_challan), ''), coalesce(p_photo, ''))) $$;

create or replace function public.inventory_gas_note(p_vendor text, p_challan text, p_order text) returns text language sql immutable as $$
  select 'Gas delivery from ' || coalesce(nullif(btrim(p_vendor), ''), 'the vendor') || case when btrim(coalesce(p_challan, '')) <> '' then ', challan ' || btrim(p_challan) else '' end || case when p_order is not null then ', order ' || p_order else '' end $$;

-- ---------- a delivery row is saved: create the visit's entry, or add to it ----------
create or replace function public.inventory_gas_add(m public.gas_movements) returns void language plpgsql security definer set search_path = public as $$
declare k text; bid uuid; nm text; vname text; ono text;
begin
  if m.kind <> 'delivery' or m.qty <= 0 or m.voided_at is not null then return; end if;
  k := public.inventory_gas_key(m.project_id, m.vendor_id, m.moved_on, m.challan_no, m.photo_path); nm := public.inventory_gas_name(m.product_id);
  select id into bid from public.inventory_bills where source = 'gas_trip' and source_ref = k;
  if bid is null then
    select name into vname from public.gas_vendors where id = m.vendor_id; select order_no into ono from public.gas_orders where id = m.order_id;
    insert into public.inventory_bills (project_id, kind, vendor_name, bill_no, bill_date, bill_total, bill_path, note, status, recorded_by, recorded_at, created_by, source, source_ref)
    values (m.project_id, 'gas', coalesce(vname, 'Gas vendor'), coalesce(btrim(m.challan_no), ''), m.moved_on, 0, m.photo_path, public.inventory_gas_note(vname, m.challan_no, ono), 'recorded', m.entered_by, now(), m.entered_by, 'gas_trip', k) returning id into bid;
  end if;
  update public.inventory_bill_items set qty = qty + m.qty where bill_id = bid and name = nm;
  if not found then
    insert into public.inventory_bill_items (bill_id, line_no, name, qty, unit, rate, gst_pct) values (bid, coalesce((select max(line_no) from public.inventory_bill_items where bill_id = bid), 0) + 1, nm, m.qty, 'No', 0, 0);
  end if;
end $$;
create or replace function public.inventory_gas_after_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.inventory_gas_add(new); return new; end $$;
drop trigger if exists inventory_gas_ins on public.gas_movements;
create trigger inventory_gas_ins after insert on public.gas_movements for each row execute function public.inventory_gas_after_insert();

-- ---------- a delivery is voided: take it off the entry ----------
create or replace function public.inventory_gas_after_void() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; b public.inventory_bills;
begin
  if new.kind <> 'delivery' or old.voided_at is not null or new.voided_at is null then return new; end if;
  select * into b from public.inventory_bills where source = 'gas_trip' and source_ref = public.inventory_gas_key(new.project_id, new.vendor_id, new.moved_on, new.challan_no, new.photo_path) for update;
  if b.id is null then return new; end if;
  if b.jsl_status not in ('none', 'authorized', 'failed') then raise exception 'This delivery is on the JSL portal (or may be), so it cannot be voided here. Settle it on the portal first.'; end if;
  -- take the cylinders off the item; an item left with none is removed (a quantity of zero is not allowed, so remove it first)
  delete from public.inventory_bill_items where bill_id = b.id and name = public.inventory_gas_name(new.product_id) and qty <= new.qty;
  update public.inventory_bill_items set qty = qty - new.qty where bill_id = b.id and name = public.inventory_gas_name(new.product_id) and qty > new.qty;
  perform set_config('app.inventory', '1', true);
  if not exists (select 1 from public.inventory_bill_items where bill_id = b.id) then
    update public.inventory_bills set voided_at = now(), void_reason = 'The gas delivery was voided on Site supplies.', jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null where id = b.id;
  else   -- the items changed, so an authorization given for the old ones no longer stands
    update public.inventory_bills set jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null where id = b.id and jsl_status = 'authorized';
  end if;
  perform set_config('app.inventory', '', true);
  return new;
end $$;
drop trigger if exists inventory_gas_void on public.gas_movements;
create trigger inventory_gas_void after update of voided_at on public.gas_movements for each row execute function public.inventory_gas_after_void();

-- ---------- only the app's own trigger can make a gas entry, and nobody can turn a draft into one ----------
drop policy if exists "inventory_bills ins" on public.inventory_bills;
create policy "inventory_bills ins" on public.inventory_bills for insert to authenticated with check (public.can_attend(project_id) and kind in ('bill', 'no_bill') and source is null and source_ref is null and direction = 'in' and status = 'draft' and jsl_status = 'none' and not jsl_wanted and voided_at is null and submitted_by is null and submitted_at is null);
create or replace function public.inventory_bill_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.inventory', true) = '1' then new.updated_at := now(); return new; end if;
  if old.voided_at is not null then raise exception 'This entry is void.'; end if;
  if old.status = 'recorded' then raise exception 'This entry is already approved and recorded. Operations or an Admin must reopen it before it can be changed.'; end if;
  if old.status = 'submitted' and not public.is_staff() then raise exception 'This entry is waiting for review, so it cannot be changed. Operations or an Admin will approve it or send it back.'; end if;
  if new.status <> old.status or new.kind <> old.kind or new.source is distinct from old.source or new.source_ref is distinct from old.source_ref or new.direction <> old.direction
     or new.jsl_status <> old.jsl_status or new.jsl_wanted <> old.jsl_wanted or new.voided_at is distinct from old.voided_at or new.project_id <> old.project_id
     or new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at or new.submitted_by is distinct from old.submitted_by or new.submitted_at is distinct from old.submitted_at
     or new.jsl_authorized_by is distinct from old.jsl_authorized_by or new.jsl_authorized_at is distinct from old.jsl_authorized_at or new.jsl_ref is distinct from old.jsl_ref or new.jsl_error is distinct from old.jsl_error or new.jsl_submitted_at is distinct from old.jsl_submitted_at then
    raise exception 'An entry''s status can only be changed with its buttons.';
  end if;
  new.updated_at := now(); return new;
end $$;

-- ---------- an entry that came from a delivery is changed on Site supplies, not here ----------
create or replace function public.inventory_take_back(p_bill uuid, p_void_reason text) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can do this.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null then raise exception 'Entry not found.'; end if;
  if b.kind = 'gas' then raise exception 'This entry comes from a gas delivery. Void the delivery on Site supplies instead.'; end if;
  if b.voided_at is not null then raise exception 'This entry is already void.'; end if;
  if p_void_reason is null and b.status <> 'recorded' then raise exception 'Only a recorded entry can be reopened.'; end if;
  if b.jsl_status not in ('none', 'authorized', 'failed') then raise exception 'This entry has gone to the JSL portal (or may have), so it cannot be changed here. Settle it on the portal first.'; end if;
  perform set_config('app.posting', '1', true);
  delete from public.project_expenses where source = 'inventory_bill' and source_id = p_bill;
  perform set_config('app.posting', '', true);
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null,
    status = 'draft', recorded_by = null, recorded_at = null, submitted_by = null, submitted_at = null,
    voided_at = case when p_void_reason is null then null else now() end, void_reason = p_void_reason where id = p_bill;
  perform set_config('app.inventory', '', true);
  insert into public.inventory_bill_events (bill_id, kind, note) values (p_bill, case when p_void_reason is null then 'reopened' else 'voided' end, coalesce(p_void_reason, ''));
end $$;

-- ---------- visits that were already recorded ----------
do $$
declare g record; bid uuid; vname text; ono text;
begin
  for g in
    select m.project_id, m.vendor_id, m.moved_on, coalesce(btrim(m.challan_no), '') as challan, m.photo_path,
           public.inventory_gas_key(m.project_id, m.vendor_id, m.moved_on, m.challan_no, m.photo_path) as k,
           (array_agg(m.order_id order by m.created_at))[1] as order_id, (array_agg(m.entered_by order by m.created_at))[1] as entered_by, min(m.created_at) as at
    from public.gas_movements m where m.kind = 'delivery' and m.qty > 0 and m.voided_at is null
    group by m.project_id, m.vendor_id, m.moved_on, coalesce(btrim(m.challan_no), ''), m.photo_path, public.inventory_gas_key(m.project_id, m.vendor_id, m.moved_on, m.challan_no, m.photo_path)
  loop
    if exists (select 1 from public.inventory_bills where source = 'gas_trip' and source_ref = g.k) then continue; end if;
    select name into vname from public.gas_vendors where id = g.vendor_id; select order_no into ono from public.gas_orders where id = g.order_id;
    insert into public.inventory_bills (project_id, kind, vendor_name, bill_no, bill_date, bill_total, bill_path, note, status, recorded_by, recorded_at, created_by, source, source_ref)
    values (g.project_id, 'gas', coalesce(vname, 'Gas vendor'), g.challan, g.moved_on, 0, g.photo_path, public.inventory_gas_note(vname, g.challan, ono), 'recorded', g.entered_by, g.at, g.entered_by, 'gas_trip', g.k) returning id into bid;
    insert into public.inventory_bill_items (bill_id, line_no, name, qty, unit, rate, gst_pct)
    select bid, row_number() over (order by x.name), x.name, x.q, 'No', 0, 0
    from (select public.inventory_gas_name(m.product_id) as name, sum(m.qty) as q from public.gas_movements m
          where m.kind = 'delivery' and m.qty > 0 and m.voided_at is null and m.project_id = g.project_id and m.vendor_id = g.vendor_id and m.moved_on = g.moved_on
            and coalesce(btrim(m.challan_no), '') = g.challan and coalesce(m.photo_path, '') = coalesce(g.photo_path, '') group by public.inventory_gas_name(m.product_id)) x;
  end loop;
end $$;

-- the triggers call these; nobody calls them directly
revoke execute on function public.inventory_gas_add(public.gas_movements), public.inventory_gas_after_insert(), public.inventory_gas_after_void(), public.inventory_gas_name(uuid) from public, anon, authenticated;
revoke execute on function public.inventory_gas_key(uuid, uuid, date, text, text), public.inventory_gas_note(text, text, text) from public, anon, authenticated;
