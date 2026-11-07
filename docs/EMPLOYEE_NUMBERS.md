# Employee numbers

Every onboarded employee gets a number in the form **CIP-EMP-051**, **CIP-EMP-052**, and so on. It is filled in by the database, so nobody types it.

## The rules

- **When:** the moment a person is moved to **Onboarded** (one at a time or in bulk) and is not rejected, if they have no number yet.
- **Which number:** one more than the highest CIP-EMP number in use, and never below 051. A number set by hand in the database is respected: if someone has CIP-EMP-120, the next person gets CIP-EMP-121.
- **Order:** people already onboarded are numbered once, earliest date of joining first. After that, numbers follow the order people are onboarded.
- **Locked:** once a person has a number, nobody can change it or clear it, and nobody can type one in for someone who has none. This is enforced by the database, so it holds for every screen, import and API call, Admin included. Saving the employee form with the number unchanged works as normal.
- **Permanent:** a number is never changed or reused. Rejecting someone, moving them back a stage, or changing their joining date does not touch it, because it is printed on letters and pay slips.
- **Never overwritten:** anyone who already has a number keeps it, whatever it looks like.
- **No two the same:** the database refuses a number that is already used (capitals and spaces ignored).
- **Not onboarded yet:** no number. The field shows a note, and stays empty until then.

## Numbering the people who are already onboarded

Running `supabase/migrations/2026-11-employee-numbers.sql` once does this. Who is numbered: onboarded, not rejected, no number yet. In this order: date of joining, earliest first; no joining date last; a tie goes to whoever was added first. It then switches the automatic numbering on. Running it twice changes nothing the second time.

**Look before you run it.** These two queries only read data. Run them in Supabase's SQL editor.

1. What numbers exist today, and in what state are people:

```sql
select stage, outcome, count(*) as people, count(*) filter (where btrim(coalesce(emp_no,'')) <> '') as have_a_number,
       count(*) filter (where join_date is null) as no_joining_date
from public.employees group by stage, outcome order by 1, 2;
```

2. Exactly who would get which number (assuming nobody has a CIP-EMP number yet; if some do, the numbers shift after the highest one):

```sql
select 50 + row_number() over (order by join_date asc nulls last, created_at asc, id) as would_be_number,
       'CIP-EMP-' || lpad((50 + row_number() over (order by join_date asc nulls last, created_at asc, id))::text, 3, '0') as employee_no,
       full_name, join_date
from public.employees
where stage = 'onboarded' and outcome = 'active' and btrim(coalesce(emp_no,'')) = ''
order by join_date asc nulls last, created_at asc, id;
```

## Good to know

- Pay slips and payroll runs copy the number when a run is calculated. Runs that are already approved keep what they had; a run not yet approved picks up the new number the next time it is calculated.
- The **Employee no.** box in the employee form is greyed out with the note "Assigned automatically after onboarding".
- **Numbers that exist before this is switched on are locked too.** If any current number has a typing mistake, correct it before running the migration.
- **Correcting a number on purpose** (a rare case) is done by an administrator in Supabase's SQL editor, with the lock switched off for those few lines, then back on:

```sql
alter table public.employees disable trigger employees_lock_no_trg;
update public.employees set emp_no = 'CIP-EMP-0xx' where id = '<the employee id>';
alter table public.employees enable trigger employees_lock_no_trg;
```

