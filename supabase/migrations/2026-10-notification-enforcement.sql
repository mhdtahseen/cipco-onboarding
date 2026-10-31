-- Notification enforcement: sign ONE person out, and show who has reminders switched on. Safe to run again. Run it in the SQL editor, AFTER 2026-10-force-relogin.sql.
--
--   admin_sign_out_user(user)   Admin only. Signs that one person out: saves the moment (like "sign everyone out", but for one login) and removes their saved sessions,
--                               so at their next tap they are sent to the sign-in page. Nobody else is affected. You cannot do it to yourself.
--   relogin_before()            now answers for the person asking: the later of the "everyone" moment and their own moment.
--   admin_list_users()          now also says how many phones each login has registered for reminders (push_devices) and when one was last registered.

create or replace function public.relogin_before() returns timestamptz language sql stable security definer set search_path = public as $$
  select max(t) from (
    select nullif(btrim(value), '')::timestamptz as t from public.app_settings where key = 'relogin_before'
    union all
    select nullif(btrim(value), '')::timestamptz from public.app_settings where key = 'relogin_user:' || coalesce(auth.uid()::text, '-')
  ) x $$;

create or replace function public.admin_sign_out_user(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_user = auth.uid() then raise exception 'You cannot sign yourself out here: use Sign out.'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'No such login.'; end if;
  insert into public.app_settings (key, value, updated_at) values ('relogin_user:' || p_user::text, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  begin
    delete from auth.sessions where user_id = p_user;
  exception when others then
    raise notice 'Could not remove saved sessions (%). Their login still ends within an hour, as the token renews.', sqlerrm;
  end;
end $$;
revoke all on function public.admin_sign_out_user(uuid) from public, anon;
grant execute on function public.admin_sign_out_user(uuid) to authenticated;

drop function if exists public.admin_list_users();
create function public.admin_list_users() returns table (user_id uuid, email text, full_name text, last_sign_in_at timestamptz, role text, project_ids uuid[], push_devices int, push_last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query select u.id, u.email::text, coalesce(p.full_name, ''), u.last_sign_in_at, r.role,
    coalesce(array(select up.project_id from public.user_projects up where up.user_id = u.id), '{}'::uuid[]),
    (select count(*)::int from public.push_subscriptions s where s.user_id = u.id),
    (select max(s.created_at) from public.push_subscriptions s where s.user_id = u.id)
  from auth.users u left join public.user_roles r on r.user_id = u.id left join public.user_profiles p on p.user_id = u.id order by u.email;
end $$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
