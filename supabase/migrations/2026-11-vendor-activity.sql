-- Vendor activity: the same "how long and where" record the app keeps for its own users (2026-11-usage-activity.sql), for the transport vendors' page.
-- Shown to Admins in Users → Activity, under Vendors. Safe to run more than once. Run AFTER 2026-11-usage-activity.sql and 2026-11-vendor-own-pin.sql.
--
--   vendor_usage_sessions  while the vendor page is open AND on screen it sends a "still here" signal every minute (through the app's server, which adds the
--                          device and network address). A gap of more than 5 minutes starts a new session. Seconds per part of the page (their account,
--                          adding a trip, choosing a PIN), and the phone's location when the session starts and every 30 minutes: only if the vendor allowed
--                          it (the page asks once, after the PIN, and "Not now" still opens the page).
--   vendor_usage_events    signed in, wrong PIN, locked out after too many wrong PINs, signed out, chose / changed their PIN; with device and network address.
-- Everything older than one month is deleted by the same scheduled job as the staff activity. Written only by the app's server; only an Admin can read it.

create table if not exists public.vendor_usage_sessions (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.transport_vehicles(id) on delete cascade,
  link_id uuid references public.vendor_links(id) on delete set null,
  tab_id text not null,
  device text not null default '',
  ip text not null default '',
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active_seconds int not null default 0,
  pages jsonb not null default '{}',                      -- {"account": 300, "add-trip": 120}
  last_path text not null default '',
  start_lat double precision, start_lng double precision, start_acc real,
  last_lat double precision, last_lng double precision, last_acc real, geo_status text not null default ''
);
create index if not exists vendor_usage_sessions_vehicle on public.vendor_usage_sessions (vehicle_id, last_seen_at desc);
create index if not exists vendor_usage_sessions_seen on public.vendor_usage_sessions (last_seen_at);
create index if not exists vendor_usage_sessions_tab on public.vendor_usage_sessions (vehicle_id, tab_id, last_seen_at desc);

create table if not exists public.vendor_usage_events (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.transport_vehicles(id) on delete cascade,
  kind text not null check (kind in ('sign_in', 'wrong_pin', 'locked_out', 'sign_out', 'pin_set')),
  at timestamptz not null default now(),
  device text not null default '', ip text not null default '', detail text not null default ''
);
create index if not exists vendor_usage_events_vehicle on public.vendor_usage_events (vehicle_id, at desc);
create index if not exists vendor_usage_events_at on public.vendor_usage_events (at);

alter table public.vendor_usage_sessions enable row level security;
alter table public.vendor_usage_events enable row level security;
drop policy if exists "admin reads vendor sessions" on public.vendor_usage_sessions; create policy "admin reads vendor sessions" on public.vendor_usage_sessions for select to authenticated using (public.is_admin());
drop policy if exists "admin reads vendor events" on public.vendor_usage_events; create policy "admin reads vendor events" on public.vendor_usage_events for select to authenticated using (public.is_admin());

-- the phone's session, checked the same way as everywhere else on the vendor page (a temporary or expired PIN still counts: choosing a PIN is time on the page)
create or replace function public.vendor_usage_link(p_token text, p_session text) returns public.vendor_links
language sql stable security definer set search_path = public, extensions as $$
  select l.* from public.vendor_links l join public.vendor_sessions s on s.link_id = l.id
  where l.token = p_token and l.revoked_at is null and s.expires_at > now() and s.secret_hash = encode(digest(coalesce(p_session, ''), 'sha256'), 'hex') limit 1 $$;

-- one "still here" signal from the vendor page. The time since the last one (at most 90 seconds) goes to the part of the page they were on.
create or replace function public.vendor_usage_beat(p_token text, p_session text, p_tab text, p_path text, p_device text, p_ip text,
  p_lat double precision default null, p_lng double precision default null, p_acc real default null, p_geo text default '') returns void
language plpgsql security definer set search_path = public as $$
declare l public.vendor_links; s public.vendor_usage_sessions; secs int;
begin
  l := public.vendor_usage_link(p_token, p_session); if l.id is null then return; end if;
  select * into s from public.vendor_usage_sessions where vehicle_id = l.vehicle_id and tab_id = left(p_tab, 64) and last_seen_at > now() - interval '5 minutes' order by last_seen_at desc limit 1 for update;
  if not found then
    insert into public.vendor_usage_sessions (vehicle_id, link_id, tab_id, device, ip, last_path, start_lat, start_lng, start_acc, last_lat, last_lng, last_acc, geo_status)
      values (l.vehicle_id, l.id, left(p_tab, 64), left(coalesce(p_device, ''), 120), left(coalesce(p_ip, ''), 64), left(coalesce(p_path, ''), 40), p_lat, p_lng, p_acc, p_lat, p_lng, p_acc, coalesce(p_geo, ''));
    return;
  end if;
  secs := least(90, greatest(0, extract(epoch from now() - s.last_seen_at)::int));
  update public.vendor_usage_sessions set
    last_seen_at = now(), active_seconds = active_seconds + secs,
    pages = case when s.last_path = '' then pages else jsonb_set(pages, array[s.last_path], to_jsonb(coalesce((pages ->> s.last_path)::int, 0) + secs)) end,
    last_path = left(coalesce(p_path, ''), 40), ip = coalesce(nullif(left(coalesce(p_ip, ''), 64), ''), ip),
    start_lat = coalesce(start_lat, p_lat), start_lng = coalesce(start_lng, p_lng), start_acc = coalesce(start_acc, p_acc),
    last_lat = coalesce(p_lat, last_lat), last_lng = coalesce(p_lng, last_lng), last_acc = coalesce(p_acc, last_acc), geo_status = coalesce(nullif(p_geo, ''), geo_status)
  where id = s.id;
end $$;

-- an event. Signing in, a wrong PIN and a lock-out are recorded by the app's server from what vendor_login answered (so only the link is needed);
-- signing out and choosing a PIN need the phone's session.
create or replace function public.vendor_usage_event(p_token text, p_session text, p_kind text, p_device text, p_ip text, p_detail text default '') returns void
language plpgsql security definer set search_path = public as $$
declare vid uuid;
begin
  if p_kind in ('sign_in', 'wrong_pin', 'locked_out') then select vehicle_id into vid from public.vendor_links where token = p_token and revoked_at is null;
  elsif p_kind in ('sign_out', 'pin_set') then vid := (public.vendor_usage_link(p_token, p_session)).vehicle_id;
  else return; end if;
  if vid is null then return; end if;
  insert into public.vendor_usage_events (vehicle_id, kind, device, ip, detail) values (vid, p_kind, left(coalesce(p_device, ''), 120), left(coalesce(p_ip, ''), 64), left(coalesce(p_detail, ''), 120));
end $$;

-- the monthly clean-up now covers the vendors too
create or replace function public.usage_prune() returns void language sql security definer set search_path = public as $$
  delete from public.usage_sessions where last_seen_at < now() - interval '1 month';
  delete from public.usage_events where at < now() - interval '1 month';
  delete from public.vendor_usage_sessions where last_seen_at < now() - interval '1 month';
  delete from public.vendor_usage_events where at < now() - interval '1 month'; $$;

revoke all on function public.vendor_usage_link(text, text), public.vendor_usage_beat(text, text, text, text, text, text, double precision, double precision, real, text),
  public.vendor_usage_event(text, text, text, text, text, text), public.usage_prune() from public, anon, authenticated;
grant execute on function public.vendor_usage_beat(text, text, text, text, text, text, double precision, double precision, real, text),
  public.vendor_usage_event(text, text, text, text, text, text), public.usage_prune() to service_role;
