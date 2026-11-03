-- Bank details of the people and businesses the company pays: food vendors, transport vehicles (the operator), rooms (the landlord) and gas vendors.
-- Kept in their own table, readable and writable by the Admin only, so the staff who can open vendors, vehicles and rooms never see account numbers.
-- Employees already carry their own bank / UPI details. Safe to run more than once.
create table if not exists public.payee_bank (
  kind text not null check (kind in ('food_vendor', 'vehicle', 'room', 'gas_vendor', 'equipment_vendor')),
  ref_id uuid not null,                                   -- the vendor, vehicle or room
  holder text not null default '',
  bank text not null default '',
  branch text not null default '',
  account_no text not null default '',
  ifsc text not null default '',
  upi text not null default '',
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (kind, ref_id)
);
alter table public.payee_bank enable row level security;
drop policy if exists "admin payee bank" on public.payee_bank;
create policy "admin payee bank" on public.payee_bank for all to authenticated using (public.is_admin()) with check (public.is_admin());
