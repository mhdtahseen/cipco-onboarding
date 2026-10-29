-- Invoicing: clients, work orders (with a bill of quantities), running-account invoices and the receipts against them.
-- Admin only (money). Safe to run again. Run it AFTER 2026-10-roles-attendance.sql (is_admin), 2026-10-projects-departments.sql (projects)
-- and 2026-10-quotations.sql (ref_counters).
--
-- How it fits together
--   clients            who we bill (legal name, address, GSTIN, state)
--   work_orders        the client's order for a project: rates, GST, retention %, TDS %, payment days; its lines are the bill of quantities
--   invoices           one running-account (RA) bill per row. Draft until issued; issuing gives the next number of the financial year.
--                      An issued invoice is never edited or deleted: cancel it (with a reason) or raise a credit note.
--   invoice_items      the lines of a bill: quantity billed earlier, to date and in this bill, at the work order's rate
--   invoice_receipts   money received against an invoice, with the TDS the client deducted. Never edited or deleted: void and re-enter.

-- ── clients ──
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  address text,
  state_code text not null default '27',            -- GST state code (27 = Maharashtra)
  gstin text,
  pan text,
  contact_person text,
  email text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint clients_gstin_format check (gstin is null or gstin = '' or upper(gstin) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
);
create unique index if not exists clients_gstin_uq on public.clients (upper(gstin)) where gstin is not null and gstin <> '';

-- ── work orders and their bill of quantities ──
create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  project_id uuid references public.projects(id),
  wo_no text not null,                              -- the client's PO / work order number
  wo_date date,
  title text not null,
  sac text not null default '9954',
  gst_rate numeric(5,2) not null default 18 check (gst_rate >= 0 and gst_rate <= 40),
  retention_pct numeric(5,2) not null default 0 check (retention_pct >= 0 and retention_pct < 100),
  tds_pct numeric(5,2) not null default 1 check (tds_pct >= 0 and tds_pct < 100),
  payment_days int not null default 45 check (payment_days between 0 and 365),
  status text not null default 'active' check (status in ('active', 'completed', 'closed')),
  notes text,
  created_at timestamptz not null default now(),
  unique (client_id, wo_no)
);
create table if not exists public.work_order_items (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  sort int not null default 0,
  description text not null,
  unit text not null default 'Nos',
  qty numeric(14,3) not null check (qty >= 0),
  rate numeric(14,2) not null check (rate >= 0)
);
create index if not exists work_order_items_wo on public.work_order_items (work_order_id, sort);

-- ── invoices ──
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text unique,                           -- set when issued; never typed in
  work_order_id uuid not null references public.work_orders(id),
  client_id uuid not null references public.clients(id),
  project_id uuid references public.projects(id),
  bill_no int not null,                             -- running bill number within the work order
  status text not null default 'draft' check (status in ('draft', 'issued', 'cancelled')),
  invoice_date date not null default current_date,
  period_from date,
  period_to date,
  due_date date,
  sac text not null default '9954',
  gst_rate numeric(5,2) not null default 18,
  place_of_supply_code text not null default '27',
  taxable numeric(14,2) not null default 0,
  cgst numeric(14,2) not null default 0,
  sgst numeric(14,2) not null default 0,
  igst numeric(14,2) not null default 0,
  round_off numeric(6,2) not null default 0,
  total numeric(14,2) not null default 0,
  retention_pct numeric(5,2) not null default 0,
  retention numeric(14,2) not null default 0,       -- held back from payment now, released later (GST is on the full amount)
  other_deduction numeric(14,2) not null default 0, -- agreed back-charges, advance recovery…
  other_deduction_note text,
  payable numeric(14,2) not null default 0,         -- total less retention and other deductions
  tds_pct numeric(5,2) not null default 0,          -- what the client is expected to deduct at payment (information only)
  notes text,
  issued_at timestamptz,
  issued_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists invoices_wo_bill_uq on public.invoices (work_order_id, bill_no) where status <> 'cancelled';
create index if not exists invoices_client on public.invoices (client_id, invoice_date);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  work_order_item_id uuid references public.work_order_items(id),   -- null for extra work that is not in the order
  sort int not null default 0,
  description text not null,
  unit text not null default 'Nos',
  rate numeric(14,2) not null check (rate >= 0),
  prev_qty numeric(14,3) not null default 0,        -- billed in earlier bills
  cum_qty numeric(14,3) not null default 0,         -- done to date, including this bill
  qty numeric(14,3) not null default 0,             -- this bill = to date less earlier
  amount numeric(14,2) not null default 0
);
create index if not exists invoice_items_inv on public.invoice_items (invoice_id, sort);
create index if not exists invoice_items_woi on public.invoice_items (work_order_item_id);

create table if not exists public.invoice_receipts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  received_on date not null default current_date,
  amount numeric(14,2) not null default 0 check (amount >= 0),       -- money that reached the bank
  tds_amount numeric(14,2) not null default 0 check (tds_amount >= 0), -- tax the client deducted (we claim it against Form 26AS)
  reference text,
  note text,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint receipt_not_empty check (amount + tds_amount > 0)
);
create index if not exists invoice_receipts_inv on public.invoice_receipts (invoice_id);

-- ── access: Admin only ──
alter table public.clients enable row level security;
alter table public.work_orders enable row level security;
alter table public.work_order_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_receipts enable row level security;
drop policy if exists "admin clients" on public.clients;                 create policy "admin clients" on public.clients for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin work orders" on public.work_orders;         create policy "admin work orders" on public.work_orders for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin work order items" on public.work_order_items; create policy "admin work order items" on public.work_order_items for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin invoices" on public.invoices;               create policy "admin invoices" on public.invoices for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin invoice items" on public.invoice_items;     create policy "admin invoice items" on public.invoice_items for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin invoice receipts" on public.invoice_receipts; create policy "admin invoice receipts" on public.invoice_receipts for all using (public.is_admin()) with check (public.is_admin());

-- ── an issued invoice is frozen ──
create or replace function public.invoice_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare ok boolean := coalesce(current_setting('app.invoicing', true), '') = '1';   -- set only inside issue_invoice / cancel_invoice
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'An issued invoice cannot be deleted. Cancel it instead.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.invoice_no := null; new.issued_at := null; new.issued_by := null; new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
    new.created_by := auth.uid(); return new;
  end if;
  new.updated_at := now();
  if old.status = 'draft' then
    if new.status = 'draft' then new.invoice_no := old.invoice_no; return new; end if;
    if new.status = 'issued' and ok then return new; end if;
    raise exception 'Use Issue to finalise an invoice.';
  end if;
  if old.status = 'issued' then
    if new.status = 'cancelled' and ok then
      if (to_jsonb(new) - 'status' - 'cancelled_at' - 'cancelled_by' - 'cancel_reason' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'cancelled_at' - 'cancelled_by' - 'cancel_reason' - 'updated_at') then
        raise exception 'An issued invoice cannot be edited.';
      end if;
      return new;
    end if;
    raise exception 'An issued invoice cannot be edited. Cancel it and raise a new one, or use a credit note.';
  end if;
  raise exception 'A cancelled invoice cannot be changed.';
end $$;
drop trigger if exists invoice_guard_trg on public.invoices;
create trigger invoice_guard_trg before insert or update or delete on public.invoices for each row execute function public.invoice_guard();

create or replace function public.invoice_item_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if tg_op = 'DELETE' and st is null then return old; end if;     -- the whole draft invoice is being deleted
  if st is distinct from 'draft' then raise exception 'This invoice is issued. Its items cannot be changed.'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists invoice_item_guard_trg on public.invoice_items;
create trigger invoice_item_guard_trg before insert or update or delete on public.invoice_items for each row execute function public.invoice_item_guard();

create or replace function public.invoice_receipt_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare st text; tot numeric; settled numeric;
begin
  if tg_op = 'DELETE' then raise exception 'A receipt is never deleted. Void it and enter the right one.'; end if;
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'voided_at' - 'voided_by' is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' then raise exception 'A receipt cannot be edited. Void it and enter the right one.'; end if;
    if old.voided_at is not null then raise exception 'This receipt is already voided.'; end if;
    if new.voided_at is not null then new.voided_by := auth.uid(); end if;
    return new;
  end if;
  select status, total into st, tot from public.invoices where id = new.invoice_id;
  if st is distinct from 'issued' then raise exception 'Receipts can only be recorded against an issued invoice.'; end if;
  select coalesce(sum(amount + tds_amount), 0) into settled from public.invoice_receipts where invoice_id = new.invoice_id and voided_at is null;
  if settled + new.amount + new.tds_amount > tot + 0.5 then raise exception 'This is more than what is still outstanding on the invoice.'; end if;
  new.created_by := auth.uid(); new.voided_at := null; new.voided_by := null; return new;
end $$;
drop trigger if exists invoice_receipt_guard_trg on public.invoice_receipts;
create trigger invoice_receipt_guard_trg before insert or update or delete on public.invoice_receipts for each row execute function public.invoice_receipt_guard();

-- ── issue: the next number of the financial year (April to March), no gaps, never typed by hand ──
create or replace function public.issue_invoice(p_id uuid) returns text language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype; fy int; n int; no text;
begin
  if not public.is_admin() then raise exception 'Only an Admin can issue invoices.'; end if;
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found.'; end if;
  if inv.status <> 'draft' then raise exception 'This invoice is already issued.'; end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_id and amount > 0) then raise exception 'Add at least one item with an amount to bill.'; end if;
  if inv.total <= 0 then raise exception 'The invoice total must be above zero.'; end if;
  fy := case when extract(month from inv.invoice_date) >= 4 then extract(year from inv.invoice_date)::int else extract(year from inv.invoice_date)::int - 1 end;
  insert into public.ref_counters(kind, year, last) values ('invoice', fy, 1) on conflict (kind, year) do update set last = public.ref_counters.last + 1 returning last into n;
  no := 'CIPCO/' || lpad((fy % 100)::text, 2, '0') || '-' || lpad(((fy + 1) % 100)::text, 2, '0') || '/' || lpad(n::text, 3, '0');
  perform set_config('app.invoicing', '1', true);
  update public.invoices set status = 'issued', invoice_no = no, issued_at = now(), issued_by = auth.uid() where id = p_id;
  perform set_config('app.invoicing', '', true);
  return no;
end $$;

-- ── cancel: keeps the number in the register as cancelled ──
create or replace function public.cancel_invoice(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare inv public.invoices%rowtype;
begin
  if not public.is_admin() then raise exception 'Only an Admin can cancel invoices.'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give the reason for cancelling.'; end if;
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found.'; end if;
  if inv.status <> 'issued' then raise exception 'Only an issued invoice can be cancelled.'; end if;
  if exists (select 1 from public.invoice_receipts where invoice_id = p_id and voided_at is null) then raise exception 'Void the receipts recorded against this invoice first.'; end if;
  perform set_config('app.invoicing', '1', true);
  update public.invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason) where id = p_id;
  perform set_config('app.invoicing', '', true);
end $$;
