-- App activity: when each person actually has the app open, for how long, on what device, where, and what they looked at. Admin only. Safe to run more than once.
-- Run AFTER 2026-10-roles-attendance.sql.
--
-- Logins hardly ever end (people stay signed in), so activity is measured from the app itself: while it is open AND on screen, every minute it sends a
-- small "still here" signal (through the app's server, which adds the network address). A gap of more than 5 minutes (app in the background, phone locked,
-- tab closed, no signal) ends a session; the next signal starts a new one. So a day reads 09:02–09:40, 11:15–11:20, 16:30–17:05.
--   usage_sessions  one row per session per browser tab / device: start, last seen, active seconds, seconds per page, device, network address,
--                   and the phone's location when the session started and the latest one (only if the phone allows location; it is never asked for here)
--   usage_events    sign in, sign out, signed out by an Admin, login disabled / enabled
-- Everything older than one month is deleted automatically (by the scheduled job). Written only by the app's server; only an Admin can read it.

create table if not exists public.usage_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tab_id text not null,                                   -- one per browser tab, so two devices (or two tabs) are two sessions
  device text not null default '',                        -- "Android phone · Chrome"
  ip text not null default '',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active_seconds int not null default 0,
  pages jsonb not null default '{}',                      -- {"/attendance": 1800, "/site-supplies": 480}: seconds on each page
  last_path text not null default '',
  start_lat double precision, start_lng double precision, start_acc real,
  last_lat double precision, last_lng double precision, last_acc real, geo_status text not null default ''
);
create index if not exists usage_sessions_user on public.usage_sessions (user_id, last_seen_at desc);
create index if not exists usage_sessions_seen on public.usage_sessions (last_seen_at);
create index if not exists usage_sessions_tab on public.usage_sessions (user_id, tab_id, last_seen_at desc);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('sign_in', 'sign_out', 'signed_out_by_admin', 'login_disabled', 'login_enabled')),
  at timestamptz not null default now(),
  by_user uuid,                                           -- the Admin, for the last three
  device text not null default '', ip text not null default '', detail text not null default ''
);
create index if not exists usage_events_user on public.usage_events (user_id, at desc);
create index if not exists usage_events_at on public.usage_events (at);

alter table public.usage_sessions enable row level security;
alter table public.usage_events enable row level security;
drop policy if exists "admin reads sessions" on public.usage_sessions; create policy "admin reads sessions" on public.usage_sessions for select to authenticated using (public.is_admin());
drop policy if exists "admin reads usage events" on public.usage_events; create policy "admin reads usage events" on public.usage_events for select to authenticated using (public.is_admin());

-- one "still here" signal. The time since the last signal (at most 90 seconds, so a missed signal is not counted as use) goes to the page they were on.
create or replace function public.usage_beat(p_user uuid, p_tab text, p_path text, p_device text, p_ip text, p_lat double precision default null, p_lng double precision default null, p_acc real default null, p_geo text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.usage_sessions; secs int;
begin
  select * into s from public.usage_sessions where user_id = p_user and tab_id = left(p_tab, 64) and last_seen_at > now() - interval '5 minutes' order by last_seen_at desc limit 1 for update;
  if not found then
    insert into public.usage_sessions (user_id, tab_id, device, ip, last_path, start_lat, start_lng, start_acc, last_lat, last_lng, last_acc, geo_status)
      values (p_user, left(p_tab, 64), left(coalesce(p_device, ''), 120), left(coalesce(p_ip, ''), 64), left(coalesce(p_path, ''), 120), p_lat, p_lng, p_acc, p_lat, p_lng, p_acc, coalesce(p_geo, ''))
      returning * into s;
    return s.id;
  end if;
  secs := least(90, greatest(0, extract(epoch from now() - s.last_seen_at)::int));
  update public.usage_sessions set
    last_seen_at = now(), active_seconds = active_seconds + secs,
    pages = case when s.last_path = '' then pages else jsonb_set(pages, array[s.last_path], to_jsonb(coalesce((pages ->> s.last_path)::int, 0) + secs)) end,
    last_path = left(coalesce(p_path, ''), 120), ip = coalesce(nullif(left(coalesce(p_ip, ''), 64), ''), ip),
    start_lat = coalesce(start_lat, p_lat), start_lng = coalesce(start_lng, p_lng), start_acc = coalesce(start_acc, p_acc),
    last_lat = coalesce(p_lat, last_lat), last_lng = coalesce(p_lng, last_lng), last_acc = coalesce(p_acc, last_acc), geo_status = coalesce(nullif(p_geo, ''), geo_status)
  where id = s.id;
  return s.id;
end $$;

-- delete what is older than a month (the scheduled job calls this)
create or replace function public.usage_prune() returns void language sql security definer set search_path = public as $$
  delete from public.usage_sessions where last_seen_at < now() - interval '1 month';
  delete from public.usage_events where at < now() - interval '1 month'; $$;

revoke all on function public.usage_beat(uuid, text, text, text, text, double precision, double precision, real, text), public.usage_prune() from public, anon, authenticated;
grant execute on function public.usage_beat(uuid, text, text, text, text, double precision, double precision, real, text), public.usage_prune() to service_role;
