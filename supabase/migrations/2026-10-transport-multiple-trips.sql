-- A vehicle can make the same run more than once in a day (a second pickup or drop). Safe to run again. Run it in the SQL editor.
--
-- Until now there was one record per vehicle, day and direction (unique on vehicle + day + leg), so a second trip could not be entered and a per-trip vehicle was
-- billed once. Now each trip is its own record: trip_no 1 is the usual "showed" / "no show"; trip 2, 3… are extra trips that happened, each with its own
-- time (the server's clock when recorded) and the person who recorded it. Billing needs no change: per-trip vehicles are billed for every "showed" record.
--
-- Rules, kept in the database so no screen can break them:
--   • a later trip is always "showed", and can only be added once the trip before it showed
--   • trips are removed last first, so the numbering never has a gap
--   • a trip's number cannot be changed, and trip 1 cannot become a no-show while later trips exist
--   • at most 6 trips in a direction

alter table public.transport_runs add column if not exists trip_no smallint not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.transport_runs'::regclass and conname = 'transport_runs_trip_no_range') then
    alter table public.transport_runs add constraint transport_runs_trip_no_range check (trip_no between 1 and 6);
  end if;
end $$;

-- the old rule allowed one record per vehicle + day + leg; it becomes one per vehicle + day + leg + trip
do $$ declare c text; begin
  select conname into c from pg_constraint
   where conrelid = 'public.transport_runs'::regclass and contype = 'u' and pg_get_constraintdef(oid) ilike '%(vehicle_id, work_date, leg)%';
  if c is not null then execute format('alter table public.transport_runs drop constraint %I', c); end if;
end $$;
create unique index if not exists transport_runs_trip_uq on public.transport_runs (vehicle_id, work_date, leg, trip_no);

-- a second, separate guard just for the trip rules (the existing guard, with its role and time rules, is left exactly as it is)
create or replace function public.transport_run_trip_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.transport_runs r where r.vehicle_id = old.vehicle_id and r.work_date = old.work_date and r.leg = old.leg and r.trip_no > old.trip_no) then
      raise exception 'Remove this vehicle''s later trips first.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.trip_no <> old.trip_no then raise exception 'A trip''s number cannot be changed.'; end if;
  if new.trip_no > 1 then
    if new.status <> 'showed' then raise exception 'Only trips that happened are recorded after the first one.'; end if;
    if not exists (select 1 from public.transport_runs r where r.vehicle_id = new.vehicle_id and r.work_date = new.work_date and r.leg = new.leg and r.trip_no = new.trip_no - 1 and r.status = 'showed') then
      raise exception 'Record the earlier trip first.';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.trip_no = 1 and new.status = 'no_show' and exists (select 1 from public.transport_runs r where r.vehicle_id = new.vehicle_id and r.work_date = new.work_date and r.leg = new.leg and r.trip_no > 1) then
    raise exception 'This vehicle has later trips recorded, so its first trip cannot be a no-show.';
  end if;
  return new;
end $$;
-- only the trigger runs it: nobody calls it directly
revoke all on function public.transport_run_trip_guard() from public, anon, authenticated;
drop trigger if exists transport_run_trip_guard_trg on public.transport_runs;
create trigger transport_run_trip_guard_trg before insert or update or delete on public.transport_runs for each row execute function public.transport_run_trip_guard();
