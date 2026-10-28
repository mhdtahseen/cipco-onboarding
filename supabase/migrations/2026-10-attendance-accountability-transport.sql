-- Attendance accountability + trip-based transport.
--   * roles: Supervisor and Site Engineer (the old "attendance clerk" becomes Supervisor); Staff is no longer offered
--   * higher roles overrule lower ones, and a lower role cannot change what a higher role set (Supervisor < Site Engineer < Admin)
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
alter table public.attendance add column if not exists rank smallint not null default 1;     -- rank of whoever last set this entry
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
  if tg_op in ('UPDATE','DELETE') and old.rank > rk then   -- a higher role's entry is protected
    raise exception 'This entry was set by the % and can''t be changed by a %.', public.rank_name(old.rank), public.rank_name(rk);
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
  voided_at timestamptz, voided_by uuid,                  -- payments are never edited or deleted; a wrong one is voided and re-entered
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

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
  if tg_op in ('UPDATE','DELETE') and old.rank > rk then raise exception 'This was set by the % and can''t be changed by a %.', public.rank_name(old.rank), public.rank_name(rk); end if;   -- the Site Engineer can overrule the Supervisor, not the other way round
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
    if to_jsonb(new) - 'voided_at' - 'voided_by' is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' then raise exception 'This cannot be edited. Void it and enter the right one.'; end if;
    if old.voided_at is not null then raise exception 'This is already voided.'; end if;
    if new.voided_at is not null then new.voided_by := auth.uid(); end if;
    return new;
  end if;
  select v.project_id into new.project_id from public.transport_vehicles v where v.id = new.vehicle_id;
  new.created_by := auth.uid(); new.voided_at := null; new.voided_by := null; return new;
end $$;
drop trigger if exists transport_payment_guard_trg on public.transport_payments;
create trigger transport_payment_guard_trg before insert or update or delete on public.transport_payments for each row execute function public.transport_money_guard();
drop trigger if exists transport_errand_guard_trg on public.transport_errands;
create trigger transport_errand_guard_trg before insert or update or delete on public.transport_errands for each row execute function public.transport_money_guard();

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

revoke all on function public.admin_list_users(), public.day_submit(uuid, date), public.day_verify(uuid, date), public.day_reopen(uuid, date), public.day_clear(uuid, date), public.app_rank(), public.user_label(uuid) from public, anon;
grant execute on function public.admin_list_users(), public.day_submit(uuid, date), public.day_verify(uuid, date), public.day_reopen(uuid, date), public.day_clear(uuid, date), public.app_rank(), public.user_label(uuid) to authenticated;
