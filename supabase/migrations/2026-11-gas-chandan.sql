-- Gas: the final vendor is Chandan Gases Co (replaces Parth Enterprise). Safe to run more than once.
--
-- Their quotation differs from the first one, so the gas tables learn four things:
--   * a deposit per product (oxygen ₹8,000, LPG ₹3,000), not one deposit per vendor
--   * a charge for a lost cylinder (₹12,500 + 18% GST) and a separate one for a damaged valve and cap (₹1,500 + 18% GST)
--   * transport charged per delivery trip (₹1,500, GST on top)
--   * the vendor's address (for the purchase order)
-- Then the data: Parth Enterprise is removed (deleted if nothing was ever recorded against it, otherwise made inactive), Chandan Gases Co is added with its products, rates,
-- terms, bank details (from the vendor's cheque) and CSL, and the deposit already paid for 3 oxygen cylinders is recorded.
-- Run AFTER 2026-11-gas.sql and 2026-11-consumables.sql.

alter table public.gas_vendors add column if not exists address text not null default '';
alter table public.gas_products add column if not exists deposit_per_cylinder numeric(12,2) not null default 0;   -- refundable, held by the vendor
alter table public.gas_terms add column if not exists damage_charge_per_cylinder numeric(12,2) not null default 0;  -- valve + cap damaged on site
alter table public.gas_terms add column if not exists charges_gst_pct numeric(5,2) not null default 18;            -- GST added to the lost / damaged / transport charges
alter table public.gas_terms add column if not exists transport_per_trip numeric(12,2) not null default 0;        -- charged for each delivery trip

do $$
declare old uuid; v uuid; ox uuid; lpg uuid; csl uuid; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  -- the first vendor: gone, unless something was already recorded against it
  select id into old from public.gas_vendors where lower(btrim(name)) = 'parth enterprise' limit 1;
  if old is not null then
    if exists (select 1 from public.gas_orders where vendor_id = old) or exists (select 1 from public.gas_movements where vendor_id = old) or exists (select 1 from public.site_bills where vendor_id = old)
       or exists (select 1 from public.site_payments where vendor_id = old) or exists (select 1 from public.gas_deposits where vendor_id = old) or exists (select 1 from public.gas_rent_billed where vendor_id = old) then
      update public.gas_vendors set active = false where id = old;
      delete from public.gas_project_vendors where vendor_id = old;
    else
      delete from public.payee_bank where kind = 'gas_vendor' and ref_id = old;
      delete from public.gas_vendors where id = old;      -- its products, rates, terms and project link go with it
    end if;
  end if;

  -- Chandan Gases Co
  select id into v from public.gas_vendors where lower(btrim(name)) = 'chandan gases co' limit 1;
  if v is null then
    insert into public.gas_vendors (name, contact, phone, gstin, address, notice_hours, free_delivery_min, kind)
    values ('Chandan Gases Co', '', '+91 99099 77099', '', 'Plot No. 235-236-237, GIDC Anjar', 0, 0, 'gas') returning id into v;   -- the quotation states no notice period or free-delivery minimum
  end if;

  select id into ox from public.gas_products where vendor_id = v and lower(name) = 'oxygen' limit 1;
  if ox is null then insert into public.gas_products (vendor_id, name, capacity, sort_order, deposit_per_cylinder) values (v, 'Oxygen', '', 1, 8000) returning id into ox; else update public.gas_products set deposit_per_cylinder = 8000 where id = ox; end if;
  select id into lpg from public.gas_products where vendor_id = v and lower(name) = 'lpg' limit 1;
  if lpg is null then insert into public.gas_products (vendor_id, name, capacity, sort_order, deposit_per_cylinder) values (v, 'LPG', '', 2, 3000) returning id into lpg; else update public.gas_products set deposit_per_cylinder = 3000 where id = lpg; end if;

  -- rates per cylinder before 18% GST (LPG is "as on today's rate": add a new rate when it changes)
  if not exists (select 1 from public.gas_rates where product_id = ox and valid_from = today) then insert into public.gas_rates (product_id, rate, gst_pct, valid_from) values (ox, 280, 18, today); end if;
  if not exists (select 1 from public.gas_rates where product_id = lpg and valid_from = today) then insert into public.gas_rates (product_id, rate, gst_pct, valid_from) values (lpg, 2861, 18, today); end if;

  -- terms. The quotation gives no rent and no payment days: rent is 0, and the payment days stay at the app's usual 25th / 10th until you tell me the real ones.
  insert into public.gas_terms (vendor_id, deposit_per_cylinder, rent_per_day, rotations_per_month, post_project_rent_per_day, return_grace_days, loss_charge_per_cylinder, damage_charge_per_cylinder, charges_gst_pct, transport_per_trip, due_day_first_half, due_day_second_half, terms_note)
  values (v, 0, 0, 4, 0, 15, 12500, 1500, 18, 1500, 25, 10, 'The LPG rate is as on the date of the quotation and may change. Transportation is charged per trip.')
  on conflict (vendor_id) do nothing;

  -- bank details (Admin only table), from the cheque: the account is in the name printed on it
  if to_regclass('public.payee_bank') is not null then
    insert into public.payee_bank (kind, ref_id, holder, bank, branch, account_no, ifsc)
    values ('gas_vendor', v, 'RK GAS WORLD', 'YES Bank', 'Gandhidham', '045373800000208', 'YESB0000453')
    on conflict (kind, ref_id) do nothing;
  end if;

  -- supplies CSL, and the deposit already paid for 3 oxygen cylinders
  select id into csl from public.projects where name = 'CSL' limit 1;
  if csl is not null then
    insert into public.gas_project_vendors (project_id, vendor_id) values (csl, v) on conflict do nothing;
    if not exists (select 1 from public.gas_deposits where vendor_id = v and project_id = csl and kind = 'paid') then
      insert into public.gas_deposits (vendor_id, project_id, kind, amount, on_date, reference, note) values (v, csl, 'paid', 24000, today, '', '3 oxygen cylinders × ₹8,000, paid before the first delivery');
    end if;
  end if;
end $$;
