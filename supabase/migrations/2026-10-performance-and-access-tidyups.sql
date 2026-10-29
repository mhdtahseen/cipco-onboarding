-- Tidy-ups from the Supabase advisors, and one real access problem they were hiding. Safe to run again. Run it in the SQL editor.
--
-- 1. ACCESS FIX: project_expenses and expense_categories had a policy "auth all" (using true) that lets EVERY signed-in user, including a Supervisor or
--    Site Engineer, read, change and delete them. It comes back whenever the old 2026-10-project-expenses.sql is run again after the roles migration
--    (that file has been fixed so it no longer does). Staff and Admin keep their access through "staff all".
-- 2. Overlapping policies (advisor "multiple permissive policies"): a policy that covers ALL actions next to one that covers SELECT is checked twice on every
--    read. Each ALL policy below is split into separate insert / update / delete policies with the SAME condition, and the SELECT policy already allows
--    everyone the ALL policy did (staff are included in can_attend, in app_role() is not null, and in is_admin()), so who can do what does not change.
-- 3. Row-level-security calls to auth.uid() are wrapped in (select …) so Postgres works it out once per query, not once per row.
-- 4. Indexes on the foreign keys the advisor listed (joins and deletes on those columns stop scanning the whole table).
-- The 10 "unused index" notices are left alone: they are new or low-traffic tables, not wasted indexes.

begin;

-- ── 1. close the wide-open expense policies (only staff and admin may touch money) ──
drop policy if exists "auth all" on public.expense_categories;
drop policy if exists "auth all" on public.project_expenses;
drop policy if exists "staff all" on public.expense_categories;
drop policy if exists "staff all" on public.project_expenses;
create policy "staff all" on public.expense_categories for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff all" on public.project_expenses for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ── 2. split the ALL policies that overlap a SELECT policy (same condition, so same access) ──
do $$ declare r record; begin
  for r in select * from (values
    ('food_vendors',       'staff writes',                'public.is_staff()'),
    ('meal_rates',         'staff writes',                'public.is_staff()'),
    ('transport_vehicles', 'staff writes vehicles',       'public.is_staff()'),
    ('user_profiles',      'admin manages names',         'public.is_admin()'),
    ('user_projects',      'admin manages user projects', 'public.is_admin()'),
    ('user_roles',         'admin manages roles',         'public.is_admin()')
  ) as v(t, old_name, pred) loop
    execute format('drop policy if exists %I on public.%I', r.old_name, r.t);
    execute format('drop policy if exists %I on public.%I', r.old_name || ' (insert)', r.t);
    execute format('drop policy if exists %I on public.%I', r.old_name || ' (update)', r.t);
    execute format('drop policy if exists %I on public.%I', r.old_name || ' (delete)', r.t);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', r.old_name || ' (insert)', r.t, r.pred);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', r.old_name || ' (update)', r.t, r.pred, r.pred);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', r.old_name || ' (delete)', r.t, r.pred);
  end loop;
end $$;

-- projects: staff do everything; a Supervisor / Site Engineer may see the projects they are assigned to. can_attend(id) is exactly "staff, or assigned".
drop policy if exists "staff all" on public.projects;
drop policy if exists "attendance read assigned" on public.projects;
drop policy if exists "read projects" on public.projects;
drop policy if exists "staff inserts projects" on public.projects;
drop policy if exists "staff updates projects" on public.projects;
drop policy if exists "staff deletes projects" on public.projects;
create policy "read projects" on public.projects for select to authenticated using (public.can_attend(id));
create policy "staff inserts projects" on public.projects for insert to authenticated with check (public.is_staff());
create policy "staff updates projects" on public.projects for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff deletes projects" on public.projects for delete to authenticated using (public.is_staff());

-- ── 3. auth.uid() worked out once per query ──
drop policy if exists "read own role" on public.user_roles;
create policy "read own role" on public.user_roles for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "read own projects" on public.user_projects;
create policy "read own projects" on public.user_projects for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

commit;

-- ── 4. foreign-key indexes (skips any table that does not exist here) ──
do $$ declare r record; begin
  for r in select * from (values
    ('accommodation_payments','project_id'), ('accommodation_payments','room_id'), ('advance_recoveries','run_id'),
    ('attendance','breakfast_vendor_id'), ('attendance','lunch_vendor_id'), ('attendance','dinner_vendor_id'),
    ('employee_advances','employee_id'), ('employee_advances','project_id'), ('invoices','project_id'), ('letters','employee_id'),
    ('payroll_adjustments','employee_id'), ('payroll_adjustments','project_id'), ('payroll_lines','employee_id'), ('payroll_lines','project_id'),
    ('payroll_payments','line_id'), ('payroll_payments','run_id'), ('project_documents','type_id'), ('project_expenses','employee_id'),
    ('statutory_payments','project_id'), ('transport_errands','project_id'), ('transport_errands','vehicle_id'),
    ('transport_payments','project_id'), ('transport_payments','vehicle_id'), ('transport_trips','vehicle_id'),
    ('user_projects','project_id'), ('vendor_bills','project_id'), ('vendor_payments','project_id'), ('vendor_payments','vendor_id'), ('work_orders','project_id')
  ) as v(t, c) loop
    if to_regclass('public.' || r.t) is not null then
      execute format('create index if not exists %I on public.%I (%I)', r.t || '_' || r.c || '_idx', r.t, r.c);
    end if;
  end loop;
end $$;
