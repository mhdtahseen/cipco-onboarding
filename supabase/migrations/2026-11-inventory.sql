-- Inventory: every purchase bill is recorded item by item. One bill = one project expense (posted automatically) = one MRR (Material Requisition) on the JSL portal.
-- The items go to the JSL portal only after an Admin authorizes that bill. Safe to run more than once. Run AFTER 2026-11-viewer-role.sql.
--
-- Status of a bill:   draft -> recorded (the expense is posted). Operations / Admin can reopen it (the expense comes off) or void it.
-- Status towards JSL: none -> authorized -> sending -> submitting -> submitted, or failed / needs_check.
--   'submitting' is written just before Save is clicked on the portal. A run that dies after that goes to needs_check and is never retried by itself: the MRR may already exist, and a retry could raise it twice.
--   The sending, submitting, submitted, failed and needs_check states are for the portal worker, which is not built yet.

create table if not exists public.inventory_bills (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  vendor_name text not null check (btrim(vendor_name) <> ''),
  vendor_gstin text not null default '',
  bill_no text not null check (btrim(bill_no) <> ''),
  bill_date date not null,
  bill_total numeric(12,2) not null check (bill_total > 0),            -- the total printed on the bill, and the amount that goes to expenses
  other_charges numeric(12,2) not null default 0,                      -- freight or a discount (minus) printed on the bill outside the item lines
  bill_path text,
  note text not null default '',
  status text not null default 'draft' check (status in ('draft', 'recorded')),
  recorded_by uuid,
  recorded_at timestamptz,
  jsl_status text not null default 'none' check (jsl_status in ('none', 'authorized', 'sending', 'submitting', 'submitted', 'failed', 'needs_check')),
  jsl_authorized_by uuid,
  jsl_authorized_at timestamptz,
  jsl_ref text,                                                        -- the confirmation from the portal
  jsl_error text,
  jsl_submitted_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);
create index if not exists inventory_bills_project on public.inventory_bills (project_id, bill_date desc);
-- the same bill cannot be entered twice. The date is part of the rule because a vendor may reuse a number in a later year.
create unique index if not exists inventory_bills_once on public.inventory_bills (lower(btrim(vendor_name)), lower(btrim(bill_no)), bill_date) where voided_at is null;

create table if not exists public.inventory_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.inventory_bills(id) on delete cascade,
  line_no int not null default 1,
  name text not null check (btrim(name) <> ''),
  hsn text not null default '',
  qty numeric(12,3) not null check (qty > 0),
  unit text not null check (btrim(unit) <> ''),
  rate numeric(12,2) not null check (rate >= 0),                       -- before GST
  gst_pct numeric(5,2) not null default 18 check (gst_pct >= 0 and gst_pct <= 40),
  amount numeric(14,2) generated always as (round(qty * rate, 2)) stored,
  created_at timestamptz not null default now()
);
create index if not exists inventory_bill_items_bill on public.inventory_bill_items (bill_id, line_no);

-- What the portal asks for before it accepts any material. Kept apart from the bill because it holds ID numbers: a Viewer cannot read this table.
-- Contractor name, address and WO validity are not here: the portal fills them in itself from the WO number.
-- wo_no is never typed: it is taken from the project's active work order when an Admin authorizes (see inventory_authorize_jsl).
-- By hand, someone on the project: only person_employee_id is kept. Their Aadhaar stays in employees, where a Supervisor cannot read it, and is looked up when the MRR is sent.
-- By hand, someone from outside: name, ID type and ID number are typed here. By vehicle works the same way.
create table if not exists public.inventory_gatepass (
  bill_id uuid primary key references public.inventory_bills(id) on delete cascade,
  wo_no text not null default '',
  received_by text not null default 'hand' check (received_by in ('hand', 'vehicle')),
  person_source text not null default 'employee' check (person_source in ('employee', 'other')),
  person_employee_id uuid references public.employees(id) on delete set null,
  person_name text not null default '', person_id_type text not null default '', person_id_no text not null default '',           -- by hand
  vehicle_no text not null default '', driver_name text not null default '', driver_dl_no text not null default '',                -- by vehicle
  codriver_name text not null default '', codriver_id_type text not null default '', codriver_id_no text not null default '',
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

-- ---------- who may change what ----------
create or replace function public.inventory_bill_open(p_bill uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inventory_bills b where b.id = p_bill and b.status = 'draft' and b.voided_at is null and public.can_attend(b.project_id)) $$;
create or replace function public.inventory_gatepass_open(p_bill uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inventory_bills b where b.id = p_bill and b.voided_at is null and b.jsl_status in ('none', 'failed') and public.can_attend(b.project_id)) $$;
create or replace function public.inventory_bill_visible(p_bill uuid, p_with_viewer boolean) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inventory_bills b where b.id = p_bill and (public.can_attend(b.project_id) or (p_with_viewer and public.is_viewer()))) $$;

alter table public.inventory_bills enable row level security;
alter table public.inventory_bill_items enable row level security;
alter table public.inventory_gatepass enable row level security;
do $$ declare t text; p text; begin
  foreach t in array array['inventory_bills', 'inventory_bill_items', 'inventory_gatepass'] loop
    foreach p in array array['read', 'ins', 'upd', 'del'] loop execute format('drop policy if exists %I on public.%I', t || ' ' || p, t); end loop;
  end loop;
end $$;
create policy "inventory_bills read" on public.inventory_bills for select to authenticated using (public.can_see(project_id));
create policy "inventory_bills ins" on public.inventory_bills for insert to authenticated with check (public.can_attend(project_id) and status = 'draft' and jsl_status = 'none' and voided_at is null);
create policy "inventory_bills upd" on public.inventory_bills for update to authenticated using (public.can_attend(project_id)) with check (public.can_attend(project_id));
create policy "inventory_bills del" on public.inventory_bills for delete to authenticated using (status = 'draft' and public.can_attend(project_id));   -- only a draft can be discarded; a recorded bill is voided
create policy "inventory_bill_items read" on public.inventory_bill_items for select to authenticated using (public.inventory_bill_visible(bill_id, true));
create policy "inventory_bill_items ins" on public.inventory_bill_items for insert to authenticated with check (public.inventory_bill_open(bill_id));
create policy "inventory_bill_items upd" on public.inventory_bill_items for update to authenticated using (public.inventory_bill_open(bill_id)) with check (public.inventory_bill_open(bill_id));
create policy "inventory_bill_items del" on public.inventory_bill_items for delete to authenticated using (public.inventory_bill_open(bill_id));
create policy "inventory_gatepass read" on public.inventory_gatepass for select to authenticated using (public.inventory_bill_visible(bill_id, false));
create policy "inventory_gatepass ins" on public.inventory_gatepass for insert to authenticated with check (public.inventory_gatepass_open(bill_id));
create policy "inventory_gatepass upd" on public.inventory_gatepass for update to authenticated using (public.inventory_gatepass_open(bill_id)) with check (public.inventory_gatepass_open(bill_id));

-- The status columns only move through the functions below, and a recorded bill cannot be edited directly.
create or replace function public.inventory_bill_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.inventory', true) = '1' then new.updated_at := now(); return new; end if;
  if old.status <> 'draft' or old.voided_at is not null then raise exception 'This bill is already recorded. Operations or an Admin must reopen it before it can be changed.'; end if;
  if new.status <> old.status or new.jsl_status <> old.jsl_status or new.voided_at is distinct from old.voided_at or new.project_id <> old.project_id
     or new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at or new.jsl_authorized_by is distinct from old.jsl_authorized_by
     or new.jsl_authorized_at is distinct from old.jsl_authorized_at or new.jsl_ref is distinct from old.jsl_ref or new.jsl_error is distinct from old.jsl_error or new.jsl_submitted_at is distinct from old.jsl_submitted_at then
    raise exception 'A bill''s status can only be changed with its buttons.';
  end if;
  new.updated_at := now(); return new;
end $$;
drop trigger if exists inventory_bill_guard_trg on public.inventory_bills;
create trigger inventory_bill_guard_trg before update on public.inventory_bills for each row execute function public.inventory_bill_guard();

-- ---------- who can bring the material by hand ----------
create or replace function public.inventory_person_ok(p_employee uuid, p_project uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees e where e.id = p_employee and e.project_id = p_project and e.outcome is distinct from 'rejected' and e.join_date is not null
    and (e.left_on is null or e.left_on >= (now() at time zone 'Asia/Kolkata')::date)) $$;

-- The project's people, for the "who is bringing it" list: the last 4 digits of the Aadhaar and nothing more. A Supervisor has no other way to see people (see attendance_roster).
-- is_default marks the person who entered the bill. Logins are not linked to employee records, so this matches on the name, and only when exactly one person has that name.
create or replace function public.inventory_project_people(p_bill uuid) returns table (employee_id uuid, full_name text, designation text, aadhaar_last4 text, is_default boolean) language plpgsql stable security definer set search_path = public as $$
declare b public.inventory_bills; me text;
begin
  select * into b from public.inventory_bills where id = p_bill;
  if b.id is null or not public.can_attend(b.project_id) then raise exception 'Not allowed.'; end if;
  select lower(regexp_replace(btrim(p.full_name), '\s+', ' ', 'g')) into me from public.user_profiles p where p.user_id = coalesce(b.created_by, auth.uid());
  return query
    with people as (select e.id, e.full_name, e.designation, e.aadhaar, lower(regexp_replace(btrim(e.full_name), '\s+', ' ', 'g')) as n from public.employees e where public.inventory_person_ok(e.id, b.project_id))
    select x.id, x.full_name, x.designation, case when x.aadhaar ~ '^\d{12}$' then right(x.aadhaar, 4) end, (x.n = me and (select count(*) from people y where y.n = me) = 1)
    from people x order by 5 desc nulls last, 2;
end $$;

-- The project's active work orders, for Operations and Admin only. Supervisors never see or choose the WO.
create or replace function public.inventory_project_wos(p_project uuid) returns table (wo_no text, title text) language sql stable security definer set search_path = public as $$
  select w.wo_no, w.title from public.work_orders w where w.project_id = p_project and w.status = 'active' and public.is_staff() order by w.wo_date desc nulls last, w.wo_no $$;

-- Whatever the client sends: the WO cannot be set here, a project person's name comes from their record, and no ID number is copied for them.
create or replace function public.inventory_gatepass_fill() returns trigger language plpgsql security definer set search_path = public as $$
declare proj uuid; nm text;
begin
  if current_setting('app.inventory', true) = '1' then return new; end if;
  new.wo_no := case when tg_op = 'UPDATE' then old.wo_no else '' end;
  new.updated_by := auth.uid(); new.updated_at := now();
  if new.received_by = 'hand' and new.person_source = 'employee' then
    new.person_name := ''; new.person_id_type := ''; new.person_id_no := '';
    if new.person_employee_id is not null then
      select project_id into proj from public.inventory_bills where id = new.bill_id;
      if not public.inventory_person_ok(new.person_employee_id, proj) then raise exception 'That person is not on this project.'; end if;
      select full_name into nm from public.employees where id = new.person_employee_id; new.person_name := nm;
    end if;
  else new.person_employee_id := null; end if;
  return new;
end $$;
drop trigger if exists inventory_gatepass_fill_trg on public.inventory_gatepass;
create trigger inventory_gatepass_fill_trg before insert or update on public.inventory_gatepass for each row execute function public.inventory_gatepass_fill();

-- ---------- record the bill: its total goes to the project's expenses ----------
create or replace function public.inventory_record_bill(p_bill uuid) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; n int; computed numeric; cat uuid;
begin
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null or not public.can_attend(b.project_id) then raise exception 'Not allowed.'; end if;
  if b.voided_at is not null then raise exception 'This bill is void.'; end if;
  if b.status <> 'draft' then raise exception 'This bill is already recorded.'; end if;
  if b.bill_path is null then raise exception 'Attach the photo of the bill first.'; end if;
  select count(*), coalesce(sum(amount * (1 + gst_pct / 100)), 0) into n, computed from public.inventory_bill_items where bill_id = p_bill;
  if n = 0 then raise exception 'Add the items first.'; end if;
  computed := round(computed + b.other_charges, 2);
  if abs(computed - b.bill_total) > 1 then raise exception 'The items come to ₹% but the bill says ₹%. Check the items before recording.', computed, b.bill_total; end if;   -- within ₹1 is the bill's round off
  select id into cat from public.expense_categories where lower(btrim(name)) = 'site consumables' limit 1;
  if cat is null then insert into public.expense_categories (name) values ('Site consumables') returning id into cat; end if;
  insert into public.project_expenses (project_id, category_id, expense_date, amount, description, source, source_id, created_by, bill_path)
  values (b.project_id, cat, b.bill_date, b.bill_total, 'Purchase bill · ' || b.vendor_name || ' · ' || b.bill_no, 'inventory_bill', b.id, auth.uid(), b.bill_path);
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set status = 'recorded', recorded_by = auth.uid(), recorded_at = now() where id = p_bill;
  perform set_config('app.inventory', '', true);
end $$;

-- ---------- reopen or void: the expense comes off. Refused once the portal may be holding the MRR. ----------
create or replace function public.inventory_take_back(p_bill uuid, p_void_reason text) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills;
begin
  if not public.is_staff() then raise exception 'Only Operations or an Admin can do this.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null then raise exception 'Bill not found.'; end if;
  if b.voided_at is not null then raise exception 'This bill is already void.'; end if;
  if b.jsl_status not in ('none', 'authorized', 'failed') then raise exception 'This bill has gone to the JSL portal (or may have), so it cannot be changed here. Settle it on the portal first.'; end if;
  perform set_config('app.posting', '1', true);
  delete from public.project_expenses where source = 'inventory_bill' and source_id = p_bill;
  perform set_config('app.posting', '', true);
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null, jsl_error = null,
    status = 'draft', recorded_by = null, recorded_at = null,
    voided_at = case when p_void_reason is null then null else now() end, void_reason = p_void_reason where id = p_bill;
  perform set_config('app.inventory', '', true);
end $$;
create or replace function public.inventory_reopen_bill(p_bill uuid) returns void language plpgsql security definer set search_path = public as $$
begin perform public.inventory_take_back(p_bill, null); end $$;
create or replace function public.inventory_void_bill(p_bill uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Give a reason.'; end if;
  perform public.inventory_take_back(p_bill, btrim(p_reason));
end $$;

-- ---------- Admin's authorization to send a bill's items to the JSL portal ----------
drop function if exists public.inventory_authorize_jsl(uuid);
-- p_wo is needed only when the project has more than one active work order.
create or replace function public.inventory_authorize_jsl(p_bill uuid, p_wo text default null) returns void language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; g public.inventory_gatepass; wo text; n int; aad text;
begin
  if not public.is_admin() then raise exception 'Only an Admin can authorize this.'; end if;
  select * into b from public.inventory_bills where id = p_bill for update;
  if b.id is null then raise exception 'Bill not found.'; end if;
  if b.voided_at is not null or b.status <> 'recorded' then raise exception 'Only a recorded bill can be authorized.'; end if;
  if b.jsl_status not in ('none', 'failed') then raise exception 'This bill is already with the JSL portal.'; end if;
  select * into g from public.inventory_gatepass where bill_id = p_bill;
  if g.bill_id is null then raise exception 'Enter the JSL details first.'; end if;
  if g.received_by = 'hand' and g.person_source = 'employee' then
    if g.person_employee_id is null then raise exception 'Choose who is bringing the material.'; end if;
    if not public.inventory_person_ok(g.person_employee_id, b.project_id) then raise exception 'The person bringing the material is no longer on this project. Choose again.'; end if;
    select aadhaar into aad from public.employees where id = g.person_employee_id;
    if aad is null or aad !~ '^\d{12}$' then raise exception 'That person has no valid Aadhaar on their employee record.'; end if;
  end if;
  if g.received_by = 'hand' and g.person_source = 'other' and (btrim(g.person_name) = '' or btrim(g.person_id_type) = '' or btrim(g.person_id_no) = '') then raise exception 'Enter the name, ID type and ID number of the person bringing the material.'; end if;
  if g.received_by = 'vehicle' and (btrim(g.vehicle_no) = '' or btrim(g.driver_name) = '' or btrim(g.driver_dl_no) = '') then raise exception 'Enter the vehicle number, driver name and driver''s licence number.'; end if;
  if g.received_by = 'vehicle' and btrim(g.codriver_name) <> '' and (btrim(g.codriver_id_type) = '' or btrim(g.codriver_id_no) = '') then raise exception 'Enter the co-driver''s ID type and number.'; end if;
  select count(*), min(w.wo_no) into n, wo from public.work_orders w where w.project_id = b.project_id and w.status = 'active' and (p_wo is null or w.wo_no = p_wo);
  if n = 0 then raise exception '%', case when p_wo is null then 'This project has no active work order. Add one under Work orders first.' else 'That work order is not active on this project.' end; end if;
  if n > 1 then raise exception 'This project has more than one active work order. Choose one.'; end if;
  perform set_config('app.inventory', '1', true);
  update public.inventory_gatepass set wo_no = wo, updated_at = now() where bill_id = p_bill;
  update public.inventory_bills set jsl_status = 'authorized', jsl_authorized_by = auth.uid(), jsl_authorized_at = now(), jsl_error = null where id = p_bill;
  perform set_config('app.inventory', '', true);
end $$;
create or replace function public.inventory_withdraw_jsl(p_bill uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can do this.'; end if;
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set jsl_status = 'none', jsl_authorized_by = null, jsl_authorized_at = null where id = p_bill and jsl_status = 'authorized';
  if not found then perform set_config('app.inventory', '', true); raise exception 'This bill is no longer waiting to be sent.'; end if;
  perform set_config('app.inventory', '', true);
end $$;

-- the buttons and the access rules call these; nobody calls the trigger or the shared take-back directly
revoke execute on function public.inventory_bill_guard(), public.inventory_gatepass_fill(), public.inventory_person_ok(uuid, uuid), public.inventory_take_back(uuid, text) from public, anon, authenticated;
revoke execute on function public.inventory_bill_open(uuid), public.inventory_gatepass_open(uuid), public.inventory_bill_visible(uuid, boolean), public.inventory_record_bill(uuid), public.inventory_reopen_bill(uuid), public.inventory_void_bill(uuid, text), public.inventory_authorize_jsl(uuid, text), public.inventory_withdraw_jsl(uuid), public.inventory_project_people(uuid), public.inventory_project_wos(uuid) from public, anon;
grant execute on function public.inventory_bill_open(uuid), public.inventory_gatepass_open(uuid), public.inventory_bill_visible(uuid, boolean), public.inventory_record_bill(uuid), public.inventory_reopen_bill(uuid), public.inventory_void_bill(uuid, text), public.inventory_authorize_jsl(uuid, text), public.inventory_withdraw_jsl(uuid), public.inventory_project_people(uuid), public.inventory_project_wos(uuid) to authenticated;
grant select, insert, update, delete on public.inventory_bills, public.inventory_bill_items to authenticated;
grant select, insert, update on public.inventory_gatepass to authenticated;
