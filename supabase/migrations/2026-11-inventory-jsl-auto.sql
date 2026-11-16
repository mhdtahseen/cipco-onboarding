-- JSL portal: bills that were authorized but not sent go out by themselves at 08:30 India time, Monday to Saturday (16 Nov 2026).
-- Run AFTER 2026-11-inventory-jsl-send.sql. Safe to run more than once. Nothing here removes data.
--
-- The app's 5-minute job (/api/cron/day-watch) calls inventory_jsl_auto_next from 08:30 IST on Monday to Saturday. Each call:
--   1. settles a run that went quiet (as "Check status" does), so a stuck bill never blocks the others;
--   2. does nothing while another bill is with the robot (sending / submitting): one portal login, one bill at a time;
--   3. otherwise queues the oldest bill authorized BEFORE 08:30 today and not yet tried automatically today. The app then starts the robot.
-- The same safety rules as the Send button: a failure before Save is "failed", after Save "needs_check", and NOTHING is retried by itself.
-- A bill that failed stays failed until an Admin authorizes it again. Only the app's server (service role) can call these.

create or replace function public.inventory_jsl_auto_next() returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.inventory_bills; r public.inventory_jsl_run; cutoff timestamptz; today_start timestamptz;
begin
  today_start := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
  cutoff := today_start + interval '8 hours 30 minutes';
  if now() < cutoff then return jsonb_build_object('waiting', 'before 08:30'); end if;
  if extract(isodow from now() at time zone 'Asia/Kolkata') = 7 then return jsonb_build_object('waiting', 'Sunday'); end if;

  -- 1. a run that went quiet: the same rule as inventory_jsl_settle
  for b in select * from public.inventory_bills where jsl_status in ('sending', 'submitting') for update loop
    select * into r from public.inventory_jsl_run where bill_id = b.id;
    perform set_config('app.inventory', '1', true);
    if b.jsl_status = 'sending' and coalesce(r.queued_at, now() - interval '1 day') < now() - interval '20 minutes' then
      update public.inventory_bills set jsl_status = 'failed', jsl_error = 'The robot did not finish. Save was never pressed, so nothing is on the portal.' where id = b.id;
      perform public.inventory_jsl_note(b.id, 'settled', 'failed');
    elsif b.jsl_status = 'submitting' and coalesce(r.saving_at, now() - interval '1 day') < now() - interval '15 minutes' then
      update public.inventory_bills set jsl_status = 'needs_check', jsl_error = 'The robot went quiet after pressing Save. Look on the portal for ' || coalesce(r.expected_ref, 'this bill''s requisition') || '.' where id = b.id;
      perform public.inventory_jsl_note(b.id, 'settled', 'needs_check');
    end if;
    perform set_config('app.inventory', '', true);
  end loop;

  -- 2. one bill at a time
  if exists (select 1 from public.inventory_bills where jsl_status in ('sending', 'submitting')) then return jsonb_build_object('busy', true); end if;

  -- 3. the oldest bill authorized before 08:30 today, not yet tried automatically today
  select * into b from public.inventory_bills x
   where x.jsl_status = 'authorized' and x.jsl_wanted and x.status = 'recorded' and x.voided_at is null and x.jsl_authorized_at < cutoff
     and not exists (select 1 from public.inventory_jsl_log l where l.bill_id = x.id and l.stage = 'auto_queued' and l.at >= today_start)
   order by x.jsl_authorized_at limit 1 for update skip locked;
  if b.id is null then return jsonb_build_object('done', true); end if;

  perform set_config('app.inventory', '1', true);
  update public.inventory_bills set jsl_status = 'sending', jsl_error = null where id = b.id;
  perform set_config('app.inventory', '', true);
  insert into public.inventory_jsl_run (bill_id, attempts, queued_at, queued_by) values (b.id, 1, now(), null)
    on conflict (bill_id) do update set attempts = public.inventory_jsl_run.attempts + 1, queued_at = now(), queued_by = null, claimed_at = null, saving_at = null, expected_ref = null, updated_at = now();
  perform public.inventory_jsl_note(b.id, 'auto_queued', 'Sent automatically at 08:30');
  return jsonb_build_object('queued', b.id, 'bill_no', b.bill_no);
end $$;

-- GitHub could not be reached: back to authorized (it is not tried again today; the next morning it is).
create or replace function public.inventory_jsl_auto_unqueue(p_bill uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.inventory', '1', true);
  update public.inventory_bills b set jsl_status = 'authorized', jsl_error = left(p_reason, 300) where b.id = p_bill and b.jsl_status = 'sending'
    and not exists (select 1 from public.inventory_jsl_run r where r.bill_id = p_bill and r.claimed_at is not null);
  perform set_config('app.inventory', '', true);
  perform public.inventory_jsl_note(p_bill, 'unqueued', p_reason);
end $$;

-- Today's automatic sends, once they have all finished, for the Admins' notification. Returns nothing until then, and only once a day.
create or replace function public.inventory_jsl_auto_summary() returns jsonb language plpgsql security definer set search_path = public as $$
declare today_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata'; day text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'); out jsonb;
begin
  if exists (select 1 from public.inventory_bills where jsl_status in ('sending', 'submitting')) then return null; end if;
  if exists (select 1 from public.inventory_bills x where x.jsl_status = 'authorized' and x.jsl_wanted and x.status = 'recorded' and x.voided_at is null
              and x.jsl_authorized_at < today_start + interval '8 hours 30 minutes'
              and not exists (select 1 from public.inventory_jsl_log l where l.bill_id = x.id and l.stage = 'auto_queued' and l.at >= today_start)) then return null; end if;
  select jsonb_agg(jsonb_build_object('id', x.id, 'bill_no', x.bill_no, 'project_id', x.project_id, 'status', x.jsl_status, 'ref', x.jsl_ref) order by x.jsl_authorized_at) into out
    from public.inventory_bills x where exists (select 1 from public.inventory_jsl_log l where l.bill_id = x.id and l.stage = 'auto_queued' and l.at >= today_start);
  if out is null then return null; end if;
  insert into public.app_settings (key, value) values ('jsl_auto_summary_on', day) on conflict (key) do update set value = excluded.value where public.app_settings.value is distinct from excluded.value;
  if not found then return null; end if;   -- already told today
  return out;
end $$;

revoke all on function public.inventory_jsl_auto_next(), public.inventory_jsl_auto_unqueue(uuid, text), public.inventory_jsl_auto_summary() from public, anon, authenticated;
grant execute on function public.inventory_jsl_auto_next(), public.inventory_jsl_auto_unqueue(uuid, text), public.inventory_jsl_auto_summary() to service_role;
