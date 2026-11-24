-- Payroll → Advances: proof that the advance was paid out (a file in storage under advances/<project>/…). Optional; can be attached later.
alter table public.employee_advances add column if not exists proof_path text;
