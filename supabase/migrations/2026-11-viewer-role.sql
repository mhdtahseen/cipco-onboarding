-- A read-only "Viewer" role: sees everything in the app for overview and monitoring, can change nothing. Safe to run more than once.
-- NOT run by Claude: run it yourself in the Supabase SQL editor. Then give someone the role on the Users page.
--
-- How it is kept read-only: the Viewer gets a SELECT policy on every data table and no INSERT / UPDATE / DELETE policy anywhere, so the database itself refuses any change,
-- whatever the app shows. Row-level security combines policies with OR, so this adds read access and takes nothing away from anyone else.
-- Left out on purpose: push_subscriptions (phone notification keys), form_invites (candidate form tokens), user_roles / user_projects (who has which access: Admin's Users page),
-- and ref_counters. A Viewer is also kept out of the Users page in the app.
--
-- When you add a new table later, run this file again so the Viewer can read it too.

-- ---------- 1. the role ----------
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.user_roles'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%role%' loop
    execute format('alter table public.user_roles drop constraint %I', c);
  end loop;
  alter table public.user_roles add constraint user_roles_role_check check (role in ('admin', 'staff', 'site_engineer', 'supervisor', 'viewer'));
end $$;

create or replace function public.is_viewer() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'viewer', false) $$;
-- "may look at this project": the people who can work on it, and the Viewer. Used ONLY by read-only functions (never by a write policy).
create or replace function public.can_see(p_project uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.can_attend(p_project) or public.is_viewer() $$;
grant execute on function public.is_viewer(), public.can_see(uuid) to authenticated;

-- ---------- 2. read access to every data table ----------
do $$ declare t text; begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname not in ('push_subscriptions', 'form_invites', 'user_roles', 'user_projects', 'ref_counters')
  loop
    execute format('drop policy if exists "viewer read" on public.%I', t);
    execute format('create policy "viewer read" on public.%I for select to authenticated using (public.is_viewer())', t);
  end loop;
end $$;

-- ---------- 3. the read-only functions the screens call (they check "can attend", which a Viewer is not) ----------
do $$ declare f text; def text; begin
  foreach f in array array['attendance_roster', 'day_readiness'] loop
    select pg_get_functiondef(p.oid) into def from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f;
    if def is not null and def like '%public.can_attend(%' then execute replace(def, 'public.can_attend(', 'public.can_see('); end if;
  end loop;
end $$;
