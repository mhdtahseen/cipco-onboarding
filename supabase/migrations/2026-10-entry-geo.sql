-- Location of every entry a Supervisor or Site Engineer makes, kept for the Admin's reference. Safe to run again. Run it in the SQL editor.
--
-- Where the phone gives a location when an entry is saved (attendance, a meal, a transport run, submit, verify, reopen), the app sends it here. Nothing in the app
-- shows it. It lives in its OWN table that only an Admin can read, not as columns on attendance: the app reads those tables with "select everything", so extra
-- columns there would have reached every Supervisor's phone even if no screen displayed them.
--   - Admin's own entries are not tagged.
--   - If the phone gives no location (permission refused, GPS off, no signal) a row is still saved with geo_status 'denied' / 'unavailable' / 'timeout',
--     so "no location" is itself visible to you.
--   - The coordinates come from the phone. A fake-GPS app or a tampered browser can fake them, so treat them as evidence, not proof.
--   - Saving a tag never gives anyone an error: if it cannot be saved the entry itself still goes through.
--   - Retention: nothing deletes these rows. Decide how long you want to keep them (say 12 months) and delete older ones:
--         delete from public.entry_geo where created_at < now() - interval '12 months';
--
-- To read them (SQL editor):
--   select g.created_at at time zone 'Asia/Kolkata' as at_ist, p.name as project, g.work_date, u.email, g.role, g.action, g.subject, g.geo_status,
--          g.lat, g.lng, g.accuracy_m, 'https://maps.google.com/?q=' || g.lat || ',' || g.lng as map
--   from public.entry_geo g left join public.projects p on p.id = g.project_id left join auth.users u on u.id = g.user_id
--   order by g.created_at desc limit 200;

create table if not exists public.entry_geo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role text,
  project_id uuid references public.projects(id) on delete cascade,
  work_date date,
  action text not null check (action in ('attendance', 'meal', 'bulk', 'transport', 'submit', 'verify', 'reopen')),
  subject text,                                  -- the employee, the vehicle and direction, or how many people a bulk action covered
  lat double precision,
  lng double precision,
  accuracy_m real,                               -- how far off the phone says the fix could be, in metres
  geo_status text not null default 'ok' check (geo_status in ('ok', 'denied', 'unavailable', 'timeout', 'unsupported')),
  fix_at timestamptz,                            -- the phone's own time for the fix; created_at is the server's
  created_at timestamptz not null default now()
);
create index if not exists entry_geo_project_day on public.entry_geo (project_id, work_date);
create index if not exists entry_geo_user_time on public.entry_geo (user_id, created_at desc);

alter table public.entry_geo enable row level security;
drop policy if exists "admin reads entry geo" on public.entry_geo;
create policy "admin reads entry geo" on public.entry_geo for select to authenticated using (public.is_admin());
-- no insert / update / delete policy: rows are written only by record_geo below, and nobody changes them afterwards

create or replace function public.record_geo(p_project uuid, p_date date, p_action text, p_subject text, p_lat double precision, p_lng double precision, p_accuracy real, p_status text, p_fix_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); lat double precision := p_lat; lng double precision := p_lng; acc real := p_accuracy; st text := coalesce(p_status, 'ok');
begin
  -- never an error the person could see: anything not meant to be tagged is simply ignored
  if r is null or r = 'admin' then return; end if;
  if p_action not in ('attendance', 'meal', 'bulk', 'transport', 'submit', 'verify', 'reopen') then return; end if;
  if not public.can_attend(p_project) then return; end if;
  if st not in ('ok', 'denied', 'unavailable', 'timeout', 'unsupported') then st := 'unavailable'; end if;
  if lat is not null and (lat not between -90 and 90 or lng is null or lng not between -180 and 180) then lat := null; lng := null; acc := null; st := 'unavailable'; end if;
  if lat is null or lng is null then lat := null; lng := null; acc := null; if st = 'ok' then st := 'unavailable'; end if; end if;
  insert into public.entry_geo (user_id, role, project_id, work_date, action, subject, lat, lng, accuracy_m, geo_status, fix_at)
  values (auth.uid(), r, p_project, p_date, p_action, left(p_subject, 200), lat, lng, acc, st, p_fix_at);
end $$;
revoke all on function public.record_geo(uuid, date, text, text, double precision, double precision, real, text, timestamptz) from public, anon;
grant execute on function public.record_geo(uuid, date, text, text, double precision, double precision, real, text, timestamptz) to authenticated;
