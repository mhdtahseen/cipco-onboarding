-- Accommodation: rooms rented for a project, rent paid a full month in advance, capacity in beds, and rent payments that post an Accommodation expense.
-- Run AFTER 2026-10-attendance-accountability-transport.sql (it defines the payment functions these triggers use). Safe to run more than once.

-- Rooms belong to a project. Rent is paid a full month in advance and can change over time (a new rent applies from a date, like prices).
-- Capacity (beds) is tracked so the page can show whether the rooms hold the people on the project, or more rooms are needed.
-- The landlord (who is paid) is a free-text name per room. Rent payments post an Accommodation expense on the project.
create table if not exists public.accommodation_rooms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  room_type text not null default 'non_ac' check (room_type in ('ac','non_ac')),
  capacity int not null default 0 check (capacity >= 0),    -- beds; 0 = not set yet
  landlord text not null default '',
  rented_from date not null default current_date,
  vacated_on date,                                         -- the last month billed is the month of this date
  notes text not null default '',
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create unique index if not exists accommodation_rooms_name_uq on public.accommodation_rooms (project_id, lower(btrim(name)));
create table if not exists public.accommodation_rents (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.accommodation_rooms(id) on delete cascade,
  rent numeric(10,2) not null check (rent >= 0),
  effective_from date not null default current_date,
  unique (room_id, effective_from)
);
create table if not exists public.accommodation_payments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.accommodation_rooms(id),
  project_id uuid references public.projects(id),          -- taken from the room's project
  for_month date,                                          -- the first day of the month this rent is for (blank = a general payment)
  paid_on date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  reference text not null default '',
  note text not null default '',
  voided_at timestamptz, voided_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.accommodation_rooms enable row level security;
alter table public.accommodation_rents enable row level security;
alter table public.accommodation_payments enable row level security;
do $$ declare t text; begin
  foreach t in array array['accommodation_rooms','accommodation_rents','accommodation_payments'] loop
    execute format('drop policy if exists "staff all" on public.%I', t);
    execute format('create policy "staff all" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;
drop trigger if exists accommodation_payment_guard_trg on public.accommodation_payments;
create trigger accommodation_payment_guard_trg before insert or update or delete on public.accommodation_payments for each row execute function public.transport_money_guard();

-- One payment can cover several rooms (for example all the non-AC rooms): one row per room, sharing a batch_id, one reference and one date.
alter table public.accommodation_payments add column if not exists batch_id uuid;
alter table public.accommodation_payments add column if not exists bill_path text;   -- optional bill / receipt (R2), shown on the project's expense
create index if not exists accommodation_payments_batch_idx on public.accommodation_payments (batch_id) where batch_id is not null;

-- Posting to the project's expenses: a payment of one room posts its own expense; a batch posts ONE expense naming its rooms, kept equal to what is
-- not voided in the batch (voiding a room's row lowers it; voiding them all removes it).
create or replace function public.post_room_payment_expense() returns trigger language plpgsql security definer set search_path = public as $$
declare cat uuid; who text; total numeric; last_paid date; rooms text; ref text; mo date; pid uuid; bill text;
begin
  if to_regclass('public.project_expenses') is null then return new; end if;
  select id into cat from public.expense_categories where lower(btrim(name)) = 'accommodation' limit 1;
  if new.batch_id is null then
    if tg_op = 'UPDATE' then
      if new.voided_at is not null and old.voided_at is null then perform set_config('app.posting', '1', true); delete from public.project_expenses where source = 'room_payment' and source_id = new.id; perform set_config('app.posting', '', true);
      elsif new.voided_at is null then update public.project_expenses set bill_path = new.bill_path where source = 'room_payment' and source_id = new.id; end if;
      return new;
    end if;
    if cat is null then insert into public.expense_categories (name) values ('Accommodation') returning id into cat; end if;
    select name || coalesce(' · ' || nullif(btrim(landlord), ''), '') into who from public.accommodation_rooms where id = new.room_id;
    insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by, bill_path)
    values (new.project_id, cat, new.paid_on, new.amount, 'Rent' || coalesce(' (' || to_char(new.for_month, 'Mon YYYY') || ')', '') || ' · ' || coalesce(who, '') || coalesce(' · ' || nullif(btrim(new.reference), ''), ''), 'room_payment', new.id, auth.uid(), new.bill_path);
    return new;
  end if;
  -- a batch: recompute its single expense from the rows that are still live
  select coalesce(sum(p.amount), 0), max(p.paid_on), string_agg(r.name, ', ' order by r.name), min(p.for_month), max(p.reference), (array_agg(p.project_id))[1], (array_agg(p.bill_path) filter (where p.bill_path is not null))[1]
    into total, last_paid, rooms, mo, ref, pid, bill
    from public.accommodation_payments p join public.accommodation_rooms r on r.id = p.room_id where p.batch_id = new.batch_id and p.voided_at is null;
  perform set_config('app.posting', '1', true);
  if total <= 0 then delete from public.project_expenses where source = 'room_payment' and source_id = new.batch_id;
  else
    if cat is null then insert into public.expense_categories (name) values ('Accommodation') returning id into cat; end if;
    insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by, bill_path)
    values (pid, cat, last_paid, total, 'Rent' || coalesce(' (' || to_char(mo, 'Mon YYYY') || ')', '') || ' · ' || rooms || coalesce(' · ' || nullif(btrim(ref), ''), ''), 'room_payment', new.batch_id, auth.uid(), bill)
    on conflict (source, source_id) where source is not null do update set amount = excluded.amount, expense_date = excluded.expense_date, description = excluded.description, bill_path = excluded.bill_path;
  end if;
  perform set_config('app.posting', '', true);
  return new;
end $$;

drop trigger if exists accommodation_payment_post_trg on public.accommodation_payments;
create trigger accommodation_payment_post_trg after insert or update on public.accommodation_payments for each row execute function public.post_room_payment_expense();
