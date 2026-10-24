-- Self-fill links: staff create a per-candidate invite; the candidate opens /apply/<token> (no login), fills their own
-- details and uploads documents. Their answers wait in form_invites until staff review and apply them.
-- Safe to run more than once. The public page can ONLY call the three functions below; it cannot read or write any table.
create table if not exists public.form_invites (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status text not null default 'sent' check (status in ('sent','submitted','applied','revoked')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  submission jsonb not null default '{}',
  files jsonb not null default '{}'
);
create index if not exists form_invites_employee_idx on public.form_invites (employee_id);
alter table public.form_invites enable row level security;
drop policy if exists "auth all" on public.form_invites;
create policy "auth all" on public.form_invites for all to authenticated using (true) with check (true);

-- What the candidate sees: details staff already entered (pre-filled) and anything they already submitted.
-- Sensitive identifiers (Aadhaar, PAN, account no., IFSC, UAN, previous PF no.) are NEVER sent back — only a list of which
-- ones are on file — because the link is a bearer token and could be forwarded.
create or replace function public.invite_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.form_invites; e public.employees; pre jsonb; onfile jsonb;
  sensitive text[] := array['aadhaar','pan','account_no','ifsc','uan','prev_pf_no'];
  shown text[] := array['father_spouse_name','father_spouse_type','dob','gender','marital_status','religion','blood_group','alt_phone',
    'permanent_address','current_address','city','district','state','pin','bank_name','bank_branch',
    'nominee_name','nominee_relation','nominee_age_dob','nominee_address','nominee_phone','emergency_name','emergency_phone'];
begin
  select * into i from public.form_invites where token = p_token;
  if not found or i.status = 'revoked' or i.expires_at < now() then return null; end if;
  select * into e from public.employees where id = i.employee_id;
  select coalesce(jsonb_object_agg(key, value), '{}') into pre from jsonb_each(to_jsonb(e))
    where key = any(shown) and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
  select coalesce(jsonb_agg(key), '[]') into onfile from jsonb_each(to_jsonb(e))
    where key = any(sensitive) and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
  return jsonb_build_object('employee_id', e.id, 'status', i.status, 'name', e.full_name, 'phone', e.phone, 'email', e.email,
                            'prefill', pre, 'on_file', onfile, 'submission', i.submission, 'files', i.files);
end $$;

-- Stores the candidate's answers. Only whitelisted keys, text only, max 500 chars each. Allowed until staff apply it.
create or replace function public.invite_submit(p_token text, p_data jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare i public.form_invites;
  allowed text[] := array['full_name','father_spouse_name','father_spouse_type','dob','gender','marital_status','religion','blood_group','email','phone','alt_phone',
    'permanent_address','current_address','city','district','state','pin','aadhaar','pan','bank_name','bank_branch','account_no','ifsc','uan','prev_pf_no',
    'nominee_name','nominee_relation','nominee_age_dob','nominee_address','nominee_phone','emergency_name','emergency_phone'];
  clean jsonb;
begin
  select * into i from public.form_invites where token = p_token;
  if not found or i.status not in ('sent','submitted') or i.expires_at < now() then return false; end if;
  select coalesce(jsonb_object_agg(key, left(value #>> '{}', 500)), '{}') into clean
    from jsonb_each(p_data) where key = any(allowed) and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
  update public.form_invites set submission = clean, status = 'submitted', submitted_at = now() where id = i.id;
  return true;
end $$;

-- Records that a file was uploaded (the file itself goes through /api/apply/upload into R2).
create or replace function public.invite_file(p_token text, p_doc text, p_path text) returns boolean
language plpgsql security definer set search_path = public as $$
declare i public.form_invites;
begin
  if p_doc <> all (array['aadhaar','pan','bank','uan','photo','resume']) or p_path is null or p_path like '%..%' then return false; end if;
  select * into i from public.form_invites where token = p_token;
  if not found or i.status not in ('sent','submitted') or i.expires_at < now() then return false; end if;
  update public.form_invites set files = files || jsonb_build_object(p_doc, p_path) where id = i.id;
  return true;
end $$;

revoke all on function public.invite_get(text), public.invite_submit(text, jsonb), public.invite_file(text, text, text) from public;
grant execute on function public.invite_get(text), public.invite_submit(text, jsonb), public.invite_file(text, text, text) to anon, authenticated;
