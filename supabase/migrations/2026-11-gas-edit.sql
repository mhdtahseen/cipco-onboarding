-- Gas deliveries: an Admin can correct any logged entry in place, and every correction is kept in a change history. Safe to run more than once.
-- NOT run by Claude: run it yourself in the Supabase SQL editor. Run AFTER 2026-11-gas-own-transport.sql and 2026-11-inventory-gas.sql.
--
-- Two kinds of correction:
--   gas_trip_edit       the truck visit as a whole: date, challan number, challan photo, who brought it (and which of our vehicles). Applied to every live entry of that
--                       visit together, so fixing a typo never splits one trip into two (which would also double the vendor's trip charge).
--   gas_movement_edit   one entry: product (same vendor), quantity, the order it is for (deliveries), note.
-- Everything linked follows: cylinder counts (an edit that would leave fewer than zero at the site is refused), order progress (old and new order), the visit's
-- Inventory entry (moved to the right date / challan, items corrected), and the trip's errand on our vehicle (made, moved or voided).
-- If the visit's Inventory entry is on the JSL portal (or may be), changing its date, challan, photo, product or quantity is refused: settle it on the portal first.
-- Notes, the order link and who brought it can still be corrected.
-- Every correction writes one row per entry to gas_movement_edits: what changed (from → to), who, when, and the reason.

create table if not exists public.gas_movement_edits (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.gas_movements(id) on delete cascade,
  changes jsonb not null,                       -- {"qty": [4, 3], "challan_no": ["123", "132"]}
  reason text not null default '',
  edited_by uuid default auth.uid(),
  edited_at timestamptz not null default now()
);
create index if not exists gas_movement_edits_movement on public.gas_movement_edits (movement_id, edited_at);
alter table public.gas_movement_edits enable row level security;
drop policy if exists "gas edits read" on public.gas_movement_edits;
create policy "gas edits read" on public.gas_movement_edits for select to authenticated using (exists (select 1 from public.gas_movements m where m.id = movement_id and public.can_attend(m.project_id)));
-- written only by the functions below

-- the guard: as before, plus a way through for the Admin's correction functions
create or replace function public.gas_movement_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); held int;
begin
  if tg_op = 'INSERT' then
    new.entered_by := auth.uid(); new.entered_role := r; new.voided_at := null;
    if new.kind in ('return','lost','damaged') then
      select coalesce(sum(case when kind = 'delivery' then qty else -qty end), 0) into held from public.gas_movements
        where project_id = new.project_id and vendor_id = new.vendor_id and product_id = new.product_id and voided_at is null;
      if new.qty > held then raise exception 'Only % of these cylinders are at this site, so % cannot be entered.', held, new.qty; end if;
    end if;
    return new;
  end if;
  if current_setting('app.gas_edit', true) = '1' then return new; end if;   -- gas_trip_edit / gas_movement_edit (Admin), which check everything themselves
  -- an update: the only things that change are the note / challan / photo and voiding; the quantity and kind are fixed once saved
  if new.project_id is distinct from old.project_id or new.vendor_id is distinct from old.vendor_id or new.product_id is distinct from old.product_id
     or new.kind is distinct from old.kind or new.qty is distinct from old.qty or new.entered_by is distinct from old.entered_by then
    raise exception 'A saved entry cannot change its cylinders or quantity: void it and enter it again.'; end if;
  if r in ('staff','admin','site_engineer') then return new; end if;
  -- a Supervisor: their own entry, within 24 hours
  if r = 'supervisor' and old.entered_by = auth.uid() and now() - old.created_at < interval '24 hours' then return new; end if;
  raise exception 'A Supervisor can correct their own entry for 24 hours. Ask the Site Engineer.';
end $$;

-- order progress: recount the order an entry was for AND the one it is for now (an edit can move a delivery from one order to another)
create or replace function public.gas_order_recount(oid uuid) returns void language plpgsql security definer set search_path = public as $$
declare ordered int; got int; st text;
begin
  if oid is null then return; end if;
  select status into st from public.gas_orders where id = oid;
  if st not in ('approved','sent','partly_delivered','delivered') then return; end if;
  select coalesce(sum(qty), 0) into ordered from public.gas_order_lines where order_id = oid;
  select coalesce(sum(qty), 0) into got from public.gas_movements where order_id = oid and kind = 'delivery' and voided_at is null;
  update public.gas_orders set status = case when got = 0 then (case when st = 'delivered' or st = 'partly_delivered' then 'sent' else st end) when got >= ordered then 'delivered' else 'partly_delivered' end where id = oid;
end $$;
create or replace function public.gas_order_progress() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.gas_order_recount(new.order_id);
  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then perform public.gas_order_recount(old.order_id); end if;
  return null;
end $$;

-- the visit's Inventory entry: is it on the JSL portal (so it must not change)?
create or replace function public.gas_bill_locked(m public.gas_movements) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inventory_bills b where b.source = 'gas_trip' and b.source_ref = public.inventory_gas_key(m.project_id, m.vendor_id, m.moved_on, m.challan_no, m.photo_path)
                 and b.voided_at is null and b.jsl_status not in ('none', 'authorized', 'failed')) $$;

-- take one delivery off its visit's Inventory entry (what voiding did), so it can be added back corrected
create or replace function public.inventory_gas_remove(m public.gas_movements) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  if m.kind <> 'delivery' or m.voided_at is not null then return; end if;
  select * into b from public.inventory_bills where source = 'gas_trip' and source_ref = public.inventory_gas_key(m.project_id, m.vendor_id, m.moved_on, m.challan_no, m.photo_path) for update;
  if b.id is null then return; end if;
  if b.jsl_status not in ('none', 'authorized', 'failed') then raise exception 'This delivery is on the JSL portal (or may be), so it cannot be changed here. Settle it on the portal first.'; end if;
  delete from public.inventory_bill_items where bill_id = b.id and name = public.inventory_gas_name(m.product_id) and qty <= m.qty;
  update public.inventory_bill_items set qty = qty - m.qty where bill_id = b.id and name = public.inventory_gas_name(m.product_id) and qty > m.qty;
  perform set_config('app.inventory', '1', true);
  if not exists (select 1 from public.inventory_bill_items where bill_id = b.id) then
    update public.inventory_bills set voided_at = now(), void_reason = 'The gas delivery was corrected on Site supplies.', jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null where id = b.id;
  else
    update public.inventory_bills set jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null where id = b.id and jsl_status = 'authorized';
  end if;
  perform set_config('app.inventory', '', true);
end $$;

-- a voided bill can come back to life when a correction moves cylinders onto its key again
create or replace function public.inventory_gas_readd(m public.gas_movements) returns void language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if m.kind <> 'delivery' or m.voided_at is not null then return; end if;
  k := public.inventory_gas_key(m.project_id, m.vendor_id, m.moved_on, m.challan_no, m.photo_path);
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set voided_at = null, void_reason = null where source = 'gas_trip' and source_ref = k and voided_at is not null;
  perform set_config('app.inventory', '', true);
  perform public.inventory_gas_add(m);
end $$;

-- no product may end up with fewer than zero cylinders at the site
create or replace function public.gas_check_held(p_project uuid, p_vendor uuid, p_product uuid) returns void language plpgsql stable security definer set search_path = public as $$
declare h int;
begin
  select coalesce(sum(case when kind = 'delivery' then qty else -qty end), 0) into h from public.gas_movements where project_id = p_project and vendor_id = p_vendor and product_id = p_product and voided_at is null;
  if h < 0 then raise exception 'That would leave % fewer % cylinders at the site than were taken back. Check the quantities.', -h, coalesce(public.inventory_gas_name(p_product), 'gas'); end if;
end $$;

create or replace function public.gas_edit_log(p_id uuid, p_old jsonb, p_new jsonb, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare ch jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['moved_on', 'challan_no', 'photo_path', 'carrier', 'vehicle_id', 'product_id', 'qty', 'order_id', 'note'] loop
    if (p_old -> k) is distinct from (p_new -> k) then ch := ch || jsonb_build_object(k, jsonb_build_array(p_old -> k, p_new -> k)); end if;
  end loop;
  if ch <> '{}'::jsonb then insert into public.gas_movement_edits (movement_id, changes, reason) values (p_id, ch, coalesce(btrim(p_reason), '')); end if;
end $$;

-- ── the visit as a whole ──
create or replace function public.gas_trip_edit(p_movement uuid, p_moved_on date, p_challan text, p_photo text, p_carrier text, p_vehicle uuid, p_reason text default '') returns int language plpgsql security definer set search_path = public as $$
declare m0 public.gas_movements; r public.gas_movements; n public.gas_movements; tref uuid; keyed boolean; vp uuid; x public.transport_errands; vname text; what text; cnt int := 0; is_trip boolean;
begin
  if not public.is_admin() then raise exception 'Only an Admin can correct a logged delivery.'; end if;
  select * into m0 from public.gas_movements where id = p_movement; if not found then raise exception 'Entry not found.'; end if;
  if m0.voided_at is not null then raise exception 'This entry is void.'; end if;
  if p_moved_on is null or p_moved_on > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Enter a date that is not in the future.'; end if;
  is_trip := m0.kind in ('delivery', 'return');
  if is_trip then
    if p_carrier not in ('vendor', 'own', 'none') then raise exception 'Choose who brought it.'; end if;
    if p_carrier = 'own' then
      if p_vehicle is null then raise exception 'Choose which of our vehicles brought it.'; end if;
      select project_id into vp from public.transport_vehicles where id = p_vehicle;
      if vp is distinct from m0.project_id then raise exception 'That vehicle is not one of this project''s transport vehicles.'; end if;
    end if;
  end if;
  keyed := p_moved_on is distinct from m0.moved_on or btrim(coalesce(p_challan, '')) is distinct from btrim(m0.challan_no) or p_photo is distinct from m0.photo_path;
  -- the entries of this visit
  create temp table if not exists _gas_trip (id uuid) on commit drop; delete from _gas_trip where true;   -- (Supabase refuses a DELETE with no WHERE clause)
  if not is_trip then insert into _gas_trip values (m0.id);
  elsif m0.trip_ref is not null then insert into _gas_trip select id from public.gas_movements where trip_ref = m0.trip_ref and voided_at is null;
  else insert into _gas_trip select id from public.gas_movements where project_id = m0.project_id and moved_on = m0.moved_on and btrim(challan_no) = btrim(m0.challan_no)
         and photo_path is not distinct from m0.photo_path and kind in ('delivery', 'return') and voided_at is null and trip_ref is null; end if;
  -- on the JSL portal: the date, challan and photo stay as they are
  if keyed and exists (select 1 from public.gas_movements g join _gas_trip t on t.id = g.id where g.kind = 'delivery' and public.gas_bill_locked(g)) then
    raise exception 'This visit is on the JSL portal (or may be), so its date, challan and photo cannot change. Settle it on the portal first.'; end if;
  tref := coalesce(m0.trip_ref, case when is_trip and p_carrier = 'own' then gen_random_uuid() end);
  perform set_config('app.gas_edit', '1', true);
  for r in select g.* from public.gas_movements g join _gas_trip t on t.id = g.id order by g.created_at loop
    if keyed then perform public.inventory_gas_remove(r); end if;
    update public.gas_movements set moved_on = p_moved_on, challan_no = btrim(coalesce(p_challan, '')), photo_path = p_photo,
      carrier = case when is_trip then p_carrier else 'vendor' end, vehicle_id = case when is_trip and p_carrier = 'own' then p_vehicle end,
      trip_ref = case when is_trip then tref else trip_ref end where id = r.id returning * into n;
    if keyed then perform public.inventory_gas_readd(n); end if;
    perform public.gas_edit_log(r.id, to_jsonb(r), to_jsonb(n), p_reason); cnt := cnt + 1;
  end loop;
  perform set_config('app.gas_edit', '', true);
  -- the trip's errand on our vehicle: one live errand when "own", none otherwise. Money is never edited, so a moved errand is voided and entered again (keeping its amount).
  if is_trip and tref is not null then
    select * into x from public.transport_errands where gas_trip_ref = tref and voided_at is null order by created_at desc limit 1;
    if p_carrier <> 'own' then
      update public.transport_errands set voided_at = now() where gas_trip_ref = tref and voided_at is null;
    elsif x.id is null or x.vehicle_id <> p_vehicle or x.work_date <> p_moved_on then
      update public.transport_errands set voided_at = now() where gas_trip_ref = tref and voided_at is null;
      select name into vname from public.gas_vendors where id = m0.vendor_id;
      what := coalesce(x.description, case when m0.kind = 'delivery' then 'Gas cylinders from ' else 'Empty gas cylinders back to ' end || coalesce(vname, 'the gas vendor')
              || case when btrim(coalesce(p_challan, '')) <> '' then ' (challan ' || btrim(p_challan) || ')' else '' end);
      insert into public.transport_errands (vehicle_id, work_date, description, amount, gas_trip_ref) values (p_vehicle, p_moved_on, what, x.amount, tref);
    end if;
  end if;
  return cnt;
end $$;

-- ── one entry ──
create or replace function public.gas_movement_edit(p_movement uuid, p_product uuid, p_qty int, p_order uuid, p_note text, p_reason text default '') returns void language plpgsql security definer set search_path = public as $$
declare o public.gas_movements; n public.gas_movements; pv uuid; ov uuid; ser int;
begin
  if not public.is_admin() then raise exception 'Only an Admin can correct a logged delivery.'; end if;
  select * into o from public.gas_movements where id = p_movement for update; if not found then raise exception 'Entry not found.'; end if;
  if o.voided_at is not null then raise exception 'This entry is void.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many cylinders.'; end if;
  select vendor_id into pv from public.gas_products where id = p_product;
  if pv is null then raise exception 'Choose the product.'; end if;
  if pv <> o.vendor_id then raise exception 'The product must be from the same vendor. For another vendor, void this entry and enter it again.'; end if;
  if o.kind <> 'delivery' and p_order is not null then raise exception 'Only a delivery can be linked to an order.'; end if;
  if p_order is not null then select vendor_id into ov from public.gas_orders where id = p_order and project_id = o.project_id;
    if ov is distinct from o.vendor_id then raise exception 'That order is not this vendor''s order for this project.'; end if; end if;
  select count(*) into ser from public.gas_movement_serials where movement_id = o.id;
  if ser > p_qty then raise exception 'This entry has % serial numbers, more than % cylinders.', ser, p_qty; end if;
  if (p_product <> o.product_id or p_qty <> o.qty) and o.kind = 'delivery' and public.gas_bill_locked(o) then
    raise exception 'This delivery is on the JSL portal (or may be), so its product and quantity cannot change. Settle it on the portal first.'; end if;
  perform set_config('app.gas_edit', '1', true);
  if p_product <> o.product_id or p_qty <> o.qty then perform public.inventory_gas_remove(o); end if;
  update public.gas_movements set product_id = p_product, qty = p_qty, order_id = case when o.kind = 'delivery' then p_order end, note = btrim(coalesce(p_note, '')) where id = o.id returning * into n;
  if p_product <> o.product_id or p_qty <> o.qty then perform public.inventory_gas_readd(n); end if;
  perform set_config('app.gas_edit', '', true);
  perform public.gas_check_held(o.project_id, o.vendor_id, o.product_id);
  if p_product <> o.product_id then perform public.gas_check_held(o.project_id, o.vendor_id, p_product); end if;
  perform public.gas_edit_log(o.id, to_jsonb(o), to_jsonb(n), p_reason);
end $$;

revoke all on function public.gas_order_recount(uuid), public.gas_bill_locked(public.gas_movements), public.inventory_gas_remove(public.gas_movements), public.inventory_gas_readd(public.gas_movements),
  public.gas_check_held(uuid, uuid, uuid), public.gas_edit_log(uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.gas_trip_edit(uuid, date, text, text, text, uuid, text), public.gas_movement_edit(uuid, uuid, int, uuid, text, text) from public, anon;
grant execute on function public.gas_trip_edit(uuid, date, text, text, text, uuid, text), public.gas_movement_edit(uuid, uuid, int, uuid, text, text) to authenticated;
