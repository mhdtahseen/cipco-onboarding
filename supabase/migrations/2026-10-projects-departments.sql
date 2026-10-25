-- Projects (name + location + description + active/closed) and a department list for dropdowns.
-- Employees keep their text `project` / `site_location` / `department` (letters and forms read those), and gain project_id
-- so closed projects can still be tracked later. Safe to run more than once.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text not null default '',
  description text not null default '',
  status text not null default 'active' check (status in ('active','closed')),
  closed_on date,
  created_at timestamptz not null default now()
);
create unique index if not exists projects_name_uq on public.projects (lower(btrim(name)));

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists departments_name_uq on public.departments (lower(btrim(name)));

alter table public.employees add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists employees_project_idx on public.employees (project_id);

alter table public.projects enable row level security;
alter table public.departments enable row level security;
do $$ declare t text; begin
  foreach t in array array['projects','departments'] loop
    execute format('drop policy if exists "auth all" on public.%I', t);
    execute format('create policy "auth all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Start the lists from what employees already have, so nothing looks unknown in the new dropdowns.
insert into public.projects (name, location)
select distinct on (lower(btrim(project))) btrim(project), coalesce(btrim(site_location), '')
from (select project, site_location, count(*) c from public.employees where project is not null and btrim(project) <> '' group by 1, 2) t
order by lower(btrim(project)), c desc
on conflict do nothing;
update public.employees e set project_id = p.id from public.projects p where e.project_id is null and e.project is not null and lower(btrim(e.project)) = lower(btrim(p.name));

insert into public.departments (name)
select distinct on (lower(btrim(department))) btrim(department) from public.employees where department is not null and btrim(department) <> ''
order by lower(btrim(department)), btrim(department)
on conflict do nothing;
