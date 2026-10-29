-- Attendance accountability + trip-based transport.
--   * roles: Supervisor and Site Engineer (the old "attendance clerk" becomes Supervisor); Staff is no longer offered
--   * nothing is locked per person: anyone with access may change an entry within their time window; the change is stamped and logged (an override by a higher role is flagged)
--   * every change is written to an append-only log with the user, their role and the old / new value
--   * names for logins, so stamps read "Ravi", not an email
--   * transport (project based): locally hired vehicles paid per trip or monthly, a daily showed-up / no-show record per vehicle and direction, errand charges and a payment ledger (admin only)
--   * day sign-off: the Supervisor submits a day, the Site Engineer verifies it
--   * money (meal prices, transport rates and payments) is visible to Admin only
-- Run AFTER 2026-10-roles-attendance.sql (which is run once). This file is safe to run again whenever it changes.

-- ---------- 1. roles ----------
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.user_roles'::regclass and contype = 'c' loop
    execute format('alter table public.user_roles drop constraint %I', c);
  end loop;
end $$;
update public.user_roles set role = 'supervisor' where role = 'attendance';
alter table public.user_roles add constraint user_roles_role_check check (role in ('admin','staff','site_engineer','supervisor'));

create or replace function public.role_rank(r text) returns int language sql immutable as $$
  select case r when 'supervisor' then 1 when 'site_engineer' then 2 when 'staff' then 2 when 'admin' then 3 else 0 end $$;
create or replace function public.rank_name(k int) returns text language sql immutable as $$
  select case k when 1 then 'Supervisor' when 2 then 'Site Engineer' when 3 then 'Admin' else 'Unknown' end $$;
create or replace function public.app_rank() returns int language sql stable security definer set search_path = public as $$
  select public.role_rank(public.app_role()) $$;
create or replace function public.can_attend(p_project uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or (public.app_role() in ('supervisor','site_engineer') and exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = p_project)) $$;

drop policy if exists "attendance read assigned" on public.projects;
create policy "attendance read assigned" on public.projects for select to authenticated
  using (public.app_role() in ('supervisor','site_engineer') and exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = projects.id));

-- ---------- 2. names on logins ----------
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
drop policy if exists "roles read names" on public.user_profiles;
drop policy if exists "admin manages names" on public.user_profiles;
create policy "roles read names" on public.user_profiles for select to authenticated using (public.app_role() is not null);
create policy "admin manages names" on public.user_profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.user_label(p_user uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.full_name), ''), u.email::text) from auth.users u left join public.user_profiles p on p.user_id = u.id where u.id = p_user $$;

drop function if exists public.admin_list_users();
create function public.admin_list_users() returns table (user_id uuid, email text, full_name text, last_sign_in_at timestamptz, role text, project_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query select u.id, u.email::text, coalesce(p.full_name, ''), u.last_sign_in_at, r.role,
    coalesce(array(select up.project_id from public.user_projects up where up.user_id = u.id), '{}'::uuid[])
  from auth.users u left join public.user_roles r on r.user_id = u.id left join public.user_profiles p on p.user_id = u.id order by u.email;
end $$;

-- ---------- 3. money is for Admin only: meal prices ----------
drop policy if exists "any role reads" on public.meal_rates;
drop policy if exists "staff reads" on public.meal_rates;
create policy "staff reads" on public.meal_rates for select to authenticated using (public.is_staff());

-- meals are the company's responsibility whatever the person's work status, so a meal can be recorded for someone who is absent, on a
-- weekly off, or not marked at all: the work status may be empty.
alter table public.attendance alter column status drop not null;
alter table public.attendance alter column status drop default;

-- food vendors are project based: each project has its own vendors (and so its own meal prices). A meal records the vendor, which is where the person ate.
alter table public.food_vendors add column if not exists project_id uuid references public.projects(id) on delete cascade;
update public.food_vendors v set project_id = (select a.project_id from public.attendance a where v.id in (a.breakfast_vendor_id, a.lunch_vendor_id, a.dinner_vendor_id) group by a.project_id order by count(*) desc limit 1) where v.project_id is null;   -- existing vendors go to the project that uses them most; any left over are assigned by an Admin in Settings
drop index if exists public.food_vendors_name_uq;
create unique index if not exists food_vendors_proj_name_uq on public.food_vendors (project_id, lower(btrim(name)));
drop policy if exists "any role reads" on public.food_vendors; drop policy if exists "roles read vendors" on public.food_vendors;
create policy "roles read vendors" on public.food_vendors for select to authenticated using (public.can_attend(project_id));   -- a Supervisor or Site Engineer sees only their own project's vendors

-- ---------- 4. day sign-off (table first: the rules below look at it) ----------
create table if not exists public.attendance_days (
  project_id uuid not null references public.projects(id) on delete cascade,
  work_date date not null,
  submitted_by uuid, submitted_at timestamptz,
  verified_by uuid, verified_at timestamptz,
  primary key (project_id, work_date)
);
alter table public.attendance_days enable row level security;
drop policy if exists "read days" on public.attendance_days;
create policy "read days" on public.attendance_days for select to authenticated using (public.can_attend(project_id));   -- written only by the functions below

-- ---------- 5. the activity log (append-only) ----------
create table if not exists public.attendance_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  tx bigint not null default txid_current(),            -- changes made in one go share this (a bulk action)
  user_id uuid, user_name text, user_role text,
  project_id uuid, work_date date,
  employee_id uuid, employee_name text,
  field text not null,                                  -- status, breakfast, lunch, dinner, pickup, drop, trip, trip_time, trip_vehicle, day
  old_value text, new_value text,
  action text not null,                                 -- create, change, delete, submit, verify, reopen
  overrode text                                         -- the role whose entry was changed, when a higher role changed it
);
create index if not exists attendance_log_project_idx on public.attendance_log (project_id, work_date, at desc);
create index if not exists attendance_log_at_idx on public.attendance_log (at desc);
alter table public.attendance_log enable row level security;
drop policy if exists "read log" on public.attendance_log;
create policy "read log" on public.attendance_log for select to authenticated using (public.app_role() in ('admin','staff','site_engineer') and public.can_attend(project_id));
-- no insert / update / delete policy: nobody writes the log from the app, only the database does, and nothing can edit it

create or replace function public.log_change(p_project uuid, p_date date, p_emp uuid, p_field text, p_old text, p_new text, p_action text, p_over text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.attendance_log (user_id, user_name, user_role, project_id, work_date, employee_id, employee_name, field, old_value, new_value, action, overrode)
  values (auth.uid(), public.user_label(auth.uid()), public.app_role(), p_project, p_date, p_emp, (select full_name from public.employees where id = p_emp), p_field, p_old, p_new, p_action, p_over);
end $$;
revoke all on function public.log_change(uuid, date, uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.touch_day(p_project uuid, p_date date) returns void language sql security definer set search_path = public as $$
  update public.attendance_days set submitted_at = null, submitted_by = null
  where project_id = p_project and work_date = p_date and verified_at is null and submitted_at is not null $$;   -- a change after "submit" means it needs submitting again
revoke all on function public.touch_day(uuid, date) from public, anon, authenticated;

-- ---------- 6. who may write which day ----------
--   Supervisor: that day until 11:00 PM India time.   Site Engineer: that day and the next day, until 11:00 PM.   Admin: always.
create or replace function public.write_window_end(r text, d date) returns timestamp language sql immutable as $$
  select case when r = 'supervisor' then d + time '23:00' when r in ('site_engineer','staff') then (d + 1) + time '23:00' else 'infinity'::timestamp end $$;

create or replace function public.check_write(p_project uuid, p_date date) returns void language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); ist timestamp := (now() at time zone 'Asia/Kolkata');
begin
  if r is null then raise exception 'You do not have access to attendance.'; end if;
  if r = 'admin' then return; end if;
  if r in ('supervisor','site_engineer') and not exists (select 1 from public.user_projects where user_id = auth.uid() and project_id = p_project) then raise exception 'You are not assigned to this project.'; end if;
  if p_date > ist::date then raise exception 'Attendance cannot be entered for a future date.'; end if;
  if ist >= public.write_window_end(r, p_date) then
    raise exception 'Attendance for % is locked (%). Ask % to change it.', to_char(p_date, 'DD Mon'),
      case when r = 'supervisor' then 'it locks at 11:00 PM that day' else 'it locks at 11:00 PM the next day' end,
      case when r = 'supervisor' then 'the Site Engineer or an Admin' else 'an Admin' end;
  end if;
  if r = 'supervisor' and exists (select 1 from public.attendance_days where project_id = p_project and work_date = p_date and verified_at is not null) then
    raise exception 'This day has been verified by the Site Engineer. Ask them to reopen it.';
  end if;
end $$;
revoke all on function public.check_write(uuid, date) from public, anon, authenticated;

-- ---------- 7. attendance: ranks, windows, and the log ----------
alter table public.attendance add column if not exists rank smallint not null default 1;     -- the highest role that has set this entry (used to flag overrides in the log; it does not lock anything)
alter table public.attendance add column if not exists set_by_role text;

create or replace function public.attendance_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); rk int := public.role_rank(r);
begin
  if r is null then raise exception 'You do not have access to attendance.'; end if;
  if tg_op in ('UPDATE','DELETE') then perform public.check_write(old.project_id, old.work_date); end if;
  if tg_op in ('INSERT','UPDATE') then perform public.check_write(new.project_id, new.work_date); end if;
  if tg_op in ('INSERT','UPDATE') and r <> 'admin' and not exists (select 1 from public.employees e where e.id = new.employee_id and e.project_id = new.project_id) then
    raise exception 'That person is not on this project.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if (new.breakfast_vendor_id is not null and (tg_op = 'INSERT' or new.breakfast_vendor_id is distinct from old.breakfast_vendor_id) and not exists (select 1 from public.food_vendors f where f.id = new.breakfast_vendor_id and f.project_id = new.project_id))
  or (new.lunch_vendor_id is not null and (tg_op = 'INSERT' or new.lunch_vendor_id is distinct from old.lunch_vendor_id) and not exists (select 1 from public.food_vendors f where f.id = new.lunch_vendor_id and f.project_id = new.project_id))
  or (new.dinner_vendor_id is not null and (tg_op = 'INSERT' or new.dinner_vendor_id is distinct from old.dinner_vendor_id) and not exists (select 1 from public.food_vendors f where f.id = new.dinner_vendor_id and f.project_id = new.project_id)) then
    raise exception 'That vendor is not set up for this project.';
  end if;
  new.rank := greatest(case when tg_op = 'UPDATE' then old.rank else 1 end, rk, 1)::smallint;
  new.set_by_role := r; new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;

create or replace function public.vendor_name(p_id uuid) returns text language sql stable security definer set search_path = public as $$
  select name from public.food_vendors where id = p_id $$;

create or replace function public.attendance_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid; d date; eid uuid; over text;
begin
  if tg_op = 'DELETE' then pid := old.project_id; d := old.work_date; eid := old.employee_id;
    if old.status is not null then perform public.log_change(pid, d, eid, 'status', old.status, null, 'delete'); end if;
    perform public.touch_day(pid, d); return old;
  end if;
  pid := new.project_id; d := new.work_date; eid := new.employee_id;
  if tg_op = 'INSERT' then
    if new.status is not null then perform public.log_change(pid, d, eid, 'status', null, new.status, 'create'); end if;
    if new.breakfast_vendor_id is not null then perform public.log_change(pid, d, eid, 'breakfast', null, public.vendor_name(new.breakfast_vendor_id), 'create'); end if;
    if new.lunch_vendor_id is not null then perform public.log_change(pid, d, eid, 'lunch', null, public.vendor_name(new.lunch_vendor_id), 'create'); end if;
    if new.dinner_vendor_id is not null then perform public.log_change(pid, d, eid, 'dinner', null, public.vendor_name(new.dinner_vendor_id), 'create'); end if;
  else
    over := case when old.rank < new.rank then public.rank_name(old.rank) end;
    if new.status is distinct from old.status then perform public.log_change(pid, d, eid, 'status', old.status, new.status, 'change', over); end if;
    if new.breakfast_vendor_id is distinct from old.breakfast_vendor_id then perform public.log_change(pid, d, eid, 'breakfast', public.vendor_name(old.breakfast_vendor_id), public.vendor_name(new.breakfast_vendor_id), 'change', over); end if;
    if new.lunch_vendor_id is distinct from old.lunch_vendor_id then perform public.log_change(pid, d, eid, 'lunch', public.vendor_name(old.lunch_vendor_id), public.vendor_name(new.lunch_vendor_id), 'change', over); end if;
    if new.dinner_vendor_id is distinct from old.dinner_vendor_id then perform public.log_change(pid, d, eid, 'dinner', public.vendor_name(old.dinner_vendor_id), public.vendor_name(new.dinner_vendor_id), 'change', over); end if;
  end if;
  perform public.touch_day(pid, d);
  return new;
end $$;
drop trigger if exists attendance_audit_trg on public.attendance;
create trigger attendance_audit_trg after insert or update or delete on public.attendance for each row execute function public.attendance_audit();

-- ---------- 8. transport: locally hired vehicles, did they show up, errands, payments ----------
--   A vehicle belongs to a project and is paid either per trip or monthly. Each day the Supervisor records, per vehicle and per direction
--   (pickup / drop), whether it showed up (server-stamped time) or did not. Errands are extra charges quoted by the operator.
create table if not exists public.transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  operator text not null default '',                      -- who is paid for it (owner / company)
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
alter table public.transport_vehicles add column if not exists project_id uuid references public.projects(id) on delete cascade;   -- transport is project based
alter table public.transport_vehicles add column if not exists billing text not null default 'per_trip';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transport_vehicles_billing_check') then
    alter table public.transport_vehicles add constraint transport_vehicles_billing_check check (billing in ('per_trip','monthly'));
  end if;
end $$;
drop index if exists public.transport_vehicles_name_uq;
create unique index if not exists transport_vehicles_proj_name_uq on public.transport_vehicles (project_id, lower(btrim(name)));

create table if not exists public.transport_rates (       -- the price: per trip, or per month, depending on the vehicle's billing; a new row per change keeps old months correct
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.transport_vehicles(id) on delete cascade,
  price numeric(10,2) not null check (price >= 0),
  effective_from date not null default current_date,
  unique (vehicle_id, effective_from)
);

create table if not exists public.transport_runs (        -- one row per vehicle, day and direction: it showed up, or it did not
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  work_date date not null,
  leg text not null check (leg in ('pickup','drop')),
  vehicle_id uuid not null references public.transport_vehicles(id),
  status text not null check (status in ('showed','no_show')),
  at timestamptz,                                         -- when it showed up: the server's clock when recorded, correctable (and the correction is logged); empty for a no-show
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (vehicle_id, work_date, leg)
);
create index if not exists transport_runs_idx on public.transport_runs (project_id, work_date);
alter table public.transport_runs add column if not exists rank smallint not null default 1;      -- rank of whoever last set this record (a higher role's record is protected, as in attendance)
alter table public.transport_runs add column if not exists set_by_role text;
alter table public.transport_runs add column if not exists updated_by uuid;
alter table public.transport_runs add column if not exists updated_at timestamptz;

create table if not exists public.transport_errands (     -- extra jobs (errands) the operator quotes and we pay for; never edited, only voided
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id),         -- taken from the vehicle's project
  vehicle_id uuid not null references public.transport_vehicles(id),
  work_date date not null default current_date,
  description text not null check (btrim(description) <> ''),
  amount numeric(12,2) not null check (amount > 0),
  voided_at timestamptz, voided_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.transport_payments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.transport_vehicles(id),
  paid_on date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  reference text not null default '',
  note text not null default '',
  project_id uuid references public.projects(id),         -- taken from the vehicle's project
  bill_path text,                                         -- optional bill / receipt (R2), shown on the project's expense
  voided_at timestamptz, voided_by uuid,                  -- payments are never edited or deleted; a wrong one is voided and re-entered
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- a payments table left by an earlier run of this file has no project column: add it, and fill it from each payment's vehicle
alter table public.transport_payments add column if not exists project_id uuid references public.projects(id);
alter table public.transport_payments add column if not exists bill_path text;   -- optional bill / receipt, shown on the project's expense
update public.transport_payments p set project_id = v.project_id from public.transport_vehicles v where v.id = p.vehicle_id and p.project_id is null;

alter table public.transport_vehicles enable row level security;
alter table public.transport_rates enable row level security;
alter table public.transport_runs enable row level security;
alter table public.transport_errands enable row level security;
alter table public.transport_payments enable row level security;
do $$ begin
  drop policy if exists "roles read vehicles" on public.transport_vehicles; drop policy if exists "staff writes vehicles" on public.transport_vehicles;
  create policy "roles read vehicles" on public.transport_vehicles for select to authenticated using (public.can_attend(project_id));   -- a Supervisor or Site Engineer sees only their own site's vehicles
  create policy "staff writes vehicles" on public.transport_vehicles for all to authenticated using (public.is_staff()) with check (public.is_staff());
  drop policy if exists "staff rates" on public.transport_rates; create policy "staff rates" on public.transport_rates for all to authenticated using (public.is_staff()) with check (public.is_staff());
  drop policy if exists "staff payments" on public.transport_payments; create policy "staff payments" on public.transport_payments for all to authenticated using (public.is_staff()) with check (public.is_staff());
  drop policy if exists "staff errands" on public.transport_errands; create policy "staff errands" on public.transport_errands for all to authenticated using (public.is_staff()) with check (public.is_staff());
  drop policy if exists "runs access" on public.transport_runs; create policy "runs access" on public.transport_runs for all to authenticated using (public.can_attend(project_id)) with check (public.can_attend(project_id));
end $$;

create or replace function public.vehicle_name(p_id uuid) returns text language sql stable security definer set search_path = public as $$
  select name from public.transport_vehicles where id = p_id $$;
create or replace function public.run_label(p_vehicle uuid, p_status text, p_at timestamptz) returns text language sql stable security definer set search_path = public as $$
  select coalesce(public.vehicle_name(p_vehicle), '?') || ' · ' || case when p_status = 'showed' then 'showed up ' || coalesce(to_char(p_at at time zone 'Asia/Kolkata', 'HH24:MI'), '') else 'did not show' end $$;

create or replace function public.transport_run_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare rk int := public.role_rank(public.app_role());
begin
  if public.app_role() is null then raise exception 'You do not have access to attendance.'; end if;
  if tg_op in ('UPDATE','DELETE') then perform public.check_write(old.project_id, old.work_date); end if;
  if tg_op = 'DELETE' then return old; end if;
  perform public.check_write(new.project_id, new.work_date);
  if not exists (select 1 from public.transport_vehicles v where v.id = new.vehicle_id and v.project_id = new.project_id) then raise exception 'That vehicle does not belong to this project.'; end if;
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
end $$;
drop trigger if exists transport_run_guard_trg on public.transport_runs;
create trigger transport_run_guard_trg before insert or update or delete on public.transport_runs for each row execute function public.transport_run_guard();

create or replace function public.transport_run_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare over text;
begin
  if tg_op = 'INSERT' then perform public.log_change(new.project_id, new.work_date, null, new.leg, null, public.run_label(new.vehicle_id, new.status, new.at), 'create'); perform public.touch_day(new.project_id, new.work_date); return new; end if;
  if tg_op = 'DELETE' then perform public.log_change(old.project_id, old.work_date, null, old.leg, public.run_label(old.vehicle_id, old.status, old.at), null, 'delete'); perform public.touch_day(old.project_id, old.work_date); return old; end if;
  if new.status is distinct from old.status or new.at is distinct from old.at then perform public.log_change(new.project_id, new.work_date, null, new.leg, public.run_label(old.vehicle_id, old.status, old.at), public.run_label(new.vehicle_id, new.status, new.at), 'change', case when old.rank < new.rank then public.rank_name(old.rank) end); end if;
  perform public.touch_day(new.project_id, new.work_date);
  return new;
end $$;
drop trigger if exists transport_run_audit_trg on public.transport_runs;
create trigger transport_run_audit_trg after insert or update or delete on public.transport_runs for each row execute function public.transport_run_audit();

-- payments and errands: money, never edited or deleted; a wrong one is voided and re-entered. Each takes its vehicle's project.
create or replace function public.transport_money_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'This is never deleted. Void it and enter the right one.'; end if;
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'voided_at' - 'voided_by' - 'bill_path' is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' - 'bill_path' then raise exception 'This cannot be edited. Void it and enter the right one.'; end if;   -- (the bill file is a document, it can be attached or replaced later)
    if old.voided_at is not null and new.voided_at is not distinct from old.voided_at and (to_jsonb(new) ->> 'bill_path') is distinct from (to_jsonb(old) ->> 'bill_path') then return new; end if;   -- (a voided payment can still get its bill)
    if old.voided_at is not null then raise exception 'This is already voided.'; end if;
    if new.voided_at is not null then new.voided_by := auth.uid(); end if;
    return new;
  end if;
  if tg_table_name = 'vendor_payments' then select f.project_id into new.project_id from public.food_vendors f where f.id = new.vendor_id;
  elsif tg_table_name = 'accommodation_payments' then select r.project_id into new.project_id from public.accommodation_rooms r where r.id = new.room_id;
  else select v.project_id into new.project_id from public.transport_vehicles v where v.id = new.vehicle_id; end if;
  if new.project_id is null then raise exception 'This vendor or vehicle is not assigned to a project yet. Assign it to a project first.'; end if;
  new.created_by := auth.uid(); new.voided_at := null; new.voided_by := null; return new;
end $$;
drop trigger if exists transport_payment_guard_trg on public.transport_payments;
create trigger transport_payment_guard_trg before insert or update or delete on public.transport_payments for each row execute function public.transport_money_guard();
drop trigger if exists transport_errand_guard_trg on public.transport_errands;
create trigger transport_errand_guard_trg before insert or update or delete on public.transport_errands for each row execute function public.transport_money_guard();

-- ---------- 8b. meal (food vendor) payments, and posting payments to project expenses ----------
-- A payment is recorded once, here; it creates the Food / Transport expense on the project by itself, and voiding the payment removes that expense.
create table if not exists public.vendor_payments (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.food_vendors(id),
  project_id uuid references public.projects(id),         -- taken from the vendor's project
  paid_on date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  reference text not null default '',
  note text not null default '',
  voided_at timestamptz, voided_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.vendor_payments add column if not exists bill_path text;   -- optional bill / receipt, shown on the project's expense
alter table public.vendor_payments enable row level security;
drop policy if exists "staff vendor payments" on public.vendor_payments;
create policy "staff vendor payments" on public.vendor_payments for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop trigger if exists vendor_payment_guard_trg on public.vendor_payments;
create trigger vendor_payment_guard_trg before insert or update or delete on public.vendor_payments for each row execute function public.transport_money_guard();

do $$ begin
  if to_regclass('public.project_expenses') is not null then
    alter table public.project_expenses add column if not exists source text;        -- 'vendor_payment' or 'transport_payment' when the expense was posted from a payment
    alter table public.project_expenses add column if not exists source_id uuid;
    create unique index if not exists project_expenses_source_uq on public.project_expenses (source, source_id) where source is not null;
  else raise notice 'project_expenses does not exist yet: payments will not be posted to expenses until 2026-10-project-expenses.sql is run and this file is run again'; end if;
end $$;

create or replace function public.post_payment_expense() returns trigger language plpgsql security definer set search_path = public as $$
declare cat uuid; kind text := case tg_table_name when 'vendor_payments' then 'vendor_payment' when 'accommodation_payments' then 'room_payment' else 'transport_payment' end; cname text; who text; lbl text;
begin
  if to_regclass('public.project_expenses') is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.voided_at is not null and old.voided_at is null then   -- voiding a payment removes the expense it posted
      perform set_config('app.posting', '1', true); delete from public.project_expenses where source = kind and source_id = new.id; perform set_config('app.posting', '', true);
    elsif new.voided_at is null and kind <> 'room_payment' then   -- a bill attached (or replaced) later goes onto the expense too
      update public.project_expenses set bill_path = (to_jsonb(new) ->> 'bill_path') where source = kind and source_id = new.id;
    end if;
    return new;
  end if;
  cname := case kind when 'vendor_payment' then 'Food' when 'room_payment' then 'Accommodation' else 'Transport / freight' end;
  select id into cat from public.expense_categories where lower(btrim(name)) = lower(cname) limit 1;
  if cat is null then insert into public.expense_categories (name) values (cname) returning id into cat; end if;
  if kind = 'vendor_payment' then select name into who from public.food_vendors where id = new.vendor_id; lbl := 'Meals payment';
  elsif kind = 'room_payment' then select name || coalesce(' · ' || nullif(btrim(landlord), ''), '') into who from public.accommodation_rooms where id = new.room_id; lbl := 'Rent' || coalesce(' (' || to_char(new.for_month, 'Mon YYYY') || ')', '');
  else select name into who from public.transport_vehicles where id = new.vehicle_id; lbl := 'Transport payment'; end if;   -- (separate statements: the other table's column does not exist on this row)
  insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by, bill_path)
  values (new.project_id, cat, new.paid_on, new.amount, lbl || ' · ' || coalesce(who, '') || coalesce(' · ' || nullif(btrim(new.reference), ''), ''), kind, new.id, auth.uid(), to_jsonb(new) ->> 'bill_path');
  return new;
end $$;
drop trigger if exists vendor_payment_post_trg on public.vendor_payments;
create trigger vendor_payment_post_trg after insert or update on public.vendor_payments for each row execute function public.post_payment_expense();
drop trigger if exists transport_payment_post_trg on public.transport_payments;
create trigger transport_payment_post_trg after insert or update on public.transport_payments for each row execute function public.post_payment_expense();

-- an expense that came from a payment is changed by voiding the payment, not by editing or deleting the expense
create or replace function public.expense_source_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.source is null or current_setting('app.posting', true) = '1' then if tg_op = 'DELETE' then return old; else return new; end if; end if;
  if tg_op = 'DELETE' then raise exception 'This expense comes from a payment. Void the payment to remove it.'; end if;
  if new.amount <> old.amount or new.expense_date <> old.expense_date or new.project_id <> old.project_id or new.category_id <> old.category_id or new.source is distinct from old.source or new.source_id is distinct from old.source_id then
    raise exception 'This expense comes from a payment, so its amount, date and category cannot be changed. Void the payment and record it again.';
  end if;
  return new;
end $$;
do $$ begin
  if to_regclass('public.project_expenses') is not null then
    drop trigger if exists expense_source_guard_trg on public.project_expenses;
    create trigger expense_source_guard_trg before update or delete on public.project_expenses for each row execute function public.expense_source_guard();
  end if;
end $$;

-- (accommodation lives in its own file, 2026-10-accommodation.sql, run after this one. The payment functions above already know about room payments.)

-- ---------- 8d. vendor bills: the bill a food vendor sends, checked against the meals recorded ----------
-- A bill covers a date range (weekly, fortnightly or monthly: a vendor can have several in a month) that never crosses a month end, and two live
-- bills of one vendor never cover the same day. Recording a bill shows the difference from what the meals recorded in its range come to; approving it
-- fixes the amount due for those days (instead of the computed amount) and keeps what the meals came to at that time. Never deleted, only voided.
create table if not exists public.vendor_bills (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.food_vendors(id),
  project_id uuid references public.projects(id),          -- taken from the vendor's project
  bill_month date not null,                                -- the first day of the month the bill falls in (set from bill_from)
  bill_from date not null,                                 -- the first day the bill covers
  bill_to date not null,                                   -- the last day the bill covers (same month as bill_from)
  bill_no text not null default '',
  bill_amount numeric(12,2) not null check (bill_amount >= 0),
  status text not null default 'received' check (status in ('received','approved')),
  approved_amount numeric(12,2) check (approved_amount >= 0),
  computed_amount numeric(12,2),                           -- what the recorded meals came to when the bill was approved
  note text not null default '',
  bill_path text,                                          -- optional copy of the bill in R2
  approved_by uuid, approved_at timestamptz,
  voided_at timestamptz, voided_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
-- an earlier version of this file allowed one bill per month: each such bill now covers its whole month
alter table public.vendor_bills add column if not exists bill_from date;
alter table public.vendor_bills add column if not exists bill_to date;
do $$ begin   -- the protection trigger of the earlier version refuses to touch voided or approved bills, so it is paused for this one-off fill and switched back on straight after
  if exists (select 1 from pg_trigger where tgname = 'vendor_bill_guard_trg' and tgrelid = 'public.vendor_bills'::regclass) then alter table public.vendor_bills disable trigger vendor_bill_guard_trg; end if;
  update public.vendor_bills set bill_from = bill_month, bill_to = (bill_month + interval '1 month' - interval '1 day')::date where bill_from is null or bill_to is null;
  if exists (select 1 from pg_trigger where tgname = 'vendor_bill_guard_trg' and tgrelid = 'public.vendor_bills'::regclass) then alter table public.vendor_bills enable trigger vendor_bill_guard_trg; end if;
end $$;
alter table public.vendor_bills alter column bill_from set not null;
alter table public.vendor_bills alter column bill_to set not null;
drop index if exists public.vendor_bills_one_per_month;
create index if not exists vendor_bills_vendor_idx on public.vendor_bills (vendor_id, bill_from);
alter table public.vendor_bills enable row level security;
drop policy if exists "staff vendor bills" on public.vendor_bills;
create policy "staff vendor bills" on public.vendor_bills for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.vendor_bill_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Bills are never deleted. Void the bill instead.'; end if;
  if tg_op = 'INSERT' then
    select f.project_id into new.project_id from public.food_vendors f where f.id = new.vendor_id;
    if new.project_id is null then raise exception 'This vendor is not assigned to a project yet. Assign it to a project first.'; end if;
    if new.bill_from > new.bill_to then raise exception 'The bill''s first day is after its last day.'; end if;
    if to_char(new.bill_from, 'YYYY-MM') <> to_char(new.bill_to, 'YYYY-MM') then raise exception 'A bill cannot cross a month end. Record it as two bills, one for each month.'; end if;
    if exists (select 1 from public.vendor_bills b where b.vendor_id = new.vendor_id and b.voided_at is null and b.id is distinct from new.id and b.bill_from <= new.bill_to and b.bill_to >= new.bill_from) then
      raise exception 'This vendor already has a bill covering some of % to %. Void that bill first, or choose other dates.', to_char(new.bill_from, 'DD Mon'), to_char(new.bill_to, 'DD Mon');
    end if;
    new.bill_month := date_trunc('month', new.bill_from)::date; new.status := 'received'; new.approved_amount := null; new.computed_amount := null; new.approved_by := null; new.approved_at := null;
    new.voided_at := null; new.voided_by := null; new.created_by := auth.uid(); return new;
  end if;
  if old.voided_at is not null then raise exception 'This bill is already voided.'; end if;
  if new.vendor_id <> old.vendor_id or new.project_id is distinct from old.project_id or new.bill_month <> old.bill_month or new.bill_from <> old.bill_from or new.bill_to <> old.bill_to then raise exception 'A bill''s vendor and dates cannot be changed. Void it and record it again.'; end if;
  if new.voided_at is not null then new.voided_by := auth.uid(); return new; end if;
  if old.status = 'approved' and new.status = 'approved' and (new.bill_amount <> old.bill_amount or new.bill_no is distinct from old.bill_no or new.approved_amount is distinct from old.approved_amount) then raise exception 'This bill is approved. Reopen it to change it.'; end if;
  if old.status = 'received' and new.status = 'approved' then
    if new.approved_amount is null then raise exception 'Enter the amount you approve.'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  elsif old.status = 'approved' and new.status = 'received' then
    new.approved_amount := null; new.computed_amount := null; new.approved_by := null; new.approved_at := null;
  end if;
  return new;
end $$;
drop trigger if exists vendor_bill_guard_trg on public.vendor_bills;
create trigger vendor_bill_guard_trg before insert or update or delete on public.vendor_bills for each row execute function public.vendor_bill_guard();

-- ---------- 9. day sign-off: Supervisor submits, Site Engineer verifies ----------
create or replace function public.day_submit(p_project uuid, p_date date) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.check_write(p_project, p_date);
  insert into public.attendance_days (project_id, work_date, submitted_by, submitted_at) values (p_project, p_date, auth.uid(), now())
  on conflict (project_id, work_date) do update set submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at where public.attendance_days.verified_at is null;
  perform public.log_change(p_project, p_date, null, 'day', null, 'submitted', 'submit');
end $$;
create or replace function public.day_verify(p_project uuid, p_date date) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() not in ('site_engineer','staff','admin') then raise exception 'Only the Site Engineer or an Admin can verify a day.'; end if;
  perform public.check_write(p_project, p_date);
  insert into public.attendance_days (project_id, work_date, submitted_by, submitted_at, verified_by, verified_at) values (p_project, p_date, auth.uid(), now(), auth.uid(), now())
  on conflict (project_id, work_date) do update set verified_by = auth.uid(), verified_at = now(), submitted_by = coalesce(public.attendance_days.submitted_by, auth.uid()), submitted_at = coalesce(public.attendance_days.submitted_at, now());
  perform public.log_change(p_project, p_date, null, 'day', null, 'verified', 'verify');
end $$;
create or replace function public.day_reopen(p_project uuid, p_date date) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() not in ('site_engineer','staff','admin') then raise exception 'Only the Site Engineer or an Admin can reopen a day.'; end if;
  perform public.check_write(p_project, p_date);
  update public.attendance_days set submitted_by = null, submitted_at = null, verified_by = null, verified_at = null where project_id = p_project and work_date = p_date;
  perform public.log_change(p_project, p_date, null, 'day', null, 'reopened', 'reopen');
end $$;

-- Admin only: wipe a day's attendance and meals for a project and reset its sign-off, so the Supervisor can fill it in fresh
-- (an Admin's own entries are otherwise protected from the Supervisor). Transport records are left alone. Logged.
create or replace function public.day_clear(p_project uuid, p_date date) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if public.app_role() <> 'admin' then raise exception 'Only an Admin can clear a day.'; end if;
  delete from public.attendance where project_id = p_project and work_date = p_date;
  get diagnostics n = row_count;
  delete from public.attendance_days where project_id = p_project and work_date = p_date;
  perform public.log_change(p_project, p_date, null, 'day', null, 'cleared (' || n || ' people)', 'clear');
  return n;
end $$;

-- ---------- 10. live updates: other people's changes reach open screens ----------
-- The attendance page and Sites today listen to these tables through Supabase Realtime. Full row identity lets a delete say which project and day it was.
alter table public.attendance replica identity full;
alter table public.transport_runs replica identity full;
alter table public.attendance_days replica identity full;
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['attendance','transport_runs','attendance_days'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- 11. payroll ----------
-- Calendar-month payroll for a project, calculated on the last day of the month and credited between the 1st and 4th of the next month.
-- Someone who joined on or before the 20th is paid for the month; someone who joined after the 20th is paid in the next run (full month plus the
-- days from joining to the previous month end). The calculation is done in the app (Admin only); the database keeps what was calculated, locks it
-- when approved, never edits or deletes money records, and posts salary payments to the project's expenses.
alter table public.employees add column if not exists left_on date;                       -- last day of work; pay stops after it
alter table public.employees add column if not exists pay_mode text not null default 'bank';
alter table public.employees add column if not exists upi_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_pay_mode_check') then
    alter table public.employees add constraint employees_pay_mode_check check (pay_mode in ('bank','upi','cash'));
  end if;
end $$;

-- the attendance roster no longer lists someone after their last day (unless they have attendance recorded in the range)
create or replace function public.attendance_roster(p_project uuid, p_from date, p_to date)
returns table (employee_id uuid, emp_no text, full_name text, designation text, week_off text, join_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_attend(p_project) then raise exception 'Not allowed'; end if;
  return query
    select e.id, e.emp_no, e.full_name, e.designation, e.week_off, e.join_date from public.employees e
    where (e.project_id = p_project and e.outcome <> 'rejected' and e.join_date is not null and e.join_date <= p_to and (e.left_on is null or e.left_on >= p_from))
       or e.id in (select a.employee_id from public.attendance a where a.project_id = p_project and a.work_date between p_from and p_to)
    order by e.full_name;
end $$;

-- salary revisions: the structure in force on a date (the employee's current salary stays on the employee record too)
create table if not exists public.salary_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  effective_from date not null,
  salary jsonb not null,
  monthly_ctc numeric(12,2),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, effective_from)
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  pay_month date not null,                                -- the first day of the month being paid
  status text not null default 'draft' check (status in ('draft','approved')),
  note text not null default '',
  approved_by uuid, approved_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, pay_month)
);
create table if not exists public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  project_id uuid not null references public.projects(id),
  kind text not null default 'salaried' check (kind in ('salaried','daily')),
  days_in_month int not null default 30,
  paid_days numeric(6,2) not null default 0,
  lop_days numeric(6,2) not null default 0,
  gross numeric(12,2) not null default 0,                 -- earnings for the month (including arrears and additions)
  deductions numeric(12,2) not null default 0,
  net numeric(12,2) not null default 0,
  pf_emp numeric(12,2) not null default 0, pf_er numeric(12,2) not null default 0, pf_admin numeric(12,2) not null default 0,
  esi_emp numeric(12,2) not null default 0, esi_er numeric(12,2) not null default 0, pt numeric(12,2) not null default 0,
  er_total numeric(12,2) not null default 0,              -- employer contributions: PF, admin / EDLI and ESI
  pay_mode text not null default 'bank',
  items jsonb not null default '[]',                      -- every earning and deduction line, as shown on the slip
  snapshot jsonb not null default '{}',                   -- the employee details, salary and attendance counts used
  held boolean not null default false, hold_reason text not null default '',
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  employee_id uuid not null references public.employees(id),
  pay_month date not null,
  kind text not null check (kind in ('earning','deduction','lop_waiver')),
  label text not null check (btrim(label) <> ''),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  days numeric(5,2) check (days > 0),                     -- for a LOP waiver: days made paid
  reason text not null default '',
  voided_at timestamptz, voided_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.employee_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  project_id uuid not null references public.projects(id),
  amount numeric(12,2) not null check (amount > 0),
  given_on date not null default current_date,
  instalment numeric(12,2) not null check (instalment > 0),
  note text not null default '',
  voided_at timestamptz, voided_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.advance_recoveries (    -- written only by payroll approval
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.employee_advances(id),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (advance_id, run_id)
);
create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.payroll_lines(id),
  run_id uuid not null references public.payroll_runs(id),
  employee_id uuid not null,
  project_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  mode text not null default 'bank' check (mode in ('bank','upi','cash')),
  paid_on date not null default current_date,
  reference text not null default '',
  voided_at timestamptz, voided_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.statutory_payments (    -- PF / ESI / PT / TDS remitted to the authorities
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  pay_month date not null,                                -- the payroll month it is for
  kind text not null check (kind in ('pf','esi','pt','tds','other')),
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default current_date,
  challan_no text not null default '',
  note text not null default '',
  voided_at timestamptz, voided_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['salary_history','payroll_runs','payroll_lines','payroll_adjustments','employee_advances','advance_recoveries','payroll_payments','statutory_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff all" on public.%I', t); execute format('drop policy if exists "admin all" on public.%I', t);
    if t = 'advance_recoveries' then execute format('create policy "admin all" on public.%I for select to authenticated using (public.is_admin())', t);   -- written only by the approve function
    elsif t = 'salary_history' then execute format('create policy "staff all" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);   -- same people who may see an employee's salary
    else execute format('create policy "admin all" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t); end if;   -- payroll is Admin only
  end loop;
end $$;

-- runs: draft until approved; approving and reopening go through the functions below
create or replace function public.payroll_run_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then if old.status <> 'draft' then raise exception 'An approved payroll cannot be deleted. Reopen it first.'; end if; return old; end if;
  if tg_op = 'INSERT' then new.pay_month := date_trunc('month', new.pay_month)::date; new.status := 'draft'; new.approved_by := null; new.approved_at := null; new.created_by := auth.uid(); return new; end if;
  if new.project_id <> old.project_id or new.pay_month <> old.pay_month then raise exception 'A payroll''s project and month cannot be changed.'; end if;
  if new.status <> old.status and coalesce(current_setting('app.payroll', true), '') <> '1' then raise exception 'Use Approve or Reopen.'; end if;
  return new;
end $$;
drop trigger if exists payroll_run_guard_trg on public.payroll_runs;
create trigger payroll_run_guard_trg before insert or update or delete on public.payroll_runs for each row execute function public.payroll_run_guard();

-- lines: editable only while the run is a draft (holding someone's pay is allowed any time)
create or replace function public.payroll_line_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from public.payroll_runs where id = coalesce(new.run_id, old.run_id);
  if tg_op = 'UPDATE' and st = 'approved' then
    if to_jsonb(new) - 'held' - 'hold_reason' is distinct from to_jsonb(old) - 'held' - 'hold_reason' then raise exception 'This payroll is approved. Reopen it to change the figures.'; end if;
    return new;
  end if;
  if st = 'approved' then raise exception 'This payroll is approved. Reopen it to change it.'; end if;
  if tg_op = 'DELETE' then return old; end if;
  new.project_id := (select project_id from public.payroll_runs where id = new.run_id); return new;
end $$;
drop trigger if exists payroll_line_guard_trg on public.payroll_lines;
create trigger payroll_line_guard_trg before insert or update or delete on public.payroll_lines for each row execute function public.payroll_line_guard();

-- adjustments and advances: never edited or deleted, only voided; adjustments are closed once the month is approved
create or replace function public.payroll_adjustment_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare approved boolean;
begin
  if tg_op = 'DELETE' then raise exception 'This is never deleted. Void it instead.'; end if;
  select exists (select 1 from public.payroll_runs r where r.project_id = coalesce(new.project_id, old.project_id) and r.pay_month = date_trunc('month', coalesce(new.pay_month, old.pay_month))::date and r.status = 'approved') into approved;
  if approved then raise exception 'That month''s payroll is approved. Reopen it to change adjustments.'; end if;
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'voided_at' - 'voided_by' is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' then raise exception 'This cannot be edited. Void it and enter it again.'; end if;
    if old.voided_at is not null then raise exception 'This is already voided.'; end if;
    if new.voided_at is not null then new.voided_by := auth.uid(); end if; return new;
  end if;
  new.pay_month := date_trunc('month', new.pay_month)::date; new.created_by := auth.uid(); new.voided_at := null; new.voided_by := null;
  if new.kind = 'lop_waiver' and new.days is null then raise exception 'Enter the number of days to waive.'; end if;
  if new.kind <> 'lop_waiver' and new.amount <= 0 then raise exception 'Enter the amount.'; end if;
  return new;
end $$;
drop trigger if exists payroll_adjustment_guard_trg on public.payroll_adjustments;
create trigger payroll_adjustment_guard_trg before insert or update or delete on public.payroll_adjustments for each row execute function public.payroll_adjustment_guard();

create or replace function public.advance_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'An advance is never deleted. Void it instead.'; end if;
  if tg_op = 'UPDATE' then
    if new.amount <> old.amount or new.employee_id <> old.employee_id or new.project_id <> old.project_id or new.given_on <> old.given_on then raise exception 'An advance''s amount, person, project and date cannot be changed. Void it and enter it again.'; end if;
    if old.voided_at is not null then raise exception 'This is already voided.'; end if;
    if new.voided_at is not null then
      if exists (select 1 from public.advance_recoveries where advance_id = old.id) then raise exception 'Part of this advance has already been recovered in a payroll, so it cannot be voided.'; end if;
      new.voided_by := auth.uid();
    end if; return new;
  end if;
  new.created_by := auth.uid(); new.voided_at := null; new.voided_by := null; return new;
end $$;
drop trigger if exists advance_guard_trg on public.employee_advances;
create trigger advance_guard_trg before insert or update or delete on public.employee_advances for each row execute function public.advance_guard();

-- approve / reopen
create or replace function public.payroll_approve(p_run uuid) returns void language plpgsql security definer set search_path = public as $$
declare r public.payroll_runs%rowtype; it jsonb; l record; owed numeric;
begin
  if not public.is_admin() then raise exception 'Only an Admin can approve payroll.'; end if;
  select * into r from public.payroll_runs where id = p_run for update; if not found then raise exception 'Payroll not found.'; end if;
  if r.status = 'approved' then raise exception 'This payroll is already approved.'; end if;
  if not exists (select 1 from public.payroll_lines where run_id = p_run) then raise exception 'There is nobody in this payroll yet.'; end if;
  if exists (select 1 from public.payroll_lines where run_id = p_run and net < 0) then raise exception 'Someone''s net pay is negative. Fix their deductions before approving.'; end if;
  for l in select * from public.payroll_lines where run_id = p_run loop
    for it in select * from jsonb_array_elements(l.items) loop
      if it ->> 'advance_id' is not null then
        select a.amount - coalesce((select sum(x.amount) from public.advance_recoveries x where x.advance_id = a.id), 0) into owed from public.employee_advances a where a.id = (it ->> 'advance_id')::uuid and a.voided_at is null;
        if owed is null or (it ->> 'amount')::numeric > owed then raise exception 'An advance recovery is larger than what is still owed. Recalculate the payroll.'; end if;
        insert into public.advance_recoveries (advance_id, run_id, employee_id, amount) values ((it ->> 'advance_id')::uuid, p_run, l.employee_id, (it ->> 'amount')::numeric);
      end if;
    end loop;
  end loop;
  perform set_config('app.payroll', '1', true); update public.payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_run; perform set_config('app.payroll', '', true);
end $$;
create or replace function public.payroll_reopen(p_run uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can reopen payroll.'; end if;
  if not exists (select 1 from public.payroll_runs where id = p_run and status = 'approved') then raise exception 'This payroll is not approved.'; end if;
  if exists (select 1 from public.payroll_payments where run_id = p_run and voided_at is null) then raise exception 'Salary payments have been recorded for this payroll. Void them first.'; end if;
  delete from public.advance_recoveries where run_id = p_run;
  perform set_config('app.payroll', '1', true); update public.payroll_runs set status = 'draft', approved_by = null, approved_at = null where id = p_run; perform set_config('app.payroll', '', true);
end $$;

-- salary payments: only against an approved payroll, never more than the net, never edited or deleted
create or replace function public.payroll_payment_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare l public.payroll_lines%rowtype; paid numeric; st text;
begin
  if tg_op = 'DELETE' then raise exception 'A payment is never deleted. Void it and enter the right one.'; end if;
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'voided_at' - 'voided_by' is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' then raise exception 'A payment cannot be edited. Void it and enter the right one.'; end if;
    if old.voided_at is not null then raise exception 'This payment is already voided.'; end if;
    if new.voided_at is not null then new.voided_by := auth.uid(); end if; return new;
  end if;
  select * into l from public.payroll_lines where id = new.line_id; if not found then raise exception 'Payroll line not found.'; end if;
  select status into st from public.payroll_runs where id = l.run_id; if st <> 'approved' then raise exception 'Approve the payroll before recording payments.'; end if;
  if l.held then raise exception 'This person''s pay is on hold: %', coalesce(nullif(l.hold_reason, ''), 'no reason given'); end if;
  select coalesce(sum(amount), 0) into paid from public.payroll_payments where line_id = l.id and voided_at is null;
  if paid + new.amount > l.net then raise exception 'That is more than the net pay (₹% of ₹% already paid).', paid, l.net; end if;
  new.run_id := l.run_id; new.employee_id := l.employee_id; new.project_id := l.project_id; new.created_by := auth.uid(); new.voided_at := null; new.voided_by := null; return new;
end $$;
drop trigger if exists payroll_payment_guard_trg on public.payroll_payments;
create trigger payroll_payment_guard_trg before insert or update or delete on public.payroll_payments for each row execute function public.payroll_payment_guard();

-- the project's Salaries & wages expense for a payroll run: one row, kept equal to what has been paid
create or replace function public.sync_payroll_expense(p_run uuid) returns void language plpgsql security definer set search_path = public as $$
declare total numeric; n int; last_paid date; cat uuid; r public.payroll_runs%rowtype;
begin
  if to_regclass('public.project_expenses') is null then return; end if;
  select * into r from public.payroll_runs where id = p_run;
  select coalesce(sum(amount), 0), count(distinct employee_id), max(paid_on) into total, n, last_paid from public.payroll_payments where run_id = p_run and voided_at is null;
  perform set_config('app.posting', '1', true);
  if total <= 0 then delete from public.project_expenses where source = 'payroll' and source_id = p_run;
  else
    select id into cat from public.expense_categories where lower(btrim(name)) = 'salaries & wages' limit 1;
    if cat is null then insert into public.expense_categories (name) values ('Salaries & wages') returning id into cat; end if;
    insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by)
    values (r.project_id, cat, last_paid, total, 'Salaries · ' || to_char(r.pay_month, 'Mon YYYY') || ' · ' || n || ' ' || case when n = 1 then 'person' else 'people' end || ' paid', 'payroll', p_run, auth.uid())
    on conflict (source, source_id) where source is not null do update set amount = excluded.amount, expense_date = excluded.expense_date, description = excluded.description, category_id = excluded.category_id;
  end if;
  perform set_config('app.posting', '', true);
end $$;
create or replace function public.payroll_payment_post() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sync_payroll_expense(new.run_id); return new; end $$;
drop trigger if exists payroll_payment_post_trg on public.payroll_payments;
create trigger payroll_payment_post_trg after insert or update on public.payroll_payments for each row execute function public.payroll_payment_post();

-- statutory remittances: one Statutory / compliance expense each; never edited or deleted, only voided
create or replace function public.statutory_payment_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'A payment is never deleted. Void it and enter the right one.'; end if;
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'voided_at' - 'voided_by' is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' then raise exception 'A payment cannot be edited. Void it and enter the right one.'; end if;
    if old.voided_at is not null then raise exception 'This payment is already voided.'; end if;
    if new.voided_at is not null then new.voided_by := auth.uid(); end if; return new;
  end if;
  new.pay_month := date_trunc('month', new.pay_month)::date; new.created_by := auth.uid(); new.voided_at := null; new.voided_by := null; return new;
end $$;
drop trigger if exists statutory_payment_guard_trg on public.statutory_payments;
create trigger statutory_payment_guard_trg before insert or update or delete on public.statutory_payments for each row execute function public.statutory_payment_guard();
create or replace function public.statutory_payment_post() returns trigger language plpgsql security definer set search_path = public as $$
declare cat uuid;
begin
  if to_regclass('public.project_expenses') is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.voided_at is not null and old.voided_at is null then perform set_config('app.posting', '1', true); delete from public.project_expenses where source = 'statutory_payment' and source_id = new.id; perform set_config('app.posting', '', true); end if;
    return new;
  end if;
  select id into cat from public.expense_categories where lower(btrim(name)) = 'statutory / compliance' limit 1;
  if cat is null then insert into public.expense_categories (name) values ('Statutory / compliance') returning id into cat; end if;
  insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by)
  values (new.project_id, cat, new.paid_on, new.amount, upper(new.kind) || ' payment · ' || to_char(new.pay_month, 'Mon YYYY') || coalesce(' · ' || nullif(btrim(new.challan_no), ''), ''), 'statutory_payment', new.id, auth.uid());
  return new;
end $$;
drop trigger if exists statutory_payment_post_trg on public.statutory_payments;
create trigger statutory_payment_post_trg after insert or update on public.statutory_payments for each row execute function public.statutory_payment_post();

grant execute on function public.payroll_approve(uuid), public.payroll_reopen(uuid) to authenticated;
revoke all on function public.payroll_approve(uuid), public.payroll_reopen(uuid) from public, anon;
grant execute on function public.payroll_approve(uuid), public.payroll_reopen(uuid) to authenticated;

revoke all on function public.admin_list_users(), public.day_submit(uuid, date), public.day_verify(uuid, date), public.day_reopen(uuid, date), public.day_clear(uuid, date), public.app_rank(), public.user_label(uuid) from public, anon;
grant execute on function public.admin_list_users(), public.day_submit(uuid, date), public.day_verify(uuid, date), public.day_reopen(uuid, date), public.day_clear(uuid, date), public.app_rank(), public.user_label(uuid) to authenticated;
