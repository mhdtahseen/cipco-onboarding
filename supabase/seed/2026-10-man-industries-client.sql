-- One-off: add Man Industries (India) Ltd as a client and link its two issued quotations (0104, 0105) and the "MAN Industries" project to it.
-- Run AFTER 2026-10-invoicing.sql and 2026-10-client-project-quotation-links.sql, in the Supabase SQL editor. Safe to run twice.
-- Taken from the quotations as issued: the name (without the trailing comma, which is part of the letter's salutation), the address and Mr Rahul Singla as the contact.
-- NOT known, so left empty: the GSTIN, email and phone. Add the GSTIN on the Clients page before raising an invoice: the client claims GST credit against it.
do $$
declare cid uuid; pid uuid := '59320465-e834-48bf-afbd-5c57afdd35ab';   -- the project "MAN Industries" (Anjar, Gujarat)
begin
  select id into cid from public.clients where name ilike 'Man Industries (India) Ltd%' order by created_at limit 1;
  if cid is null then
    insert into public.clients (name, short_name, address, state_code, contact_person)
    values ('Man Industries (India) Ltd', 'MAN Industries', 'Plot No 485/2, Anjar-Mundra Highway, Village: Khedoi, Taluka: Anjar, Dist: Kutch, Gujarat - 370130', '24', 'Rahul Singla')
    returning id into cid;
  end if;
  update public.projects set client_id = cid, state_code = coalesce(state_code, '24') where id = pid and client_id is null;
  update public.quotations set client_id = cid, project_id = pid where ref_no in ('CIPCO/OPS/QTN/2026/0104', 'CIPCO/OPS/QTN/2026/0105') and client_id is null;
end $$;
