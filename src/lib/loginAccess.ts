import type { SupabaseClient } from "@supabase/supabase-js";

// Turning a login off completely, and back on. Server only: it needs the service key (adminClient). Used by the Users page / Exit tab button
// (/api/users/login, Admin only) and by the scheduled job just after an employee's last working day (/api/cron/day-watch).
// The ban comes first: once it is in place the password is refused and the phone cannot renew its session. The database then signs the login out
// everywhere, removes its role and sites, and records who did it and why (login_cut_off in 2026-11-login-disable.sql).
const FOREVER = "876000h";   // 100 years: Supabase's way of saying "banned until lifted"

export async function disableLogin(db: SupabaseClient, userId: string, by: string | null, reason: string): Promise<string | null> {
  const { error: banErr } = await db.auth.admin.updateUserById(userId, { ban_duration: FOREVER });
  if (banErr) return `Could not disable the login: ${banErr.message}`;
  const { error } = await db.rpc("login_cut_off", { p_user: userId, p_by: by, p_reason: reason });
  await db.from("usage_events").insert({ user_id: userId, kind: "login_disabled", by_user: by, detail: reason.slice(0, 300) }).then(() => {}, () => {});   // the activity log (if its migration is run)
  return error ? `The login is disabled, but signing it out did not finish: ${error.message}` : null;
}

export async function enableLogin(db: SupabaseClient, userId: string, by: string | null = null): Promise<string | null> {
  const { error: e } = await db.auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (e) return `Could not enable the login: ${e.message}`;
  const { error } = await db.rpc("login_restore", { p_user: userId });
  await db.from("usage_events").insert({ user_id: userId, kind: "login_enabled", by_user: by }).then(() => {}, () => {});
  return error ? error.message : null;
}

/** For the scheduled job: disable every linked login whose employee's last working day is over. Returns what was done. */
export async function disableLeavers(db: SupabaseClient): Promise<{ disabled: string[]; failed: string[] }> {
  const { data, error } = await db.rpc("logins_due_to_disable");
  if (error || !data) return { disabled: [], failed: error ? [error.message] : [] };   // before the migration is run the function does not exist: nothing to do
  const out = { disabled: [] as string[], failed: [] as string[] };
  for (const r of data as { user_id: string; full_name: string; last_day: string; exit_type: string }[]) {
    const e = await disableLogin(db, r.user_id, null, `Automatic: last working day ${r.last_day} (${r.exit_type.replace("_", " ")})`);
    (e ? out.failed : out.disabled).push(e ? `${r.full_name}: ${e}` : r.full_name);
  }
  return out;
}
