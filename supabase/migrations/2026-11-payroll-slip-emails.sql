-- A shared record of every salary slip sent to a person, by email or WhatsApp, so the Salary slips tab shows the same status to every admin on every device,
-- and can re-send only the failures. Email sends are logged by the app; a WhatsApp send is logged when an admin presses Send (or Mark sent), and 'cleared' undoes a mark.
-- Admin only, like payroll. Not applied automatically.
create table if not exists public.payroll_slip_emails (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  line_id uuid not null references public.payroll_lines(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email','whatsapp')),
  to_email text,
  status text not null check (status in ('sent','failed','no_email','cleared')),
  error text,
  sent_at timestamptz not null default now()
);
create index if not exists payroll_slip_emails_run_idx on public.payroll_slip_emails (run_id, sent_at desc);
alter table public.payroll_slip_emails enable row level security;
drop policy if exists payroll_slip_emails_admin on public.payroll_slip_emails;
create policy payroll_slip_emails_admin on public.payroll_slip_emails for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
