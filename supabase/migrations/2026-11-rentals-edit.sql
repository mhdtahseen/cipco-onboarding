-- Editing a rented delivery (Site supplies → Equipment → Rented → Edit delivery): the date, vehicle, delivery note number, note and the items
-- (add, remove, rename, change the quantity or unit). Admin and Operations only, like the rest of rentals.
--  - Items keep their id when they are kept, so their rate stays; a removed item loses its rate; a new one has none until it is set (or is given one here).
--  - Its Inventory entry follows: the same date, note number, note and items, and the vehicle on its JSL details when it goes by vehicle.
--    Allowed only while that entry is not with the JSL portal (none, authorized or failed). An authorization is withdrawn, so an Admin looks again.
--  - Not after the return (undo the return first) or on a void rental.
-- Safe to run more than once. Run AFTER 2026-11-rentals.sql.

-- p_items: [{ "id": "<kept item>" | null, "name": "Clamp", "qty": 12, "unit": "No", "rate": 1 | null }, ...]  (rate is only used for Operations / Admin)
create or replace function public.rental_update(p_rental uuid, p_delivered_on date, p_vehicle text, p_note_no text, p_note text, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x public.rentals; b public.inventory_bills; it jsonb; n int := 0; iid uuid; keep uuid[] := '{}';
  today date := (now() at time zone 'Asia/Kolkata')::date;
  veh text := upper(regexp_replace(btrim(coalesce(p_vehicle, '')), '\s+', ' ', 'g'));
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can change a rental.'; end if;
  select * into x from public.rentals where id = p_rental for update;
  if x.id is null then raise exception 'Rental not found.'; end if;
  if x.voided_at is not null then raise exception 'This rental is void.'; end if;
  if x.returned_on is not null then raise exception 'The items are already returned. Undo the return first to change the delivery.'; end if;
  if p_delivered_on is null or p_delivered_on > today then raise exception 'The delivery date cannot be in the future.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Keep at least one item.'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if btrim(coalesce(it ->> 'name', '')) = '' or coalesce((it ->> 'qty')::numeric, 0) <= 0 then raise exception 'Every item needs a name and a quantity.'; end if;
    if coalesce(nullif(btrim(it ->> 'unit'), ''), 'No') not in ('FT', 'Inch', 'Kg', 'Meter', 'mm', 'MT', 'No', 'Pcs') then raise exception 'Choose the unit from the list (No, Pcs, Meter, FT, Kg...): "%" is not one the JSL portal knows.', it ->> 'unit'; end if;
    if nullif(it ->> 'id', '') is not null and not exists (select 1 from public.rental_items where id = (it ->> 'id')::uuid and rental_id = p_rental) then raise exception 'An item does not belong to this rental. Reload and try again.'; end if;
  end loop;

  if x.inventory_bill_id is not null then
    select * into b from public.inventory_bills where id = x.inventory_bill_id for update;
    if b.id is not null and b.voided_at is null and b.jsl_status not in ('none', 'authorized', 'failed') then
      raise exception 'This delivery is on the JSL portal (or may be), so it cannot be changed here. Settle it on the portal first.'; end if;
  end if;

  -- the delivery and its items (kept items keep their id and rate)
  update public.rentals set delivered_on = p_delivered_on, delivery_vehicle = veh, delivery_note_no = btrim(coalesce(p_note_no, '')), note = btrim(coalesce(p_note, '')) where id = p_rental;
  for it in select * from jsonb_array_elements(p_items) loop
    if nullif(it ->> 'id', '') is not null then keep := keep || (it ->> 'id')::uuid; end if;
  end loop;
  delete from public.rental_items where rental_id = p_rental and not (id = any (keep));
  update public.rental_items set line_no = line_no + 1000 where rental_id = p_rental;   -- out of the way while lines are renumbered
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    if nullif(it ->> 'id', '') is not null then
      iid := (it ->> 'id')::uuid;
      update public.rental_items set line_no = n, name = btrim(it ->> 'name'), qty = (it ->> 'qty')::numeric, unit = coalesce(nullif(btrim(it ->> 'unit'), ''), 'No'), missing_qty = 0 where id = iid;
    else
      insert into public.rental_items (rental_id, line_no, name, qty, unit) values (p_rental, n, btrim(it ->> 'name'), (it ->> 'qty')::numeric, coalesce(nullif(btrim(it ->> 'unit'), ''), 'No')) returning id into iid;
    end if;
    if nullif(it ->> 'rate', '') is not null and (it ->> 'rate')::numeric >= 0 then
      insert into public.rental_item_rates (item_id, rate) values (iid, (it ->> 'rate')::numeric) on conflict (item_id) do update set rate = excluded.rate, updated_at = now();
    end if;
  end loop;

  -- its Inventory entry follows, and an authorization is withdrawn
  if b.id is not null and b.voided_at is null then
    perform set_config('app.inventory', '1', true);
    update public.inventory_bills set bill_date = p_delivered_on, bill_no = btrim(coalesce(p_note_no, '')),
      note = 'Rented from ' || vendor_name || ', returns to the vendor' || case when veh <> '' then '. Vehicle ' || veh else '' end,
      jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null where id = b.id;
    delete from public.inventory_bill_items where bill_id = b.id;
    insert into public.inventory_bill_items (bill_id, line_no, name, qty, unit, rate, gst_pct)
      select b.id, i.line_no, i.name, i.qty, i.unit, 0, 0 from public.rental_items i where i.rental_id = p_rental order by i.line_no;
    update public.inventory_gatepass set vehicle_no = replace(veh, ' ', ''), updated_at = now() where bill_id = b.id and received_by = 'vehicle' and veh <> '';
    perform set_config('app.inventory', '', true);
  end if;
end $$;

revoke all on function public.rental_update(uuid, date, text, text, text, jsonb) from public, anon;
grant execute on function public.rental_update(uuid, date, text, text, text, jsonb) to authenticated;
