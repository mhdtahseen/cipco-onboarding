-- Practice mode: a person (e.g. a Supervisor not yet officially onboarded) uses the app with their real role and the real data, but nothing they
-- change is saved. The app keeps their "saves" in the browser only (src/lib/supabase/practice.ts) and a refresh resets them.
-- Set from Admin → Users (the Practice mode tick). Only an Admin can change user_roles (policy "admin manages roles"), so the person cannot turn it off.
-- Note: this is enforced by the app, not by the database; the person still has their role's database rights.

alter table public.user_roles add column if not exists practice boolean not null default false;
