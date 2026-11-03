-- Gas cylinders: vendors, orders, deliveries and returns, and the cylinders held at each site (phase 1). Safe to run more than once.
--
-- Two halves, kept in SEPARATE tables on purpose:
--   * quantities (vendors, products, orders, deliveries, returns, serial numbers): Supervisors and Site Engineers read these for their own sites
--   * money (rates, terms, the rates locked onto an approved order): Operations (the role stored as 'staff') and Admin only
-- A row-level rule cannot hide ONE column, so a price never shares a table with anything a Supervisor or Site Engineer can read.
--
-- Who may do what:
--   Supervisor      record deliveries, returns, lost / damaged cylinders and serial numbers on their sites; see orders (no prices)
--   Site Engineer   the same, and raise an order (edit or cancel it until it is approved)
--   Operations      everything above for every site, approve / reject orders, set up vendors, products, rates and terms
--   Admin           everything
-- Run AFTER 2026-10-attendance-accountability-transport.sql (it defines can_attend, app_role, is_staff).

-- ---------- vendors and products (read by every signed-in role, written by Operations / Admin) ----------
create table if not exists public.gas_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text not null default '',
  phone text not null default '',
  gstin text not null default '',
  notice_hours int not null default 24,                -- the vendor wants this much notice before a delivery
  free_delivery_min int not null default 50,           -- delivery is free from this many cylinders in one order
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.gas_products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.gas_vendors(id) on delete cascade,
  name text not null,                                  -- e.g. Industrial oxygen, Commercial LPG
  capacity text not null default '',                   -- e.g. 7 m3, 19 kg
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.gas_project_vendors (   -- which vendor(s) supply which project
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor_id uuid not null references public.gas_vendors(id) on delete cascade,
  primary key (project_id, vendor_id)
);

-- ---------- orders (quantities only) ----------
create sequence if not exists public.gas_order_seq;
create table if not exists public.gas_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique default ('GAS-' || lpad(nextval('public.gas_order_seq')::text, 4, '0')),
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor_id uuid not null references public.gas_vendors(id),
  status text not null default 'requested' check (status in ('requested','approved','rejected','sent','partly_delivered','delivered','closed','cancelled')),
  needed_by date,
  note text not null default '',
  requested_by uuid default auth.uid(),
  requested_role text,
  decided_by uuid,
  decided_at timestamptz,
  reject_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gas_orders_project on public.gas_orders (project_id, created_at desc);
create table if not exists public.gas_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.gas_orders(id) on delete cascade,
  product_id uuid not null references public.gas_products(id),
  qty int not null check (qty > 0)
);
create index if not exists gas_order_lines_order on public.gas_order_lines (order_id);

-- ---------- deliveries, returns, lost and damaged (quantities only) ----------
create table if not exists public.gas_movements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor_id uuid not null references public.gas_vendors(id),
  product_id uuid not null references public.gas_products(id),
  order_id uuid references public.gas_orders(id) on delete set null,
  kind text not null check (kind in ('delivery','return','lost','damaged')),
  qty int not null check (qty > 0),
  moved_on date not null default (now() at time zone 'Asia/Kolkata')::date,
  challan_no text not null default '',
  photo_path text,
  note text not null default '',
  entered_by uuid default auth.uid(),
  entered_role text,
  created_at timestamptz not null default now(),
  voided_at timestamptz
);
create index if not exists gas_movements_project on public.gas_movements (project_id, moved_on desc);
create table if not exists public.gas_movement_serials (   -- optional: the cylinder numbers on a delivery or return
  movement_id uuid not null references public.gas_movements(id) on delete cascade,
  serial text not null,
  primary key (movement_id, serial)
);

-- ---------- money: Operations and Admin only ----------
create table if not exists public.gas_rates (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.gas_products(id) on delete cascade,
  rate numeric(12,2) not null check (rate >= 0),       -- per cylinder, before GST
  gst_pct numeric(5,2) not null default 18,
  valid_from date not null default (now() at time zone 'Asia/Kolkata')::date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists gas_rates_product on public.gas_rates (product_id, valid_from desc);
create table if not exists public.gas_terms (
  vendor_id uuid primary key references public.gas_vendors(id) on delete cascade,
  deposit_per_cylinder numeric(12,2) not null default 0,       -- refundable; held by the vendor
  rent_per_day numeric(12,2) not null default 0,                -- when a cylinder is not rotated enough in a month
  rotations_per_month int not null default 4,                   -- kept for the rotation rule (not calculated yet)
  post_project_rent_per_day numeric(12,2) not null default 0,   -- once the project is over and cylinders are not returned in time
  return_grace_days int not null default 15,
  loss_charge_per_cylinder numeric(12,2) not null default 0,
  due_day_first_half int not null default 25,                   -- bills dated the 1st to the 15th are due on this day of the same month
  due_day_second_half int not null default 10,                  -- bills dated the 16th onwards are due on this day of the next month
  terms_note text not null default '',                          -- printed on the order (the PO)
  updated_at timestamptz not null default now()
);
create table if not exists public.gas_order_pricing (          -- the rate in force when the order was approved, per line
  line_id uuid primary key references public.gas_order_lines(id) on delete cascade,
  rate numeric(12,2) not null,
  gst_pct numeric(5,2) not null
);

-- ---------- row-level security ----------
alter table public.gas_vendors enable row level security;
alter table public.gas_products enable row level security;
alter table public.gas_project_vendors enable row level security;
alter table public.gas_orders enable row level security;
alter table public.gas_order_lines enable row level security;
alter table public.gas_movements enable row level security;
alter table public.gas_movement_serials enable row level security;
alter table public.gas_rates enable row level security;
alter table public.gas_terms enable row level security;
alter table public.gas_order_pricing enable row level security;

do $$ declare t text; begin
  foreach t in array array['gas_vendors','gas_products','gas_project_vendors','gas_orders','gas_order_lines','gas_movements','gas_movement_serials','gas_rates','gas_terms','gas_order_pricing'] loop
    execute format('drop policy if exists %I on public.%I', t || ' read', t);
    execute format('drop policy if exists %I on public.%I', t || ' write', t);
    execute format('drop policy if exists %I on public.%I', t || ' ins', t);
    execute format('drop policy if exists %I on public.%I', t || ' upd', t);
    execute format('drop policy if exists %I on public.%I', t || ' del', t);
  end loop;
end $$;

-- setup: anyone with a role reads, Operations / Admin write
create policy "gas_vendors read" on public.gas_vendors for select to authenticated using (public.app_role() is not null and public.app_role() <> 'none');
create policy "gas_vendors write" on public.gas_vendors for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "gas_products read" on public.gas_products for select to authenticated using (public.app_role() is not null and public.app_role() <> 'none');
create policy "gas_products write" on public.gas_products for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "gas_project_vendors read" on public.gas_project_vendors for select to authenticated using (public.can_attend(project_id));
create policy "gas_project_vendors write" on public.gas_project_vendors for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- orders: read on your own sites; raise as Site Engineer / Operations / Admin; the guard trigger below enforces who may change what and when
create policy "gas_orders read" on public.gas_orders for select to authenticated using (public.can_attend(project_id));
create policy "gas_orders ins" on public.gas_orders for insert to authenticated with check (public.app_role() in ('site_engineer','staff','admin') and public.can_attend(project_id));
create policy "gas_orders upd" on public.gas_orders for update to authenticated using (public.can_attend(project_id) and public.app_role() in ('site_engineer','staff','admin')) with check (public.can_attend(project_id));
create policy "gas_orders del" on public.gas_orders for delete to authenticated using (public.is_admin());

create policy "gas_order_lines read" on public.gas_order_lines for select to authenticated using (exists (select 1 from public.gas_orders o where o.id = order_id and public.can_attend(o.project_id)));
create policy "gas_order_lines ins" on public.gas_order_lines for insert to authenticated with check (exists (select 1 from public.gas_orders o where o.id = order_id and public.can_attend(o.project_id)
  and o.status = 'requested' and (o.requested_by = auth.uid() or public.is_staff())));
create policy "gas_order_lines upd" on public.gas_order_lines for update to authenticated using (exists (select 1 from public.gas_orders o where o.id = order_id and public.can_attend(o.project_id)
  and o.status = 'requested' and (o.requested_by = auth.uid() or public.is_staff())));
create policy "gas_order_lines del" on public.gas_order_lines for delete to authenticated using (exists (select 1 from public.gas_orders o where o.id = order_id and public.can_attend(o.project_id)
  and o.status = 'requested' and (o.requested_by = auth.uid() or public.is_staff())));

-- movements: every site role records on their own sites; corrections are controlled by the trigger
create policy "gas_movements read" on public.gas_movements for select to authenticated using (public.can_attend(project_id));
create policy "gas_movements ins" on public.gas_movements for insert to authenticated with check (public.app_role() in ('supervisor','site_engineer','staff','admin') and public.can_attend(project_id));
create policy "gas_movements upd" on public.gas_movements for update to authenticated using (public.can_attend(project_id)) with check (public.can_attend(project_id));
create policy "gas_movements del" on public.gas_movements for delete to authenticated using (public.is_admin());
create policy "gas_movement_serials read" on public.gas_movement_serials for select to authenticated using (exists (select 1 from public.gas_movements m where m.id = movement_id and public.can_attend(m.project_id)));
create policy "gas_movement_serials ins" on public.gas_movement_serials for insert to authenticated with check (exists (select 1 from public.gas_movements m where m.id = movement_id and public.can_attend(m.project_id) and m.voided_at is null));
create policy "gas_movement_serials del" on public.gas_movement_serials for delete to authenticated using (exists (select 1 from public.gas_movements m where m.id = movement_id and public.can_attend(m.project_id)));

-- money: Operations and Admin only (a Supervisor or Site Engineer gets no rows, not even the column names' values)
create policy "gas_rates write" on public.gas_rates for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "gas_terms write" on public.gas_terms for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "gas_order_pricing write" on public.gas_order_pricing for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- guards ----------
-- Orders: who may move an order to which status.
create or replace function public.gas_order_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.app_role();
begin
  if tg_op = 'INSERT' then
    new.status := 'requested'; new.requested_by := auth.uid(); new.requested_role := r; new.decided_by := null; new.decided_at := null; new.reject_reason := '';
    if not exists (select 1 from public.gas_project_vendors pv where pv.project_id = new.project_id and pv.vendor_id = new.vendor_id) then
      raise exception 'That vendor is not set up for this project.'; end if;
    return new;
  end if;
  new.updated_at := now();
  if r in ('staff','admin') then
    if new.status is distinct from old.status then
      if new.status in ('approved','rejected') then new.decided_by := auth.uid(); new.decided_at := now(); end if;
      if new.status = 'rejected' and btrim(coalesce(new.reject_reason, '')) = '' then raise exception 'Say why the order is rejected.'; end if;
    end if;
    return new;
  end if;
  -- a Site Engineer: only their own order, only while it is still a request, and only to edit it or cancel it
  if r = 'site_engineer' and old.status = 'requested' and old.requested_by = auth.uid() and new.status in ('requested','cancelled')
     and new.project_id = old.project_id and new.vendor_id = old.vendor_id then
    new.requested_by := old.requested_by; new.requested_role := old.requested_role; new.decided_by := old.decided_by; new.decided_at := old.decided_at; new.reject_reason := old.reject_reason;
    return new;
  end if;
  raise exception 'You can only change your own order, and only until it is approved.';
end $$;
drop trigger if exists gas_order_guard_trg on public.gas_orders;
create trigger gas_order_guard_trg before insert or update on public.gas_orders for each row execute function public.gas_order_guard();

-- When an order is approved, lock the rate in force that day onto each line. Needs a rate for every product on the order.
create or replace function public.gas_lock_rates() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; rt record; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    for l in select ol.id, ol.product_id, p.name from public.gas_order_lines ol join public.gas_products p on p.id = ol.product_id where ol.order_id = new.id loop
      select r.rate, r.gst_pct into rt from public.gas_rates r where r.product_id = l.product_id and r.valid_from <= today order by r.valid_from desc, r.created_at desc limit 1;
      if not found then raise exception 'No rate is set for % yet. Add it under Rates & terms, then approve.', l.name; end if;
      insert into public.gas_order_pricing (line_id, rate, gst_pct) values (l.id, rt.rate, rt.gst_pct) on conflict (line_id) do update set rate = excluded.rate, gst_pct = excluded.gst_pct;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists gas_lock_rates_trg on public.gas_orders;
create trigger gas_lock_rates_trg after update on public.gas_orders for each row execute function public.gas_lock_rates();

-- Deliveries, returns, lost / damaged: stamp who and in what role; a return cannot be more than is at site; corrections are limited.
create or replace function public.gas_movement_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.app_role(); held int;
begin
  if tg_op = 'INSERT' then
    new.entered_by := auth.uid(); new.entered_role := r; new.voided_at := null;
    if new.kind in ('return','lost','damaged') then
      select coalesce(sum(case when kind = 'delivery' then qty else -qty end), 0) into held from public.gas_movements
        where project_id = new.project_id and vendor_id = new.vendor_id and product_id = new.product_id and voided_at is null;
      if new.qty > held then raise exception 'Only % of these cylinders are at this site, so % cannot be entered.', held, new.qty; end if;
    end if;
    return new;
  end if;
  -- an update: the only things that change are the note / challan / photo and voiding; the quantity and kind are fixed once saved
  if new.project_id is distinct from old.project_id or new.vendor_id is distinct from old.vendor_id or new.product_id is distinct from old.product_id
     or new.kind is distinct from old.kind or new.qty is distinct from old.qty or new.entered_by is distinct from old.entered_by then
    raise exception 'A saved entry cannot change its cylinders or quantity: void it and enter it again.'; end if;
  if r in ('staff','admin','site_engineer') then return new; end if;
  -- a Supervisor: their own entry, within 24 hours
  if r = 'supervisor' and old.entered_by = auth.uid() and now() - old.created_at < interval '24 hours' then return new; end if;
  raise exception 'A Supervisor can correct their own entry for 24 hours. Ask the Site Engineer.';
end $$;
drop trigger if exists gas_movement_guard_trg on public.gas_movements;
create trigger gas_movement_guard_trg before insert or update on public.gas_movements for each row execute function public.gas_movement_guard();

-- An order moves to partly delivered / delivered as deliveries are recorded against it.
create or replace function public.gas_order_progress() returns trigger language plpgsql security definer set search_path = public as $$
declare oid uuid := coalesce(new.order_id, old.order_id); ordered int; got int; st text;
begin
  if oid is null then return null; end if;
  select status into st from public.gas_orders where id = oid;
  if st not in ('approved','sent','partly_delivered','delivered') then return null; end if;
  select coalesce(sum(qty), 0) into ordered from public.gas_order_lines where order_id = oid;
  select coalesce(sum(qty), 0) into got from public.gas_movements where order_id = oid and kind = 'delivery' and voided_at is null;
  update public.gas_orders set status = case when got = 0 then (case when st = 'delivered' or st = 'partly_delivered' then 'sent' else st end) when got >= ordered then 'delivered' else 'partly_delivered' end where id = oid;
  return null;
end $$;
drop trigger if exists gas_order_progress_trg on public.gas_movements;
create trigger gas_order_progress_trg after insert or update on public.gas_movements for each row execute function public.gas_order_progress();

-- Serial numbers can't outnumber the cylinders on the entry.
create or replace function public.gas_serial_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare q int; n int;
begin
  select qty into q from public.gas_movements where id = new.movement_id;
  select count(*) into n from public.gas_movement_serials where movement_id = new.movement_id;
  if n >= q then raise exception 'This entry has % cylinders, so it can carry at most % serial numbers.', q, q; end if;
  new.serial := upper(btrim(new.serial));
  return new;
end $$;
drop trigger if exists gas_serial_guard_trg on public.gas_movement_serials;
create trigger gas_serial_guard_trg before insert on public.gas_movement_serials for each row execute function public.gas_serial_guard();

-- Who to tell about a new order: every Operations and Admin login.
create or replace function public.gas_order_recipients() returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select ur.user_id from public.user_roles ur where ur.role in ('admin','staff') $$;
revoke all on function public.gas_order_recipients() from public, anon;
grant execute on function public.gas_order_recipients() to authenticated;
