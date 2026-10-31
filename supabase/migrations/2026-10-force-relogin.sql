-- Signs EVERYONE out, so each person signs in again and the app asks for notification and location permission. Run it LAST, after the other four files and after the
-- new version of the app is live. Safe to run again (each run signs everyone out again).
--
-- Two things happen:
--   1. the moment is saved as relogin_before. The app's page guard turns away any session that began before it, so people are sent to the sign-in page at their next
--      tap (their sign-in time is checked, so a quietly renewed session does not get around it).
--   2. every saved session is removed, so a phone cannot quietly renew its way past the guard.
-- You will be signed out too, and need to sign in again.

insert into public.app_settings (key, value, updated_at) values ('relogin_before', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now())
on conflict (key) do update set value = excluded.value, updated_at = now();

do $$ begin
  delete from auth.sessions;
exception when others then
  raise notice 'Could not remove saved sessions (%). That is fine: the relogin_before time above still signs everyone out as their login token renews (within an hour).', sqlerrm;
end $$;
