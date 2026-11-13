-- Stationed at: Site or Head office. Run AFTER 2026-11-invite-police-station.sql. Safe to run more than once.
--
-- A Site person is posted to one project (employees.project_id), as today: they are on its attendance sheet, onsite team, meals, transport and payroll.
-- A Head office person (Operations / Ops, C-Suite for now) has NO site posting. They are linked instead to any number of projects (employee_projects),
-- with a role, dates and whether they need a gate pass there. Everything that goes by the posting (attendance roster, day checks, Sites today, meals,
-- transport, accommodation, the project's People list, payroll, forecast) therefore leaves them out by itself.
-- Payroll for head-office people is not built yet (the Head Office module, later): until then they are in no payroll run and are paid outside the app.
--
-- What this changes in the data: people in the Operations / Ops / C-Suite departments become Head office; any site posting they have is kept as a
-- project link (gate pass on) and the posting itself is cleared. Their past attendance and approved payroll are untouched.

alter table public.employees add column if not exists stationed_at text not null default 'site';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_stationed_at_check') then
    alter table public.employees add constraint employees_stationed_at_check check (stationed_at in ('site', 'head_office'));
  end if;
end $$;

-- the departments that are head office by default (more can be added here later)
create or replace function public.is_head_office_dept(p text) returns boolean language sql immutable set search_path = public as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '[\s_-]+', '', 'g')) in ('ops', 'operations', 'csuite') $$;

create table if not exists public.employee_projects (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null default '',            -- e.g. Project manager, Commercial
  from_date date,
  to_date date,
  gate_pass boolean not null default true,  -- needs the site's gate-pass documents (joining kit, PCC form when the site asks for it)
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  unique (employee_id, project_id),
  check (to_date is null or from_date is null or to_date >= from_date)
);
create index if not exists employee_projects_project on public.employee_projects (project_id);
alter table public.employee_projects enable row level security;
drop policy if exists "staff all employee projects" on public.employee_projects;
create policy "staff all employee projects" on public.employee_projects for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "read employee projects" on public.employee_projects;
create policy "read employee projects" on public.employee_projects for select to authenticated using (public.can_see(project_id));

-- a head-office person never has a site posting; a new person in a head-office department starts as head office
create or replace function public.employees_station_trg() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.stationed_at = 'site' and public.is_head_office_dept(new.department) then new.stationed_at := 'head_office'; end if;
  if new.stationed_at = 'head_office' then new.project_id := null; end if;
  return new;
end $$;
drop trigger if exists employees_station on public.employees;
create trigger employees_station before insert or update on public.employees for each row execute function public.employees_station_trg();
revoke all on function public.employees_station_trg() from public, anon, authenticated;

-- the people already in those departments: keep their posting as a project link, then make them head office (the trigger clears the posting)
insert into public.employee_projects (employee_id, project_id, gate_pass)
  select id, project_id, true from public.employees where stationed_at = 'site' and public.is_head_office_dept(department) and project_id is not null
  on conflict (employee_id, project_id) do nothing;
update public.employees set stationed_at = 'head_office' where stationed_at = 'site' and public.is_head_office_dept(department);

-- the self-fill link asks for the police station when the person's site, or any project they need a gate pass for, wants police verification
create or replace function public.invite_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.form_invites; e public.employees; pre jsonb; onfile jsonb; masked jsonb; pcc boolean;
  sensitive text[] := array['aadhaar','pan','account_no','ifsc','uan','prev_pf_no'];
  shown text[] := array['father_spouse_name','father_spouse_type','dob','gender','marital_status','religion','blood_group','alt_phone',
    'permanent_address','native_police_station','current_address','city','district','state','pin','bank_name','bank_branch',
    'nominee_name','nominee_relation','nominee_age_dob','nominee_address','nominee_phone','emergency_name','emergency_phone'];
begin
  select * into i from public.form_invites where token = p_token;
  if not found or i.status = 'revoked' or i.expires_at < now() then return null; end if;
  select * into e from public.employees where id = i.employee_id;
  pcc := exists (select 1 from public.projects p where p.id = e.project_id and p.police_verification)
      or exists (select 1 from public.employee_projects ep join public.projects p on p.id = ep.project_id
                 where ep.employee_id = e.id and ep.gate_pass and p.police_verification and (ep.to_date is null or ep.to_date >= current_date));
  select coalesce(jsonb_object_agg(key, value), '{}') into pre from jsonb_each(to_jsonb(e))
    where key = any(shown) and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
  select coalesce(jsonb_agg(key), '[]') into onfile from jsonb_each(to_jsonb(e))
    where key = any(sensitive) and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
  select coalesce(jsonb_object_agg(key, case when length(regexp_replace(value #>> '{}', '\s', '', 'g')) >= 8 then right(regexp_replace(value #>> '{}', '\s', '', 'g'), 4) else '' end), '{}') into masked
    from jsonb_each(to_jsonb(e))
    where key = any(sensitive) and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
  return jsonb_build_object('employee_id', e.id, 'status', i.status, 'name', e.full_name, 'phone', e.phone, 'email', e.email,
                            'prefill', pre, 'on_file', onfile, 'on_file_masked', masked, 'submission', i.submission, 'files', i.files,
                            'needs_pcc', coalesce(pcc, false));
end $$;
revoke all on function public.invite_get(text) from public;
grant execute on function public.invite_get(text) to anon, authenticated;
