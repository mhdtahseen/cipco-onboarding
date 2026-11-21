-- Which vehicles do employee transport. Every transport vendor is on-demand and can run errands (office or vendor-entered, approved and paid);
-- only the vehicles ticked "Employee transport" also do the daily staff pickups and drops: they appear on the attendance sheet, need their pickup
-- and drop each working day, and carry a trip billing (per trip / monthly) and rate. An unticked vehicle is errands only.
--  - Existing vehicles are ticked (they are on attendance today). New vehicles start unticked.
--  - Unticking keeps history: records already made stay (and stay billed); a new pickup / drop is refused for an unticked vehicle.
--  - The day's checklist (day_readiness_core) only waits for ticked vehicles. The vendor's page is told, to hide pickups and drops for errands only.
-- Safe to run more than once. Run AFTER 2026-11-vendor-own-pin.sql.

alter table public.transport_vehicles add column if not exists staff_transport boolean not null default true;   -- true for the vehicles already there
alter table public.transport_vehicles alter column staff_transport set default false;                         -- new vehicles: errands only until ticked

CREATE OR REPLACE FUNCTION public.day_readiness_core(p_project uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  dn text := to_char(p_date, 'FMDay');
  people int; marked int; worked int; wd boolean;
  vehicles int; pickup_missing int := 0; drop_missing int := 0;
  mb int; ml int; md int; has_sup boolean;
  miss text[] := '{}'; unmarked_names text; legs text;
begin
  -- the people on the sheet: the same roster the attendance screen shows, and what each one's day counts as (a saved status, else weekly off on their off day, else nothing yet)
  with eff as (
    select e.id, e.full_name, coalesce(a.status, case when e.week_off is not null and e.week_off = dn then 'off' end) as st
    from public.employees e left join public.attendance a on a.employee_id = e.id and a.work_date = p_date
    where (e.project_id = p_project and e.outcome <> 'rejected' and e.join_date is not null and e.join_date <= p_date and (e.left_on is null or e.left_on >= p_date))
       or e.id in (select x.employee_id from public.attendance x where x.project_id = p_project and x.work_date = p_date)
  )
  select count(*), count(*) filter (where st is not null), count(*) filter (where st in ('present', 'half')),
         (select string_agg(n.full_name, ', ' order by n.full_name) from (select full_name from eff where st is null order by full_name limit 3) n)
    into people, marked, worked, unmarked_names from eff;
  wd := worked > 0;
  if people - marked > 0 then miss := miss || ('Attendance: ' || (people - marked) || ' not marked' || case when unmarked_names is not null then ' (' || unmarked_names || case when people - marked > 3 then ' and more' else '' end || ')' else '' end); end if;

  -- transport: only on a day somebody worked; each active vehicle used for employee transport needs its pickup and its drop
  select count(*) into vehicles from public.transport_vehicles v where v.project_id = p_project and v.active and v.staff_transport;
  if wd then
    select count(*) filter (where not exists (select 1 from public.transport_runs r where r.vehicle_id = v.id and r.work_date = p_date and r.leg = 'pickup')),
           count(*) filter (where not exists (select 1 from public.transport_runs r where r.vehicle_id = v.id and r.work_date = p_date and r.leg = 'drop'))
      into pickup_missing, drop_missing from public.transport_vehicles v where v.project_id = p_project and v.active and v.staff_transport;
    select string_agg(x.name || ' ' || x.leg, ', ' order by x.name, x.leg) into legs from (
      select v.name, l.leg from public.transport_vehicles v cross join (values ('pickup'), ('drop')) as l(leg)
      where v.project_id = p_project and v.active and v.staff_transport and not exists (select 1 from public.transport_runs r where r.vehicle_id = v.id and r.work_date = p_date and r.leg = l.leg)) x;
    if legs is not null then miss := miss || ('Transport: ' || legs); end if;
  end if;

  -- meals are only counted (watched, never required)
  select count(*) filter (where breakfast_vendor_id is not null), count(*) filter (where lunch_vendor_id is not null), count(*) filter (where dinner_vendor_id is not null)
    into mb, ml, md from public.attendance where project_id = p_project and work_date = p_date;
  has_sup := exists (select 1 from public.user_projects up join public.user_roles ur on ur.user_id = up.user_id where up.project_id = p_project and ur.role in ('supervisor', 'attendance'));

  return jsonb_build_object(
    'people', people, 'marked', marked, 'unmarked', people - marked, 'worked', worked, 'work_day', wd,
    'vehicles', vehicles, 'legs_expected', case when wd then vehicles * 2 else 0 end, 'pickup_missing', pickup_missing, 'drop_missing', drop_missing,
    'legs_recorded', case when wd then vehicles * 2 - pickup_missing - drop_missing else 0 end,
    'meals', jsonb_build_object('breakfast', mb, 'lunch', ml, 'dinner', md),
    'has_supervisor', has_sup, 'complete', (people = marked and pickup_missing = 0 and drop_missing = 0), 'missing', to_jsonb(miss));
end $function$;

CREATE OR REPLACE FUNCTION public.transport_run_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare rk int := public.role_rank(public.app_role());
begin
  if public.app_role() is null then raise exception 'You do not have access to attendance.'; end if;
  if tg_op in ('UPDATE','DELETE') then perform public.check_write(old.project_id, old.work_date); end if;
  if tg_op = 'DELETE' then return old; end if;
  perform public.check_write(new.project_id, new.work_date);
  if not exists (select 1 from public.transport_vehicles v where v.id = new.vehicle_id and v.project_id = new.project_id) then raise exception 'That vehicle does not belong to this project.'; end if;
  if tg_op = 'INSERT' and not exists (select 1 from public.transport_vehicles v where v.id = new.vehicle_id and v.staff_transport) then raise exception 'This vehicle is not used for employee transport. An Admin can tick "Employee transport" for it under Transport.'; end if;   -- corrections to past records stay possible
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.work_date <> old.work_date or new.leg <> old.leg or new.vehicle_id <> old.vehicle_id) then raise exception 'A record''s site, day, direction and vehicle cannot be changed.'; end if;
  if new.status = 'no_show' then new.at := null;
  else
    new.at := coalesce(new.at, now());
    if (new.at at time zone 'Asia/Kolkata')::date <> new.work_date then raise exception 'The time must fall on the same day.'; end if;
    if public.app_role() <> 'admin' and new.at > now() + interval '5 minutes' then raise exception 'A time cannot be stamped in the future.'; end if;
  end if;
  new.created_by := coalesce(case when tg_op = 'UPDATE' then old.created_by end, auth.uid());
  new.rank := greatest(case when tg_op = 'UPDATE' then old.rank else 1 end, rk, 1)::smallint; new.set_by_role := public.app_role(); new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.vendor_get(p_token text, p_session text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare l public.vendor_links := public.vendor_session(p_token, p_session); v public.transport_vehicles;
begin
  if l.id is null then
    if not exists (select 1 from public.vendor_links where token = p_token and revoked_at is null) then return jsonb_build_object('ok', false, 'gone', true); end if;
    return jsonb_build_object('ok', false, 'pin', true);
  end if;
  select * into v from public.transport_vehicles where id = l.vehicle_id;
  return jsonb_build_object('ok', true,
    'today', (now() at time zone 'Asia/Kolkata')::date,
    'vehicle', jsonb_build_object('id', v.id, 'project_id', v.project_id, 'name', v.name, 'operator', v.operator, 'billing', v.billing, 'staff_transport', v.staff_transport, 'active', v.active, 'sort_order', v.sort_order),
    'project', (select p.name from public.projects p where p.id = v.project_id),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'vehicle_id', r.vehicle_id, 'price', r.price, 'effective_from', r.effective_from) order by r.effective_from) from public.transport_rates r where r.vehicle_id = v.id), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'project_id', r.project_id, 'vehicle_id', r.vehicle_id, 'work_date', r.work_date, 'leg', r.leg, 'status', r.status, 'at', null) order by r.work_date, r.leg)
      from public.transport_runs r where r.vehicle_id = v.id and r.project_id = v.project_id), '[]'::jsonb),
    'errands', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'vehicle_id', e.vehicle_id, 'work_date', e.work_date, 'description', e.description, 'amount', e.amount, 'quoted_amount', e.quoted_amount,
        'approval', e.approval, 'source', e.source, 'asked_by', e.asked_by, 'from_place', e.from_place, 'to_place', e.to_place, 'decision_note', e.decision_note, 'decided_at', e.decided_at, 'created_at', e.created_at, 'voided_at', null) order by e.work_date desc, e.created_at desc)
      from public.transport_errands e where e.vehicle_id = v.id and e.voided_at is null), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'vehicle_id', p.vehicle_id, 'paid_on', p.paid_on, 'amount', p.amount, 'reference', p.reference, 'voided_at', null) order by p.paid_on desc, p.created_at desc)
      from public.transport_payments p where p.vehicle_id = v.id and p.voided_at is null), '[]'::jsonb),
    -- who may have asked: Admins and Operations, and the Site Engineers and Supervisors of this vehicle's project. Names only.
    'askers', coalesce((select jsonb_agg(n order by n) from (select distinct btrim(up.full_name) as n from public.user_roles r join public.user_profiles up on up.user_id = r.user_id
        where btrim(coalesce(up.full_name, '')) <> '' and not coalesce(r.practice, false)
          and (r.role in ('admin', 'staff') or (r.role in ('site_engineer', 'supervisor') and exists (select 1 from public.user_projects x where x.user_id = r.user_id and x.project_id = v.project_id)))) q), '[]'::jsonb));
end $function$;
