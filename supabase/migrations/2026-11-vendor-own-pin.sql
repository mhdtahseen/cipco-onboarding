-- Vendors choose their own PIN. A PIN the office sets (a new link, or a reset for a forgotten PIN) is TEMPORARY: it signs the vendor in once, and then
-- the page asks them to choose their own 4-6 digit PIN before anything else opens. Only the vendor knows that one. They can change it any time with their
-- current PIN. Their own PIN EXPIRES 30 days after they set it: they sign in with the old PIN once more and choose a new one, on their phone, with no
-- office involved. A forgotten PIN: the office resets it to a temporary one (every phone signs out). The office panel shows the PIN's state and expiry.
--  - Enforced here, not only on the page: while the PIN is temporary, a phone's session opens nothing (vendor_session gives nothing back), so the
--    vendor's month, payments and adding trips all wait until the PIN is set. Only vendor_set_pin accepts that session.
--  - Refused: 1111-style, 1234/4321-style, and the temporary PIN itself.
--  - Setting a PIN signs out the vendor's other phones (this phone stays signed in).
--  - Links made before this keep working as they are (their PIN is not treated as temporary).
-- Safe to run more than once. Run AFTER 2026-11-transport-vendor-portal.sql.

alter table public.vendor_links add column if not exists pin_temp boolean not null default false;
alter table public.vendor_links add column if not exists pin_set_at timestamptz;   -- when the vendor last chose their own PIN

-- why the vendor must choose a PIN now: 'temp' (the office set it), 'expired' (their own, 30 days old), or null (fine). Links made before this count
-- their 30 days from when they were made.
create or replace function public.vendor_pin_due(l public.vendor_links) returns text language sql stable as $$
  select case when l.pin_temp then 'temp' when coalesce(l.pin_set_at, l.created_at) < now() - interval '30 days' then 'expired' end $$;

-- a PIN that is easy to guess
create or replace function public.vendor_pin_weak(p text) returns boolean language sql immutable as $$
  select p ~ '^(\d)\1+$' or position(p in '0123456789012345') > 0 or position(p in '9876543210987654') > 0 $$;

-- ---------- the office: any PIN it sets is temporary ----------
create or replace function public.vendor_link_create(p_vehicle uuid, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if not public.is_admin() then raise exception 'Only an Admin can make a vendor link.'; end if;
  if coalesce(p_pin, '') !~ '^\d{4,6}$' then raise exception 'The PIN must be 4 to 6 digits.'; end if;
  if not exists (select 1 from public.transport_vehicles where id = p_vehicle and project_id is not null) then raise exception 'Assign the vehicle to a project first.'; end if;
  update public.vendor_links set revoked_at = now(), revoked_by = auth.uid() where vehicle_id = p_vehicle and revoked_at is null;   -- a new link replaces the old one
  delete from public.vendor_sessions s using public.vendor_links l where s.link_id = l.id and l.vehicle_id = p_vehicle;
  insert into public.vendor_links (vehicle_id, pin_hash, pin_temp) values (p_vehicle, crypt(p_pin, gen_salt('bf', 8)), true) returning token into t;
  return t;
end $$;

create or replace function public.vendor_link_set_pin(p_vehicle uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare lid uuid;
begin
  if not public.is_admin() then raise exception 'Only an Admin can change the PIN.'; end if;
  if coalesce(p_pin, '') !~ '^\d{4,6}$' then raise exception 'The PIN must be 4 to 6 digits.'; end if;
  update public.vendor_links set pin_hash = crypt(p_pin, gen_salt('bf', 8)), pin_temp = true, failed_count = 0, locked_until = null
    where vehicle_id = p_vehicle and revoked_at is null returning id into lid;
  if lid is null then raise exception 'This vehicle has no vendor link. Make one first.'; end if;
  delete from public.vendor_sessions where link_id = lid;   -- every phone signs in with the temporary PIN, then chooses a new one
end $$;

drop function if exists public.vendor_links_list();
-- pin_expires: when the vendor's own PIN runs out (null while it is temporary)
create function public.vendor_links_list() returns table (vehicle_id uuid, token text, created_at timestamptz, last_used_at timestamptz, locked_until timestamptz, devices int, pin_temp boolean, pin_set_at timestamptz, pin_expires timestamptz)
language sql stable security definer set search_path = public as $$
  select l.vehicle_id, l.token, l.created_at, l.last_used_at, case when l.locked_until > now() then l.locked_until end,
    (select count(*)::int from public.vendor_sessions s where s.link_id = l.id and s.expires_at > now()), l.pin_temp, l.pin_set_at, case when not l.pin_temp then coalesce(l.pin_set_at, l.created_at) + interval '30 days' end
  from public.vendor_links l where l.revoked_at is null and public.is_admin() $$;

-- ---------- the vendor's phone ----------
-- a signed-in session opens nothing while the PIN is temporary or expired
create or replace function public.vendor_session(p_token text, p_session text) returns public.vendor_links
language plpgsql security definer set search_path = public, extensions as $$
declare l public.vendor_links; sid uuid; lid uuid;
begin
  select s.id, s.link_id into sid, lid from public.vendor_links l2 join public.vendor_sessions s on s.link_id = l2.id
    where l2.token = p_token and l2.revoked_at is null and public.vendor_pin_due(l2) is null and s.expires_at > now() and s.secret_hash = encode(digest(coalesce(p_session, ''), 'sha256'), 'hex');
  if sid is null then return null; end if;
  update public.vendor_sessions set last_seen_at = now() where id = sid;
  update public.vendor_links set last_used_at = now() where id = lid returning * into l;
  return l;
end $$;

-- signing in also says whether the vendor must choose their own PIN now
create or replace function public.vendor_login(p_token text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare l public.vendor_links; secret text; left_ int;
begin
  select * into l from public.vendor_links where token = p_token and revoked_at is null for update;
  if l.id is null then return jsonb_build_object('ok', false, 'gone', true, 'error', 'This link is no longer active. Ask the CIPCO office for a new one.'); end if;
  if l.locked_until > now() then return jsonb_build_object('ok', false, 'error', 'Too many wrong PINs. Try again after ' || to_char(l.locked_until at time zone 'Asia/Kolkata', 'HH24:MI') || '.'); end if;
  if crypt(coalesce(p_pin, ''), l.pin_hash) <> l.pin_hash then   -- returned, not raised, so the count of wrong tries is kept
    left_ := 4 - l.failed_count;
    update public.vendor_links set locked_until = case when left_ <= 0 then now() + interval '15 minutes' end, failed_count = case when left_ <= 0 then 0 else failed_count + 1 end where id = l.id;
    return jsonb_build_object('ok', false, 'error', case when left_ <= 0 then 'Too many wrong PINs. Try again in 15 minutes.' else 'That PIN is not right. ' || left_ || ' tr' || case when left_ = 1 then 'y' else 'ies' end || ' left.' end);
  end if;
  secret := encode(gen_random_bytes(32), 'hex');
  update public.vendor_links set failed_count = 0, locked_until = null, last_used_at = now() where id = l.id;
  delete from public.vendor_sessions where link_id = l.id and (expires_at <= now() or id in (select id from public.vendor_sessions where link_id = l.id order by created_at desc offset 9));   -- at most 10 phones
  insert into public.vendor_sessions (link_id, secret_hash, expires_at) values (l.id, encode(digest(secret, 'sha256'), 'hex'), now() + interval '30 days');
  return jsonb_build_object('ok', true, 'session', secret, 'must_set', public.vendor_pin_due(l) is not null, 'why', public.vendor_pin_due(l));
end $$;

-- the vendor chooses their own PIN: after a temporary or expired one (no current PIN asked again: they just signed in with it), or any time (current PIN needed)
create or replace function public.vendor_set_pin(p_token text, p_session text, p_new text, p_current text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare l public.vendor_links; sid uuid; lid uuid; n text := coalesce(p_new, '');
begin
  select l2.id, s.id into lid, sid from public.vendor_links l2 join public.vendor_sessions s on s.link_id = l2.id
    where l2.token = p_token and l2.revoked_at is null and s.expires_at > now() and s.secret_hash = encode(digest(coalesce(p_session, ''), 'sha256'), 'hex');
  select * into l from public.vendor_links where id = lid for update;
  if sid is null then return jsonb_build_object('ok', false, 'pin', true, 'error', 'Please enter your PIN again.'); end if;
  if public.vendor_pin_due(l) is null and (p_current is null or crypt(p_current, l.pin_hash) <> l.pin_hash) then return jsonb_build_object('ok', false, 'code', 'current', 'error', 'Your current PIN is not right.'); end if;
  if n !~ '^\d{4,6}$' then return jsonb_build_object('ok', false, 'code', 'format', 'error', 'The PIN must be 4 to 6 digits.'); end if;
  if public.vendor_pin_weak(n) then return jsonb_build_object('ok', false, 'code', 'weak', 'error', 'That PIN is too easy to guess. Avoid 1111 or 1234.'); end if;
  if crypt(n, l.pin_hash) = l.pin_hash then return jsonb_build_object('ok', false, 'code', 'same', 'error', 'Choose a PIN different from the one you have now.'); end if;
  update public.vendor_links set pin_hash = crypt(n, gen_salt('bf', 8)), pin_temp = false, pin_set_at = now(), failed_count = 0, locked_until = null where id = l.id;
  delete from public.vendor_sessions where link_id = l.id and id <> sid;   -- other phones sign in with the new PIN
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.vendor_pin_weak(text) from public, anon, authenticated;
revoke all on function public.vendor_pin_due(public.vendor_links) from public, anon, authenticated;
revoke all on function public.vendor_set_pin(text, text, text, text) from public;
grant execute on function public.vendor_set_pin(text, text, text, text) to anon, authenticated;
revoke all on function public.vendor_links_list() from public, anon;
grant execute on function public.vendor_links_list() to authenticated;
