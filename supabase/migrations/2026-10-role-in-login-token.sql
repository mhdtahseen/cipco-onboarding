-- Puts each person's role INSIDE their login token (as the claim "app_role"), so the page guard in src/middleware.ts can read it from the token itself
-- instead of asking the database on every request. Safe to run again.
--
-- TWO STEPS (the second cannot be done in SQL):
--   1. Run this file in the SQL editor.
--   2. Supabase dashboard → Authentication → Hooks → "Customize Access Token (JWT) Claims" → choose  public.custom_access_token_hook  → Save.
--      People pick up the claim the next time their login token is renewed (within an hour) or when they sign in again.
-- Until step 2 is done nothing changes: the middleware falls back to looking the role up, as it does today. So this is safe to deploy first.
--
-- Good to know
--   - The claim is signed with the project's key, so it cannot be forged. It is named app_role because "role" is reserved by Postgres for the database role.
--   - A role change reaches the PAGE GUARD when the person's token is next renewed (up to an hour), or at their next sign-in. The database does not use this
--     claim: every read and write is still checked against the live user_roles table, so a removed or demoted person loses data access immediately.
--   - The hook never blocks a sign-in: if anything goes wrong it returns the token unchanged and the middleware falls back to the database lookup.

create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare claims jsonb; r text;
begin
  begin
    select role into r from public.user_roles where user_id = (event ->> 'user_id')::uuid;
    claims := coalesce(event -> 'claims', '{}'::jsonb);
    claims := jsonb_set(claims, '{app_role}', to_jsonb(coalesce(r, 'none')));
    return jsonb_set(event, '{claims}', claims);
  exception when others then
    return event;   -- never stop someone signing in because of this
  end;
end $$;

-- only Supabase's auth service may run it; nobody can call it from the app
revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
