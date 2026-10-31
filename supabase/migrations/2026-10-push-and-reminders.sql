-- Phone notifications and the automatic reminders. Safe to run again. Run it in the SQL editor, AFTER 2026-10-day-rules.sql.
--
-- What this adds
--   push_subscriptions  one row per phone/browser that agreed to notifications (so a reminder can reach it)
--   day_notices         a log of every reminder sent for a project's day (automatic or by a person), so each automatic one is sent only once
--   app_settings        three settings: cron_url, cron_secret (for the scheduled job) and relogin_before (see 2026-10-force-relogin.sql)
--   nudge_supervisor    the "Notify supervisor" button: checks who is asking, refuses a repeat within 30 minutes, and says what is missing
--   day_watch_snapshot  everything the scheduled job needs to decide who to remind (only the server can run it)
--   a scheduled job     every 5 minutes it calls your app's /api/cron/day-watch (needs the pg_cron and pg_net extensions)
--
-- AFTER RUNNING THIS you must give the scheduled job two values (put your real ones in; do not save them in a file in the repo):
--     update public.app_settings set value = 'https://YOUR-APP-ADDRESS/api/cron/day-watch' where key = 'cron_url';
--     update public.app_settings set value = 'THE-SAME-SECRET-AS-CRON_SECRET-IN-YOUR-HOSTING-SETTINGS' where key = 'cron_secret';
-- Until cron_url is filled in, the job does nothing. If pg_cron / pg_net cannot be switched on from here, enable them under Database → Extensions and run the
-- last block of this file again, or point any scheduler (for example cron-job.org) at the same address every 5 minutes with the header  x-cron-secret: <the secret>.
--
-- THE REMINDERS (India time; each is sent once per project per day, and only if what it checks is still missing)
--   10:30  attendance not fully marked, or a pickup / breakfast not recorded      → Supervisor and Site Engineer
--   15:00  nobody has a lunch recorded                                             → Supervisor
--   19:30  a vehicle's drop is not recorded                                        → Supervisor
--   21:30  nobody has a dinner recorded                                            → Supervisor
--   22:00  the day is still not complete (or complete but not submitted)           → Supervisor and Site Engineer
--   22:30  still not complete                                                      → Supervisor, Site Engineer and Admin
--   as soon as the Supervisor submits a complete day                               → Site Engineer: "ready to verify and close"
--   23:05  still not verified                                                      → Admin: only an Admin can close it now
-- A day where nobody worked sends nothing. A project with no Supervisor sends the Supervisor reminders to the Admin instead.

-- ── phones that agreed to notifications ──
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  fail_count int not null default 0
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "own push delete" on public.push_subscriptions;
create policy "own push delete" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
-- inserts go through the function below, so a shared phone moves to whoever signs in on it

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, fail_count = 0;
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- signing out on a shared phone: stop this person's reminders reaching it
create or replace function public.drop_push_subscription(p_endpoint text) returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() $$;
revoke all on function public.drop_push_subscription(text) from public, anon;
grant execute on function public.drop_push_subscription(text) to authenticated;

-- ── the log of reminders ──
create table if not exists public.day_notices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  work_date date not null,
  kind text not null check (kind in ('morning', 'lunch', 'drop', 'dinner', 'final', 'escalate', 'ready', 'admin_late', 'manual')),
  sent_for timestamptz,                         -- 'ready' is sent once per submission, so it carries the submission time; a manual one carries its own time
  sent_by uuid,                                 -- who pressed the button (manual ones only)
  recipients jsonb not null default '[]',
  detail jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists day_notices_once on public.day_notices (project_id, work_date, kind, coalesce(sent_for, 'epoch'::timestamptz));
create index if not exists day_notices_day on public.day_notices (project_id, work_date);
alter table public.day_notices enable row level security;
drop policy if exists "read day notices" on public.day_notices;
create policy "read day notices" on public.day_notices for select to authenticated using (public.can_attend(project_id));   -- written only by the server

-- ── settings ──
create table if not exists public.app_settings (key text primary key, value text not null default '', updated_at timestamptz not null default now());
insert into public.app_settings (key, value) values ('cron_url', ''), ('cron_secret', ''), ('relogin_before', '') on conflict (key) do nothing;
alter table public.app_settings enable row level security;
drop policy if exists "admin settings" on public.app_settings;
create policy "admin settings" on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- anyone signed in may ask only this one setting: "sign out everyone who signed in before this moment" (used by the page guard)
create or replace function public.relogin_before() returns timestamptz language sql stable security definer set search_path = public as $$
  select nullif(btrim(value), '')::timestamptz from public.app_settings where key = 'relogin_before' $$;
revoke all on function public.relogin_before() from public, anon;
grant execute on function public.relogin_before() to authenticated;

-- ── the "Notify supervisor" button ──
create or replace function public.nudge_supervisor(p_project uuid, p_date date) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text := public.app_role(); r jsonb; miss text; recent timestamptz; pname text; who text; recips jsonb; body text;
begin
  if v_role not in ('site_engineer', 'staff', 'admin') then raise exception 'Only the Site Engineer or an Admin can send a reminder.'; end if;
  if not public.can_attend(p_project) then raise exception 'Not allowed'; end if;
  if p_date <> (now() at time zone 'Asia/Kolkata')::date then raise exception 'Reminders can only be sent for today.'; end if;
  select max(created_at) into recent from public.day_notices where project_id = p_project and work_date = p_date and kind = 'manual';
  if recent is not null and recent > now() - interval '30 minutes' then
    raise exception 'A reminder was already sent at %. You can send another after %.', to_char(recent at time zone 'Asia/Kolkata', 'HH24:MI'), to_char((recent + interval '30 minutes') at time zone 'Asia/Kolkata', 'HH24:MI');
  end if;
  r := public.day_readiness_core(p_project, p_date);
  select name into pname from public.projects where id = p_project;
  miss := array_to_string(array(select jsonb_array_elements_text(r -> 'missing')), '; ');
  who := coalesce(public.user_label(auth.uid()), 'The Site Engineer');
  select coalesce(jsonb_agg(jsonb_build_object('user_id', up.user_id, 'name', public.user_label(up.user_id))), '[]'::jsonb) into recips
    from public.user_projects up join public.user_roles ur on ur.user_id = up.user_id where up.project_id = p_project and ur.role in ('supervisor', 'attendance');
  if jsonb_array_length(recips) = 0 then raise exception 'No Supervisor is assigned to this project.'; end if;
  if miss = '' then
    if exists (select 1 from public.attendance_days where project_id = p_project and work_date = p_date and submitted_at is not null) then raise exception 'Nothing is missing and the day has already been submitted.'; end if;
    body := who || ' is asking you to submit ' || pname || '''s day. Everything is recorded: tap Submit day.';
  else
    body := who || ' is asking you to update ' || pname || '''s tracker: ' || miss || '.';
  end if;
  insert into public.day_notices (project_id, work_date, kind, sent_by, sent_for, recipients, detail) values (p_project, p_date, 'manual', auth.uid(), now(), recips, jsonb_build_object('missing', r -> 'missing'));
  return jsonb_build_object('project', pname, 'title', pname || ' · tracker', 'body', body, 'url', '/attendance?p=' || p_project || '&d=' || p_date, 'recipients', recips, 'missing', r -> 'missing');
end $$;
revoke all on function public.nudge_supervisor(uuid, date) from public, anon;
grant execute on function public.nudge_supervisor(uuid, date) to authenticated;

-- ── what the scheduled job looks at (server only) ──
create or replace function public.day_watch_snapshot(p_date date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare projects jsonb := '[]'::jsonb; p record; admins jsonb;
begin
  select coalesce(jsonb_agg(user_id), '[]'::jsonb) into admins from public.user_roles where role = 'admin';
  for p in select id, name from public.projects where status = 'active' order by name loop
    projects := projects || jsonb_build_array(jsonb_build_object(
      'project_id', p.id, 'name', p.name,
      'supervisors', (select coalesce(jsonb_agg(up.user_id), '[]'::jsonb) from public.user_projects up join public.user_roles ur on ur.user_id = up.user_id where up.project_id = p.id and ur.role in ('supervisor', 'attendance')),
      'engineers', (select coalesce(jsonb_agg(up.user_id), '[]'::jsonb) from public.user_projects up join public.user_roles ur on ur.user_id = up.user_id where up.project_id = p.id and ur.role = 'site_engineer'),
      'r', public.day_readiness_core(p.id, p_date),
      'submitted_at', (select d.submitted_at from public.attendance_days d where d.project_id = p.id and d.work_date = p_date),
      'verified_at', (select d.verified_at from public.attendance_days d where d.project_id = p.id and d.work_date = p_date),
      'sent', (select coalesce(jsonb_agg(n.kind), '[]'::jsonb) from public.day_notices n where n.project_id = p.id and n.work_date = p_date and n.kind not in ('manual', 'ready')),
      'ready_sent', exists (select 1 from public.day_notices n join public.attendance_days d on d.project_id = n.project_id and d.work_date = n.work_date
                            where n.project_id = p.id and n.work_date = p_date and n.kind = 'ready' and n.sent_for = d.submitted_at)));
  end loop;
  return jsonb_build_object('date', p_date, 'admins', admins, 'projects', projects);
end $$;
revoke all on function public.day_watch_snapshot(date) from public, anon, authenticated;
grant execute on function public.day_watch_snapshot(date) to service_role;

-- ── the scheduled job: every 5 minutes, ask the app to check today ──
do $$ begin
  create extension if not exists pg_net;
  create extension if not exists pg_cron;
  begin perform cron.unschedule('day-watch'); exception when others then null; end;   -- replace an earlier copy
  perform cron.schedule('day-watch', '*/5 * * * *', $cron$
    select net.http_post(
      url := (select value from public.app_settings where key = 'cron_url'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.app_settings where key = 'cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 20000)
    where exists (select 1 from public.app_settings where key = 'cron_url' and btrim(value) <> '') $cron$);
exception when others then
  raise notice 'The reminder job could not be scheduled (%). Switch on pg_cron and pg_net under Database → Extensions, then run this last block again, or use an outside scheduler (see the top of this file).', sqlerrm;
end $$;
