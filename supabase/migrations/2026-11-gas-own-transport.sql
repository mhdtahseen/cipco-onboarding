-- Gas deliveries: who brought the cylinders. Safe to run more than once. NOT run by Claude: run it yourself in the Supabase SQL editor.
-- Run AFTER 2026-11-gas.sql, 2026-11-gas-chandan.sql and 2026-10-attendance-accountability-transport.sql.
--
-- Each delivery trip now says who brought it (gas_movements.carrier):
--   vendor  the gas vendor's own vehicle (the default, and what every earlier entry was). The vendor's "transport per delivery trip" from Setup → Terms is charged,
--           e.g. Chandan ₹1,500 per trip, no GST; a vendor with 0 there charges nothing.
--   own     one of the project's transport vehicles. The vendor's trip charge is NOT counted. An errand is made on that vehicle by itself, with no amount yet
--           ("needs amount"); Admin or Operations enter the amount later, once. It is paid with that vehicle's dues under Transport, never in the gas cost.
--   none    collected or otherwise free: no trip charge from anyone.
-- All the entries of one trip (each product in, each product's empties out) share a trip_ref, so one trip makes one errand. Voiding every entry of the trip voids its errand.

alter table public.gas_movements add column if not exists carrier text not null default 'vendor';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gas_movements_carrier_check') then
    alter table public.gas_movements add constraint gas_movements_carrier_check check (carrier in ('vendor', 'own', 'none'));
  end if;
end $$;
alter table public.gas_movements add column if not exists vehicle_id uuid references public.transport_vehicles(id);   -- set when carrier = 'own'
alter table public.gas_movements add column if not exists trip_ref uuid;                                               -- the same for every entry saved in one trip

-- an errand from a gas trip: no amount until Admin / Operations enter it
alter table public.transport_errands alter column amount drop not null;            -- the existing "amount > 0" check still applies once an amount is entered
alter table public.transport_errands add column if not exists gas_trip_ref uuid;   -- the gas trip it came from
create index if not exists transport_errands_gas_trip on public.transport_errands (gas_trip_ref) where gas_trip_ref is not null;

-- money is never edited, only voided; the one exception: an errand made without an amount gets its amount once
create or replace function public.transport_money_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'This is never deleted. Void it and enter the right one.'; end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'transport_errands' and old.voided_at is null and new.voided_at is null and (to_jsonb(old) ->> 'amount') is null and (to_jsonb(new) ->> 'amount') is not null
       and to_jsonb(new) - 'amount' is not distinct from to_jsonb(old) - 'amount' then return new; end if;   -- entering the amount of a gas-trip errand
    if to_jsonb(new) - 'voided_at' - 'voided_by' - 'bill_path' is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' - 'bill_path' then raise exception 'This cannot be edited. Void it and enter the right one.'; end if;   -- (the bill can be attached later)
    if old.voided_at is not null and new.voided_at is not distinct from old.voided_at and (to_jsonb(new) ->> 'bill_path') is distinct from (to_jsonb(old) ->> 'bill_path') then return new; end if;   -- (a voided payment can still get its bill)
    if old.voided_at is not null then raise exception 'This is already voided.'; end if;
    if new.voided_at is not null then new.voided_by := auth.uid(); end if;
    return new;
  end if;
  if tg_table_name = 'vendor_payments' then select f.project_id into new.project_id from public.food_vendors f where f.id = new.vendor_id;
  elsif tg_table_name = 'accommodation_payments' then select r.project_id into new.project_id from public.accommodation_rooms r where r.id = new.room_id;
  else select v.project_id into new.project_id from public.transport_vehicles v where v.id = new.vehicle_id; end if;
  if new.project_id is null then raise exception 'This vendor or vehicle is not assigned to a project yet. Assign it to a project first.'; end if;
  new.created_by := auth.uid(); new.voided_at := null; new.voided_by := null; return new;
end $$;

-- check the carrier on each entry, and make the trip's errand
create or replace function public.gas_carrier_check() returns trigger language plpgsql security definer set search_path = public as $$
declare vp uuid;
begin
  if new.kind not in ('delivery', 'return') then new.carrier := 'vendor'; new.vehicle_id := null; return new; end if;   -- lost / damaged are not trips
  if new.carrier = 'own' then
    if new.vehicle_id is null then raise exception 'Choose which of our vehicles brought it.'; end if;
    select project_id into vp from public.transport_vehicles where id = new.vehicle_id;
    if vp is distinct from new.project_id then raise exception 'That vehicle is not one of this project''s transport vehicles.'; end if;
  else new.vehicle_id := null; end if;
  return new;
end $$;
drop trigger if exists gas_carrier_check_trg on public.gas_movements;
create trigger gas_carrier_check_trg before insert on public.gas_movements for each row execute function public.gas_carrier_check();

create or replace function public.gas_trip_errand() returns trigger language plpgsql security definer set search_path = public as $$
declare vname text; what text;
begin
  if tg_op = 'INSERT' then
    if new.carrier <> 'own' or new.trip_ref is null or new.voided_at is not null then return null; end if;
    if exists (select 1 from public.transport_errands where gas_trip_ref = new.trip_ref and voided_at is null) then return null; end if;   -- one errand per trip
    select name into vname from public.gas_vendors where id = new.vendor_id;
    what := case when new.kind = 'delivery' then 'Gas cylinders from ' else 'Empty gas cylinders back to ' end || coalesce(vname, 'the gas vendor') || case when btrim(new.challan_no) <> '' then ' (challan ' || btrim(new.challan_no) || ')' else '' end;
    insert into public.transport_errands (vehicle_id, work_date, description, amount, gas_trip_ref) values (new.vehicle_id, new.moved_on, what, null, new.trip_ref);
  elsif new.voided_at is not null and old.voided_at is null and new.trip_ref is not null
        and not exists (select 1 from public.gas_movements where trip_ref = new.trip_ref and voided_at is null) then
    update public.transport_errands set voided_at = now() where gas_trip_ref = new.trip_ref and voided_at is null;   -- the whole trip was voided
  end if;
  return null;
end $$;
drop trigger if exists gas_trip_errand_trg on public.gas_movements;
create trigger gas_trip_errand_trg after insert or update of voided_at on public.gas_movements for each row execute function public.gas_trip_errand();

revoke all on function public.gas_carrier_check(), public.gas_trip_errand() from public, anon, authenticated;
