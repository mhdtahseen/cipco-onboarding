-- Offboarding: record an exit, run the exit checklist (company items, accommodation, advances, final pay, ESIC, EPFO), issue the exit letters, and rehire later.
-- Safe to run more than once. NOT run by Claude: run it yourself in the Supabase SQL editor.
-- Run AFTER 2026-11-payroll-no-pay.sql (the "forfeit" choice uses its 'no_pay' payroll marker).
--
-- THE EXIT (employee_exits). One open exit per person at a time. Recording it sets the employee's last working day (employees.left_on), so payroll pays up to that
-- day and the attendance sheet drops them after it, exactly as before. Exit types: resigned, contract_end, terminated, absconded.
--
-- PAY ON EXIT (pay_action)
--   pay      the normal final salary.
--   hold     the default for someone who absconded. Every salary of theirs that is not fully paid is put on hold (payroll_lines.held), and so is any line created
--            later (a trigger), so nothing can be paid out. Releasing it is the existing "hold" switch on Payroll → Pay, once they have settled.
--   forfeit  Admin only, and only with a reason. The final month is left out of payroll (the 'no_pay' marker), and any other unpaid salary is held.
--   Changing the choice later undoes the earlier one. A month whose payroll is approved cannot gain or lose the forfeit marker: reopen that payroll first.
--
-- THE CHECKLIST (employee_exit_items): each item is done (with a date) or not applicable, by whom, with an optional note and file (a portal screenshot, say).
-- CLOSING the exit needs every item done or not applicable; an Admin can close it anyway, with a reason.
-- LETTERS: relieving, experience, recommendation, settlement (full and final statement) and absconding notices are stored in the same letters table as offer
-- and appointment letters (staff only, as before). Who may issue which is checked by the app when it issues them.
-- REHIRE: once the exit is closed (or cancelled), employee_rehire clears the last working day and the joining date and puts the person back at the Offer stage.
-- Their exits, letters and salary slips stay on record.

-- ── the exit ──
create table if not exists public.employee_exits (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  project_id uuid references public.projects(id),
  exit_type text not null check (exit_type in ('resigned', 'contract_end', 'terminated', 'absconded')),
  resigned_on date,                                   -- the day they resigned / were told (optional)
  last_day date not null,                             -- the last working day
  reason text not null default '',
  notes text not null default '',
  rehire text not null default 'yes' check (rehire in ('yes', 'no', 'conditional')),
  rehire_note text not null default '',
  pay_action text not null default 'pay' check (pay_action in ('pay', 'hold', 'forfeit')),
  pay_reason text not null default '',
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  close_note text not null default '',                -- an Admin's reason for closing with the checklist not complete
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz,
  closed_by uuid, closed_at timestamptz,
  cancelled_by uuid, cancelled_at timestamptz, cancel_reason text not null default '',
  rehired_by uuid, rehired_at timestamptz
);
create unique index if not exists employee_exits_one_open on public.employee_exits (employee_id) where status = 'open';
create index if not exists employee_exits_employee on public.employee_exits (employee_id, created_at desc);

create table if not exists public.employee_exit_items (
  id uuid primary key default gen_random_uuid(),
  exit_id uuid not null references public.employee_exits(id) on delete cascade,
  item text not null check (item in ('assets', 'handover', 'accommodation', 'advances', 'settlement', 'esi', 'pf')),
  state text not null check (state in ('done', 'na')),
  done_on date,
  note text not null default '',
  file_path text,
  done_by uuid default auth.uid(), updated_at timestamptz not null default now(),
  unique (exit_id, item)
);

alter table public.employee_exits enable row level security;
alter table public.employee_exit_items enable row level security;
drop policy if exists "staff read exits" on public.employee_exits;
create policy "staff read exits" on public.employee_exits for select to authenticated using (public.is_staff());
drop policy if exists "staff read exit items" on public.employee_exit_items;
create policy "staff read exit items" on public.employee_exit_items for select to authenticated using (public.is_staff());
-- both are written only by the functions below

-- ── letters: the exit letters live with the offer and appointment letters ──
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.letters'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%appointment%' loop
    execute format('alter table public.letters drop constraint %I', c);
  end loop;
  alter table public.letters add constraint letters_kind_check check (kind in ('offer', 'appointment', 'relieving', 'experience', 'recommendation', 'settlement', 'absconding_notice'));
end $$;
alter table public.letters add column if not exists exit_id uuid references public.employee_exits(id) on delete set null;

-- ── pay on exit ──
-- every salary line of this person not yet fully paid
create or replace function public.exit_unpaid_lines(p_employee uuid) returns setof uuid language sql stable security definer set search_path = public as $$
  select l.id from public.payroll_lines l
  where l.employee_id = p_employee and l.net > coalesce((select sum(p.amount) from public.payroll_payments p where p.line_id = l.id and p.voided_at is null), 0) + 0.004 $$;

-- undo whatever the exit did to pay, then apply its current choice
create or replace function public.exit_apply_pay(p_exit uuid) returns void language plpgsql security definer set search_path = public as $$
declare x public.employee_exits; want date; label text;
begin
  select * into x from public.employee_exits where id = p_exit;
  want := case when x.status <> 'cancelled' and x.pay_action = 'forfeit' then date_trunc('month', x.last_day)::date end;   -- the month to leave out, if any
  label := 'Exit: ' || case x.exit_type when 'absconded' then 'absconded' when 'terminated' then 'terminated' else 'left' end || coalesce(nullif(': ' || btrim(x.pay_reason), ': '), '');
  -- the forfeit marker: void the ones this exit no longer wants (a month already approved refuses, with its own message), add the one it does
  update public.payroll_adjustments set voided_at = now() where employee_id = x.employee_id and kind = 'no_pay' and voided_at is null and reason like 'Exit:%' and (want is null or pay_month <> want);
  if want is not null and not exists (select 1 from public.payroll_adjustments where employee_id = x.employee_id and kind = 'no_pay' and voided_at is null and pay_month = want) then
    insert into public.payroll_adjustments (project_id, employee_id, pay_month, kind, label, reason, amount)
    select coalesce(x.project_id, e.project_id), x.employee_id, want, 'no_pay', 'Salary not paid', label, 0 from public.employees e where e.id = x.employee_id and coalesce(x.project_id, e.project_id) is not null;
  end if;
  -- holds: release the ones this exit placed, then hold every unpaid salary again if the choice is hold or forfeit
  update public.payroll_lines set held = false, hold_reason = '' where employee_id = x.employee_id and held and hold_reason like 'Exit:%';
  if x.status = 'cancelled' or x.pay_action = 'pay' then return; end if;
  update public.payroll_lines set held = true, hold_reason = left(label, 300) where id in (select public.exit_unpaid_lines(x.employee_id)) and not held;
end $$;

-- a salary line created later (the payroll recalculated after the exit) is held too
create or replace function public.exit_hold_new_line() returns trigger language plpgsql security definer set search_path = public as $$
declare x public.employee_exits;
begin
  select * into x from public.employee_exits where employee_id = new.employee_id and status <> 'cancelled' and rehired_at is null and pay_action in ('hold', 'forfeit') order by created_at desc limit 1;
  if found and not new.held then
    new.held := true;
    new.hold_reason := left('Exit: ' || case x.exit_type when 'absconded' then 'absconded' when 'terminated' then 'terminated' else 'left' end || coalesce(nullif(': ' || btrim(x.pay_reason), ': '), ''), 300);
  end if;
  return new;
end $$;
drop trigger if exists zz_exit_hold_trg on public.payroll_lines;
create trigger zz_exit_hold_trg before insert on public.payroll_lines for each row execute function public.exit_hold_new_line();

-- ── recording and changing an exit ──
create or replace function public.exit_check_args(p_type text, p_last date, p_resigned date, p_rehire text, p_pay text, p_pay_reason text) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_type not in ('resigned', 'contract_end', 'terminated', 'absconded') then raise exception 'Choose how they are leaving.'; end if;
  if p_last is null then raise exception 'Enter the last working day.'; end if;
  if p_resigned is not null and p_resigned > p_last then raise exception 'The resignation date is after the last working day.'; end if;
  if p_rehire not in ('yes', 'no', 'conditional') then raise exception 'Choose whether they can be rehired.'; end if;
  if p_pay not in ('pay', 'hold', 'forfeit') then raise exception 'Choose what happens to their pay.'; end if;
  if p_pay = 'forfeit' and not public.is_admin() then raise exception 'Only an Admin can forfeit salary.'; end if;
  if p_pay = 'forfeit' and btrim(coalesce(p_pay_reason, '')) = '' then raise exception 'Give the reason for not paying the salary.'; end if;
end $$;

create or replace function public.exit_start(p_employee uuid, p_type text, p_last_day date, p_resigned_on date default null, p_reason text default '', p_notes text default '',
  p_rehire text default 'yes', p_rehire_note text default '', p_pay_action text default 'pay', p_pay_reason text default '') returns uuid language plpgsql security definer set search_path = public as $$
declare e public.employees; xid uuid;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can offboard someone.'; end if;
  select * into e from public.employees where id = p_employee; if not found then raise exception 'Employee not found.'; end if;
  if e.join_date is not null and p_last_day < e.join_date then raise exception 'The last working day is before their joining date (%).', to_char(e.join_date, 'DD Mon YYYY'); end if;
  if exists (select 1 from public.employee_exits where employee_id = p_employee and status = 'open') then raise exception 'An exit is already open for this person.'; end if;
  perform public.exit_check_args(p_type, p_last_day, p_resigned_on, p_rehire, p_pay_action, p_pay_reason);
  insert into public.employee_exits (employee_id, project_id, exit_type, resigned_on, last_day, reason, notes, rehire, rehire_note, pay_action, pay_reason)
    values (p_employee, e.project_id, p_type, p_resigned_on, p_last_day, coalesce(p_reason, ''), coalesce(p_notes, ''), p_rehire, coalesce(p_rehire_note, ''), p_pay_action, coalesce(p_pay_reason, ''))
    returning id into xid;
  update public.employees set left_on = p_last_day, updated_at = now() where id = p_employee;
  perform public.exit_apply_pay(xid);
  return xid;
end $$;

create or replace function public.exit_update(p_exit uuid, p_type text, p_last_day date, p_resigned_on date default null, p_reason text default '', p_notes text default '',
  p_rehire text default 'yes', p_rehire_note text default '', p_pay_action text default 'pay', p_pay_reason text default '') returns void language plpgsql security definer set search_path = public as $$
declare x public.employee_exits; e public.employees;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can change an exit.'; end if;
  select * into x from public.employee_exits where id = p_exit; if not found then raise exception 'Exit not found.'; end if;
  if x.status <> 'open' then raise exception 'This exit is %. It can no longer be changed.', x.status; end if;
  if x.pay_action = 'forfeit' and p_pay_action <> 'forfeit' and not public.is_admin() then raise exception 'Only an Admin can undo a forfeit.'; end if;
  perform public.exit_check_args(p_type, p_last_day, p_resigned_on, p_rehire, p_pay_action, p_pay_reason);
  select * into e from public.employees where id = x.employee_id;
  if e.join_date is not null and p_last_day < e.join_date then raise exception 'The last working day is before their joining date (%).', to_char(e.join_date, 'DD Mon YYYY'); end if;
  update public.employee_exits set exit_type = p_type, last_day = p_last_day, resigned_on = p_resigned_on, reason = coalesce(p_reason, ''), notes = coalesce(p_notes, ''),
    rehire = p_rehire, rehire_note = coalesce(p_rehire_note, ''), pay_action = p_pay_action, pay_reason = coalesce(p_pay_reason, ''), updated_by = auth.uid(), updated_at = now() where id = p_exit;
  update public.employees set left_on = p_last_day, updated_at = now() where id = x.employee_id;
  perform public.exit_apply_pay(p_exit);
end $$;

-- the person did not leave after all (an absconder came back, a resignation was withdrawn): they are working again, and any hold or forfeit is undone
create or replace function public.exit_cancel(p_exit uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare x public.employee_exits;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can cancel an exit.'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give the reason for cancelling the exit.'; end if;
  select * into x from public.employee_exits where id = p_exit; if not found then raise exception 'Exit not found.'; end if;
  if x.status <> 'open' then raise exception 'Only an open exit can be cancelled.'; end if;
  if x.pay_action = 'forfeit' and not public.is_admin() then raise exception 'This exit forfeited salary. Only an Admin can cancel it.'; end if;
  update public.employee_exits set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p_exit;
  update public.employees set left_on = null, updated_at = now() where id = x.employee_id;
  perform public.exit_apply_pay(p_exit);
end $$;

-- one checklist item: p_state 'done' | 'na' | null (clear it)
create or replace function public.exit_item_set(p_exit uuid, p_item text, p_state text, p_done_on date default null, p_note text default '', p_file text default null) returns void language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can update the exit checklist.'; end if;
  select status into st from public.employee_exits where id = p_exit; if st is null then raise exception 'Exit not found.'; end if;
  if st <> 'open' then raise exception 'This exit is %. Its checklist can no longer be changed.', st; end if;
  if p_state is null then delete from public.employee_exit_items where exit_id = p_exit and item = p_item; return; end if;
  if p_state not in ('done', 'na') then raise exception 'Bad state.'; end if;
  insert into public.employee_exit_items (exit_id, item, state, done_on, note, file_path, done_by, updated_at)
    values (p_exit, p_item, p_state, case when p_state = 'done' then coalesce(p_done_on, (now() at time zone 'Asia/Kolkata')::date) end, coalesce(p_note, ''), p_file, auth.uid(), now())
  on conflict (exit_id, item) do update set state = excluded.state, done_on = excluded.done_on, note = excluded.note, file_path = coalesce(excluded.file_path, public.employee_exit_items.file_path), done_by = auth.uid(), updated_at = now();
end $$;

-- is every checklist item done or not applicable?
create or replace function public.exit_cleared(p_exit uuid) returns boolean language sql stable security definer set search_path = public as $$
  select (select count(*) from public.employee_exit_items where exit_id = p_exit) >= 7 $$;

create or replace function public.exit_close(p_exit uuid, p_note text default '') returns void language plpgsql security definer set search_path = public as $$
declare x public.employee_exits;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can close an exit.'; end if;
  select * into x from public.employee_exits where id = p_exit; if not found then raise exception 'Exit not found.'; end if;
  if x.status <> 'open' then raise exception 'This exit is already %.', x.status; end if;
  if x.last_day > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Their last working day (%) has not come yet.', to_char(x.last_day, 'DD Mon YYYY'); end if;
  if not public.exit_cleared(p_exit) then
    if not public.is_admin() then raise exception 'Finish the exit checklist first (mark each item done or not applicable). An Admin can close it anyway.'; end if;
    if btrim(coalesce(p_note, '')) = '' then raise exception 'The checklist is not complete. Give the reason for closing it anyway.'; end if;
  end if;
  update public.employee_exits set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_note = btrim(coalesce(p_note, '')) where id = p_exit;
end $$;

-- bring someone back: their history stays, they restart at the Offer stage with no joining date
create or replace function public.employee_rehire(p_employee uuid, p_note text default '') returns void language plpgsql security definer set search_path = public as $$
declare x public.employee_exits;
begin
  if not public.is_staff() then raise exception 'Only Admin or Operations can rehire someone.'; end if;
  if exists (select 1 from public.employee_exits where employee_id = p_employee and status = 'open') then raise exception 'Close or cancel the open exit first.'; end if;
  select * into x from public.employee_exits where employee_id = p_employee and status = 'closed' order by created_at desc limit 1;
  if found and (x.rehire = 'no' or x.exit_type = 'absconded') and not public.is_admin() then raise exception 'This person was marked as not to be rehired. Only an Admin can rehire them.'; end if;
  if found and (x.rehire = 'no' or x.exit_type = 'absconded') and btrim(coalesce(p_note, '')) = '' then raise exception 'Give the reason for rehiring them.'; end if;
  if found then update public.employee_exits set rehired_by = auth.uid(), rehired_at = now(), notes = case when btrim(coalesce(p_note, '')) = '' then notes else btrim(notes || E'\nRehired: ' || btrim(p_note)) end where id = x.id; end if;
  update public.employees set left_on = null, join_date = null, stage = 'offer', outcome = 'active', updated_at = now() where id = p_employee;
end $$;

-- the approved salary slips of one person, for the Exit tab (Operations cannot read payroll directly)
create or replace function public.employee_slips(p_employee uuid) returns table (line_id uuid, pay_month date, project text, net numeric, held boolean) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  return query select l.id, r.pay_month, p.name, l.net, l.held from public.payroll_lines l join public.payroll_runs r on r.id = l.run_id left join public.projects p on p.id = r.project_id
    where l.employee_id = p_employee and r.status = 'approved' order by r.pay_month desc;
end $$;

-- is this salary slip part of an approved payroll? (before a share link is made for it)
create or replace function public.slip_approved(p_line uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  return exists (select 1 from public.payroll_lines l join public.payroll_runs r on r.id = l.run_id where l.id = p_line and r.status = 'approved');
end $$;

-- what the person still owes on advances (for the settlement statement)
create or replace function public.employee_advance_balance(p_employee uuid) returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  return coalesce((select sum(a.amount) from public.employee_advances a where a.employee_id = p_employee and a.voided_at is null), 0)
       - coalesce((select sum(r.amount) from public.advance_recoveries r join public.employee_advances a on a.id = r.advance_id where a.employee_id = p_employee and a.voided_at is null), 0);
end $$;

revoke all on function public.exit_unpaid_lines(uuid), public.exit_apply_pay(uuid), public.exit_hold_new_line(), public.exit_check_args(text, date, date, text, text, text) from public, anon, authenticated;
revoke all on function public.exit_start(uuid, text, date, date, text, text, text, text, text, text), public.exit_update(uuid, text, date, date, text, text, text, text, text, text),
  public.exit_cancel(uuid, text), public.exit_item_set(uuid, text, text, date, text, text), public.exit_cleared(uuid), public.exit_close(uuid, text),
  public.employee_rehire(uuid, text), public.employee_slips(uuid), public.slip_approved(uuid), public.employee_advance_balance(uuid) from public, anon;
grant execute on function public.exit_start(uuid, text, date, date, text, text, text, text, text, text), public.exit_update(uuid, text, date, date, text, text, text, text, text, text),
  public.exit_cancel(uuid, text), public.exit_item_set(uuid, text, text, date, text, text), public.exit_cleared(uuid), public.exit_close(uuid, text),
  public.employee_rehire(uuid, text), public.employee_slips(uuid), public.slip_approved(uuid), public.employee_advance_balance(uuid) to authenticated;
