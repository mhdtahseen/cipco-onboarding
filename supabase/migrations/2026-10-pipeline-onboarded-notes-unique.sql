-- Adds the Onboarded stage, call/interview notes, and blocks duplicate candidates.
-- Safe to run more than once. Run AFTER 2026-10-hiring-pipeline.sql.
alter table public.employees add column if not exists call_notes text, add column if not exists interview_notes text;

alter table public.employees drop constraint if exists employees_stage_check;
alter table public.employees add constraint employees_stage_check check (stage in ('resume','call','interview','offer','appointment','forms','onboarded'));

-- Normalise what is already stored so the unique indexes compare like with like.
update public.employees set phone = right(regexp_replace(phone, '\D', '', 'g'), 10) where phone is not null and phone <> '';
update public.employees set phone = null where phone = '';
update public.employees set email = lower(trim(email)) where email is not null;
update public.employees set email = null where email = '';
update public.employees set aadhaar = regexp_replace(aadhaar, '\s', '', 'g') where aadhaar is not null;
update public.employees set aadhaar = null where aadhaar = '';
update public.employees set pan = upper(trim(pan)) where pan is not null;
update public.employees set pan = null where pan = '';

-- One person, one record. If you already have duplicates an index is skipped with a NOTICE — merge/remove them and re-run.
do $$ begin
  begin create unique index employees_phone_uq   on public.employees (phone)   where phone is not null;   exception when others then raise notice 'phone index skipped: %', sqlerrm; end;
  begin create unique index employees_email_uq   on public.employees (email)   where email is not null;   exception when others then raise notice 'email index skipped: %', sqlerrm; end;
  begin create unique index employees_aadhaar_uq on public.employees (aadhaar) where aadhaar is not null; exception when others then raise notice 'aadhaar index skipped: %', sqlerrm; end;
  begin create unique index employees_pan_uq     on public.employees (pan)     where pan is not null;     exception when others then raise notice 'pan index skipped: %', sqlerrm; end;
end $$;
