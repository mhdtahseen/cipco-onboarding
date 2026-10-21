-- Hiring pipeline: stage tracking + a "closed" pile for candidates who are rejected or decline.
-- Safe to run more than once. Paste into Supabase → SQL Editor → Run.
alter table public.employees
  add column if not exists stage text not null default 'resume',
  add column if not exists outcome text not null default 'active',
  add column if not exists closed_reason text,
  add column if not exists closed_note text,
  add column if not exists closed_stage text,
  add column if not exists closed_at timestamptz;

alter table public.employees drop constraint if exists employees_stage_check;
alter table public.employees add constraint employees_stage_check check (stage in ('resume','call','interview','offer','appointment','forms'));
alter table public.employees drop constraint if exists employees_outcome_check;
alter table public.employees add constraint employees_outcome_check check (outcome in ('active','rejected'));

-- Put people already in the system at the right stage, based on the letters issued so far.
update public.employees e set stage = case
  when exists (select 1 from public.letters l where l.employee_id = e.id and l.kind = 'appointment') then 'appointment'
  when exists (select 1 from public.letters l where l.employee_id = e.id and l.kind = 'offer') then 'offer'
  else 'resume' end
where e.stage = 'resume';

create index if not exists employees_outcome_stage_idx on public.employees (outcome, stage);
