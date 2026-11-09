-- The candidate self-fill page shows details already on file, masked: only the LAST 4 characters of the sensitive ones (Aadhaar, PAN, bank account, IFSC, UAN, previous PF).
-- The masking happens here, in the database, so the full value never reaches the browser. A value shorter than 8 characters shows no characters at all.
-- Same as invite_get in 2026-10-candidate-form-invites.sql, plus 'on_file_masked' ({ "aadhaar": "1234", ... }). Not applied automatically.
create or replace function public.invite_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i public.form_invites; e public.employees; pre jsonb; onfile jsonb; masked jsonb;
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
  select coalesce(jsonb_object_agg(key, case when length(regexp_replace(value #>> '{}', '\s', '', 'g')) >= 8 then right(regexp_replace(value #>> '{}', '\s', '', 'g'), 4) else '' end), '{}') into masked
    from jsonb_each(to_jsonb(e))
    where key = any(sensitive) and jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '';
  return jsonb_build_object('employee_id', e.id, 'status', i.status, 'name', e.full_name, 'phone', e.phone, 'email', e.email,
                            'prefill', pre, 'on_file', onfile, 'on_file_masked', masked, 'submission', i.submission, 'files', i.files);
end $$;
