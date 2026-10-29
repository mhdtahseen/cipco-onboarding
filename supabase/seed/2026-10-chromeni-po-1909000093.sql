-- One-off: enter Chromeni Steels Limited's service order 1909000093 (10 Sep 2026) for the CSL Mundra project as a work order.
-- Run AFTER 2026-10-invoicing.sql and 2026-10-client-project-quotation-links.sql, in the Supabase SQL editor. Safe to run twice (it skips what exists).
-- Checked against the PO: item 1 = 34,76,500.00 + item 2 = 12,93,350.00 = 47,69,850.00 (excl. GST).
--   Settings taken from the PO: retention 10% (the 10% held against the performance bank guarantee for the defect-liability period); GST 18% extra.
--   NOT stated in the PO, so check them: TDS rate (set to 1%) and payment days (set to 45); the SAC code (set to 9954, ask your CA).
--   The 10% advance against an advance bank guarantee is not modelled yet.
do $$
declare cid uuid; wid uuid; pid uuid := '2ae61557-53f7-4761-a1fc-19c208d271cf';   -- the project "CSL" (Mundra, Gujarat)
begin
  select id into cid from public.clients where upper(gstin) = '24AAHCC0596R1Z3';
  if cid is null then
    insert into public.clients (name, short_name, address, state_code, gstin, pan, contact_person, email, phone)
    values ('Chromeni Steels Limited', 'CSL', 'Survey No 74, 75, National Highway No. 8A, Kachchh - 370410, Gujarat', '24', '24AAHCC0596R1Z3', 'AAHCC0596R', 'Mukesh Kumar', 'mukesh.kumar@jindalstainless.com', '9896395242')
    returning id into cid;
  end if;
  update public.projects set client_id = cid, state_code = coalesce(state_code, '24') where id = pid and client_id is null;
  select id into wid from public.work_orders where client_id = cid and wo_no = '1909000093';
  if wid is null then
    insert into public.work_orders (client_id, project_id, wo_no, wo_date, title, sac, gst_rate, retention_pct, tds_pct, payment_days, status, notes)
    values (cid, pid, '1909000093', '2026-09-10', 'SGL line installation & new shed fire fighting work, CSL Mundra', '9954', 18, 10, 1, 45, 'active',
            'Chromeni Steels PO 1909000093 (vendor code 2036514). Payment: 10% advance against ABG, 80% on running bills with 100% taxes, 10% against PBG for the defect-liability period. Quote the PO number and vendor code on every invoice. Delivery by 31.03.2027.')
    returning id into wid;
  end if;
  if not exists (select 1 from public.work_order_items where work_order_id = wid) then
    insert into public.work_order_items (work_order_id, sort, description, unit, qty, rate)
    select wid, v.sort, v.description, v.unit, v.qty, v.rate from (values
      (1, '1.10 · 3095971 · Loading, unloading & shifting', 'MT', 360, 900),
      (2, '1.20 · 3070001 · Erection, alignment & commissioning of equipment; cutting & shifting of scrap', 'MT', 130, 9500),
      (3, '1.30 · 3070704 · Fabrication of shed & structural work (i-beam, channel & angle; 5% extra with old material)', 'MT', 25, 16000),
      (4, '1.40 · 3070707 · Fabrication (general) using plates above 6-12 mm thick', 'MT', 6, 17500),
      (5, '1.50 · 3070708 · Fabrication (general) using plates above 12 mm thick', 'MT', 6, 16000),
      (6, '1.60 · 3072132 · Erection of structure, all structures', 'MT', 25, 10000),
      (7, '1.70 · 3070723 · Fabrication of grating / trench covers', 'MT', 12, 15000),
      (8, '1.80 · 3072178 · Installation of CS utility piping', 'INM', 500, 160),
      (9, '1.90 · 3072180 · Installation of SS hydraulic piping', 'INM', 700, 450),
      (10, '1.100 · 3072131 · Fabrication of engineering structure (equipment technological structure, to engineering drawings)', 'MT', 5, 17500),
      (11, '1.110 · 3070760 · Laying of water pipeline 4" NB size (unit: inch-dia-metre)', 'ind', 2500, 160),
      (12, '1.120 · 3070767 · Fixing of valve 6"', 'EA', 20, 200),
      (13, '2.10 · 3070791 · Unloading', 'MT', 10, 900),
      (14, '2.20 · 3070760 · Laying of water pipeline 4" NB size (unit: inch-dia-metre)', 'ind', 550, 200),
      (15, '2.30 · 3070761 · Laying of water pipeline above 4" NB size (unit: inch-dia-metre)', 'ind', 6060, 160),
      (16, '2.40 · 3071636 · Fixing of valve 6"', 'ind', 120, 200),
      (17, '2.50 · 3070797 · Painting of steel structure & equipment', 'MT', 17, 750),
      (18, '2.60 · 3070704 · Fabrication of shed & structural work', 'MT', 3, 15000),
      (19, '2.70 · 3070736 · Erection of shed & structure up to gantry level', 'MT', 3, 11000),
      (20, '2.80 · 3071779 · Fire hose box installation', 'EA', 30, 3000)
    ) as v(sort, description, unit, qty, rate);
  end if;
end $$;
