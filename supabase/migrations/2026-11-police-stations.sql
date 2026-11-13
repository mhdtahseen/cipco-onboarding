-- India's police stations, by state and police district, for picking "the police station of the permanent address" (the Gujarat PCC form)
-- on the candidate self-fill link and on the employee form. Safe to run more than once. Until it and the seed are run, both forms keep plain text boxes.
-- The list comes from the Passport Seva "Know your police station" page (scripts/police-stations.py, 13 Nov 2026: 37 states, 853 police districts,
-- about 15,100 stations). Load it with supabase/seed/police-stations.sql AFTER this file; re-running the seed replaces the list.
-- "district" is the POLICE district the passport office uses (e.g. "Surat City", "Surat Rural", "East-Kutch Gandhidham"), not always the revenue district.
-- The list is public information, so the three look-up functions are open to the self-fill page (anon) as well as signed-in users. Nothing else is exposed.

create table if not exists public.police_stations (
  id bigint generated always as identity primary key,
  state text not null,
  district text not null,
  name text not null
);
create unique index if not exists police_stations_uq on public.police_stations (state, district, name);
create index if not exists police_stations_state_district on public.police_stations (state, district);
alter table public.police_stations enable row level security;
drop policy if exists "read police stations" on public.police_stations;
create policy "read police stations" on public.police_stations for select to authenticated using (true);

-- the states, the police districts of a state, and the stations of a district (each sorted by name)
create or replace function public.ps_states() returns setof text language sql stable security definer set search_path = public as $$
  select distinct state from public.police_stations order by state $$;
create or replace function public.ps_districts(p_state text) returns setof text language sql stable security definer set search_path = public as $$
  select distinct district from public.police_stations where state = p_state order by district $$;
create or replace function public.ps_stations(p_state text, p_district text) returns setof text language sql stable security definer set search_path = public as $$
  select name from public.police_stations where state = p_state and district = p_district order by name $$;
revoke all on function public.ps_states(), public.ps_districts(text), public.ps_stations(text, text) from public;
grant execute on function public.ps_states(), public.ps_districts(text), public.ps_stations(text, text) to anon, authenticated;

-- Nothing new on employees: the address State and District are now picked from these lists (State → District → City → PIN), and the chosen station
-- goes into employees.native_police_station (2026-11-pcc-form.sql), as the PCC form prints it.
