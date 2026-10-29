-- Links the commercial chain: Client → Projects → Quotations → Work order (PO / WO) → Invoices. Safe to run again.
-- Run it AFTER 2026-10-invoicing.sql (needs clients and work_orders).
--
--   projects.client_id       the client a project is for (a client has many projects)
--   projects.state_code      GST state code of the SITE. For work on a site the place of supply is the site's state, not ours or the client's:
--                            27 = Maharashtra (our registration) → CGST + SGST; any other state → IGST
--   quotations.client_id     which client the quotation is for (the printed name and address stay as typed)
--   quotations.project_id    which project it is for
--   work_orders.quotation_id the quotation a work order came from ("won")
-- Everything is optional (nullable), so existing projects and quotations keep working until they are linked.

alter table public.projects add column if not exists client_id uuid references public.clients(id);
alter table public.projects add column if not exists state_code text;
alter table public.quotations add column if not exists client_id uuid references public.clients(id);
alter table public.quotations add column if not exists project_id uuid references public.projects(id);
alter table public.work_orders add column if not exists quotation_id uuid references public.quotations(id);
create index if not exists projects_client on public.projects (client_id);
create index if not exists quotations_client on public.quotations (client_id);
create index if not exists quotations_project on public.quotations (project_id);
create index if not exists work_orders_quotation on public.work_orders (quotation_id);

-- A best guess for the sites you already have, from their location text. Anything not recognised stays empty: the screens ask for it.
update public.projects set state_code = '24' where state_code is null and location ilike '%gujarat%';
update public.projects set state_code = '27' where state_code is null and location ilike '%maharashtra%';

-- Quotations are written by staff, so staff pick the client from this list. A name and a GSTIN are not secret; the money tables stay Admin only.
drop policy if exists "admin clients" on public.clients;
drop policy if exists "staff clients" on public.clients;
create policy "staff clients" on public.clients for all using (public.is_staff()) with check (public.is_staff());
