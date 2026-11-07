-- Permissions: what each role may do in each module and tab, edited by an Admin on the Permissions page.
-- Levels, lowest to highest: none < view < create < edit < full. A key is a module ("quotations") or one tab of it ("meals.bills"); a tab with no row takes its module's level. Admin is always full and is not stored.
-- Seeds the defaults (how the app behaved before, plus: Operations get Quotations create/read/update, Payroll, Clients; view-only Projects, Expenses and Meals Overview/Daily log/People/Bills).
-- Opens the payroll tables (Admin-only until now) to the levels set here. Approving and reopening a payroll run stay Admin-only inside their functions.
-- Safe to run more than once. Nothing here removes data.

create table if not exists public.role_permissions (
  role text not null check (role in ('staff', 'site_engineer', 'supervisor', 'viewer')),
  module text not null check (module ~ '^[a-z_]+(\.[a-z_]+)?$'),
  level text not null check (level in ('none', 'view', 'create', 'edit', 'full')),
  updated_at timestamptz not null default now(), updated_by uuid,
  primary key (role, module)
);
alter table public.role_permissions enable row level security;
drop policy if exists "read permissions" on public.role_permissions;
create policy "read permissions" on public.role_permissions for select to authenticated using (true);   -- not secret; the menu and the page guard read it. Written only by admin_set_role_permissions.
grant select on public.role_permissions to authenticated;

create table if not exists public.role_permission_log (
  id bigserial primary key, at timestamptz not null default now(), by_user uuid, role text not null, module text not null, old_level text, new_level text not null
);
alter table public.role_permission_log enable row level security;
drop policy if exists "admin reads log" on public.role_permission_log;
create policy "admin reads log" on public.role_permission_log for select to authenticated using (public.is_admin());
grant select on public.role_permission_log to authenticated;

-- ---------- helpers ----------
-- The signed-in person's level for a key. Admin: full. A tab with no row of its own takes its module's row. Anything not set: none. The old role name "attendance" is a Supervisor.
create or replace function public.perm_level(p_module text) returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then 'full'
    else coalesce(
      (select rp.level from public.role_permissions rp where rp.role = (case public.app_role() when 'attendance' then 'supervisor' else public.app_role() end) and rp.module = p_module),
      (select rp.level from public.role_permissions rp where rp.role = (case public.app_role() when 'attendance' then 'supervisor' else public.app_role() end) and rp.module = split_part(p_module, '.', 1)),
      'none') end $$;
create or replace function public.perm_rank(p_module text) returns int language sql stable security definer set search_path = public as $$
  select array_position(array['none', 'view', 'create', 'edit', 'full'], public.perm_level(p_module)) - 1 $$;
-- The most the person can do anywhere in a module (its own row or any tab's): used by tables that serve all the tabs of a module.
create or replace function public.perm_open_rank(p_module text) returns int language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then 4 else coalesce((
    select max(array_position(array['none', 'view', 'create', 'edit', 'full'], rp.level)) - 1 from public.role_permissions rp
    where rp.role = (case public.app_role() when 'attendance' then 'supervisor' else public.app_role() end) and (rp.module = p_module or rp.module like p_module || '.%')), 0) end $$;
revoke execute on function public.perm_level(text), public.perm_rank(text), public.perm_open_rank(text) from public, anon;
grant execute on function public.perm_level(text), public.perm_rank(text), public.perm_open_rank(text) to authenticated;

-- ---------- the Admin's save: one role at a time, all its changed rows together ----------
-- p_rows is [{"module": "meals.bills", "level": "view"}, ...]. A Viewer is held at none or view whatever is sent. Level "inherit" (tabs only) removes a tab's own row so it takes its module's level again.
create or replace function public.admin_set_role_permissions(p_role text, p_rows jsonb) returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; old text; lv text; me uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'Only an Admin can change permissions.'; end if;
  if p_role not in ('staff', 'site_engineer', 'supervisor', 'viewer') then raise exception 'Unknown role.'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    lv := r ->> 'level';
    if lv = 'inherit' and (r ->> 'module') like '%.%' then
      select level into old from public.role_permissions where role = p_role and module = r ->> 'module';
      if old is not null then
        delete from public.role_permissions where role = p_role and module = r ->> 'module';
        insert into public.role_permission_log (by_user, role, module, old_level, new_level) values (me, p_role, r ->> 'module', old, 'inherit'); n := n + 1;
      end if;
      continue;
    end if;
    if lv not in ('none', 'view', 'create', 'edit', 'full') then raise exception 'Unknown level: %', lv; end if;
    if p_role = 'viewer' and lv not in ('none', 'view') then lv := 'view'; end if;
    select level into old from public.role_permissions where role = p_role and module = r ->> 'module';
    if old is distinct from lv then
      insert into public.role_permissions (role, module, level, updated_by) values (p_role, r ->> 'module', lv, me)
        on conflict (role, module) do update set level = excluded.level, updated_at = now(), updated_by = me;
      insert into public.role_permission_log (by_user, role, module, old_level, new_level) values (me, p_role, r ->> 'module', old, lv);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.admin_set_role_permissions(text, jsonb) from public, anon;
grant execute on function public.admin_set_role_permissions(text, jsonb) to authenticated;

-- ---------- defaults (only where nothing is set yet) ----------
insert into public.role_permissions (role, module, level) values
    ('staff', 'attendance', 'full'),
    ('staff', 'clauses', 'full'),
    ('staff', 'clients', 'edit'),
    ('staff', 'employees', 'full'),
    ('staff', 'expenses', 'view'),
    ('staff', 'inventory', 'full'),
    ('staff', 'mail_templates', 'full'),
    ('staff', 'meals.bills', 'view'),
    ('staff', 'meals.daily', 'view'),
    ('staff', 'meals.overview', 'view'),
    ('staff', 'meals.people', 'view'),
    ('staff', 'payroll', 'edit'),
    ('staff', 'projects', 'view'),
    ('staff', 'quotations', 'edit'),
    ('staff', 'quote_library', 'full'),
    ('staff', 'settings', 'full'),
    ('staff', 'site_supplies', 'full'),
    ('site_engineer', 'attendance', 'edit'),
    ('site_engineer', 'inventory', 'edit'),
    ('supervisor', 'attendance', 'edit'),
    ('supervisor', 'inventory', 'edit'),
    ('viewer', 'accommodation', 'view'),
    ('viewer', 'attendance', 'view'),
    ('viewer', 'clauses', 'view'),
    ('viewer', 'clients', 'view'),
    ('viewer', 'employees', 'view'),
    ('viewer', 'expenses', 'view'),
    ('viewer', 'inventory', 'view'),
    ('viewer', 'invoices', 'view'),
    ('viewer', 'locations', 'view'),
    ('viewer', 'mail_templates', 'view'),
    ('viewer', 'meals', 'view'),
    ('viewer', 'payroll', 'view'),
    ('viewer', 'projects', 'view'),
    ('viewer', 'quotations', 'view'),
    ('viewer', 'quote_library', 'view'),
    ('viewer', 'settings', 'view'),
    ('viewer', 'site_supplies', 'view'),
    ('viewer', 'sites', 'view'),
    ('viewer', 'transport', 'view'),
    ('viewer', 'work_orders', 'view')

on conflict (role, module) do nothing;

-- ---------- payroll tables: by level instead of Admin only ----------
-- Read: View or more in any payroll tab. Add: Create. Change: Edit. Delete: Full. Admin is full everywhere. The run's approve and reopen functions check for an Admin themselves.
do $$ declare t text; begin
  foreach t in array array['payroll_runs', 'payroll_lines', 'payroll_adjustments', 'employee_advances', 'payroll_payments', 'statutory_payments', 'advance_recoveries'] loop
    execute format('drop policy if exists "admin all" on public.%I', t);
    execute format('drop policy if exists "perm read" on public.%I', t); execute format('drop policy if exists "perm insert" on public.%I', t);
    execute format('drop policy if exists "perm update" on public.%I', t); execute format('drop policy if exists "perm delete" on public.%I', t);
    execute format('create policy "perm read" on public.%I for select to authenticated using (public.perm_open_rank(%L) >= 1)', t, 'payroll');
    if t <> 'advance_recoveries' then   -- written only by the approve function
      execute format('create policy "perm insert" on public.%I for insert to authenticated with check (public.perm_open_rank(%L) >= 2)', t, 'payroll');
      execute format('create policy "perm update" on public.%I for update to authenticated using (public.perm_open_rank(%L) >= 3) with check (public.perm_open_rank(%L) >= 3)', t, 'payroll', 'payroll');
      execute format('create policy "perm delete" on public.%I for delete to authenticated using (public.perm_open_rank(%L) >= 4)', t, 'payroll');
    end if;
  end loop;
end $$;

-- Whoever may see Expenses → Due also sees where to pay (bank details). Changing them stays Admin-only.
drop policy if exists "perm read payee bank" on public.payee_bank;
create policy "perm read payee bank" on public.payee_bank for select to authenticated using (public.perm_rank('expenses.due') >= 1);
