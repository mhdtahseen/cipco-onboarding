-- Approval flow for inventory entries, and entries that have no bill.
-- Supervisors and Site Engineers SUBMIT an entry; Operations or an Admin reviews it: they can mark corrections, fix things themselves, send it back to be reworked, or approve it.
-- Approving is what records the entry: its items count as received and its amount (if any) posts to the project's expenses. An Admin may also send an approved entry on to the JSL portal in the same step.
-- Operations and Admin entering their own entry still record it directly, which is the same as approving it.
-- Safe to run more than once. Run AFTER 2026-11-inventory.sql, 2026-11-inventory-units.sql and 2026-11-inventory-jsl-optional.sql.
--
-- status:  draft (being entered) -> submitted (waiting for review) -> recorded (approved)
--                          returned (sent back for rework; editable like a draft) -> submitted again
-- kind:    'bill' (a purchase bill with its photo) or 'no_bill' (items with a reason, and an optional amount paid and photo)

alter table public.inventory_bills add column if not exists kind text not null default 'bill';
alter table public.inventory_bills add column if not exists submitted_by uuid;
alter table public.inventory_bills add column if not exists submitted_at timestamptz;
alter table public.inventory_bills drop constraint if exists inventory_bills_kind_check;
alter table public.inventory_bills add constraint inventory_bills_kind_check check (kind in ('bill', 'no_bill'));
alter table public.inventory_bills drop constraint if exists inventory_bills_status_check;
alter table public.inventory_bills add constraint inventory_bills_status_check check (status in ('draft', 'submitted', 'returned', 'recorded'));
-- an entry without a bill has no vendor or bill number, and its amount paid may be nothing
alter table public.inventory_bills drop constraint if exists inventory_bills_vendor_name_check, drop constraint if exists inventory_bills_bill_no_check, drop constraint if exists inventory_bills_bill_total_check;
alter table public.inventory_bills add constraint inventory_bills_vendor_name_check check (kind = 'no_bill' or btrim(vendor_name) <> '');
alter table public.inventory_bills add constraint inventory_bills_bill_no_check check (kind = 'no_bill' or btrim(bill_no) <> '');
alter table public.inventory_bills add constraint inventory_bills_bill_total_check check ((kind = 'bill' and bill_total > 0) or (kind = 'no_bill' and bill_total >= 0));
-- the same bill cannot be entered twice (entries without a bill have no number to repeat)
drop index if exists public.inventory_bills_once;
create unique index inventory_bills_once on public.inventory_bills (lower(btrim(vendor_name)), lower(btrim(bill_no)), bill_date) where voided_at is null and kind = 'bill';

-- ---------- history and corrections ----------
create table if not exists public.inventory_bill_events (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.inventory_bills(id) on delete cascade,
  kind text not null check (kind in ('submitted', 'returned', 'approved', 'recorded', 'reopened', 'voided')),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists inventory_bill_events_bill on public.inventory_bill_events (bill_id, created_at);

-- What the reviewer marked for correction. field is the part of the entry it is about (empty when it is about an item or the entry as a whole).
create table if not exists public.inventory_review_notes (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.inventory_bills(id) on delete cascade,
  item_id uuid references public.inventory_bill_items(id) on delete set null,
  item_name text not null default '',
  field text not null default '' check (field in ('', 'vendor', 'gstin', 'bill_no', 'date', 'total', 'other_charges', 'photo', 'reason', 'amount')),
  note text not null check (btrim(note) <> ''),
  state text not null default 'open' check (state in ('open', 'done')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz
);
create index if not exists inventory_review_notes_bill on public.inventory_review_notes (bill_id, created_at);

alter table public.inventory_bill_events enable row level security;
alter table public.inventory_review_notes enable row level security;
drop policy if exists "inventory_bill_events read" on public.inventory_bill_events;
drop policy if exists "inventory_review_notes read" on public.inventory_review_notes;
create policy "inventory_bill_events read" on public.inventory_bill_events for select to authenticated using (public.inventory_bill_visible(bill_id, true));
create policy "inventory_review_notes read" on public.inventory_review_notes for select to authenticated using (public.inventory_bill_visible(bill_id, true));
-- no insert, update or delete policies: both tables are written only by the functions below
grant select on public.inventory_bill_events, public.inventory_review_notes to authenticated;

-- ---------- who may change what ----------
-- Items (and the entry's own details) can be edited while it is a draft or has been sent back, by whoever may attend the project; and while it waits for review, by Operations or an Admin, who may correct it.
create or replace function public.inventory_bill_open(p_bill uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inventory_bills b where b.id = p_bill and b.voided_at is null and (
    (b.status in ('draft', 'returned') and public.can_attend(b.project_id)) or (b.status = 'submitted' and public.is_staff()))) $$;

drop policy if exists "inventory_bills ins" on public.inventory_bills;
create policy "inventory_bills ins" on public.inventory_bills for insert to authenticated with check (public.can_attend(project_id) and status = 'draft' and jsl_status = 'none' and not jsl_wanted and voided_at is null and submitted_by is null and submitted_at is null);
drop policy if exists "inventory_bills del" on public.inventory_bills;
create policy "inventory_bills del" on public.inventory_bills for delete to authenticated using (status in ('draft', 'returned') and public.can_attend(project_id));

create or replace function public.inventory_bill_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.inventory', true) = '1' then new.updated_at := now(); return new; end if;
  if old.voided_at is not null then raise exception 'This entry is void.'; end if;
  if old.status = 'recorded' then raise exception 'This entry is already approved and recorded. Operations or an Admin must reopen it before it can be changed.'; end if;
  if old.status = 'submitted' and not public.is_staff() then raise exception 'This entry is waiting for review, so it cannot be changed. Operations or an Admin will approve it or send it back.'; end if;
  if new.status <> old.status or new.kind <> old.kind or new.jsl_status <> old.jsl_status or new.jsl_wanted <> old.jsl_wanted or new.voided_at is distinct from old.voided_at or new.project_id <> old.project_id
     or new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at or new.submitted_by is distinct from old.submitted_by or new.submitted_at is distinct from old.submitted_at
     or new.jsl_authorized_by is distinct from old.jsl_authorized_by or new.jsl_authorized_at is distinct from old.jsl_authorized_at or new.jsl_ref is distinct from old.jsl_ref or new.jsl_error is distinct from old.jsl_error or new.jsl_submitted_at is distinct from old.jsl_submitted_at then
    raise exception 'An entry''s status can only be changed with its buttons.';
  end if;
  new.updated_at := now(); return new;
end $$;

-- ---------- is the entry complete enough to submit or approve? ----------
-- Returns what is missing, or null. A bill needs its photo and items that add up to its total (within the ₹1 of round off); an entry without a bill needs its items and a reason.
create or replace function public.inventory_ready_error(p_bill uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare b public.inventory_bills; n int; computed numeric;
begin
  select * into b from public.inventory_bills where id = p_bill;
  select count(*), coalesce(sum(amount * (1 + gst_pct / 100)), 0) into n, computed from public.inventory_bill_items where bill_id = p_bill;
  if n = 0 then return 'Add the items first.'; end if;
  if b.kind = 'no_bill' then
    if btrim(b.note) = '' then return 'Give the reason for this entry first.'; end if;
    return null;
  end if;
  if b.bill_path is null then return 'Attach the photo of the bill first.'; end if;
  computed := round(computed + b.other_charges, 2);
  if abs(computed - b.bill_total) > 1 then return format('The items come to ₹%s but the bill says ₹%s. Check the items first.', computed, b.bill_total); end if;
  return null;
end $$;

-- ---------- submit, send back, approve ----------
create or replace function public.inventory_submit_bill(p_bill uuid) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; msg text;
begin
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null or not public.can_attend(b.project_id) then raise exception 'Not allowed.'; end if;
  if b.voided_at is not null then raise exception 'This entry is void.'; end if;
  if b.status not in ('draft', 'returned') then raise exception 'This entry is not open for submitting.'; end if;
  msg := public.inventory_ready_error(p_bill); if msg is not null then raise exception '%', msg; end if;
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set status = 'submitted', submitted_by = auth.uid(), submitted_at = now() where id = p_bill;
  perform set_config('app.inventory', '', true);
  insert into public.inventory_bill_events (bill_id, kind) values (p_bill, 'submitted');
end $$;

create or replace function public.inventory_return_bill(p_bill uuid, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can send an entry back.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null then raise exception 'Entry not found.'; end if;
  if b.voided_at is not null or b.status <> 'submitted' then raise exception 'Only an entry waiting for review can be sent back.'; end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'Say what needs to be fixed.'; end if;
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set status = 'returned' where id = p_bill;
  perform set_config('app.inventory', '', true);
  insert into public.inventory_bill_events (bill_id, kind, note) values (p_bill, 'returned', btrim(p_note));
end $$;

-- Approve = record. From a draft (Operations or an Admin entering their own) or from submitted (after review). The total posts to the project's expenses, if there is an amount.
-- p_portal: an Admin may also switch the entry on for the JSL portal in the same step.
drop function if exists public.inventory_record_bill(uuid);
create or replace function public.inventory_record_bill(p_bill uuid, p_portal boolean default false) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; msg text; cat uuid; dsc text;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can approve an entry. Submit it for approval.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null or not public.can_attend(b.project_id) then raise exception 'Not allowed.'; end if;
  if b.voided_at is not null then raise exception 'This entry is void.'; end if;
  if b.status = 'recorded' then raise exception 'This entry is already recorded.'; end if;
  if b.status = 'returned' then raise exception 'This entry was sent back and is with the person who entered it.'; end if;
  if p_portal and not public.is_admin() then raise exception 'Only an Admin can send an entry to the JSL portal.'; end if;
  msg := public.inventory_ready_error(p_bill); if msg is not null then raise exception '%', msg; end if;
  if b.bill_total > 0 then
    select id into cat from public.expense_categories where lower(btrim(name)) = 'site consumables' limit 1;
    if cat is null then insert into public.expense_categories (name) values ('Site consumables') returning id into cat; end if;
    dsc := case when b.kind = 'no_bill' then 'Entry without a bill · ' || left(btrim(b.note), 120) else 'Purchase bill · ' || b.vendor_name || ' · ' || b.bill_no end;
    insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by, bill_path)
    values (b.project_id, cat, b.bill_date, b.bill_total, dsc, 'inventory_bill', b.id, auth.uid(), b.bill_path);
  end if;
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set status = 'recorded', recorded_by = auth.uid(), recorded_at = now(), jsl_wanted = (jsl_wanted or coalesce(p_portal, false)) where id = p_bill;
  perform set_config('app.inventory', '', true);
  insert into public.inventory_bill_events (bill_id, kind) values (p_bill, case when b.status = 'submitted' then 'approved' else 'recorded' end);
end $$;

-- ---------- reopen or void (now with a history line) ----------
create or replace function public.inventory_take_back(p_bill uuid, p_void_reason text) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can do this.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null then raise exception 'Entry not found.'; end if;
  if b.voided_at is not null then raise exception 'This entry is already void.'; end if;
  if p_void_reason is null and b.status <> 'recorded' then raise exception 'Only a recorded entry can be reopened.'; end if;
  if b.jsl_status not in ('none', 'authorized', 'failed') then raise exception 'This entry has gone to the JSL portal (or may have), so it cannot be changed here. Settle it on the portal first.'; end if;
  perform set_config('app.posting', '1', true);
  delete from public.project_expenses where source = 'inventory_bill' and source_id = p_bill;
  perform set_config('app.posting', '', true);
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null,
    status = 'draft', recorded_by = null, recorded_at = null, submitted_by = null, submitted_at = null,
    voided_at = case when p_void_reason is null then null else now() end, void_reason = p_void_reason where id = p_bill;
  perform set_config('app.inventory', '', true);
  insert into public.inventory_bill_events (bill_id, kind, note) values (p_bill, case when p_void_reason is null then 'reopened' else 'voided' end, coalesce(p_void_reason, ''));
end $$;

-- ---------- corrections marked by the reviewer ----------
create or replace function public.inventory_note_add(p_bill uuid, p_item uuid, p_field text, p_note text) returns uuid language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; nm text := ''; nid uuid;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can mark corrections.'; end if;
  select * into b from public.inventory_bills where id = p_bill;
  if b.id is null then raise exception 'Entry not found.'; end if;
  if b.voided_at is not null or b.status <> 'submitted' then raise exception 'Corrections can only be marked on an entry that is waiting for review.'; end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'Write what is wrong.'; end if;
  if p_item is not null then
    select name into nm from public.inventory_bill_items where id = p_item and bill_id = p_bill;
    if not found then raise exception 'That item is not on this entry.'; end if;
  end if;
  insert into public.inventory_review_notes (bill_id, item_id, item_name, field, note) values (p_bill, p_item, coalesce(nm, ''), coalesce(p_field, ''), btrim(p_note)) returning inventory_review_notes.id into nid;
  return nid;
end $$;

create or replace function public.inventory_note_remove(p_note uuid) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can remove a correction.'; end if;
  select bl.* into b from public.inventory_review_notes n join public.inventory_bills bl on bl.id = n.bill_id where n.id = p_note;
  if b.id is null then raise exception 'Correction not found.'; end if;
  if b.status <> 'submitted' then raise exception 'Corrections can only be removed while the entry waits for review.'; end if;
  delete from public.inventory_review_notes where id = p_note;
end $$;

-- The person who entered the entry ticks a correction as done once it is sent back; the reviewer may tick it too.
create or replace function public.inventory_note_set_done(p_note uuid, p_done boolean) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  select bl.* into b from public.inventory_review_notes n join public.inventory_bills bl on bl.id = n.bill_id where n.id = p_note;
  if b.id is null then raise exception 'Correction not found.'; end if;
  if not ((b.status = 'returned' and public.can_attend(b.project_id)) or (b.status = 'submitted' and public.is_staff())) then raise exception 'Not allowed.'; end if;
  update public.inventory_review_notes set state = case when p_done then 'done' else 'open' end, resolved_by = case when p_done then auth.uid() end, resolved_at = case when p_done then now() end where id = p_note;
end $$;

-- the page calls these; nobody calls the helpers directly
revoke execute on function public.inventory_ready_error(uuid) from public, anon, authenticated;
revoke execute on function public.inventory_submit_bill(uuid), public.inventory_return_bill(uuid, text), public.inventory_record_bill(uuid, boolean), public.inventory_note_add(uuid, uuid, text, text), public.inventory_note_remove(uuid), public.inventory_note_set_done(uuid, boolean) from public, anon;
grant execute on function public.inventory_submit_bill(uuid), public.inventory_return_bill(uuid, text), public.inventory_record_bill(uuid, boolean), public.inventory_note_add(uuid, uuid, text, text), public.inventory_note_remove(uuid), public.inventory_note_set_done(uuid, boolean) to authenticated;
