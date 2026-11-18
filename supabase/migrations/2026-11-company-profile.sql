-- Company page (profile menu → Company, Admin only): the company's details, its documents (GST, Udyam, PTRC, EPFO, ESIC, PAN, Aadhaar, cancelled cheque,
-- WC policy...) and the seal and signature printed on the PDFs.
--  - company_profile: one row. data holds only the details an Admin has changed; anything not there keeps the value written in src/lib/company.ts.
--    seal_path / signature_path: an uploaded seal or signature (empty = the built-in images).
--  - company_documents: one card per document, with its current file; company_document_files keeps every file ever uploaded for it (older copies).
--  - company_doc_reminders: which expiry reminders have been sent (30 days, 7 days, on the day), so each goes once. Written by the 5-minute job only.
-- Only Admins can read or change any of it. The PDFs read the details with the server's own key (src/lib/companyServer.ts), so letters and invoices made by
-- other roles still carry them; the letterhead details (not the documents, not the Aadhaar) are also given to signed-in staff by /api/company/info.

create table if not exists public.company_profile (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  seal_path text,
  signature_path text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
insert into public.company_profile (id) values (1) on conflict (id) do nothing;

create table if not exists public.company_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'other',
  title text not null,
  doc_no text not null default '',
  issued_on date,
  valid_until date,
  notes text not null default '',
  file_path text,
  file_name text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists company_documents_valid_until on public.company_documents (valid_until) where archived_at is null;

create table if not exists public.company_document_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.company_documents(id) on delete cascade,
  file_path text not null,
  file_name text,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid default auth.uid()
);
create index if not exists company_document_files_doc on public.company_document_files (document_id, uploaded_at desc);

create table if not exists public.company_doc_reminders (
  document_id uuid not null references public.company_documents(id) on delete cascade,
  valid_until date not null,
  stage text not null check (stage in ('30', '7', '0')),
  sent_at timestamptz not null default now(),
  primary key (document_id, valid_until, stage)
);

alter table public.company_profile enable row level security;
alter table public.company_documents enable row level security;
alter table public.company_document_files enable row level security;
alter table public.company_doc_reminders enable row level security;   -- no policies: only the server's own key (the 5-minute job) reads and writes it

drop policy if exists "admin company profile" on public.company_profile;
create policy "admin company profile" on public.company_profile for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin company documents" on public.company_documents;
create policy "admin company documents" on public.company_documents for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin company document files" on public.company_document_files;
create policy "admin company document files" on public.company_document_files for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.company_profile, public.company_documents, public.company_document_files, public.company_doc_reminders from anon;
grant select, insert, update, delete on public.company_profile, public.company_documents, public.company_document_files to authenticated;
revoke all on public.company_doc_reminders from authenticated;
