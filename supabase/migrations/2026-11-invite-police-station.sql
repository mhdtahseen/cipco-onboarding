-- Candidate self-fill link: the police station of the permanent address, for projects that need police verification (the Gujarat PCC form).
-- Run AFTER 2026-11-pcc-form.sql (projects.police_verification, employees.native_police_station) and 2026-11-invite-masked-on-file.sql. Safe to run more than once.
--   invite_get     also returns needs_pcc (the person's project has police_verification on) and pre-fills native_police_station if it is already on file
--   invite_submit  also accepts native_police_station
-- Staff apply it like any other answer (InviteCard); the PCC form already prints it.

create or replace function public.invite_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.form_invites; e public.employees; pre jsonb; onfile jsonb; masked jsonb; pcc boolean;
  sensitive text[] := array['aadhaar','pan','account_no','ifsc','uan','prev_pf_no'];
  shown text[] := array['father_spouse_name','father_spouse_type','dob','gender','marital_status','religion','blood_group','alt_phone',
    'permanent_address','native_police_station','current_address','city','district','state','pin','bank_name','bank_branch',
    'nominee_name','nominee_relation','nominee_age_dob','nominee_address','nominee_phone','emergency_name','emergency_phone'];
begin
  select * into i from public.form_invites where token = p_token;
  if not found or i.status = 'revoked' or i.expires_at < now() then return null; end if;
  select * into e from public.employees where id = i.employee_id;
  select coalesce(p.police_verification, false) into pcc from public.projects p where p.id = e.project_id;
  select coalesce(jsonb_object_agg(key, value), '{}') into pre from jsonb_each(to_jsonb(e))
    where key = any(shown) and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
  select coalesce(jsonb_agg(key), '[]') into onfile from jsonb_each(to_jsonb(e))
    where key = any(sensitive) and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
  select coalesce(jsonb_object_agg(key, case when length(regexp_replace(value #>> '{}', '\s', '', 'g')) >= 8 then right(regexp_replace(value #>> '{}', '\s', '', 'g'), 4) else '' end), '{}') into masked
    from jsonb_each(to_jsonb(e))
    where key = any(sensitive) and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
  return jsonb_build_object('employee_id', e.id, 'status', i.status, 'name', e.full_name, 'phone', e.phone, 'email', e.email,
                            'prefill', pre, 'on_file', onfile, 'on_file_masked', masked, 'submission', i.submission, 'files', i.files,
                            'needs_pcc', coalesce(pcc, false));
end $$;

create or replace function public.invite_submit(p_token text, p_data jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare i public.form_invites;
  allowed text[] := array['full_name','father_spouse_name','father_spouse_type','dob','gender','marital_status','religion','blood_group','email','phone','alt_phone',
    'permanent_address','native_police_station','current_address','city','district','state','pin','aadhaar','pan','bank_name','bank_branch','account_no','ifsc','uan','prev_pf_no',
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

revoke all on function public.invite_get(text), public.invite_submit(text, jsonb) from public;
grant execute on function public.invite_get(text), public.invite_submit(text, jsonb) to anon, authenticated;
