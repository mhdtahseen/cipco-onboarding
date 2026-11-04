-- Payroll: "off days as LOP" for chosen people. Safe to run more than once. NOT run by Claude: run it yourself in the Supabase SQL editor.
--
-- On the payroll run you can tick the salaried people whose off days (a marked Off and the weekly off) are unpaid that month and count as LOP.
-- The tick is saved as a payroll adjustment of a new kind, 'off_lop', for that person and month. It carries no money. Un-ticking voids it, like any adjustment,
-- and a month that is approved cannot be changed (the existing guard already enforces that).

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.payroll_adjustments'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%lop_waiver%' loop
    execute format('alter table public.payroll_adjustments drop constraint %I', c);
  end loop;
  alter table public.payroll_adjustments add constraint payroll_adjustments_kind_check check (kind in ('earning', 'deduction', 'lop_waiver', 'off_lop'));
end $$;

-- one live tick per person and month
create unique index if not exists payroll_adjustments_one_off_lop on public.payroll_adjustments (employee_id, pay_month) where kind = 'off_lop' and voided_at is null;

-- the same guard as before, except that an 'off_lop' marker needs no amount
create or replace function public.payroll_adjustment_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare approved boolean;
begin
  if tg_op = 'DELETE' then raise exception 'This is never deleted. Void it instead.'; end if;
  select exists (select 1 from public.payroll_runs r where r.project_id = coalesce(new.project_id, old.project_id) and r.pay_month = date_trunc('month', coalesce(new.pay_month, old.pay_month))::date and r.status = 'approved') into approved;
  if approved then raise exception 'That month''s payroll is approved. Reopen it to change adjustments.'; end if;
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'voided_at' - 'voided_by' is distinct from to_jsonb(old) - 'voided_at' - 'voided_by' then raise exception 'This cannot be edited. Void it and enter it again.'; end if;
    if old.voided_at is not null then raise exception 'This is already voided.'; end if;
    if new.voided_at is not null then new.voided_by := auth.uid(); end if; return new;
  end if;
  new.pay_month := date_trunc('month', new.pay_month)::date; new.created_by := auth.uid(); new.voided_at := null; new.voided_by := null;
  if new.kind = 'lop_waiver' and new.days is null then raise exception 'Enter the number of days to waive.'; end if;
  if new.kind not in ('lop_waiver', 'off_lop') and new.amount <= 0 then raise exception 'Enter the amount.'; end if;
  return new;
end $$;
