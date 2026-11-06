-- Sending a bill to the JSL portal becomes optional, and an Admin's choice, bill by bill.
-- Recording a bill still posts its expense on its own. Until an Admin switches "Send to the JSL portal" on for a bill, nobody can enter portal details for it or authorize it.
-- Safe to run more than once. Run AFTER 2026-11-inventory.sql.

alter table public.inventory_bills add column if not exists jsl_wanted boolean not null default false;

-- Bills that were already on the way to the portal (details entered, or any status past none) stay switched on.
select set_config('app.inventory', '1', true);
update public.inventory_bills b set jsl_wanted = true where not b.jsl_wanted and (b.jsl_status <> 'none' or exists (select 1 from public.inventory_gatepass g where g.bill_id = b.id));
select set_config('app.inventory', '', true);

-- The portal details can only be entered once the Admin has switched the bill on.
create or replace function public.inventory_gatepass_open(p_bill uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inventory_bills b where b.id = p_bill and b.voided_at is null and b.jsl_wanted and b.jsl_status in ('none', 'failed') and public.can_attend(b.project_id)) $$;

-- The switch itself moves only through inventory_set_jsl_wanted.
create or replace function public.inventory_bill_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.inventory', true) = '1' then new.updated_at := now(); return new; end if;
  if old.status <> 'draft' or old.voided_at is not null then raise exception 'This bill is already recorded. Operations or an Admin must reopen it before it can be changed.'; end if;
  if new.status <> old.status or new.jsl_status <> old.jsl_status or new.jsl_wanted <> old.jsl_wanted or new.voided_at is distinct from old.voided_at or new.project_id <> old.project_id
     or new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at or new.jsl_authorized_by is distinct from old.jsl_authorized_by
     or new.jsl_authorized_at is distinct from old.jsl_authorized_at or new.jsl_ref is distinct from old.jsl_ref or new.jsl_error is distinct from old.jsl_error or new.jsl_submitted_at is distinct from old.jsl_submitted_at then
    raise exception 'A bill''s status can only be changed with its buttons.';
  end if;
  new.updated_at := now(); return new;
end $$;
drop policy if exists "inventory_bills ins" on public.inventory_bills;
create policy "inventory_bills ins" on public.inventory_bills for insert to authenticated with check (public.can_attend(project_id) and status = 'draft' and jsl_status = 'none' and not jsl_wanted and voided_at is null);

-- The Admin's authorization needs the switch.
create or replace function public.inventory_authorize_jsl(p_bill uuid, p_wo text default null) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; g public.inventory_gatepass; wo text; n int; aad text;
begin
  if not public.is_admin() then raise exception 'Only an Admin can authorize this.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null then raise exception 'Bill not found.'; end if;
  if b.voided_at is not null or b.status <> 'recorded' then raise exception 'Only a recorded bill can be authorized.'; end if;
  if not b.jsl_wanted then raise exception 'Switch on "Send to the JSL portal" for this bill first.'; end if;
  if b.jsl_status not in ('none', 'failed') then raise exception 'This bill is already with the JSL portal.'; end if;
  select * into g from public.inventory_gatepass where bill_id = p_bill;
  if g.bill_id is null then raise exception 'Enter the JSL details first.'; end if;
  if g.received_by = 'hand' and g.person_source = 'employee' then
    if g.person_employee_id is null then raise exception 'Choose who is bringing the material.'; end if;
    if not public.inventory_person_ok(g.person_employee_id, b.project_id) then raise exception 'The person bringing the material is no longer on this project. Choose again.'; end if;
    select aadhaar into aad from public.employees where id = g.person_employee_id;
    if aad is null or aad !~ '^\d{12}$' then raise exception 'That person has no valid Aadhaar on their employee record.'; end if;
  end if;
  if g.received_by = 'hand' and g.person_source = 'other' and (btrim(g.person_name) = '' or btrim(g.person_id_type) = '' or btrim(g.person_id_no) = '') then raise exception 'Enter the name, ID type and ID number of the person bringing the material.'; end if;
  if g.received_by = 'vehicle' and (btrim(g.vehicle_no) = '' or btrim(g.driver_name) = '' or btrim(g.driver_dl_no) = '') then raise exception 'Enter the vehicle number, driver name and driver''s licence number.'; end if;
  if g.received_by = 'vehicle' and btrim(g.codriver_name) <> '' and (btrim(g.codriver_id_type) = '' or btrim(g.codriver_id_no) = '') then raise exception 'Enter the co-driver''s ID type and number.'; end if;
  select count(*), min(w.wo_no) into n, wo from public.work_orders w where w.project_id = b.project_id and w.status = 'active' and (p_wo is null or w.wo_no = p_wo);
  if n = 0 then raise exception '%', case when p_wo is null then 'This project has no active work order. Add one under Work orders first.' else 'That work order is not active on this project.' end; end if;
  if n > 1 then raise exception 'This project has more than one active work order. Choose one.'; end if;
  perform set_config('app.inventory', '1', true);
  update public.inventory_gatepass set wo_no = wo, updated_at = now() where bill_id = p_bill;
  update public.inventory_bills set jsl_status = 'authorized', jsl_authorized_by = auth.uid(), jsl_authorized_at = now(), jsl_error = null where id = p_bill;
  perform set_config('app.inventory', '', true);
end $$;

-- Admin only. On needs a recorded bill. Off is refused once the bill has gone to the portal (or may have); a bill that was only authorized is taken back to not sent.
create or replace function public.inventory_set_jsl_wanted(p_bill uuid, p_on boolean) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  if not public.is_admin() then raise exception 'Only an Admin can choose this.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null then raise exception 'Bill not found.'; end if;
  if b.voided_at is not null then raise exception 'This bill is void.'; end if;
  if b.jsl_wanted = p_on then return; end if;
  if p_on and b.status <> 'recorded' then raise exception 'Record the bill first. Only a recorded bill can be sent to the JSL portal.'; end if;
  if not p_on and b.jsl_status not in ('none', 'authorized', 'failed') then raise exception 'This bill has gone to the JSL portal (or may have), so it cannot be switched off here.'; end if;
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set jsl_wanted = p_on,
    jsl_status = case when p_on then jsl_status else 'none' end, jsl_authorized_by = case when p_on then jsl_authorized_by else null end,
    jsl_authorized_at = case when p_on then jsl_authorized_at else null end, jsl_error = case when p_on then jsl_error else null end where id = p_bill;
  perform set_config('app.inventory', '', true);
end $$;
revoke execute on function public.inventory_set_jsl_wanted(uuid, boolean) from public, anon;
grant execute on function public.inventory_set_jsl_wanted(uuid, boolean) to authenticated;
