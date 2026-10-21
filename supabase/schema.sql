-- =====================================================================
-- CIPCO Onboarding — Supabase schema. Paste into SQL Editor and Run once.
-- =====================================================================
create extension if not exists "pgcrypto";

-- ---------- Employees ----------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  emp_no text,
  full_name text not null,
  father_spouse_name text,
  father_spouse_type text default 'Father',        -- Father | Spouse
  dob date,
  gender text,                                      -- Male | Female | Other
  marital_status text,                              -- Single | Married | Widow | Widower | Divorced
  religion text,
  blood_group text,
  email text,
  phone text,
  alt_phone text,
  permanent_address text,
  current_address text,
  city text,
  district text,
  state text,
  pin text,
  aadhaar text,
  pan text,
  bank_name text,
  bank_branch text,
  account_no text,
  ifsc text,
  uan text,
  prev_pf_no text,
  nominee_name text,
  nominee_relation text,
  nominee_age_dob text,
  nominee_address text,
  nominee_phone text,
  emergency_name text,
  emergency_phone text,
  designation text,
  department text,
  project text,
  site_location text,
  base_location text default 'Pune, Maharashtra',
  employment_type text default 'Employee',          -- Trainee | Employee | Contract ...
  join_date date,
  probation_months int default 6,
  monthly_ctc numeric,                              -- kept in sync with the calculated monthly CTC
  salary jsonb default '{}'::jsonb,                 -- salary basis + structure (see src/lib/salary.ts)
  week_off text default 'Sunday',
  status text default 'onboarding',                 -- onboarding | active | exited
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- Clause library (offer + appointment letters) ----------
create table if not exists public.clauses (
  id uuid primary key default gen_random_uuid(),
  letter_type text not null check (letter_type in ('offer','appointment')),
  key text not null,
  title text not null,
  body text not null,                 -- lines starting "- " become bullets, **bold** supported, {{placeholders}} supported
  is_core boolean default false,      -- always included, cannot be unticked
  default_on boolean default false,   -- pre-ticked in the picker
  rules jsonb default '{}'::jsonb,    -- e.g. {"designations":["engineer"],"departments":["erection"],"projects":[],"employment_types":[]}
  sort_order int default 100,
  active boolean default true,
  unique (letter_type, key)
);

-- ---------- Issued letters (immutable snapshot of what was sent) ----------
create table if not exists public.letters (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('offer','appointment')),
  ref_no text not null,
  issued_on date not null default current_date,
  sections jsonb not null,            -- rendered sections [{title, body}]
  vars jsonb not null,                -- variable snapshot used to render
  with_seal boolean default true,
  annexure jsonb,                     -- Annexure A snapshot (salary break-up table + notes)
  created_at timestamptz default now()
);

-- ---------- Reference number counters ----------
create table if not exists public.ref_counters (
  kind text not null, year int not null, last int not null default 0,
  primary key (kind, year)
);
create or replace function public.next_ref(p_kind text) returns text
language plpgsql security definer as $$
declare y int := extract(year from now())::int; n int; code text;
begin
  insert into public.ref_counters(kind, year, last) values (p_kind, y, 1)
  on conflict (kind, year) do update set last = public.ref_counters.last + 1
  returning last into n;
  code := case p_kind when 'offer' then 'OL' when 'appointment' then 'APPT' else upper(p_kind) end;
  return 'CIPCO/HR/' || code || '/' || y || '/' || lpad(n::text, 4, '0');
end $$;

-- ---------- Mail templates ----------
create table if not exists public.mail_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  subject text not null,
  body text not null,
  sort_order int default 100
);

-- ---------- Per-employee document checklist ----------
create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  doc_type text not null,
  status text not null default 'pending',           -- pending | received | verified | not_required
  file_path text,
  notes text,
  updated_at timestamptz default now(),
  unique (employee_id, doc_type)
);

-- ---------- Row Level Security: only logged-in users ----------
alter table public.employees          enable row level security;
alter table public.clauses            enable row level security;
alter table public.letters            enable row level security;
alter table public.mail_templates     enable row level security;
alter table public.employee_documents enable row level security;
alter table public.ref_counters       enable row level security;

do $$ declare t text; begin
  foreach t in array array['employees','clauses','letters','mail_templates','employee_documents'] loop
    execute format('drop policy if exists "auth all" on public.%I', t);
    execute format('create policy "auth all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- Private storage bucket for uploaded KYC / medical files ----------
insert into storage.buckets (id, name, public) values ('employee-docs', 'employee-docs', false)
on conflict (id) do nothing;
drop policy if exists "auth docs all" on storage.objects;
create policy "auth docs all" on storage.objects for all to authenticated
  using (bucket_id = 'employee-docs') with check (bucket_id = 'employee-docs');
