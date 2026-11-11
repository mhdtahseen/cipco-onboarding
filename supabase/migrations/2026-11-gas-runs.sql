-- Gas, reworked around RUNS. Safe to run more than once. Run AFTER 2026-11-gas-stock.sql.
--
-- A run is one visit of a truck: one vendor, one delivery challan, the full cylinders it brought and the empties it took back. Each entry of a run already
-- carries the same trip_ref; this gives the older entries one too (grouped by project, vendor, date, challan number and photo, as before). Then:
--   gas_runs   what belongs to the run as a whole: the delivery challan (scan or photo, if it was not attached when the run was recorded) and the vendor's
--              tax invoice for the run (number, date, amount, file). Anyone who works on the site can attach the challan; only Admin / Operations the invoice.
--   gas_terms.transport_gst_pct   GST on the vendor's freight per run (the vendor's invoices charge 18%; set per vendor in Vendors & rates).
-- Orders are no longer used by the app; the order tables and the one order already entered are left as they are.

-- every run's entries share one reference (one new reference per group of older entries)
do $$ declare g record; r uuid; begin
  perform set_config('app.gas_edit', '1', true);   -- the entry guard lets this through, as it does the Admin's corrections (only trip_ref changes)
  for g in select project_id, vendor_id, moved_on, lower(btrim(challan_no)) as ch, photo_path from public.gas_movements
           where trip_ref is null and kind in ('delivery', 'return') group by project_id, vendor_id, moved_on, lower(btrim(challan_no)), photo_path loop
    r := gen_random_uuid();
    update public.gas_movements set trip_ref = r
      where trip_ref is null and kind in ('delivery', 'return') and project_id = g.project_id and vendor_id = g.vendor_id and moved_on = g.moved_on
        and lower(btrim(challan_no)) = g.ch and photo_path is not distinct from g.photo_path;
  end loop;
end $$;

alter table public.gas_terms add column if not exists transport_gst_pct numeric(5,2) not null default 0;

create table if not exists public.gas_runs (
  run_ref uuid primary key,                               -- the trip_ref its entries share
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor_id uuid not null references public.gas_vendors(id),
  challan_path text,                                      -- the delivery challan, attached after the run was recorded
  invoice_no text not null default '',
  invoice_date date,
  invoice_amount numeric(12,2) check (invoice_amount >= 0),
  invoice_path text,
  note text not null default '',
  updated_by uuid default auth.uid(), updated_at timestamptz not null default now()
);
create index if not exists gas_runs_project on public.gas_runs (project_id);
alter table public.gas_runs enable row level security;
drop policy if exists "gas runs read" on public.gas_runs; create policy "gas runs read" on public.gas_runs for select to authenticated using (public.can_see(project_id));
drop policy if exists "gas runs add" on public.gas_runs; create policy "gas runs add" on public.gas_runs for insert to authenticated with check (public.can_attend(project_id));
drop policy if exists "gas runs change" on public.gas_runs; create policy "gas runs change" on public.gas_runs for update to authenticated using (public.can_attend(project_id)) with check (public.can_attend(project_id));

-- the site may attach the challan; the invoice (money) is Admin / Operations only
create or replace function public.gas_run_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid(); new.updated_at := now();
  if not public.is_staff() then
    if tg_op = 'INSERT' and (new.invoice_no <> '' or new.invoice_date is not null or new.invoice_amount is not null or new.invoice_path is not null) then raise exception 'Only Operations or an Admin can attach the invoice.'; end if;
    if tg_op = 'UPDATE' and (new.invoice_no is distinct from old.invoice_no or new.invoice_date is distinct from old.invoice_date or new.invoice_amount is distinct from old.invoice_amount or new.invoice_path is distinct from old.invoice_path) then
      raise exception 'Only Operations or an Admin can change the invoice.'; end if;
  end if;
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.vendor_id <> old.vendor_id) then raise exception 'A run cannot move to another project or vendor.'; end if;
  return new;
end $$;
drop trigger if exists gas_run_guard_trg on public.gas_runs;
create trigger gas_run_guard_trg before insert or update on public.gas_runs for each row execute function public.gas_run_guard();
revoke all on function public.gas_run_guard() from public, anon, authenticated;
