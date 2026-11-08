-- A record of every salary-slip email the app sends (or fails to send), so the Run tab can show who has received theirs and re-send only the failures.
-- Admin only, like payroll. Not applied automatically.
create table if not exists public.payroll_slip_emails (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  line_id uuid not null references public.payroll_lines(id) on delete cascade,
  to_email text,
  status text not null check (status in ('sent','failed','no_email')),
  error text,
  sent_at timestamptz not null default now()
);
create index if not exists payroll_slip_emails_run_idx on public.payroll_slip_emails (run_id, sent_at desc);
alter table public.payroll_slip_emails enable row level security;
drop policy if exists payroll_slip_emails_admin on public.payroll_slip_emails;
create policy payroll_slip_emails_admin on public.payroll_slip_emails for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
