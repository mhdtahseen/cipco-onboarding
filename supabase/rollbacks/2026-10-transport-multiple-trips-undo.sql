-- UNDO of 2026-10-transport-multiple-trips.sql. Run it in the Supabase SQL editor. Safe to run again.
-- It puts transport_runs back to one record per vehicle, day and direction, and removes the trip rules.
--
-- It will NOT delete anything by itself. If any extra trips (trip 2, 3…) have been recorded it stops with a message, because
-- the old rule (one record per vehicle + day + direction) cannot hold alongside them. To see them first, run:
--     select work_date, leg, vehicle_id, trip_no, at from public.transport_runs where trip_no > 1 order by work_date, leg, trip_no;
-- If you really want to throw those extra trips away (they are billed as trips, so this lowers what a per-trip vehicle is owed), delete them first:
--     delete from public.transport_runs where trip_no > 1;     -- later trips go first automatically, because they are all removed together
-- and then run this file.
--
-- Everything runs in one transaction: if any step fails, nothing is changed.

begin;

do $$ declare n int; begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transport_runs' and column_name = 'trip_no') then
    select count(*) into n from public.transport_runs where trip_no > 1;
    if n > 0 then
      raise exception '% extra trip(s) are recorded (trip 2 or later). Nothing was changed. See the note at the top of this file: look at them, then delete them on purpose if you want, and run this again.', n;
    end if;
  end if;
end $$;

-- 1. the trip rules go first
drop trigger if exists transport_run_trip_guard_trg on public.transport_runs;
drop function if exists public.transport_run_trip_guard();

-- 2. back to one record per vehicle, day and direction
drop index if exists public.transport_runs_trip_uq;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.transport_runs'::regclass and contype = 'u' and pg_get_constraintdef(oid) ilike '%(vehicle_id, work_date, leg)%') then
    alter table public.transport_runs add constraint transport_runs_vehicle_id_work_date_leg_key unique (vehicle_id, work_date, leg);
  end if;
end $$;

-- 3. the trip number itself
alter table public.transport_runs drop constraint if exists transport_runs_trip_no_range;
alter table public.transport_runs drop column if exists trip_no;

commit;

-- To check afterwards (expect: no trip_no column, the unique rule on vehicle + day + leg, and no transport_run_trip_guard_trg trigger):
--   select column_name from information_schema.columns where table_schema = 'public' and table_name = 'transport_runs' and column_name = 'trip_no';
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.transport_runs'::regclass and contype = 'u';
--   select tgname from pg_trigger where tgrelid = 'public.transport_runs'::regclass and not tgisinternal;
