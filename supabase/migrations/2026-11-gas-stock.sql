-- Gas cylinders: opening stock, and full versus empty. Safe to run more than once. NOT run by Claude: run it yourself in the Supabase SQL editor.
-- Run AFTER 2026-11-gas-edit.sql (it replaces the guard from that file).
--
-- Two new kinds of entry on gas_movements:
--   opening  the cylinders already at the site before the app was used (Admin or Operations only). They count as being at the site, but are not a delivery:
--            no vendor bill, no trip charge, no Inventory entry, no JSL portal.
--   emptied  cylinders used up on site (full → empty). Anyone who can enter site supplies may record it; it changes nothing about how many cylinders are
--            at the site, only how many of them are full and how many are empty waiting to go back with the next truck.
-- At the site now:   total = opening + delivered − taken back − lost − damaged
--                    empty = what was used up, less the empties already taken back (never below 0)        full = total − empty
-- A swap (one full in, one empty out) leaves the total unchanged and turns that empty into a full one.
-- An "emptied" entry cannot be larger than the full cylinders at the site, and an entry of "opening" cannot be typed by a Supervisor or Site Engineer.

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.gas_movements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%delivery%' and pg_get_constraintdef(oid) like '%damaged%' loop
    execute format('alter table public.gas_movements drop constraint %I', c);
  end loop;
  alter table public.gas_movements add constraint gas_movements_kind_check check (kind in ('delivery', 'return', 'lost', 'damaged', 'opening', 'emptied'));
end $$;

-- cylinders at the site for one product of one vendor on one project (full and empty together)
create or replace function public.gas_stock_total(p_project uuid, p_vendor uuid, p_product uuid) returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(case kind when 'delivery' then qty when 'opening' then qty when 'emptied' then 0 else -qty end), 0)::int
  from public.gas_movements where project_id = p_project and vendor_id = p_vendor and product_id = p_product and voided_at is null $$;

-- full cylinders at the site (total less the empties still waiting to go back)
create or replace function public.gas_stock_full(p_project uuid, p_vendor uuid, p_product uuid) returns int language sql stable security definer set search_path = public as $$
  select public.gas_stock_total(p_project, p_vendor, p_product) - greatest(0, least(public.gas_stock_total(p_project, p_vendor, p_product),
    coalesce(sum(case kind when 'emptied' then qty when 'return' then -qty else 0 end), 0)::int))
  from public.gas_movements where project_id = p_project and vendor_id = p_vendor and product_id = p_product and voided_at is null $$;

create or replace function public.gas_movement_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); held int; v_full int;
begin
  if tg_op = 'INSERT' then
    new.entered_by := auth.uid(); new.entered_role := r; new.voided_at := null;
    if new.kind = 'opening' and not public.is_staff() then raise exception 'Only Operations or an Admin can enter opening stock.'; end if;
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
  -- an update: the only things that change are the note / challan / photo and voiding; the quantity and kind are fixed once saved
  if new.project_id is distinct from old.project_id or new.vendor_id is distinct from old.vendor_id or new.product_id is distinct from old.product_id
     or new.kind is distinct from old.kind or new.qty is distinct from old.qty or new.entered_by is distinct from old.entered_by then
    raise exception 'A saved entry cannot change its cylinders or quantity: void it and enter it again.'; end if;
  if r in ('staff','admin','site_engineer') then return new; end if;
  -- a Supervisor: their own entry, within 24 hours
  if r = 'supervisor' and old.entered_by = auth.uid() and now() - old.created_at < interval '24 hours' then return new; end if;
  raise exception 'A Supervisor can correct their own entry for 24 hours. Ask the Site Engineer.';
end $$;

-- the Admin's correction check: no product may end up with fewer than zero cylinders at the site
create or replace function public.gas_check_held(p_project uuid, p_vendor uuid, p_product uuid) returns void language plpgsql stable security definer set search_path = public as $$
declare h int;
begin
  h := public.gas_stock_total(p_project, p_vendor, p_product);
  if h < 0 then raise exception 'That would leave % fewer % cylinders at the site than were taken back. Check the quantities.', -h, coalesce(public.inventory_gas_name(p_product), 'gas'); end if;
end $$;

revoke all on function public.gas_stock_total(uuid, uuid, uuid), public.gas_stock_full(uuid, uuid, uuid) from public, anon, authenticated;
