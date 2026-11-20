-- Cranes and hired machines: a bill claims the stretches of work it covers, instead of a date range.
-- Why: a bill was only a date range ("covers 1 Nov to 20 Nov"), so a second bill could cover the same work again, and work with no bill never reached
-- Payments due. Now:
--  - equipment_logs.site_bill_id: the bill (or statement) a stretch is on. A stretch can be on one bill only.
--  - site_bills.no_bill: a statement the office makes from the logged hours when the vendor sends no bill. It is approved and paid like a bill.
--  - site_payments.site_bill_id: the bill a payment is for (optional; a payment without one is an advance to the vendor).
--  - equipment_bill_claim(bill, stretches): set which stretches a bill covers (Operations / Admin, while the bill is not approved). The bill's dates follow.
--  - A stretch on an approved bill cannot be corrected or voided until the bill is reopened. Voiding a bill frees its stretches.
-- Gas and rented items keep their date ranges. Existing equipment bills claim the stretches inside their dates, oldest bill first.
-- Safe to run more than once. Run AFTER 2026-11-consumables.sql.

alter table public.site_bills add column if not exists no_bill boolean not null default false;
alter table public.equipment_logs add column if not exists site_bill_id uuid references public.site_bills(id) on delete set null;
alter table public.site_payments add column if not exists site_bill_id uuid references public.site_bills(id) on delete set null;
create index if not exists equipment_logs_bill on public.equipment_logs (site_bill_id) where site_bill_id is not null;
create index if not exists site_payments_bill on public.site_payments (site_bill_id) where site_bill_id is not null;

-- ---------- who may move a stretch on or off a bill, and what an approved bill freezes ----------
create or replace function public.equipment_log_claim_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare st text; vd timestamptz;
begin
  if current_setting('app.eqclaim', true) = '1' then return new; end if;
  if tg_op = 'INSERT' then new.site_bill_id := null; return new; end if;
  if new.site_bill_id is distinct from old.site_bill_id then raise exception 'A stretch is put on a bill from Bills & payments.'; end if;
  if old.site_bill_id is not null then
    select status, voided_at into st, vd from public.site_bills where id = old.site_bill_id;
    if st = 'approved' and vd is null and (new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at or new.voided_at is distinct from old.voided_at or new.work_date is distinct from old.work_date) then
      raise exception 'This stretch is on an approved bill. Reopen the bill under Bills & payments to change it.'; end if;
    if new.voided_at is not null and old.voided_at is null then new.site_bill_id := null; end if;   -- a voided stretch leaves a bill that is not approved
  end if;
  return new;
end $$;
drop trigger if exists equipment_log_claim_guard_trg on public.equipment_logs;
create trigger equipment_log_claim_guard_trg before insert or update on public.equipment_logs for each row execute function public.equipment_log_claim_guard();

-- a voided bill lets go of its stretches
create or replace function public.site_bill_release() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    perform set_config('app.eqclaim', '1', true);
    update public.equipment_logs set site_bill_id = null where site_bill_id = new.id;
    perform set_config('app.eqclaim', '', true);
  end if;
  return new;
end $$;
drop trigger if exists site_bill_release_trg on public.site_bills;
create trigger site_bill_release_trg after update on public.site_bills for each row execute function public.site_bill_release();

-- ---------- put stretches on a bill ----------
-- p_logs: the stretches this bill covers (the whole list: stretches left out come off it). Each must be this vendor's, on this project, stopped,
-- not void, and not on another bill. The bill's dates become the first and last day of its stretches.
create or replace function public.equipment_bill_claim(p_bill uuid, p_logs uuid[]) returns void language plpgsql security definer set search_path = public as $$
declare b public.site_bills; bad int; d1 date; d2 date;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can do this.'; end if;
  select * into b from public.site_bills where id = p_bill for update;
  if b.id is null or b.voided_at is not null then raise exception 'Bill not found.'; end if;
  if b.kind <> 'equipment' then raise exception 'Only equipment bills cover stretches of work.'; end if;
  if b.status = 'approved' then raise exception 'This bill is approved. Reopen it to change what it covers.'; end if;
  p_logs := coalesce(p_logs, '{}');
  select count(*) into bad from public.equipment_logs l where l.id = any (p_logs)
    and (l.project_id <> b.project_id or l.vendor_id <> b.vendor_id or l.end_at is null or l.voided_at is not null or (l.site_bill_id is not null and l.site_bill_id <> p_bill));
  if bad > 0 or (select count(*) from public.equipment_logs where id = any (p_logs)) <> cardinality(p_logs) then
    raise exception 'A stretch cannot go on this bill (another vendor or project, still running, void, or already on another bill). Reload and try again.'; end if;
  perform set_config('app.eqclaim', '1', true);
  update public.equipment_logs set site_bill_id = null where site_bill_id = p_bill and not (id = any (p_logs));
  update public.equipment_logs set site_bill_id = p_bill where id = any (p_logs);
  perform set_config('app.eqclaim', '', true);
  select min(work_date), max(work_date) into d1, d2 from public.equipment_logs where site_bill_id = p_bill;
  if d1 is not null then update public.site_bills set period_from = d1, period_to = d2 where id = p_bill; end if;
end $$;
revoke all on function public.equipment_bill_claim(uuid, uuid[]) from public, anon;
grant execute on function public.equipment_bill_claim(uuid, uuid[]) to authenticated;

-- ---------- existing equipment bills claim the stretches inside their dates, oldest bill first ----------
do $$
declare b record;
begin
  perform set_config('app.eqclaim', '1', true);
  for b in select id, vendor_id, project_id, period_from, period_to from public.site_bills where kind = 'equipment' and voided_at is null order by bill_date, created_at loop
    update public.equipment_logs set site_bill_id = b.id
    where site_bill_id is null and voided_at is null and end_at is not null and vendor_id = b.vendor_id and project_id = b.project_id and work_date between b.period_from and b.period_to;
  end loop;
  perform set_config('app.eqclaim', '', true);
  -- a bill's dates become those of the work it now covers (a bill dated "1 to 20 Nov" that only covers 20 Nov says 20 Nov)
  update public.site_bills s set period_from = x.d1, period_to = x.d2
  from (select site_bill_id, min(work_date) d1, max(work_date) d2 from public.equipment_logs where site_bill_id is not null group by site_bill_id) x
  where x.site_bill_id = s.id and s.kind = 'equipment' and (s.period_from, s.period_to) is distinct from (x.d1, x.d2);
end $$;
