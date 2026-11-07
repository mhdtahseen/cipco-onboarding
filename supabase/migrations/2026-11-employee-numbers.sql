-- Employee numbers, given automatically: CIP-EMP-051, CIP-EMP-052, ... in the order people joined.
--
--   * When a person becomes ONBOARDED (and is not rejected) and has no employee number, they get the next one. A number already typed in is never changed.
--   * Today's onboarded employees who have no number are numbered once, below, in date-of-joining order (earliest first; no joining date goes last; a tie goes to whoever was added first).
--   * "Next" is one more than the highest CIP-EMP number in use (never below 050), so a number someone typed by hand is respected and nothing is ever handed out twice.
--   * A number is permanent: it is not re-worked when joining dates change, because it is printed on letters and pay slips.
--   * LOCKED: once a person has a number, nobody can change or clear it (from any screen, import or API call), and nobody can type one in either: only the automatic numbering below can give one.
--     To correct a number on purpose, an administrator does it in the SQL editor with the lock switched off (see docs/EMPLOYEE_NUMBERS.md).
-- Safe to run more than once. Nothing is removed or renumbered: only empty numbers are filled.

-- ---------- the next number ----------
create or replace function public.next_employee_no() returns text language plpgsql security definer set search_path = public as $$
declare hi int; n int;
begin
  perform pg_advisory_xact_lock(hashtext('employee_no'));   -- one at a time, even from two screens at once
  select coalesce(max(substring(emp_no from '^CIP-EMP-(\d{1,6})$')::int), 0) into hi from public.employees where emp_no ~ '^CIP-EMP-\d{1,6}$';
  -- the counter row makes several people numbered by ONE statement (a bulk "move to Onboarded") get different numbers
  insert into public.ref_counters (kind, year, last) values ('employee_no', 0, greatest(50, hi) + 1)
    on conflict (kind, year) do update set last = greatest(public.ref_counters.last, hi, 50) + 1
    returning last into n;
  perform set_config('app.empno_given', 'CIP-EMP-' || lpad(n::text, 3, '0'), true);   -- the lock below lets exactly this number through, once
  return 'CIP-EMP-' || lpad(n::text, 3, '0');
end $$;
revoke execute on function public.next_employee_no() from public, anon, authenticated;   -- only the trigger and this migration call it

-- ---------- number people as they are onboarded ----------
create or replace function public.employees_assign_no() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'onboarded' and new.outcome = 'active' and btrim(coalesce(new.emp_no, '')) = '' then new.emp_no := public.next_employee_no(); end if;
  return new;
end $$;
drop trigger if exists employees_assign_no_trg on public.employees;
create trigger employees_assign_no_trg before insert or update of stage, outcome on public.employees for each row execute function public.employees_assign_no();

-- ---------- the lock ----------
-- A number may go from empty to the number the automatic numbering just gave, and from then on it can never change or be cleared.
-- Saving a form with the number unchanged is fine. (The trigger name sorts after the numbering one, so on an onboarding the two run in the right order.)
create or replace function public.employees_lock_no() returns trigger language plpgsql set search_path = public as $$
declare o text := case when tg_op = 'UPDATE' then coalesce(nullif(btrim(old.emp_no), ''), '') else '' end; n text := coalesce(nullif(btrim(new.emp_no), ''), '');
begin
  if o = n then new.emp_no := case when o = '' then null else old.emp_no end; return new; end if;   -- unchanged (blank stays blank; a stray space or empty text is tidied away)
  if o = '' and n = coalesce(current_setting('app.empno_given', true), '') then perform set_config('app.empno_given', '', true); return new; end if;
  raise exception 'Employee numbers are given automatically when a person is onboarded, and cannot be typed in, changed or removed.' using errcode = 'check_violation';
end $$;
drop trigger if exists employees_lock_no_trg on public.employees;
create trigger employees_lock_no_trg before insert or update of emp_no on public.employees for each row execute function public.employees_lock_no();

-- ---------- number the people already onboarded, earliest joiner first ----------
do $$ declare r record; n int := 0;
begin
  for r in select id from public.employees where stage = 'onboarded' and outcome = 'active' and btrim(coalesce(emp_no, '')) = ''
           order by join_date asc nulls last, created_at asc, id loop
    update public.employees set emp_no = public.next_employee_no() where id = r.id; n := n + 1;
  end loop;
  raise notice 'Employee numbers given to % people.', n;
end $$;

-- ---------- two people can never share a number ----------
do $$ begin
  if exists (select 1 from public.employees where btrim(coalesce(emp_no, '')) <> '' group by upper(btrim(emp_no)) having count(*) > 1) then
    raise notice 'Some employee numbers are used twice, so the "no two the same" rule was NOT added. Fix the duplicates, then run this file again.';
  else
    create unique index if not exists employees_emp_no_unique on public.employees (upper(btrim(emp_no))) where btrim(coalesce(emp_no, '')) <> '';
  end if;
end $$;
