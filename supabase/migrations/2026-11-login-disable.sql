-- Disabling a login: when someone leaves, their login stops working completely (the password is refused), and an Admin can turn it back on for a rehire.
-- Safe to run more than once. Run AFTER 2026-11-offboarding.sql and 2026-10-notification-enforcement.sql.
--
-- 1. A login can be linked to the employee it belongs to (user_profiles.employee_id), on the Users page. One login per employee.
-- 2. Disabling (Admin only, from the Users page or the employee's Exit tab) does four things. The app's server bans the login in Supabase Auth (the password
--    no longer works, the phone cannot renew its session); this database part then signs it out everywhere (the per-person sign-out moment, and its saved
--    sessions removed), removes its role and site assignments, and records who disabled it, when and why. The login is kept, so the person's name stays on
--    everything they entered. Enabling lifts the ban; the role is then given again on purpose on the Users page.
-- 3. Automatically: just after midnight following an employee's last working day (the scheduled job that runs every 5 minutes), a linked login is disabled,
--    unless an Admin turned it back on after that exit was recorded, or it is an Admin's login (an Admin is never locked out automatically).
-- 4. The exit checklist is finished only when a linked login is disabled.

alter table public.user_profiles add column if not exists employee_id uuid references public.employees(id) on delete set null;
create unique index if not exists user_profiles_employee_once on public.user_profiles (employee_id) where employee_id is not null;
alter table public.user_profiles add column if not exists disabled_at timestamptz;
alter table public.user_profiles add column if not exists disabled_by uuid;
alter table public.user_profiles add column if not exists disabled_reason text not null default '';
alter table public.user_profiles add column if not exists enabled_at timestamptz;   -- the last time an Admin turned it back on

-- the Users page list, now with the linked employee and whether the login is disabled
drop function if exists public.admin_list_users();
create function public.admin_list_users() returns table (user_id uuid, email text, full_name text, last_sign_in_at timestamptz, role text, project_ids uuid[], push_devices int, push_last_at timestamptz,
  employee_id uuid, disabled_at timestamptz, disabled_reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query select u.id, u.email::text, coalesce(p.full_name, ''), u.last_sign_in_at, r.role,
    coalesce(array(select up.project_id from public.user_projects up where up.user_id = u.id), '{}'::uuid[]),
    (select count(*)::int from public.push_subscriptions s where s.user_id = u.id),
    (select max(s.created_at) from public.push_subscriptions s where s.user_id = u.id),
    p.employee_id, p.disabled_at, coalesce(p.disabled_reason, '')
  from auth.users u left join public.user_roles r on r.user_id = u.id left join public.user_profiles p on p.user_id = u.id order by u.email;
end $$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- link a login to an employee (or unlink with null). Admin only.
create or replace function public.admin_link_login(p_user uuid, p_employee uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'No such login.'; end if;
  if p_employee is not null and exists (select 1 from public.user_profiles where employee_id = p_employee and user_id <> p_user) then raise exception 'That employee is already linked to another login.'; end if;
  insert into public.user_profiles (user_id, employee_id, updated_at) values (p_user, p_employee, now())
    on conflict (user_id) do update set employee_id = excluded.employee_id, updated_at = now();
end $$;
revoke all on function public.admin_link_login(uuid, uuid) from public, anon;
grant execute on function public.admin_link_login(uuid, uuid) to authenticated;

-- the database half of disabling (the ban itself is done by the app's server first). Server only.
create or replace function public.login_cut_off(p_user uuid, p_by uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_settings (key, value, updated_at) values ('relogin_user:' || p_user::text, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  begin delete from auth.sessions where user_id = p_user; exception when others then raise notice 'Could not remove saved sessions (%).', sqlerrm; end;
  delete from public.user_projects where user_id = p_user;
  delete from public.user_roles where user_id = p_user;
  insert into public.user_profiles (user_id, disabled_at, disabled_by, disabled_reason, updated_at) values (p_user, now(), p_by, left(btrim(coalesce(p_reason, '')), 300), now())
    on conflict (user_id) do update set disabled_at = now(), disabled_by = p_by, disabled_reason = left(btrim(coalesce(p_reason, '')), 300), updated_at = now();
end $$;

create or replace function public.login_restore(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.user_profiles set disabled_at = null, disabled_by = null, disabled_reason = '', enabled_at = now(), updated_at = now() where user_id = p_user;
end $$;

-- logins whose employee's last working day is over (India time) and which are still enabled. For the scheduled job.
create or replace function public.logins_due_to_disable() returns table (user_id uuid, full_name text, last_day date, exit_type text) language sql stable security definer set search_path = public as $$
  select p.user_id, e.full_name, x.last_day, x.exit_type
  from public.user_profiles p
  join public.employees e on e.id = p.employee_id
  join lateral (select * from public.employee_exits xx where xx.employee_id = e.id and xx.status <> 'cancelled' and xx.rehired_at is null order by xx.created_at desc limit 1) x on true
  where p.disabled_at is null
    and x.last_day < (now() at time zone 'Asia/Kolkata')::date
    and (p.enabled_at is null or p.enabled_at < x.created_at)
    and not exists (select 1 from public.user_roles r where r.user_id = p.user_id and r.role = 'admin') $$;

revoke all on function public.login_cut_off(uuid, uuid, text), public.login_restore(uuid), public.logins_due_to_disable() from public, anon, authenticated;
grant execute on function public.login_cut_off(uuid, uuid, text), public.login_restore(uuid), public.logins_due_to_disable() to service_role;

-- the exit checklist is finished only when a linked login is disabled too
create or replace function public.exit_cleared(p_exit uuid) returns boolean language sql stable security definer set search_path = public as $$
  select (select count(*) from public.employee_exit_items where exit_id = p_exit) >= 7
     and not exists (select 1 from public.employee_exits x join public.user_profiles u on u.employee_id = x.employee_id where x.id = p_exit and u.disabled_at is null) $$;
