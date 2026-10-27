-- Roles (admin / staff / supervisor) + the attendance tracker (work + breakfast / lunch / dinner per vendor).
-- Run AFTER the other 2026-10 migrations (the tables they create are protected here if they exist).
-- Safe to run more than once.
--
-- WHAT THIS CHANGES: before, any logged-in user could read and write every table. After this, a user needs a row in
-- user_roles. Everyone who has an account today is made an ADMIN below, so nothing changes for you. Accounts created
-- later have NO access until an admin gives them a role (Users page in the app).

-- ---------- roles ----------
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','staff','attendance')),
  created_at timestamptz not null default now()
);
create table if not exists public.user_projects (          -- which projects an supervisor may handle
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  primary key (user_id, project_id)
);
insert into public.user_roles (user_id, role) select id, 'admin' from auth.users on conflict do nothing;

create or replace function public.app_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid() $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'admin', false) $$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('admin','staff'), false) $$;
create or replace function public.can_attend(p_project uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or (public.app_role() = 'attendance' and exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = p_project)) $$;

alter table public.user_roles enable row level security;
alter table public.user_projects enable row level security;
drop policy if exists "read own role" on public.user_roles;
drop policy if exists "admin manages roles" on public.user_roles;
create policy "read own role" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "admin manages roles" on public.user_roles for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "read own projects" on public.user_projects;
drop policy if exists "admin manages user projects" on public.user_projects;
create policy "read own projects" on public.user_projects for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "admin manages user projects" on public.user_projects for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admin-only list of logins (emails live in auth.users, which the app cannot read directly).
create or replace function public.admin_list_users() returns table (user_id uuid, email text, last_sign_in_at timestamptz, role text, project_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query select u.id, u.email::text, u.last_sign_in_at, r.role,
    coalesce(array(select up.project_id from public.user_projects up where up.user_id = u.id), '{}'::uuid[])
  from auth.users u left join public.user_roles r on r.user_id = u.id order by u.email;
end $$;

-- ---------- lock the existing tables to staff (admin + staff) ----------
do $$ declare t text; begin
  foreach t in array array['employees','clauses','letters','mail_templates','employee_documents','form_invites','quotations','quote_library',
                           'projects','departments','expense_categories','project_expenses','document_types','project_documents'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "auth all" on public.%I', t);
      execute format('drop policy if exists "staff all" on public.%I', t);
      execute format('create policy "staff all" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    end if;
  end loop;
end $$;
-- An supervisor may see the projects they are assigned to (name / location only matter here).
drop policy if exists "attendance read assigned" on public.projects;
create policy "attendance read assigned" on public.projects for select to authenticated
  using (public.app_role() = 'attendance' and exists (select 1 from public.user_projects up where up.user_id = auth.uid() and up.project_id = projects.id));
-- Old Supabase-storage bucket policy (files now live in R2): staff only.
do $$ begin
  drop policy if exists "auth docs all" on storage.objects;
  create policy "auth docs all" on storage.objects for all to authenticated
    using (bucket_id = 'employee-docs' and public.is_staff()) with check (bucket_id = 'employee-docs' and public.is_staff());
exception when others then raise notice 'storage policy skipped: %', sqlerrm; end $$;

-- ---------- food vendors and meal prices ----------
create table if not exists public.food_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create unique index if not exists food_vendors_name_uq on public.food_vendors (lower(btrim(name)));
create table if not exists public.meal_rates (               -- price per meal; a new row per change keeps old months correct
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.food_vendors(id) on delete cascade,
  meal text not null check (meal in ('breakfast','lunch','dinner')),
  price numeric(10,2) not null check (price >= 0),
  effective_from date not null default current_date,
  unique (vendor_id, meal, effective_from)
);
alter table public.food_vendors enable row level security;
alter table public.meal_rates enable row level security;
do $$ declare t text; begin
  foreach t in array array['food_vendors','meal_rates'] loop
    execute format('drop policy if exists "any role reads" on public.%I', t);
    execute format('drop policy if exists "staff writes" on public.%I', t);
    execute format('create policy "any role reads" on public.%I for select to authenticated using (public.app_role() is not null)', t);
    execute format('create policy "staff writes" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;
insert into public.food_vendors (name, sort_order)
select * from (values ('Maruti', 10), ('Plant Mess', 20)) as v(name, sort_order)
where not exists (select 1 from public.food_vendors);

-- ---------- attendance ----------
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  project_id uuid not null references public.projects(id),
  work_date date not null,
  status text not null default 'present' check (status in ('present','absent','half','off')),   -- off = weekly off
  breakfast_vendor_id uuid references public.food_vendors(id),     -- empty = did not take that meal
  lunch_vendor_id uuid references public.food_vendors(id),
  dinner_vendor_id uuid references public.food_vendors(id),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index if not exists attendance_project_date_idx on public.attendance (project_id, work_date);
alter table public.attendance enable row level security;
drop policy if exists "attendance access" on public.attendance;
create policy "attendance access" on public.attendance for all to authenticated using (public.can_attend(project_id)) with check (public.can_attend(project_id));

-- Rules enforced in the database (so they cannot be bypassed from the screen):
--  * admins can change anything, any time;
--  * everyone else (supervisors, staff) can only touch their own projects, never a future day, and never a day after 11:00 PM India time on that day;
--  * the person must currently be on that project.
create or replace function public.attendance_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); ist timestamp := (now() at time zone 'Asia/Kolkata');
begin
  if r is null then raise exception 'You do not have access to attendance.'; end if;
  if r = 'admin' then
    if tg_op = 'DELETE' then return old; end if;
    new.updated_by := auth.uid(); new.updated_at := now(); return new;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    if ist >= old.work_date + time '23:00' then raise exception 'Attendance for % is locked (it locks at 11:00 PM). Ask an Admin to change it.', to_char(old.work_date, 'DD Mon'); end if;
    if r = 'attendance' and not exists (select 1 from public.user_projects where user_id = auth.uid() and project_id = old.project_id) then raise exception 'You are not assigned to this project.'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if r = 'attendance' and not exists (select 1 from public.user_projects where user_id = auth.uid() and project_id = new.project_id) then raise exception 'You are not assigned to this project.'; end if;
  if new.work_date > ist::date then raise exception 'Attendance cannot be entered for a future date.'; end if;
  if ist >= new.work_date + time '23:00' then raise exception 'Attendance for % is locked (it locks at 11:00 PM). Ask an Admin to change it.', to_char(new.work_date, 'DD Mon'); end if;
  if not exists (select 1 from public.employees e where e.id = new.employee_id and e.project_id = new.project_id) then raise exception 'That person is not on this project.'; end if;
  new.updated_by := auth.uid(); new.updated_at := now(); return new;
end $$;
drop trigger if exists attendance_guard_trg on public.attendance;
create trigger attendance_guard_trg before insert or update or delete on public.attendance for each row execute function public.attendance_guard();

-- The only way a supervisor sees people: names and roles of the project they handle (no Aadhaar, bank, salary or documents).
-- Covers a date range, so the same call serves the daily sheet and the monthly grid.
create or replace function public.attendance_roster(p_project uuid, p_from date, p_to date)
returns table (employee_id uuid, emp_no text, full_name text, designation text, week_off text, join_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_attend(p_project) then raise exception 'Not allowed'; end if;
  return query
    select e.id, e.emp_no, e.full_name, e.designation, e.week_off, e.join_date from public.employees e
    where (e.project_id = p_project and e.outcome <> 'rejected' and e.join_date is not null and e.join_date <= p_to)
       or e.id in (select a.employee_id from public.attendance a where a.project_id = p_project and a.work_date between p_from and p_to)
    order by e.full_name;
end $$;

revoke all on function public.app_role(), public.is_admin(), public.is_staff(), public.can_attend(uuid), public.admin_list_users(), public.attendance_roster(uuid, date, date) from public, anon;
grant execute on function public.app_role(), public.is_admin(), public.is_staff(), public.can_attend(uuid), public.admin_list_users(), public.attendance_roster(uuid, date, date) to authenticated;
