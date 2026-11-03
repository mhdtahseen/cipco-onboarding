-- Site consumables, part 2: hired equipment (cranes, manlifts, trucks), vendor bills and payments shared with gas, gas deposits and billed rent.
-- Run AFTER 2026-11-gas.sql. Safe to run more than once. NOT run by Claude: run it yourself in the Supabase SQL editor.
--
-- Same split as gas: what a Supervisor / Site Engineer records (the equipment and its time log) is in tables they can read for their own sites;
-- everything with a rupee value (rates, bills, payments, deposits) is in tables only Operations (stored as 'staff') and Admin can read.
-- The hours logged on site are what a vendor's bill is compared with. A booking is NOT required: a crane called at short notice is simply logged.

-- ---------- 1. bank details for the new vendor kinds ----------
do $$ declare c text; begin
  if to_regclass('public.payee_bank') is not null then
    for c in select conname from pg_constraint where conrelid = 'public.payee_bank'::regclass and contype = 'c' loop
      execute format('alter table public.payee_bank drop constraint %I', c);
    end loop;
    alter table public.payee_bank add constraint payee_bank_kind_check check (kind in ('food_vendor', 'vehicle', 'room', 'gas_vendor', 'equipment_vendor'));
  end if;
end $$;

-- ---------- 2. one vendor list for gas and equipment ----------
alter table public.gas_vendors add column if not exists kind text not null default 'gas';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gas_vendors_kind_check') then
    alter table public.gas_vendors add constraint gas_vendors_kind_check check (kind in ('gas', 'equipment'));
  end if;
end $$;

-- ---------- 3. equipment ----------
create table if not exists public.equipment_items (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.gas_vendors(id) on delete cascade,
  name text not null,                                  -- e.g. 50T crane
  type text not null default 'crane' check (type in ('crane', 'manlift', 'truck', 'other')),
  identifier text not null default '',                 -- registration number or the vendor's unit number
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.equipment_logs (       -- one row per stretch of work: start, stop. A row with no end is running now.
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_id uuid not null references public.equipment_items(id),
  vendor_id uuid not null references public.gas_vendors(id),
  work_date date not null,                             -- the day it started, in India
  start_at timestamptz not null,
  end_at timestamptz,
  breakdown boolean not null default false,            -- the machine was on site but did not work (shown, not billed differently: the vendor's bill decides)
  note text not null default '',
  entered_by uuid default auth.uid(),
  entered_role text,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  check (end_at is null or end_at > start_at)
);
create index if not exists equipment_logs_project on public.equipment_logs (project_id, work_date desc);
create unique index if not exists equipment_logs_one_running on public.equipment_logs (item_id) where end_at is null and voided_at is null;

create table if not exists public.equipment_rates (      -- money: Operations / Admin only
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.equipment_items(id) on delete cascade,
  unit text not null default 'hour' check (unit in ('hour', 'day')),
  rate numeric(12,2) not null check (rate >= 0),                  -- per hour, or per day
  min_hours numeric(5,2) not null default 0,                      -- hourly: a day with any work is billed for at least this many hours
  round_minutes int not null default 0,                           -- hourly: round each day's time up to a multiple of this (0 = exact)
  overtime_after_hours numeric(5,2),                              -- hours in a day after which the overtime rate applies (blank = none)
  overtime_rate numeric(12,2),                                    -- per hour beyond that
  gst_pct numeric(5,2) not null default 18,
  valid_from date not null default (now() at time zone 'Asia/Kolkata')::date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists equipment_rates_item on public.equipment_rates (item_id, valid_from desc);

-- ---------- 4. bills and payments for gas and equipment (money) ----------
create table if not exists public.site_bills (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('gas', 'equipment')),
  vendor_id uuid not null references public.gas_vendors(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  bill_no text not null default '',
  bill_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  period_from date not null,
  period_to date not null,
  bill_amount numeric(12,2) not null check (bill_amount >= 0),     -- what the vendor billed
  status text not null default 'received' check (status in ('received', 'approved')),
  approved_amount numeric(12,2),                                   -- what you agreed to pay
  computed_amount numeric(12,2),                                   -- what the site records came to when it was approved
  note text not null default '',
  bill_path text,
  created_by uuid default auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  check (period_to >= period_from)
);
create index if not exists site_bills_project on public.site_bills (project_id, bill_date desc);
create table if not exists public.site_payments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('gas', 'equipment')),
  vendor_id uuid not null references public.gas_vendors(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  paid_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  amount numeric(12,2) not null check (amount > 0),
  reference text not null default '',
  note text not null default '',
  bill_path text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz
);
create index if not exists site_payments_project on public.site_payments (project_id, paid_on desc);

-- ---------- 5. gas: deposits (a refundable asset, not an expense) and rent the vendor billed ----------
create table if not exists public.gas_deposits (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.gas_vendors(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('paid', 'refund')),
  amount numeric(12,2) not null check (amount > 0),
  on_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  reference text not null default '',
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz
);
create table if not exists public.gas_rent_billed (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.gas_vendors(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  amount numeric(12,2) not null check (amount >= 0),
  reason text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz
);

-- ---------- 6. row-level security ----------
alter table public.equipment_items enable row level security;
alter table public.equipment_logs enable row level security;
alter table public.equipment_rates enable row level security;
alter table public.site_bills enable row level security;
alter table public.site_payments enable row level security;
alter table public.gas_deposits enable row level security;
alter table public.gas_rent_billed enable row level security;
do $$ declare t text; begin
  foreach t in array array['equipment_items','equipment_logs','equipment_rates','site_bills','site_payments','gas_deposits','gas_rent_billed'] loop
    execute format('drop policy if exists %I on public.%I', t || ' read', t);
    execute format('drop policy if exists %I on public.%I', t || ' write', t);
    execute format('drop policy if exists %I on public.%I', t || ' ins', t);
    execute format('drop policy if exists %I on public.%I', t || ' upd', t);
    execute format('drop policy if exists %I on public.%I', t || ' del', t);
  end loop;
end $$;
create policy "equipment_items read" on public.equipment_items for select to authenticated using (public.app_role() is not null and public.app_role() <> 'none');
create policy "equipment_items write" on public.equipment_items for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "equipment_logs read" on public.equipment_logs for select to authenticated using (public.can_attend(project_id));
create policy "equipment_logs ins" on public.equipment_logs for insert to authenticated with check (public.app_role() in ('supervisor','site_engineer','staff','admin') and public.can_attend(project_id));
create policy "equipment_logs upd" on public.equipment_logs for update to authenticated using (public.can_attend(project_id)) with check (public.can_attend(project_id));
create policy "equipment_logs del" on public.equipment_logs for delete to authenticated using (public.is_admin());
create policy "equipment_rates write" on public.equipment_rates for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "site_bills write" on public.site_bills for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "site_payments write" on public.site_payments for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "gas_deposits write" on public.gas_deposits for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "gas_rent_billed write" on public.gas_rent_billed for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- 7. the equipment log guard ----------
-- Stamps who and in which role; times cannot be in the future; the machine must be one the vendor linked to this project supplies;
-- a stop can come from anyone on the site; a time correction or void is by the Site Engineer and above, or the Supervisor who made the entry within 24 hours;
-- only a Site Engineer, Operations or Admin can verify, and any change to the times clears the verification.
create or replace function public.equipment_log_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); it record; times_changed boolean; own boolean;
begin
  if tg_op = 'INSERT' then
    select i.vendor_id, i.active into it from public.equipment_items i where i.id = new.item_id;
    if not found then raise exception 'That equipment does not exist.'; end if;
    new.vendor_id := it.vendor_id; new.entered_by := auth.uid(); new.entered_role := r; new.verified_by := null; new.verified_at := null; new.voided_at := null;
    new.work_date := (new.start_at at time zone 'Asia/Kolkata')::date;
    if new.start_at > now() + interval '5 minutes' then raise exception 'The start time is in the future.'; end if;
    if new.end_at is not null and new.end_at > now() + interval '5 minutes' then raise exception 'The end time is in the future.'; end if;
    if new.end_at is not null and new.end_at - new.start_at > interval '24 hours' then raise exception 'One entry cannot be longer than 24 hours.'; end if;
    if not exists (select 1 from public.gas_project_vendors pv where pv.project_id = new.project_id and pv.vendor_id = new.vendor_id) then raise exception 'That vendor is not set up for this project.'; end if;
    return new;
  end if;
  if new.project_id is distinct from old.project_id or new.item_id is distinct from old.item_id or new.vendor_id is distinct from old.vendor_id or new.entered_by is distinct from old.entered_by or new.created_at is distinct from old.created_at then
    raise exception 'The machine, project and who entered it cannot change: void the entry and enter it again.'; end if;
  times_changed := new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at;
  own := old.entered_by = auth.uid() and now() - old.created_at < interval '24 hours';
  -- verifying
  if new.verified_at is distinct from old.verified_at and new.verified_at is not null then
    if r not in ('site_engineer','staff','admin') then raise exception 'Only the Site Engineer or above can verify hours.'; end if;
    if new.end_at is null then raise exception 'Stop the machine before verifying its hours.'; end if;
    new.verified_by := auth.uid(); new.verified_at := now();
  end if;
  -- stopping a running entry: anyone on the site
  if old.end_at is null and new.end_at is not null and new.start_at is not distinct from old.start_at and new.voided_at is not distinct from old.voided_at then
    if new.end_at > now() + interval '5 minutes' then raise exception 'The end time is in the future.'; end if;
    if new.end_at - new.start_at > interval '24 hours' then raise exception 'One entry cannot be longer than 24 hours: correct the start time.'; end if;
    return new;
  end if;
  if times_changed or new.voided_at is distinct from old.voided_at or new.breakdown is distinct from old.breakdown or new.note is distinct from old.note then
    if not (r in ('site_engineer','staff','admin') or (r = 'supervisor' and own)) then raise exception 'A Supervisor can correct their own entry for 24 hours. Ask the Site Engineer.'; end if;
    if times_changed then
      new.verified_by := null; new.verified_at := null;
      if new.start_at > now() + interval '5 minutes' or (new.end_at is not null and new.end_at > now() + interval '5 minutes') then raise exception 'A time is in the future.'; end if;
      if new.end_at is not null and new.end_at - new.start_at > interval '24 hours' then raise exception 'One entry cannot be longer than 24 hours.'; end if;
      new.work_date := (new.start_at at time zone 'Asia/Kolkata')::date;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists equipment_log_guard_trg on public.equipment_logs;
create trigger equipment_log_guard_trg before insert or update on public.equipment_logs for each row execute function public.equipment_log_guard();

-- ---------- 8. paying a gas / equipment bill posts an expense to the project ----------
create or replace function public.post_site_payment_expense() returns trigger language plpgsql security definer set search_path = public as $$
declare cat uuid; cname text; who text;
begin
  if to_regclass('public.project_expenses') is null then return new; end if;
  cname := case new.kind when 'gas' then 'Gas' else 'Equipment hire' end;
  if tg_op = 'UPDATE' then
    if new.voided_at is not null and old.voided_at is null then perform set_config('app.posting', '1', true); delete from public.project_expenses where source = 'site_payment' and source_id = new.id; perform set_config('app.posting', '', true);
    elsif new.voided_at is null then update public.project_expenses set bill_path = new.bill_path where source = 'site_payment' and source_id = new.id; end if;
    return new;
  end if;
  select id into cat from public.expense_categories where lower(btrim(name)) = lower(cname) limit 1;
  if cat is null then insert into public.expense_categories (name) values (cname) returning id into cat; end if;
  select name into who from public.gas_vendors where id = new.vendor_id;
  insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by, bill_path)
  values (new.project_id, cat, new.paid_on, new.amount, cname || ' · ' || coalesce(who, '') || coalesce(' · ' || nullif(btrim(new.reference), ''), ''), 'site_payment', new.id, auth.uid(), new.bill_path);
  return new;
end $$;
drop trigger if exists site_payment_post_trg on public.site_payments;
create trigger site_payment_post_trg after insert or update on public.site_payments for each row execute function public.post_site_payment_expense();
