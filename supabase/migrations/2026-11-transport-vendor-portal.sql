-- Transport vendor portal: a vehicle's operator gets a private link (/vendor/<link>) and a PIN. On it they see their month (trips, no-shows,
-- approved errands), their balance and the payments made, and they enter errands they ran for someone in management. An errand they enter
-- waits for an Admin: approved (at their quote or a changed amount, with a note) it joins the month and the balance; rejected (with a reason) it never counts.
--  - One live link per vehicle. Admin only: create (with a 4–6 digit PIN), change the PIN, revoke. Changing the PIN or revoking signs every phone out.
--  - Five wrong PINs lock the link for 15 minutes. A phone stays signed in for 30 days.
--  - The vendor's phone never reads a table: only the vendor_* functions below, and each answers for that one vehicle only.
--  - Errands entered by staff and gas-trip errands work as before (approved at once). Existing errands are all approved.
--  - Money is still never edited: a vendor's errand has no amount until an Admin decides; the amount is set once, by that decision.
-- Safe to run more than once. Run AFTER 2026-11-gas-own-transport.sql.
-- If 2026-10-function-permissions.sql is ever run again, it keeps these vendor functions open to signed-out callers (they are on its list).

create extension if not exists pgcrypto with schema extensions;

-- ---------- links and signed-in phones ----------
create table if not exists public.vendor_links (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'transport' check (kind in ('transport')),   -- more kinds (equipment, gas, rooms) can follow
  vehicle_id uuid not null references public.transport_vehicles(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  pin_hash text not null,
  failed_count int not null default 0,
  locked_until timestamptz,
  revoked_at timestamptz, revoked_by uuid,
  last_used_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists vendor_links_one_live on public.vendor_links (vehicle_id) where revoked_at is null;

create table if not exists public.vendor_sessions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.vendor_links(id) on delete cascade,
  secret_hash text not null unique,                       -- sha256 of the secret kept on the phone; the secret itself is never stored
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index if not exists vendor_sessions_link on public.vendor_sessions (link_id);

alter table public.vendor_links enable row level security;      -- no policies: only the functions below read or write these
alter table public.vendor_sessions enable row level security;

-- ---------- errands: approval ----------
alter table public.transport_errands add column if not exists approval text not null default 'approved';
alter table public.transport_errands add column if not exists source text not null default 'staff';
alter table public.transport_errands add column if not exists quoted_amount numeric(12,2);   -- what the vendor asked for
alter table public.transport_errands add column if not exists asked_by text;                 -- who in management asked for it (the vendor's answer)
alter table public.transport_errands add column if not exists vendor_link_id uuid references public.vendor_links(id);
alter table public.transport_errands add column if not exists decided_by uuid;
alter table public.transport_errands add column if not exists decided_at timestamptz;
alter table public.transport_errands add column if not exists decision_note text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transport_errands_approval_check') then
    alter table public.transport_errands add constraint transport_errands_approval_check check (approval in ('awaiting', 'approved', 'rejected')); end if;
  if not exists (select 1 from pg_constraint where conname = 'transport_errands_source_check') then
    alter table public.transport_errands add constraint transport_errands_source_check check (source in ('staff', 'vendor')); end if;
  if not exists (select 1 from pg_constraint where conname = 'transport_errands_quoted_check') then
    alter table public.transport_errands add constraint transport_errands_quoted_check check (quoted_amount is null or quoted_amount > 0); end if;
  if not exists (select 1 from pg_constraint where conname = 'transport_errands_unapproved_no_amount') then   -- only an approved errand carries an amount
    alter table public.transport_errands add constraint transport_errands_unapproved_no_amount check (approval = 'approved' or amount is null); end if;
end $$;
create index if not exists transport_errands_awaiting on public.transport_errands (vehicle_id) where approval = 'awaiting' and voided_at is null;

-- ---------- the money guard, now knowing about vendor errands ----------
-- Same as 2026-11-gas-own-transport.sql, plus:
--  - an errand inserted by the vendor functions (they set cipco.vendor_link) is the vendor's, waiting, with no amount; any other insert is staff's and approved
--  - a waiting errand only changes by an Admin's decision (amount, approval, note) or by being withdrawn (the vendor) / voided (an Admin)
--  - a rejected errand never changes; a gas-trip errand still gets its amount once
create or replace function public.transport_money_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare vl text := nullif(current_setting('cipco.vendor_link', true), '');
  keep_out constant text[] := array['amount', 'approval', 'decided_by', 'decided_at', 'decision_note'];
begin
  if tg_op = 'DELETE' then raise exception 'This is never deleted. Void it and enter the right one.'; end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'transport_errands' then
      if (to_jsonb(old) ->> 'approval') = 'awaiting' then
        if old.voided_at is null and new.voided_at is not null then   -- withdrawn by the vendor, or removed by an Admin
          if not (public.is_admin() or coalesce(vl = (to_jsonb(old) ->> 'vendor_link_id'), false)) then raise exception 'Only an Admin can remove an errand that is waiting for approval.'; end if;   -- (coalesce: with no vendor link set the comparison is null, and "not null" would let anyone through)
          if to_jsonb(new) - 'voided_at' - 'voided_by' is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' then raise exception 'Only remove it: nothing else changes.'; end if;
          new.voided_by := auth.uid(); return new;
        end if;
        if old.voided_at is not null then raise exception 'This errand was withdrawn.'; end if;
        if (to_jsonb(new) ->> 'approval') is distinct from 'awaiting' then
          if not public.is_admin() then raise exception 'Only an Admin can approve or reject an errand.'; end if;
          if to_jsonb(new) - keep_out is distinct from to_jsonb(old) - keep_out then raise exception 'Only the decision can change: the amount, approved or rejected, and the note.'; end if;
          new.decided_by := auth.uid(); new.decided_at := now(); return new;
        end if;
        raise exception 'An errand waiting for approval can only be approved, rejected or withdrawn.';
      end if;
      if (to_jsonb(old) ->> 'approval') = 'rejected' then raise exception 'This errand was rejected and cannot be changed.'; end if;
      if old.voided_at is null and new.voided_at is null and (to_jsonb(old) ->> 'amount') is null and (to_jsonb(new) ->> 'amount') is not null
         and to_jsonb(new) - 'amount' is not distinct from to_jsonb(old) - 'amount' then return new; end if;   -- entering the amount of a gas-trip errand
    end if;
    if to_jsonb(new) - 'voided_at' - 'voided_by' - 'bill_path' is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' - 'bill_path' then raise exception 'This cannot be edited. Void it and enter the right one.'; end if;   -- (the bill can be attached later)
    if old.voided_at is not null and new.voided_at is not distinct from old.voided_at and (to_jsonb(new) ->> 'bill_path') is distinct from (to_jsonb(old) ->> 'bill_path') then return new; end if;   -- (a voided payment can still get its bill)
    if old.voided_at is not null then raise exception 'This is already voided.'; end if;
    if new.voided_at is not null then new.voided_by := auth.uid(); end if;
    return new;
  end if;
  if tg_table_name = 'vendor_payments' then select f.project_id into new.project_id from public.food_vendors f where f.id = new.vendor_id;
  elsif tg_table_name = 'accommodation_payments' then select r.project_id into new.project_id from public.accommodation_rooms r where r.id = new.room_id;
  else select v.project_id into new.project_id from public.transport_vehicles v where v.id = new.vehicle_id; end if;
  if new.project_id is null then raise exception 'This vendor or vehicle is not assigned to a project yet. Assign it to a project first.'; end if;
  if tg_table_name = 'transport_errands' then
    if vl is not null then new.source := 'vendor'; new.approval := 'awaiting'; new.vendor_link_id := vl::uuid; new.amount := null;
    else new.source := 'staff'; new.approval := 'approved'; new.vendor_link_id := null; end if;
    new.decided_by := null; new.decided_at := null; new.decision_note := null;
  end if;
  new.created_by := auth.uid(); new.voided_at := null; new.voided_by := null; return new;
end $$;

-- ---------- Admin: links ----------
create or replace function public.vendor_links_list() returns table (vehicle_id uuid, token text, created_at timestamptz, last_used_at timestamptz, locked_until timestamptz, devices int)
language sql stable security definer set search_path = public as $$
  select l.vehicle_id, l.token, l.created_at, l.last_used_at, case when l.locked_until > now() then l.locked_until end,
    (select count(*)::int from public.vendor_sessions s where s.link_id = l.id and s.expires_at > now())
  from public.vendor_links l where l.revoked_at is null and public.is_admin() $$;

create or replace function public.vendor_link_create(p_vehicle uuid, p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if not public.is_admin() then raise exception 'Only an Admin can make a vendor link.'; end if;
  if coalesce(p_pin, '') !~ '^\d{4,6}$' then raise exception 'The PIN must be 4 to 6 digits.'; end if;
  if not exists (select 1 from public.transport_vehicles where id = p_vehicle and project_id is not null) then raise exception 'Assign the vehicle to a project first.'; end if;
  update public.vendor_links set revoked_at = now(), revoked_by = auth.uid() where vehicle_id = p_vehicle and revoked_at is null;   -- a new link replaces the old one
  delete from public.vendor_sessions s using public.vendor_links l where s.link_id = l.id and l.vehicle_id = p_vehicle;
  insert into public.vendor_links (vehicle_id, pin_hash) values (p_vehicle, crypt(p_pin, gen_salt('bf', 8))) returning token into t;
  return t;
end $$;

create or replace function public.vendor_link_set_pin(p_vehicle uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare lid uuid;
begin
  if not public.is_admin() then raise exception 'Only an Admin can change the PIN.'; end if;
  if coalesce(p_pin, '') !~ '^\d{4,6}$' then raise exception 'The PIN must be 4 to 6 digits.'; end if;
  update public.vendor_links set pin_hash = crypt(p_pin, gen_salt('bf', 8)), failed_count = 0, locked_until = null
    where vehicle_id = p_vehicle and revoked_at is null returning id into lid;
  if lid is null then raise exception 'This vehicle has no vendor link. Make one first.'; end if;
  delete from public.vendor_sessions where link_id = lid;   -- every phone enters the new PIN
end $$;

create or replace function public.vendor_link_revoke(p_vehicle uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can turn off a vendor link.'; end if;
  delete from public.vendor_sessions s using public.vendor_links l where s.link_id = l.id and l.vehicle_id = p_vehicle;
  update public.vendor_links set revoked_at = now(), revoked_by = auth.uid() where vehicle_id = p_vehicle and revoked_at is null;
end $$;

-- ---------- Admin: decide a vendor's errand ----------
create or replace function public.transport_errand_decide(p_id uuid, p_approve boolean, p_amount numeric, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.transport_errands; amt numeric; note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then raise exception 'Only an Admin can approve or reject an errand.'; end if;
  select * into e from public.transport_errands where id = p_id for update;
  if e.id is null then raise exception 'Errand not found.'; end if;
  if e.voided_at is not null then raise exception 'The vendor withdrew this errand.'; end if;
  if e.approval <> 'awaiting' then raise exception 'This errand was already %.', e.approval; end if;
  if p_approve then
    amt := coalesce(p_amount, e.quoted_amount);
    if amt is null or amt <= 0 then raise exception 'Enter the amount to approve.'; end if;
    if amt <> e.quoted_amount and note is null then raise exception 'Say why the amount differs from the ₹% quoted: the vendor sees this note.', regexp_replace(e.quoted_amount::text, '\.00$', ''); end if;
    update public.transport_errands set approval = 'approved', amount = amt, decision_note = note where id = p_id;
  else
    if note is null then raise exception 'Give a reason: the vendor sees it.'; end if;
    update public.transport_errands set approval = 'rejected', decision_note = note where id = p_id;
  end if;
end $$;

-- ---------- the vendor's phone ----------
-- The signed-in link for this token and phone secret, or nothing. Internal: never callable from outside.
create or replace function public.vendor_session(p_token text, p_session text) returns public.vendor_links
language plpgsql security definer set search_path = public, extensions as $$
declare l public.vendor_links; sid uuid; lid uuid;
begin
  select s.id, s.link_id into sid, lid from public.vendor_links l2 join public.vendor_sessions s on s.link_id = l2.id
    where l2.token = p_token and l2.revoked_at is null and s.expires_at > now() and s.secret_hash = encode(digest(coalesce(p_session, ''), 'sha256'), 'hex');
  if sid is null then return null; end if;
  update public.vendor_sessions set last_seen_at = now() where id = sid;
  update public.vendor_links set last_used_at = now() where id = lid returning * into l;
  return l;
end $$;

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
  return jsonb_build_object('ok', true, 'session', secret);
end $$;

create or replace function public.vendor_logout(p_token text, p_session text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.vendor_sessions s using public.vendor_links l
    where s.link_id = l.id and l.token = p_token and s.secret_hash = encode(digest(coalesce(p_session, ''), 'sha256'), 'hex');
end $$;

-- Everything the vendor's page shows, for this vehicle only. { ok: false, pin: true } = enter the PIN again; { ok: false, gone: true } = the link was turned off.
create or replace function public.vendor_get(p_token text, p_session text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.vendor_links := public.vendor_session(p_token, p_session); v public.transport_vehicles;
begin
  if l.id is null then
    if not exists (select 1 from public.vendor_links where token = p_token and revoked_at is null) then return jsonb_build_object('ok', false, 'gone', true); end if;
    return jsonb_build_object('ok', false, 'pin', true);
  end if;
  select * into v from public.transport_vehicles where id = l.vehicle_id;
  return jsonb_build_object('ok', true,
    'today', (now() at time zone 'Asia/Kolkata')::date,
    'vehicle', jsonb_build_object('id', v.id, 'project_id', v.project_id, 'name', v.name, 'operator', v.operator, 'billing', v.billing, 'active', v.active, 'sort_order', v.sort_order),
    'project', (select p.name from public.projects p where p.id = v.project_id),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'vehicle_id', r.vehicle_id, 'price', r.price, 'effective_from', r.effective_from) order by r.effective_from) from public.transport_rates r where r.vehicle_id = v.id), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'project_id', r.project_id, 'vehicle_id', r.vehicle_id, 'work_date', r.work_date, 'leg', r.leg, 'status', r.status, 'at', null) order by r.work_date, r.leg)
      from public.transport_runs r where r.vehicle_id = v.id and r.project_id = v.project_id), '[]'::jsonb),
    'errands', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'vehicle_id', e.vehicle_id, 'work_date', e.work_date, 'description', e.description, 'amount', e.amount, 'quoted_amount', e.quoted_amount,
        'approval', e.approval, 'source', e.source, 'asked_by', e.asked_by, 'decision_note', e.decision_note, 'decided_at', e.decided_at, 'created_at', e.created_at, 'voided_at', null) order by e.work_date desc, e.created_at desc)
      from public.transport_errands e where e.vehicle_id = v.id and e.voided_at is null), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'vehicle_id', p.vehicle_id, 'paid_on', p.paid_on, 'amount', p.amount, 'reference', p.reference, 'voided_at', null) order by p.paid_on desc, p.created_at desc)
      from public.transport_payments p where p.vehicle_id = v.id and p.voided_at is null), '[]'::jsonb),
    -- who may have asked: Admins and Operations, and the Site Engineers and Supervisors of this vehicle's project. Names only.
    'askers', coalesce((select jsonb_agg(n order by n) from (select distinct btrim(up.full_name) as n from public.user_roles r join public.user_profiles up on up.user_id = r.user_id
        where btrim(coalesce(up.full_name, '')) <> '' and not coalesce(r.practice, false)
          and (r.role in ('admin', 'staff') or (r.role in ('site_engineer', 'supervisor') and exists (select 1 from public.user_projects x where x.user_id = r.user_id and x.project_id = v.project_id)))) q), '[]'::jsonb));
end $$;

-- The vendor enters an errand. Returns the notification for the Admins (sent by /api/vendor/errand).
create or replace function public.vendor_add_errand(p_token text, p_session text, p_date date, p_description text, p_amount numeric, p_asked_by text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.vendor_links := public.vendor_session(p_token, p_session); v public.transport_vehicles; id_ uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date; d text := btrim(coalesce(p_description, '')); who text := btrim(coalesce(p_asked_by, ''));
  amt text;
begin
  if l.id is null then raise exception 'Please enter your PIN again.'; end if;
  select * into v from public.transport_vehicles where id = l.vehicle_id;
  if p_date is null or p_date > today then raise exception 'The date cannot be in the future.'; end if;
  if p_date < today - 7 then raise exception 'Errands older than 7 days cannot be added here. Call the CIPCO office.'; end if;
  if length(d) < 3 then raise exception 'Say what the errand was for.'; end if;
  if length(d) > 300 then raise exception 'Keep the description under 300 letters.'; end if;
  if length(who) < 2 or length(who) > 80 then raise exception 'Say who asked you to run it.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount you quoted.'; end if;
  if p_amount > 50000 then raise exception 'For more than ₹50,000, call the CIPCO office.'; end if;
  if (select count(*) from public.transport_errands where vendor_link_id = l.id and created_at > now() - interval '1 day') >= 15 then raise exception 'Too many errands today. Call the CIPCO office.'; end if;
  perform set_config('cipco.vendor_link', l.id::text, true);
  insert into public.transport_errands (vehicle_id, work_date, description, amount, quoted_amount, asked_by) values (v.id, p_date, d, null, round(p_amount, 2), who) returning id into id_;
  perform set_config('cipco.vendor_link', '', true);
  amt := case when p_amount = trunc(p_amount) then trunc(p_amount)::bigint::text else round(p_amount, 2)::text end;
  return jsonb_build_object('id', id_,
    'title', 'Errand to approve: ' || v.name,
    'body', '₹' || amt || ' · ' || left(d, 90) || ' · asked by ' || who || ' · ' || to_char(p_date, 'DD Mon'),
    'url', '/transport?p=' || v.project_id || '&tab=errands',
    'recipients', coalesce((select jsonb_agg(r.user_id) from public.user_roles r where r.role = 'admin' and not coalesce(r.practice, false)), '[]'::jsonb));
end $$;

create or replace function public.vendor_withdraw_errand(p_token text, p_session text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.vendor_links := public.vendor_session(p_token, p_session); e public.transport_errands;
begin
  if l.id is null then raise exception 'Please enter your PIN again.'; end if;
  select * into e from public.transport_errands where id = p_id and vendor_link_id = l.id for update;
  if e.id is null then raise exception 'Errand not found.'; end if;
  if e.approval <> 'awaiting' or e.voided_at is not null then raise exception 'Only an errand still waiting for approval can be withdrawn.'; end if;
  perform set_config('cipco.vendor_link', l.id::text, true);
  update public.transport_errands set voided_at = now() where id = p_id;
  perform set_config('cipco.vendor_link', '', true);
end $$;

-- ---------- who may call what ----------
revoke all on function public.vendor_session(text, text) from public, anon, authenticated;
revoke all on function public.vendor_login(text, text), public.vendor_logout(text, text), public.vendor_get(text, text),
  public.vendor_add_errand(text, text, date, text, numeric, text), public.vendor_withdraw_errand(text, text, uuid) from public;
grant execute on function public.vendor_login(text, text), public.vendor_logout(text, text), public.vendor_get(text, text),
  public.vendor_add_errand(text, text, date, text, numeric, text), public.vendor_withdraw_errand(text, text, uuid) to anon, authenticated;
revoke all on function public.vendor_links_list(), public.vendor_link_create(uuid, text), public.vendor_link_set_pin(uuid, text), public.vendor_link_revoke(uuid),
  public.transport_errand_decide(uuid, boolean, numeric, text) from public, anon;
grant execute on function public.vendor_links_list(), public.vendor_link_create(uuid, text), public.vendor_link_set_pin(uuid, text), public.vendor_link_revoke(uuid),
  public.transport_errand_decide(uuid, boolean, numeric, text) to authenticated;

notify pgrst, 'reload schema';
