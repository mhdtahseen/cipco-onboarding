-- Who may call each database function. Safe to run again. Run it in the SQL editor.
--
-- Why: Postgres lets everyone run a new function by default, and Supabase publishes every function in the public schema as an API call
-- (/rest/v1/rpc/<name>). So 36 functions could be run by someone who is not even signed in, and the advisors flagged it. Two did real work with no
-- check at all: next_ref (anyone could use up quotation and letter reference numbers) and sync_payroll_expense (anyone could re-post a payroll run).
--
-- After this:
--   • signed out (anon): only the three candidate self-fill functions, which have to work from the link you send people (invite_get / invite_submit / invite_file)
--   • signed in: what the app calls, and the small helpers the row-level-security rules use (is_admin, is_staff, app_role, can_attend…).
--     Money and payroll functions still check the caller's role inside, as before.
--   • nobody: the trigger functions (guards, audit, expense posting) and sync_payroll_expense. Triggers keep firing: Postgres only checks the right to run a
--     trigger function when the trigger is created, not each time it fires, and sync_payroll_expense is only called from a trigger that runs as the owner.
--   • next_ref now also refuses people who are not staff, and (with rank_name, role_rank, write_window_end) has a fixed search_path, which the advisor asked for.
--   • functions you add later no longer give signed-out users access by default. If a future function must be public, grant it on purpose:
--         grant execute on function public.<name>(<args>) to anon;
-- It does not touch the role-in-login-token function; that one is already restricted to Supabase's auth service.
--
-- To check afterwards:  select proname, has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as signed_in
--                       from pg_proc where pronamespace = 'public'::regnamespace order by 2 desc, 3 desc, 1;

begin;

-- next_ref: same numbers as before, but only staff may take one, and the search path is fixed
create or replace function public.next_ref(p_kind text) returns text language plpgsql security definer set search_path = public as $$
declare y int := extract(year from now())::int; n int; code text;
begin
  if not public.is_staff() then raise exception 'Only staff can issue reference numbers.'; end if;
  insert into public.ref_counters(kind, year, last) values (p_kind, y, 1)
  on conflict (kind, year) do update set last = public.ref_counters.last + 1
  returning last into n;
  if p_kind = 'quotation' then return 'CIPCO/OPS/QTN/' || y || '/' || lpad(n::text, 4, '0'); end if;
  code := case p_kind when 'offer' then 'OL' when 'appointment' then 'APPT' else upper(p_kind) end;
  return 'CIPCO/HR/' || code || '/' || y || '/' || lpad(n::text, 4, '0');
end $$;

alter function public.rank_name(integer) set search_path = public;
alter function public.role_rank(text) set search_path = public;
alter function public.write_window_end(text, date) set search_path = public;

-- Reset who can run every function in this schema, then grant back exactly what is needed.
-- "Signed in" keeps whatever it can run today, except trigger functions and sync_payroll_expense.
do $$ declare r record; had_auth boolean; begin
  for r in
    select p.oid, p.oid::regprocedure as fn, p.proname, pg_get_function_result(p.oid) as ret
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')   -- never touch an extension's own functions
  loop
    had_auth := has_function_privilege('authenticated', r.oid, 'execute');
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
    if r.proname in ('invite_get', 'invite_submit', 'invite_file') then
      execute format('grant execute on function %s to anon, authenticated', r.fn);
    elsif had_auth and r.ret <> 'trigger' and r.proname not in ('sync_payroll_expense', 'custom_access_token_hook') then
      execute format('grant execute on function %s to authenticated', r.fn);
    end if;
  end loop;
end $$;

-- functions created from now on: not callable by signed-out users unless you grant that on purpose
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

commit;
