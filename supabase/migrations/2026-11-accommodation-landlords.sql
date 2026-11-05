-- Accommodation: landlords as records, and a charge that can differ from the rent for a month. Safe to run more than once.
-- NOT run by Claude: run it yourself in the Supabase SQL editor (or tell Claude to run it).
--
-- 1. Landlords. Until now the landlord was a name typed on every room, and the bank details were stored per room. A landlord is now one record (name, phone, PAN, notes, an optional
--    agreement) with the bank details entered once; rooms point to it. The migration builds the landlords from the names already on the rooms and moves their bank details across.
-- 2. Month adjustments. Rent is normally the full rent for each month from the month a room was rented. An adjustment says what was ACTUALLY charged for one room in one month:
--    nothing (₹0), a part month, or any other amount, with a reason. Without one, the full rent applies, as before.
-- 3. The data fix you asked for: Room 5 (the AC room, rented from 27 Oct) was not charged for October, so October is set to ₹0 for it and it no longer shows ₹13,000 overdue.
-- Run AFTER 2026-10-accommodation.sql and 2026-11-payee-bank.sql.

-- bank details can now belong to a landlord
do $$ declare c text; begin
  if to_regclass('public.payee_bank') is not null then
    for c in select conname from pg_constraint where conrelid = 'public.payee_bank'::regclass and contype = 'c' loop
      execute format('alter table public.payee_bank drop constraint %I', c);
    end loop;
    alter table public.payee_bank add constraint payee_bank_kind_check check (kind in ('food_vendor', 'vehicle', 'room', 'gas_vendor', 'equipment_vendor', 'landlord'));
  end if;
end $$;

create table if not exists public.accommodation_landlords (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  pan text not null default '',
  notes text not null default '',
  agreement_path text,                       -- optional: a photo or PDF of the rent agreement, if there is one (most arrangements are verbal)
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists accommodation_landlords_name_uq on public.accommodation_landlords (lower(btrim(name)));

alter table public.accommodation_rooms add column if not exists landlord_id uuid references public.accommodation_landlords(id) on delete set null;
create index if not exists accommodation_rooms_landlord on public.accommodation_rooms (landlord_id);

create table if not exists public.accommodation_adjustments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.accommodation_rooms(id) on delete cascade,
  for_month date not null,                   -- the first day of the month
  amount numeric(12,2) not null check (amount >= 0),   -- what was charged for that room in that month; 0 = nothing
  reason text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (room_id, for_month)
);

alter table public.accommodation_landlords enable row level security;
alter table public.accommodation_adjustments enable row level security;
drop policy if exists "staff all" on public.accommodation_landlords;
drop policy if exists "staff all" on public.accommodation_adjustments;
create policy "staff all" on public.accommodation_landlords for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff all" on public.accommodation_adjustments for all to authenticated using (public.is_staff()) with check (public.is_staff());
do $$ begin
  if to_regproc('public.is_viewer') is not null then   -- the read-only Viewer role (2026-11-viewer-role.sql)
    execute 'drop policy if exists "viewer read" on public.accommodation_landlords';
    execute 'create policy "viewer read" on public.accommodation_landlords for select to authenticated using (public.is_viewer())';
    execute 'drop policy if exists "viewer read" on public.accommodation_adjustments';
    execute 'create policy "viewer read" on public.accommodation_adjustments for select to authenticated using (public.is_viewer())';
  end if;
end $$;

-- landlords from the names already typed on the rooms (one per name, ignoring capitals and spaces), then the rooms linked to them
insert into public.accommodation_landlords (name)
select distinct on (lower(btrim(landlord))) btrim(landlord) from public.accommodation_rooms where btrim(landlord) <> '' order by lower(btrim(landlord)), created_at
on conflict do nothing;
update public.accommodation_rooms r set landlord_id = l.id
from public.accommodation_landlords l where r.landlord_id is null and btrim(r.landlord) <> '' and lower(btrim(l.name)) = lower(btrim(r.landlord));

-- bank details move from the rooms to the landlord (the most recently saved set that has an account or UPI)
do $$ begin
  if to_regclass('public.payee_bank') is not null then
    insert into public.payee_bank (kind, ref_id, holder, bank, branch, account_no, ifsc, upi)
    select distinct on (r.landlord_id) 'landlord', r.landlord_id, pb.holder, pb.bank, pb.branch, pb.account_no, pb.ifsc, pb.upi
    from public.accommodation_rooms r join public.payee_bank pb on pb.kind = 'room' and pb.ref_id = r.id
    where r.landlord_id is not null and (pb.account_no <> '' or pb.upi <> '')
    order by r.landlord_id, pb.updated_at desc
    on conflict (kind, ref_id) do nothing;
  end if;
end $$;

-- the AC room (rented from 27 Oct) was not charged for October
insert into public.accommodation_adjustments (room_id, for_month, amount, reason)
select r.id, date '2026-10-01', 0, 'Not charged for October' from public.accommodation_rooms r where r.room_type = 'ac' and r.rented_from = date '2026-10-27'
on conflict (room_id, for_month) do nothing;
