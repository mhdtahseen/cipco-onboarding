-- Project expenses: a category list (add / hide as needed) and one table of expense entries per project.
-- Run AFTER 2026-10-projects-departments.sql. Safe to run more than once; categories are seeded only while the list is empty.
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create unique index if not exists expense_categories_name_uq on public.expense_categories (lower(btrim(name)));

create table if not exists public.project_expenses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category_id uuid not null references public.expense_categories(id),
  expense_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  description text not null default '',
  employee_id uuid references public.employees(id) on delete set null,   -- optional: the cost was for one person
  bill_path text,                                                          -- optional bill / receipt in R2
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_expenses_project_idx on public.project_expenses (project_id, expense_date);
create index if not exists project_expenses_category_idx on public.project_expenses (category_id);

alter table public.expense_categories enable row level security;
alter table public.project_expenses enable row level security;
do $$ declare t text; begin
  foreach t in array array['expense_categories','project_expenses'] loop
    execute format('drop policy if exists "auth all" on public.%I', t);
    execute format('create policy "auth all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

insert into public.expense_categories (name, sort_order)
select * from (values
  ('Accommodation', 10), ('Travel', 20), ('Food', 30), ('Site consumables', 40), ('Tools & tackles', 50),
  ('Transport / freight', 60), ('Medical & safety', 70), ('Statutory / compliance', 80), ('Miscellaneous', 90)
) as v(name, sort_order)
where not exists (select 1 from public.expense_categories);
