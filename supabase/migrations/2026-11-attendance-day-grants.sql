-- Attendance: (1) an Admin can open ONE past day for ONE Supervisor / Site Engineer login, for 1, 3, 6, 12 or 24 hours; (2) "Notify" can go to the Site Engineer as well as the Supervisor.
-- Safe to run more than once. NOT run by Claude: run it yourself in the Supabase SQL editor. Run AFTER 2026-10-day-rules.sql and 2026-10-push-and-reminders.sql.
--
-- 1. DAY GRANTS. After 11:00 PM on a day, only an Admin can change that day. A grant lifts that lock for one person, one project and one day, until it runs out
--    (or the Admin takes it back). Nothing else changes: future days are still refused, a day the Site Engineer has verified is still closed to the Supervisor
--    (the Admin reopens it first), and the person can still only touch projects they are assigned to. Every grant is kept (who, for whom, which day, why, until when).
-- 2. NOTIFY. nudge_day(project, date, 'supervisor' | 'site_engineer') replaces the Supervisor-only button. The Admin can notify either; the 30-minute wait is counted
--    separately for each, so notifying one does not block the other. The old nudge_supervisor function is left as it is.

-- ── 1. grants ──
create table if not exists public.attendance_day_grants (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,                                  -- the login that may edit
  work_date date not null,                                -- the one day it may edit
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reason text,
  revoked_at timestamptz,
  revoked_by uuid
);
create index if not exists attendance_day_grants_lookup on public.attendance_day_grants (user_id, project_id, work_date);
alter table public.attendance_day_grants enable row level security;
drop policy if exists "read own day grants" on public.attendance_day_grants;
create policy "read own day grants" on public.attendance_day_grants for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());   -- written only by the functions below

-- the old lock, with one extra way through: a live grant for this person, this project and this day
create or replace function public.check_write(p_project uuid, p_date date) returns void language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); ist timestamp := (now() at time zone 'Asia/Kolkata');
begin
  if r is null then raise exception 'You do not have access to attendance.'; end if;
  if r = 'admin' then return; end if;
  if r in ('supervisor', 'site_engineer') and not exists (select 1 from public.user_projects where user_id = auth.uid() and project_id = p_project) then raise exception 'You are not assigned to this project.'; end if;
  if p_date > ist::date then raise exception 'Attendance cannot be entered for a future date.'; end if;
  if ist >= public.write_window_end(r, p_date)
     and not exists (select 1 from public.attendance_day_grants g where g.user_id = auth.uid() and g.project_id = p_project and g.work_date = p_date and g.revoked_at is null and g.expires_at > now()) then
    raise exception 'Attendance for % is locked: it locked at 11:00 PM that day. Only an Admin can change it now.', to_char(p_date, 'DD Mon');
  end if;
  if r = 'supervisor' and exists (select 1 from public.attendance_days where project_id = p_project and work_date = p_date and verified_at is not null) then
    raise exception 'This day has been verified by the Site Engineer. Ask them to reopen it.';
  end if;
end $$;

-- who an Admin can open a day for: the Supervisors and Site Engineers assigned to the project
create or replace function public.day_grant_candidates(p_project uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can do this.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', up.user_id, 'name', coalesce(public.user_label(up.user_id), 'Unnamed'), 'role', ur.role) order by ur.role, public.user_label(up.user_id))
    from public.user_projects up join public.user_roles ur on ur.user_id = up.user_id where up.project_id = p_project and ur.role in ('supervisor', 'attendance', 'site_engineer')), '[]'::jsonb);
end $$;

-- open a day: p_hours is 1, 3, 6, 12 or 24. Opening it again for the same person replaces the earlier grant.
create or replace function public.grant_day_edit(p_project uuid, p_user uuid, p_date date, p_hours int, p_reason text default null) returns timestamptz language plpgsql security definer set search_path = public as $$
declare exp timestamptz;
begin
  if not public.is_admin() then raise exception 'Only an Admin can open a day for someone.'; end if;
  if p_hours not in (1, 3, 6, 12, 24) then raise exception 'Choose 1, 3, 6, 12 or 24 hours.'; end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'A future day cannot be opened.'; end if;
  if not exists (select 1 from public.user_projects up join public.user_roles ur on ur.user_id = up.user_id where up.user_id = p_user and up.project_id = p_project and ur.role in ('supervisor', 'attendance', 'site_engineer')) then
    raise exception 'That person is not a Supervisor or Site Engineer on this project.';
  end if;
  update public.attendance_day_grants set revoked_at = now(), revoked_by = auth.uid() where user_id = p_user and project_id = p_project and work_date = p_date and revoked_at is null;
  exp := now() + make_interval(hours => p_hours);
  insert into public.attendance_day_grants (project_id, user_id, work_date, granted_by, expires_at, reason) values (p_project, p_user, p_date, auth.uid(), exp, nullif(btrim(coalesce(p_reason, '')), ''));
  return exp;
end $$;

create or replace function public.revoke_day_edit(p_grant uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can take a day back.'; end if;
  update public.attendance_day_grants set revoked_at = now(), revoked_by = auth.uid() where id = p_grant and revoked_at is null;
end $$;

revoke all on function public.check_write(uuid, date) from public, anon, authenticated;
revoke all on function public.day_grant_candidates(uuid), public.grant_day_edit(uuid, uuid, date, int, text), public.revoke_day_edit(uuid) from public, anon;
grant execute on function public.day_grant_candidates(uuid), public.grant_day_edit(uuid, uuid, date, int, text), public.revoke_day_edit(uuid) to authenticated;

-- ── 2. notify either one ──
create or replace function public.nudge_day(p_project uuid, p_date date, p_to text default 'supervisor') returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text := public.app_role(); r jsonb; miss text; recent timestamptz; pname text; who text; recips jsonb; body text; roles text[]; submitted boolean;
begin
  if p_to not in ('supervisor', 'site_engineer') then raise exception 'Choose the Supervisor or the Site Engineer.'; end if;
  if p_to = 'supervisor' and v_role not in ('site_engineer', 'staff', 'admin') then raise exception 'Only the Site Engineer or an Admin can send a reminder.'; end if;
  if p_to = 'site_engineer' and v_role <> 'admin' then raise exception 'Only an Admin can send a reminder to the Site Engineer.'; end if;
  if not public.can_attend(p_project) then raise exception 'Not allowed'; end if;
  if p_date <> (now() at time zone 'Asia/Kolkata')::date then raise exception 'Reminders can only be sent for today.'; end if;
  -- a manual reminder is told apart by who it went to (older ones carry no "to": they went to the Supervisor)
  select max(created_at) into recent from public.day_notices where project_id = p_project and work_date = p_date and kind = 'manual' and coalesce(detail ->> 'to', 'supervisor') = p_to;
  if recent is not null and recent > now() - interval '30 minutes' then
    raise exception 'A reminder was already sent at %. You can send another after %.', to_char(recent at time zone 'Asia/Kolkata', 'HH24:MI'), to_char((recent + interval '30 minutes') at time zone 'Asia/Kolkata', 'HH24:MI');
  end if;
  r := public.day_readiness_core(p_project, p_date);
  select name into pname from public.projects where id = p_project;
  miss := array_to_string(array(select jsonb_array_elements_text(r -> 'missing')), '; ');
  who := coalesce(public.user_label(auth.uid()), case when p_to = 'supervisor' then 'The Site Engineer' else 'The Admin' end);
  roles := case when p_to = 'supervisor' then array['supervisor', 'attendance'] else array['site_engineer'] end;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', up.user_id, 'name', public.user_label(up.user_id))), '[]'::jsonb) into recips
    from public.user_projects up join public.user_roles ur on ur.user_id = up.user_id where up.project_id = p_project and ur.role = any(roles);
  if jsonb_array_length(recips) = 0 then raise exception 'No % is assigned to this project.', case when p_to = 'supervisor' then 'Supervisor' else 'Site Engineer' end; end if;
  submitted := exists (select 1 from public.attendance_days where project_id = p_project and work_date = p_date and submitted_at is not null);
  if p_to = 'supervisor' then
    if miss = '' then
      if submitted then raise exception 'Nothing is missing and the day has already been submitted.'; end if;
      body := who || ' is asking you to submit ' || pname || '''s day. Everything is recorded: tap Submit day.';
    else
      body := who || ' is asking you to update ' || pname || '''s tracker: ' || miss || '.';
    end if;
  else
    if exists (select 1 from public.attendance_days where project_id = p_project and work_date = p_date and verified_at is not null) then raise exception 'The day has already been verified.'; end if;
    if miss = '' and submitted then body := who || ' is asking you to verify ' || pname || '''s day. It is complete and submitted: tap Verify day.';
    elsif miss = '' then body := who || ' is asking you to check ' || pname || '''s day. Everything is recorded; it is waiting to be submitted and verified.';
    else body := who || ' is asking you to look at ' || pname || '''s tracker: ' || miss || '.'; end if;
  end if;
  insert into public.day_notices (project_id, work_date, kind, sent_by, sent_for, recipients, detail) values (p_project, p_date, 'manual', auth.uid(), now(), recips, jsonb_build_object('missing', r -> 'missing', 'to', p_to));
  return jsonb_build_object('project', pname, 'title', pname || ' · tracker', 'body', body, 'url', '/attendance?p=' || p_project || '&d=' || p_date, 'recipients', recips, 'missing', r -> 'missing');
end $$;
revoke all on function public.nudge_day(uuid, date, text) from public, anon;
grant execute on function public.nudge_day(uuid, date, text) to authenticated;
