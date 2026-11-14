-- Choose which items of a bill go to the JSL portal (14 Nov 2026). A bill may have 10 items while only some belong on the MRR.
-- Every item is ticked by default (existing items too). An Admin ticks or unticks them in "4. Send to the JSL portal" any time before the
-- bill is sent (portal status none, authorized or failed). Items of a recorded bill are otherwise locked, so the tick goes through
-- inventory_jsl_pick, which changes nothing but this flag. The robot's job (inventory_jsl_job) sends only the ticked items.

alter table public.inventory_bill_items add column if not exists jsl_send boolean not null default true;

create or replace function public.inventory_jsl_pick(p_item uuid, p_on boolean) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  if not public.is_admin() then raise exception 'Only an Admin can choose what goes to the JSL portal.'; end if;
  select b2.* into b from public.inventory_bills b2 join public.inventory_bill_items i on i.bill_id = b2.id where i.id = p_item for update of b2;
  if b.id is null then raise exception 'Item not found.'; end if;
  if b.voided_at is not null or b.jsl_status not in ('none', 'authorized', 'failed') then raise exception 'This bill has already gone to the portal (it is %), so its items can no longer be changed.', b.jsl_status; end if;
  update public.inventory_bill_items set jsl_send = coalesce(p_on, true) where id = p_item;
end $$;
revoke execute on function public.inventory_jsl_pick(uuid, boolean) from public, anon;
grant execute on function public.inventory_jsl_pick(uuid, boolean) to authenticated;

-- The robot's job, as in 2026-11-inventory-jsl-send.sql, sending only the ticked items.
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
  select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'unit', i.unit) order by i.line_no) into items from public.inventory_bill_items i where i.bill_id = p_bill and i.jsl_send;   -- only the items ticked to send
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

-- ---------- Correcting prices on a bill that is already on the JSL portal ----------
-- The portal only has each item's name, quantity and unit, never a price. So a bill already submitted to JSL can be reopened
-- (Operations or Admin) to correct rates, GST, other charges and the bill total, then recorded again. While it is reopened:
--   * the items that went to the portal keep their name, quantity and unit, and cannot be removed;
--   * items added now (or ones that were left off the portal) are not on the MRR and can be changed freely;
--   * the bill keeps its portal status and MRR reference, so it is never sent again;
--   * its tools register entries stay (the names and quantities they came from cannot change).
-- Voiding or discarding a bill that is on the portal is still refused.

create or replace function public.inventory_take_back(p_bill uuid, p_void_reason text) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; on_portal boolean;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can do this.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null then raise exception 'Entry not found.'; end if;
  if b.kind = 'gas' then raise exception 'This entry comes from a gas delivery. Void the delivery on Site supplies instead.'; end if;
  if b.voided_at is not null then raise exception 'This entry is already void.'; end if;
  if p_void_reason is null and b.status <> 'recorded' then raise exception 'Only a recorded entry can be reopened.'; end if;
  on_portal := b.jsl_status = 'submitted';
  if on_portal and p_void_reason is not null then raise exception 'This bill is on the JSL portal (MRR %), so it cannot be voided here. Reopen it to correct its prices instead.', coalesce(b.jsl_ref, '?'); end if;
  if b.jsl_status not in ('none', 'authorized', 'failed') and not on_portal then raise exception 'This entry has gone to the JSL portal (or may have), so it cannot be changed here. Settle it on the portal first.'; end if;
  perform set_config('app.posting', '1', true);
  delete from public.project_expenses where source = 'inventory_bill' and source_id = p_bill;
  perform set_config('app.posting', '', true);
  perform set_config('app.inventory', '1', true);
  if on_portal then   -- keep everything about the portal: it stays submitted, with its MRR reference
    update public.inventory_bills set status = 'draft', recorded_by = null, recorded_at = null, submitted_by = null, submitted_at = null where id = p_bill;
  else
    update public.inventory_bills set jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null,
      status = 'draft', recorded_by = null, recorded_at = null, submitted_by = null, submitted_at = null,
      voided_at = case when p_void_reason is null then null else now() end, void_reason = p_void_reason where id = p_bill;
  end if;
  perform set_config('app.inventory', '', true);
  insert into public.inventory_bill_events (bill_id, kind, note) values (p_bill, case when p_void_reason is null then 'reopened' else 'voided' end,
    case when on_portal then 'To correct prices. On the JSL portal as MRR ' || coalesce(b.jsl_ref, '?') || ': items stay as sent.' else coalesce(p_void_reason, '') end);
end $$;

-- the items of a reopened bill that is on the portal
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
  if new.jsl_send is distinct from old.jsl_send then raise exception 'This bill is already on the JSL portal, so the items sent cannot be changed.'; end if;
  if old.jsl_send and (new.name is distinct from old.name or new.qty is distinct from old.qty or new.unit is distinct from old.unit or new.bill_id is distinct from old.bill_id) then
    raise exception '% is on the JSL portal (MRR %): its name, quantity and unit stay as sent. Only the rate, GST and HSN can be changed.', old.name, coalesce(ref, '?');
  end if;
  return new;
end $$;
drop trigger if exists inventory_item_portal_guard_trg on public.inventory_bill_items;
create trigger inventory_item_portal_guard_trg before insert or update or delete on public.inventory_bill_items for each row execute function public.inventory_item_portal_guard();

-- a bill that is on (or may be on) the portal can never be discarded
create or replace function public.inventory_bill_delete_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.jsl_status not in ('none', 'authorized', 'failed') then raise exception 'This bill has gone to the JSL portal, so it cannot be discarded.'; end if;
  return old;
end $$;
drop trigger if exists inventory_bill_delete_guard_trg on public.inventory_bills;
create trigger inventory_bill_delete_guard_trg before delete on public.inventory_bills for each row execute function public.inventory_bill_delete_guard();

-- reopening a portal bill to fix prices leaves its tools register entries alone
create or replace function public.tool_bill_taken_back() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.jsl_status = 'submitted' and new.voided_at is null then return null; end if;   -- a price correction: names and quantities cannot change
  if (old.status = 'recorded' and new.status <> 'recorded') or (old.voided_at is null and new.voided_at is not null) then
    update public.tool_moves set voided_at = now(), voided_by = auth.uid(), void_reason = 'The bill was ' || case when new.voided_at is not null then 'voided' else 'reopened' end || ' in Inventory'
      where voided_at is null and bill_item_id in (select id from public.inventory_bill_items where bill_id = new.id);
  end if;
  return null;
end $$;
