-- Project documents: letters, JSAs, POs, emails etc. kept against a project for later reference.
-- Run AFTER 2026-10-projects-departments.sql. Safe to run more than once; types are seeded only while the list is empty.
create table if not exists public.document_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create unique index if not exists document_types_name_uq on public.document_types (lower(btrim(name)));

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type_id uuid references public.document_types(id),
  title text not null,
  doc_date date not null default current_date,        -- the date on the document, not the upload date
  recipient text not null default '',                 -- who it was sent to / who issued it
  ref_no text not null default '',                    -- your own or the other party's reference / PO number
  notes text not null default '',
  file_path text not null,                            -- file in R2
  file_name text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_documents_project_idx on public.project_documents (project_id, doc_date desc);

alter table public.document_types enable row level security;
alter table public.project_documents enable row level security;
do $$ declare t text; begin
  foreach t in array array['document_types','project_documents'] loop
    execute format('drop policy if exists "auth all" on public.%I', t);
    if to_regproc('public.is_staff') is not null then   -- the roles migration has run: staff only. Re-running this file must NOT reopen the table to everyone.
      execute format('drop policy if exists "staff all" on public.%I', t);
      execute format('create policy "staff all" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
    else   -- before the roles migration everyone signed in has access
      execute format('create policy "auth all" on public.%I for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

insert into public.document_types (name, sort_order)
select * from (values
  ('Letter', 10), ('Permission / authorisation letter', 20), ('Job Safety Analysis (JSA)', 30), ('Purchase Order (PO)', 40),
  ('Email / correspondence', 50), ('Report', 60), ('Drawing', 70), ('Certificate', 80), ('Contract / agreement', 90), ('Other', 100)
) as v(name, sort_order)
where not exists (select 1 from public.document_types);
