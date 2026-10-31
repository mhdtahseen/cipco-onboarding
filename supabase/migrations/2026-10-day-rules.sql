-- Day rules: a day can only be submitted and verified when it is complete, and nobody but an Admin can change anything after 11:00 PM. Safe to run again.
-- Run it in the SQL editor, AFTER 2026-10-attendance-accountability-transport.sql and 2026-10-function-permissions.sql.
--
-- 1. THE 23:00 LOCK. Supervisor, Site Engineer and Staff can change a day only until 23:00 India time ON THAT DAY. (Before, the Site Engineer and Staff had until 23:00 the
--    next day.) Only an Admin can change anything after that. Every attendance, meal, transport and sign-off change goes through check_write, so this covers all of it.
-- 2. A COMPLETE DAY means:
--      Attendance: everyone on the project has a status (weekly offs count automatically)
--      Transport:  every active vehicle has its pickup AND its drop recorded ("no show" counts as recorded)
--    Meals are NOT part of the rule: a blank meal means "did not eat" and each meal is paid for, so forcing entries would push people to invent meals.
--    Meals are watched instead: the counts are shown, reminders fire when a meal has no entries, and the counts are saved on the day when it is verified.
--    If nobody worked that day (everyone Off or Absent), only attendance is needed: no vehicles, no reminders.
-- 3. THE SUPERVISOR cannot submit an incomplete day. THE SITE ENGINEER (or Staff) cannot verify a day unless it is complete AND the Supervisor has submitted it
--    (if no Supervisor is assigned to the project, completeness is enough, so a day can never get stuck). An ADMIN can verify an incomplete day, but must give a reason,
--    and the day is then marked "verified incomplete" with that reason.
--
-- day_readiness(project, date) returns the state of a day as JSON (used by the day bar); day_readiness_core is the same without the permission check, for the
-- scheduled reminders. To look at one day:  select public.day_readiness_core('<project id>', '2026-10-31');

begin;

-- ── 1. the 23:00 lock ──
create or replace function public.write_window_end(r text, d date) returns timestamp language sql immutable set search_path = public as $$
  select case when r in ('supervisor', 'site_engineer', 'staff') then d + time '23:00' else 'infinity'::timestamp end $$;

create or replace function public.check_write(p_project uuid, p_date date) returns void language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); ist timestamp := (now() at time zone 'Asia/Kolkata');
begin
  if r is null then raise exception 'You do not have access to attendance.'; end if;
  if r = 'admin' then return; end if;
  if r in ('supervisor', 'site_engineer') and not exists (select 1 from public.user_projects where user_id = auth.uid() and project_id = p_project) then raise exception 'You are not assigned to this project.'; end if;
  if p_date > ist::date then raise exception 'Attendance cannot be entered for a future date.'; end if;
  if ist >= public.write_window_end(r, p_date) then
    raise exception 'Attendance for % is locked: it locked at 11:00 PM that day. Only an Admin can change it now.', to_char(p_date, 'DD Mon');
  end if;
  if r = 'supervisor' and exists (select 1 from public.attendance_days where project_id = p_project and work_date = p_date and verified_at is not null) then
    raise exception 'This day has been verified by the Site Engineer. Ask them to reopen it.';
  end if;
end $$;

-- ── what a verification records ──
alter table public.attendance_days add column if not exists meal_counts jsonb;                          -- {"breakfast": 12, "lunch": 12, "dinner": 0} as they stood at verification
alter table public.attendance_days add column if not exists verified_incomplete boolean not null default false;   -- an Admin verified it although it was not complete
alter table public.attendance_days add column if not exists verify_note text;                           -- the Admin's reason

-- ── 2. is the day complete? ──
create or replace function public.day_readiness_core(p_project uuid, p_date date) returns jsonb language plpgsql stable security definer set search_path = public as $$
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

  -- transport: only on a day somebody worked; each active vehicle needs its pickup and its drop
  select count(*) into vehicles from public.transport_vehicles v where v.project_id = p_project and v.active;
  if wd then
    select count(*) filter (where not exists (select 1 from public.transport_runs r where r.vehicle_id = v.id and r.work_date = p_date and r.leg = 'pickup')),
           count(*) filter (where not exists (select 1 from public.transport_runs r where r.vehicle_id = v.id and r.work_date = p_date and r.leg = 'drop'))
      into pickup_missing, drop_missing from public.transport_vehicles v where v.project_id = p_project and v.active;
    select string_agg(x.name || ' ' || x.leg, ', ' order by x.name, x.leg) into legs from (
      select v.name, l.leg from public.transport_vehicles v cross join (values ('pickup'), ('drop')) as l(leg)
      where v.project_id = p_project and v.active and not exists (select 1 from public.transport_runs r where r.vehicle_id = v.id and r.work_date = p_date and r.leg = l.leg)) x;
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
end $$;

-- the screen's version: only someone who may see that project's attendance
create or replace function public.day_readiness(p_project uuid, p_date date) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_attend(p_project) then raise exception 'Not allowed'; end if;
  return public.day_readiness_core(p_project, p_date);
end $$;

-- ── 3. submit / verify / reopen ──
create or replace function public.day_submit(p_project uuid, p_date date) returns void language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.check_write(p_project, p_date);
  r := public.day_readiness_core(p_project, p_date);
  if not (r ->> 'complete')::boolean then raise exception 'The day is not complete yet: %', array_to_string(array(select jsonb_array_elements_text(r -> 'missing')), '; '); end if;
  insert into public.attendance_days (project_id, work_date, submitted_by, submitted_at) values (p_project, p_date, auth.uid(), now())
  on conflict (project_id, work_date) do update set submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at where public.attendance_days.verified_at is null;
  perform public.log_change(p_project, p_date, null, 'day', null, 'submitted', 'submit');
end $$;

drop function if exists public.day_verify(uuid, date);
create or replace function public.day_verify(p_project uuid, p_date date, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare r jsonb; v_role text := public.app_role(); done boolean; has_sup boolean; sub timestamptz; incomplete boolean; miss text; note text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_role not in ('site_engineer', 'staff', 'admin') then raise exception 'Only the Site Engineer or an Admin can verify a day.'; end if;
  perform public.check_write(p_project, p_date);
  r := public.day_readiness_core(p_project, p_date);
  done := (r ->> 'complete')::boolean; has_sup := (r ->> 'has_supervisor')::boolean;
  select a.submitted_at into sub from public.attendance_days a where a.project_id = p_project and a.work_date = p_date;
  miss := array_to_string(array(select jsonb_array_elements_text(r -> 'missing')), '; ');
  incomplete := (not done) or (has_sup and sub is null);
  if incomplete then
    if v_role = 'admin' then
      if note is null then raise exception 'This day is not complete (%). Give a reason to verify it anyway.', coalesce(nullif(miss, ''), 'the Supervisor has not submitted it'); end if;
    elsif not done then raise exception 'The Supervisor has not completed the day yet: %', miss;
    else raise exception 'The Supervisor has not submitted the day yet.';
    end if;
  end if;
  insert into public.attendance_days (project_id, work_date, submitted_by, submitted_at, verified_by, verified_at, meal_counts, verified_incomplete, verify_note)
  values (p_project, p_date, auth.uid(), now(), auth.uid(), now(), r -> 'meals', incomplete, case when incomplete then note end)
  on conflict (project_id, work_date) do update set verified_by = auth.uid(), verified_at = now(), meal_counts = excluded.meal_counts, verified_incomplete = excluded.verified_incomplete, verify_note = excluded.verify_note,
    submitted_by = coalesce(public.attendance_days.submitted_by, auth.uid()), submitted_at = coalesce(public.attendance_days.submitted_at, now());
  perform public.log_change(p_project, p_date, null, 'day', null, case when incomplete then 'verified (incomplete: ' || note || ')' else 'verified' end, 'verify');
end $$;

create or replace function public.day_reopen(p_project uuid, p_date date) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() not in ('site_engineer', 'staff', 'admin') then raise exception 'Only the Site Engineer or an Admin can reopen a day.'; end if;
  perform public.check_write(p_project, p_date);
  update public.attendance_days set submitted_by = null, submitted_at = null, verified_by = null, verified_at = null, meal_counts = null, verified_incomplete = false, verify_note = null
   where project_id = p_project and work_date = p_date;
  perform public.log_change(p_project, p_date, null, 'day', null, 'reopened', 'reopen');
end $$;

-- who may run what (same rules as 2026-10-function-permissions.sql)
revoke all on function public.day_readiness_core(uuid, date) from public, anon, authenticated;
grant execute on function public.day_readiness_core(uuid, date) to service_role;
revoke all on function public.day_readiness(uuid, date) from public, anon;
grant execute on function public.day_readiness(uuid, date) to authenticated;
revoke all on function public.day_verify(uuid, date, text) from public, anon;
grant execute on function public.day_verify(uuid, date, text) to authenticated;

commit;
