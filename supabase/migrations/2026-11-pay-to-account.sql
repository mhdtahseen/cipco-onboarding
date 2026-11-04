-- Pay one employee's salary into another employee's bank account (for example a brother's). Safe to run more than once.
-- NOT run by Claude: run it yourself in the Supabase SQL editor.
--
-- employees.pay_to_employee_id names the employee whose account receives this person's salary. It is read when the bank letter, the bank transfer CSV and
-- the Payments due report are made, so it works for payroll that is already approved. The person still has their own pay slip, attendance and payroll line.
alter table public.employees add column if not exists pay_to_employee_id uuid references public.employees(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_pay_to_not_self') then
    alter table public.employees add constraint employees_pay_to_not_self check (pay_to_employee_id is null or pay_to_employee_id <> id);
  end if;
end $$;
