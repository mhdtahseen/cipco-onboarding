-- Sending an authorized bill to the JSL portal for real. Run AFTER 2026-11-inventory.sql and 2026-11-inventory-jsl-optional.sql.
--
-- The states already exist on the bill: authorized -> sending -> submitting -> submitted | failed | needs_check. This adds the rules for moving between them and one job per bill.
--   authorized   an Admin pressed Send: the bill is queued (sending) and the robot is asked to start.
--   sending      queued or running, and the Save button on the portal has NOT been pressed. Anything that goes wrong here saves nothing.
--   submitting   the robot reported "about to press Save" and then pressed it. From here nobody can say for certain whether the portal has it.
--   submitted    the portal's Report shows our requisition number. jsl_ref holds it.
--   failed       nothing was saved on the portal. Safe to authorize and send again.
--   needs_check  Save may or may not have worked. NEVER retried by itself: an Admin looks at the portal and answers (inventory_jsl_resolve).
-- The robot never talks to the tables: it calls the job and report functions below (service role only) through the app, with its own key.
-- Safe to run more than once. Nothing here removes data.

create table if not exists public.inventory_jsl_run (
  bill_id uuid primary key references public.inventory_bills(id) on delete cascade,
  attempts int not null default 0,
  queued_at timestamptz, queued_by uuid,
  claimed_at timestamptz,                -- the robot took the job (it can be taken only once per send)
  saving_at timestamptz,                 -- the robot said it was about to press Save
  expected_ref text,                     -- the requisition number the portal's form showed before saving
  updated_at timestamptz not null default now()
);
create table if not exists public.inventory_jsl_log (
  id bigserial primary key, bill_id uuid not null references public.inventory_bills(id) on delete cascade,
  at timestamptz not null default now(), stage text not null, detail text not null default '', by_user uuid
);
create index if not exists inventory_jsl_log_bill on public.inventory_jsl_log (bill_id, at);
alter table public.inventory_jsl_run enable row level security; alter table public.inventory_jsl_log enable row level security;
drop policy if exists "jsl run read" on public.inventory_jsl_run; drop policy if exists "jsl log read" on public.inventory_jsl_log;
create policy "jsl run read" on public.inventory_jsl_run for select to authenticated using (public.is_staff() or public.is_viewer());
create policy "jsl log read" on public.inventory_jsl_log for select to authenticated using (public.is_staff() or public.is_viewer());
grant select on public.inventory_jsl_run, public.inventory_jsl_log to authenticated;   -- written only by the functions below

create or replace function public.inventory_jsl_note(p_bill uuid, p_stage text, p_detail text) returns void language sql security definer set search_path = public as $$
  insert into public.inventory_jsl_log (bill_id, stage, detail, by_user) values (p_bill, p_stage, left(coalesce(p_detail, ''), 500), auth.uid()) $$;

-- ---------- the Admin's side ----------
-- Press Send: authorized -> sending. The app then starts the robot; if it cannot, it calls inventory_jsl_unqueue.
create or replace function public.inventory_jsl_queue(p_bill uuid) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  if not public.is_admin() then raise exception 'Only an Admin can send a bill to the JSL portal.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null or b.voided_at is not null or b.status <> 'recorded' then raise exception 'Only a recorded bill can be sent.'; end if;
  if not b.jsl_wanted then raise exception 'Switch on "Send to the JSL portal" for this bill first.'; end if;
  if b.jsl_status <> 'authorized' then raise exception 'This bill is not waiting to be sent (it is %).', b.jsl_status; end if;
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set jsl_status = 'sending', jsl_error = null where id = p_bill;
  perform set_config('app.inventory', '', true);
  insert into public.inventory_jsl_run (bill_id, attempts, queued_at, queued_by) values (p_bill, 1, now(), auth.uid())
    on conflict (bill_id) do update set attempts = public.inventory_jsl_run.attempts + 1, queued_at = now(), queued_by = auth.uid(), claimed_at = null, saving_at = null, expected_ref = null, updated_at = now();
  perform public.inventory_jsl_note(p_bill, 'queued', '');
end $$;

-- The robot could not be started: back to authorized. Only while the robot has not taken the job.
create or replace function public.inventory_jsl_unqueue(p_bill uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can do this.'; end if;
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills b set jsl_status = 'authorized', jsl_error = left(p_reason, 300) where b.id = p_bill and b.jsl_status = 'sending'
    and not exists (select 1 from public.inventory_jsl_run r where r.bill_id = p_bill and r.claimed_at is not null);
  if not found then perform set_config('app.inventory', '', true); raise exception 'The robot has already started, so this cannot be called back.'; end if;
  perform set_config('app.inventory', '', true);
  perform public.inventory_jsl_note(p_bill, 'unqueued', p_reason);
end $$;

-- A run that went quiet. Before Save was pressed (sending) nothing can have been saved: failed. After (submitting) nobody knows: needs_check.
create or replace function public.inventory_jsl_settle(p_bill uuid) returns text language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; r public.inventory_jsl_run; res text := 'nothing to settle';
begin
  if not public.is_admin() then raise exception 'Only an Admin can do this.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update; select * into r from public.inventory_jsl_run where bill_id = p_bill;
  perform set_config('app.inventory', '1', true);
  if b.jsl_status = 'sending' and coalesce(r.queued_at, now() - interval '1 day') < now() - interval '20 minutes' then
    update public.inventory_bills set jsl_status = 'failed', jsl_error = 'The robot did not finish. Save was never pressed, so nothing is on the portal.' where id = p_bill; res := 'failed';
  elsif b.jsl_status = 'submitting' and coalesce(r.saving_at, now() - interval '1 day') < now() - interval '15 minutes' then
    update public.inventory_bills set jsl_status = 'needs_check', jsl_error = 'The robot went quiet after pressing Save. Look on the portal for ' || coalesce(r.expected_ref, 'this bill''s requisition') || '.' where id = p_bill; res := 'needs_check';
  end if;
  perform set_config('app.inventory', '', true);
  if res <> 'nothing to settle' then perform public.inventory_jsl_note(p_bill, 'settled', res); end if;
  return res;
end $$;

-- After looking at the portal: it is there (give the requisition number) or it is not (the bill can be authorized and sent again).
create or replace function public.inventory_jsl_resolve(p_bill uuid, p_exists boolean, p_ref text) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; ref text := btrim(coalesce(p_ref, ''));
begin
  if not public.is_admin() then raise exception 'Only an Admin can do this.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null or b.jsl_status <> 'needs_check' then raise exception 'This bill is not waiting for a check.'; end if;
  if p_exists and ref = '' then raise exception 'Enter the requisition number you saw on the portal.'; end if;
  perform set_config('app.inventory', '1', true);
  if p_exists then update public.inventory_bills set jsl_status = 'submitted', jsl_ref = ref, jsl_error = null, jsl_submitted_at = now() where id = p_bill;
  else update public.inventory_bills set jsl_status = 'failed', jsl_error = 'Checked on the portal: it is not there, so nothing was saved.' where id = p_bill; end if;
  perform set_config('app.inventory', '', true);
  perform public.inventory_jsl_note(p_bill, case when p_exists then 'resolved_exists' else 'resolved_missing' end, ref);
end $$;

-- ---------- the robot's side (service role only; the app checks the robot's key before calling these) ----------
-- The job: everything the portal asks for. Can be taken once per send. Aadhaar numbers are read here and go only to the robot.
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
  select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'unit', i.unit) order by i.line_no) into items from public.inventory_bill_items i where i.bill_id = p_bill;
  if items is null then raise exception 'The bill has no items.'; end if;
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

-- The robot's progress. submitting must come BEFORE it presses Save. The rules:
--   submitting (p_ref = the requisition number the form showed): only from sending, only after the job was taken
--   submitted  (p_ref = the number the portal's Report shows): only from submitting
--   failed     nothing was saved: only from sending
--   needs_check Save may have worked: only from submitting
create or replace function public.inventory_jsl_report(p_bill uuid, p_stage text, p_ref text, p_detail text) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; r public.inventory_jsl_run;
begin
  select * into b from public.inventory_bills where id = p_bill for update; select * into r from public.inventory_jsl_run where bill_id = p_bill;
  if b.id is null then raise exception 'Bill not found.'; end if;
  perform set_config('app.inventory', '1', true);
  if p_stage = 'submitting' then
    if b.jsl_status <> 'sending' or r.claimed_at is null then perform set_config('app.inventory', '', true); raise exception 'Not in a state to save (it is %).', b.jsl_status; end if;
    if coalesce(p_ref, '') !~ '^\d{8}-\d+$' then perform set_config('app.inventory', '', true); raise exception 'The requisition number is missing or not in the expected form.'; end if;
    update public.inventory_bills set jsl_status = 'submitting' where id = p_bill;
    update public.inventory_jsl_run set saving_at = now(), expected_ref = p_ref, updated_at = now() where bill_id = p_bill;
  elsif p_stage = 'submitted' then
    if b.jsl_status <> 'submitting' then perform set_config('app.inventory', '', true); raise exception 'Not saving (it is %).', b.jsl_status; end if;
    if coalesce(p_ref, '') !~ '^\d{8}-\d+$' then perform set_config('app.inventory', '', true); raise exception 'The requisition number is missing or not in the expected form.'; end if;
    update public.inventory_bills set jsl_status = 'submitted', jsl_ref = p_ref, jsl_error = null, jsl_submitted_at = now() where id = p_bill;
  elsif p_stage = 'failed' then
    if b.jsl_status <> 'sending' then perform set_config('app.inventory', '', true); raise exception 'Cannot call this failed (it is %): Save may already have been pressed.', b.jsl_status; end if;
    update public.inventory_bills set jsl_status = 'failed', jsl_error = left(coalesce(p_detail, 'The robot stopped before saving.'), 300) where id = p_bill;
  elsif p_stage = 'needs_check' then
    if b.jsl_status <> 'submitting' then perform set_config('app.inventory', '', true); raise exception 'Not saving (it is %).', b.jsl_status; end if;
    update public.inventory_bills set jsl_status = 'needs_check', jsl_error = left(coalesce(p_detail, 'Save may or may not have worked.'), 300) where id = p_bill;
  else perform set_config('app.inventory', '', true); raise exception 'Unknown stage.'; end if;
  perform set_config('app.inventory', '', true);
  perform public.inventory_jsl_note(p_bill, p_stage, coalesce(p_ref, '') || ' ' || coalesce(p_detail, ''));
end $$;

revoke execute on function public.inventory_jsl_note(uuid, text, text), public.inventory_jsl_job(uuid), public.inventory_jsl_report(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.inventory_jsl_job(uuid), public.inventory_jsl_report(uuid, text, text, text) to service_role;
revoke execute on function public.inventory_jsl_queue(uuid), public.inventory_jsl_unqueue(uuid, text), public.inventory_jsl_settle(uuid), public.inventory_jsl_resolve(uuid, boolean, text) from public, anon;
grant execute on function public.inventory_jsl_queue(uuid), public.inventory_jsl_unqueue(uuid, text), public.inventory_jsl_settle(uuid), public.inventory_jsl_resolve(uuid, boolean, text) to authenticated;
