-- Seed: Parth Enterprise's gas quotation dated 03.11.2026 (Ref Nov-2026/27): the vendor, its two products, the rates, the terms and the bank details.
-- Run AFTER 2026-11-gas.sql and 2026-11-consumables.sql (the bank details need the latter). Safe to run more than once: nothing is added twice.
-- The vendor is linked to the project named in the last block: change the name there if the quotation is for a different project.

do $$
declare v uuid; ox uuid; lpg uuid; start date := date '2026-11-03';
begin
  select id into v from public.gas_vendors where lower(btrim(name)) = 'parth enterprise' limit 1;
  if v is null then
    insert into public.gas_vendors (name, contact, phone, gstin, notice_hours, free_delivery_min, kind)
    values ('Parth Enterprise', 'Bhujpur, Mundra (Kutch)', '98799 28177 / 81410 81128', '24BETPS1679P1ZD', 24, 50, 'gas') returning id into v;
  end if;

  -- products
  select id into ox from public.gas_products where vendor_id = v and lower(name) = 'industrial oxygen' and capacity = '7 m3' limit 1;
  if ox is null then insert into public.gas_products (vendor_id, name, capacity, sort_order) values (v, 'Industrial oxygen', '7 m3', 1) returning id into ox; end if;
  select id into lpg from public.gas_products where vendor_id = v and lower(name) = 'commercial lpg' and capacity = '19 kg' limit 1;
  if lpg is null then insert into public.gas_products (vendor_id, name, capacity, sort_order) values (v, 'Commercial LPG', '19 kg', 2) returning id into lpg; end if;

  -- rates: per cylinder at their godown, before 18% GST
  if not exists (select 1 from public.gas_rates where product_id = ox and valid_from = start) then insert into public.gas_rates (product_id, rate, gst_pct, valid_from) values (ox, 450, 18, start); end if;
  if not exists (select 1 from public.gas_rates where product_id = lpg and valid_from = start) then insert into public.gas_rates (product_id, rate, gst_pct, valid_from) values (lpg, 3100, 18, start); end if;

  -- terms
  insert into public.gas_terms (vendor_id, deposit_per_cylinder, rent_per_day, rotations_per_month, post_project_rent_per_day, return_grace_days, loss_charge_per_cylinder, due_day_first_half, due_day_second_half, terms_note)
  values (v, 5000, 10, 4, 20, 15, 15000, 25, 10,
    'Cylinders are supplied on loan, on a returnable basis. Rates may change with electricity, diesel and spare-part costs. Loading and unloading is at our end. Payment by DD or cheque payable at Mundra in favour of Parth Enterprise; no round-figure or on-account payments, each invoice is paid as per its amount.')
  on conflict (vendor_id) do nothing;

  -- bank details (Admin only table)
  if to_regclass('public.payee_bank') is not null then
    insert into public.payee_bank (kind, ref_id, holder, bank, branch, account_no, ifsc)
    values ('gas_vendor', v, 'Parth Enterprise', 'Union Bank of India', 'Mundra', '624701010050030', 'UBIN0562475')
    on conflict (kind, ref_id) do nothing;
  end if;

  -- supplies this project (the quotation is addressed to Chandrika Ind, Gindala, Kutch)
  insert into public.gas_project_vendors (project_id, vendor_id)
  select p.id, v from public.projects p where p.name = 'CSL' on conflict do nothing;
end $$;
