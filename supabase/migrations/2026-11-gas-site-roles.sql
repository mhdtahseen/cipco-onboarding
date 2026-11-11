-- Site supplies for Supervisors and Site Engineers, and a low-stock warning. Safe to run more than once. Run AFTER 2026-11-gas-runs.sql.
--
-- 1. A lost or damaged cylinder (each carries a charge from the vendor) is recorded by the Site Engineer, Operations or an Admin, not by a Supervisor,
--    who reports it to the Site Engineer. Everything else in the gas guard is unchanged (2026-11-gas-stock.sql).
-- 2. Low stock: each gas can have a level (gas_products.alert_full, in full cylinders). When a project's full cylinders of it fall to that level or below, Operations
--    and the Admin get a phone notification, once a day per gas per project (gas_alerts records it). The app's server does the sending; the database says what is low.

create or replace function public.gas_movement_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); held int; v_full int;
begin
  if tg_op = 'INSERT' then
    new.entered_by := auth.uid(); new.entered_role := r; new.voided_at := null;
    if new.kind = 'opening' and not public.is_staff() then raise exception 'Only Operations or an Admin can enter opening stock.'; end if;
    if new.kind in ('lost', 'damaged') and r in ('supervisor', 'attendance') then raise exception 'A lost or damaged cylinder is recorded by the Site Engineer. Please tell them.'; end if;
    if new.kind in ('return','lost','damaged') then
      held := public.gas_stock_total(new.project_id, new.vendor_id, new.product_id);
      if new.qty > held then raise exception 'Only % of these cylinders are at this site, so % cannot be entered.', held, new.qty; end if;
    end if;
    if new.kind = 'emptied' then
      v_full := public.gas_stock_full(new.project_id, new.vendor_id, new.product_id);
      if new.qty > v_full then raise exception 'Only % full cylinders of this product are at the site, so % cannot be marked empty.', v_full, new.qty; end if;
    end if;
    return new;
  end if;
  if current_setting('app.gas_edit', true) = '1' then return new; end if;   -- gas_trip_edit / gas_movement_edit (Admin), which check everything themselves
  if new.project_id is distinct from old.project_id or new.vendor_id is distinct from old.vendor_id or new.product_id is distinct from old.product_id
     or new.kind is distinct from old.kind or new.qty is distinct from old.qty or new.entered_by is distinct from old.entered_by then
    raise exception 'A saved entry cannot change its cylinders or quantity: void it and enter it again.'; end if;
  if r in ('staff','admin','site_engineer') then return new; end if;
  if r = 'supervisor' and old.entered_by = auth.uid() and now() - old.created_at < interval '24 hours' then return new; end if;
  raise exception 'A Supervisor can correct their own entry for 24 hours. Ask the Site Engineer.';
end $$;

alter table public.gas_products add column if not exists alert_full int check (alert_full >= 0);   -- warn when full cylinders at a project fall to this or below (empty: no warning)

create table if not exists public.gas_alerts (
  project_id uuid not null references public.projects(id) on delete cascade,
  product_id uuid not null references public.gas_products(id) on delete cascade,
  alerted_on date not null,
  full_count int not null,
  created_at timestamptz not null default now(),
  primary key (project_id, product_id, alerted_on)
);
alter table public.gas_alerts enable row level security;
drop policy if exists "staff read gas alerts" on public.gas_alerts; create policy "staff read gas alerts" on public.gas_alerts for select to authenticated using (public.is_staff());

-- what is at or below its level on a project now (for the server, which sends the notification)
create or replace function public.gas_low_stock(p_project uuid) returns table (product_id uuid, name text, full_count int, alert_full int) language sql stable security definer set search_path = public as $$
  select p.id, btrim(p.name || coalesce(' ' || nullif(btrim(p.capacity), ''), '')), public.gas_stock_full(p_project, p.vendor_id, p.id), p.alert_full
  from public.gas_products p
  where p.alert_full is not null and p.active
    and exists (select 1 from public.gas_project_vendors pv where pv.project_id = p_project and pv.vendor_id = p.vendor_id)
    and public.gas_stock_full(p_project, p.vendor_id, p.id) <= p.alert_full $$;
revoke all on function public.gas_low_stock(uuid) from public, anon, authenticated;
grant execute on function public.gas_low_stock(uuid) to service_role;
