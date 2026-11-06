-- Item units must be one of the units the JSL portal's dropdown offers, spelled exactly as it spells them. Safe to run more than once. Run AFTER 2026-11-inventory.sql.
-- If an item already holds another unit this fails and names nothing: fix those items first (select distinct unit from public.inventory_bill_items).
alter table public.inventory_bill_items drop constraint if exists inventory_bill_items_unit_portal;
alter table public.inventory_bill_items add constraint inventory_bill_items_unit_portal check (unit in ('FT', 'Inch', 'Kg', 'Meter', 'mm', 'MT', 'No', 'Pcs'));
