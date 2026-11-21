-- Deposits (Expenses → Deposits): money handed over that is meant to come back (a water connection, an electricity meter, a rented item, a cylinder).
-- A deposit is held money, NEVER an expense, so it is not in Spent while it is held. Only what the other side KEEPS is a real cost: that is posted to Spent
-- (category "Deposits kept back") automatically, so it shows in cost figures.
--  - public.deposits: the deposits entered by hand (anything that is not a rented item or a gas cylinder, which already have their own deposit records).
--    Paid → held; then refunded (amount, date) and/or kept back (amount). Held = paid - refunded - kept back. Void to remove.
--  - Rented items' kept-back deduction (rental_terms.deduction) is posted to Spent the same way.
-- Operations and Admin only. Safe to run more than once. Run AFTER 2026-11-rentals.sql.
create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  holder text not null,                                     -- who holds it: "Mundra water supply", "Electricity board"…
  purpose text not null default '',                         -- what it is for: "Water connection deposit"
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default current_date,
  reference text not null default '',                       -- receipt / UTR
  bill_path text,                                           -- the receipt in R2
  refunded_amount numeric(12,2) not null default 0 check (refunded_amount >= 0),
  refunded_on date,
  kept_amount numeric(12,2) not null default 0 check (kept_amount >= 0),   -- kept back by the holder: a real cost
  kept_note text not null default '',
  note text not null default '',
  voided_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposits_settled_within check (refunded_amount + kept_amount <= amount)
);
create index if not exists deposits_project_idx on public.deposits (project_id, paid_on);
alter table public.deposits enable row level security;
drop policy if exists "deposits staff" on public.deposits;
create policy "deposits staff" on public.deposits for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- the category the kept-back money is booked under
insert into public.expense_categories (name, sort_order) select 'Deposits kept back', 95 where not exists (select 1 from public.expense_categories where lower(btrim(name)) = 'deposits kept back');

-- keep the Spent entry in step with what is kept back (one entry per deposit, replaced whenever it changes)
create or replace function public.post_deposit_kept() returns trigger language plpgsql security definer set search_path = public as $$
declare cat uuid;
begin
  select id into cat from public.expense_categories where lower(btrim(name)) = 'deposits kept back' limit 1;
  perform set_config('app.posting', '1', true);
  delete from public.project_expenses where source = 'deposit' and source_id = new.id;
  if new.voided_at is null and new.kept_amount > 0 and cat is not null then
    insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by)
    values (new.project_id, cat, coalesce(new.refunded_on, (now() at time zone 'Asia/Kolkata')::date), new.kept_amount,
            'Deposit kept back · ' || new.holder || coalesce(' · ' || nullif(btrim(new.purpose), ''), '') || coalesce(' · ' || nullif(btrim(new.kept_note), ''), ''), 'deposit', new.id, auth.uid());
  end if;
  perform set_config('app.posting', '', true);
  return new;
end $$;
drop trigger if exists deposit_kept_trg on public.deposits;
create trigger deposit_kept_trg after insert or update on public.deposits for each row execute function public.post_deposit_kept();

-- a rented item's deposit kept back for missing or damaged items is a cost too
create or replace function public.post_rental_deduction() returns trigger language plpgsql security definer set search_path = public as $$
declare cat uuid; r public.rentals; who text;
begin
  select * into r from public.rentals where id = new.rental_id; if r.id is null then return new; end if;
  select id into cat from public.expense_categories where lower(btrim(name)) = 'deposits kept back' limit 1;
  select name into who from public.gas_vendors where id = r.vendor_id;
  perform set_config('app.posting', '1', true);
  delete from public.project_expenses where source = 'rental_deposit' and source_id = new.rental_id;
  if r.voided_at is null and new.deduction > 0 and cat is not null then
    insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by)
    values (r.project_id, cat, coalesce(new.refund_on, r.returned_on, (now() at time zone 'Asia/Kolkata')::date), new.deduction,
            'Rental deposit kept back · ' || coalesce(who, '') || coalesce(' · ' || nullif(btrim(new.deduction_note), ''), ''), 'rental_deposit', new.rental_id, auth.uid());
  end if;
  perform set_config('app.posting', '', true);
  return new;
end $$;
drop trigger if exists rental_deduction_trg on public.rental_terms;
create trigger rental_deduction_trg after insert or update of deduction, deduction_note, refund_on on public.rental_terms for each row execute function public.post_rental_deduction();

-- voiding a rental takes its kept-back cost out again (and un-voiding puts it back)
create or replace function public.rental_deduction_resync() returns trigger language plpgsql security definer set search_path = public as $$
begin update public.rental_terms set deduction = deduction where rental_id = new.id; return new; end $$;
drop trigger if exists rental_deduction_void_trg on public.rentals;
create trigger rental_deduction_void_trg after update of voided_at on public.rentals for each row execute function public.rental_deduction_resync();

-- deductions already recorded before this migration
update public.rental_terms set deduction = deduction where deduction > 0;
