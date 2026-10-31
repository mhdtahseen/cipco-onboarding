-- UNDO of 2026-10-notification-enforcement.sql. Run it in the Supabase SQL editor. Safe to run again.
-- Puts relogin_before() and admin_list_users() back as they were and removes admin_sign_out_user. Saved per-person sign-out moments are deleted.
-- Do this only after the app version that uses the new columns is gone (the Users page reads push_devices), or the page just shows no alert status.
begin;
create or replace function public.relogin_before() returns timestamptz language sql stable security definer set search_path = public as $$
  select nullif(btrim(value), '')::timestamptz from public.app_settings where key = 'relogin_before' $$;
drop function if exists public.admin_sign_out_user(uuid);
delete from public.app_settings where key like 'relogin_user:%';
drop function if exists public.admin_list_users();
create function public.admin_list_users() returns table (user_id uuid, email text, full_name text, last_sign_in_at timestamptz, role text, project_ids uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query select u.id, u.email::text, coalesce(p.full_name, ''), u.last_sign_in_at, r.role,
    coalesce(array(select up.project_id from public.user_projects up where up.user_id = u.id), '{}'::uuid[])
  from auth.users u left join public.user_roles r on r.user_id = u.id left join public.user_profiles p on p.user_id = u.id order by u.email;
end $$;
commit;
