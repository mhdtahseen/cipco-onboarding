"use client";
import { supabase } from "./supabase/client";
import type { Role } from "./roles";
import { swrClear } from "./swr";

export type Me = { userId: string; email: string; name: string; role: Role };

// Who is signed in, their role and their name: fetched ONCE per browser tab and shared by the shell and every screen that asks.
// Before this each of them asked Supabase separately ("who is this?", then the role, then the profile): several round trips in a row on every page.
// The user comes from the saved session (no network call; the database still checks every request against the real login), and the cache is keyed by user,
// so signing out and in as someone else loads fresh. Call resetMe() after changing a role or name so the next read is current.
let cache: { uid: string; promise: Promise<Me> } | null = null;
let resolved: Me | null = null;
let lastUid: string | null = null;   // who filled the list cache, so it is emptied only when that actually changes

async function fetchMe(uid: string, email: string): Promise<Me> {
  const sb = supabase();
  const [r, p] = await Promise.all([sb.from("user_roles").select("role").eq("user_id", uid).maybeSingle(), sb.from("user_profiles").select("full_name").eq("user_id", uid).maybeSingle()]);
  // If the roles table does not exist yet (migration not run) everyone is treated as admin, so nobody is locked out.
  const raw = r.error ? "admin" : ((r.data?.role as string) ?? "none");
  return { userId: uid, email, name: ((p.data?.full_name as string) || "").trim(), role: (raw === "attendance" ? "supervisor" : raw) as Role };
}

/** The signed-in user, or null if nobody is. Repeated calls share one fetch. */
export async function loadMe(): Promise<Me | null> {
  const { data } = await supabase().auth.getSession();
  const u = data.session?.user;
  if (!u) { cache = null; resolved = null; lastUid = null; swrClear(); return null; }
  if (lastUid !== u.id) { if (lastUid !== null) swrClear(); lastUid = u.id; }   // a different person: nothing the last one loaded may be shown
  if (cache?.uid !== u.id) {
    resolved = null;
    const promise = fetchMe(u.id, u.email ?? "").then((me) => { resolved = me; return me; }, (e) => { cache = null; throw e; });
    cache = { uid: u.id, promise };
  }
  return cache.promise;
}

/** What is already known, with no waiting, so a screen opened after the first can show the right thing at once. */
export const peekMe = (): Me | null => resolved;

/** Forget what is cached (after a role or name changes) so the next read fetches it again. */
export const resetMe = () => { cache = null; resolved = null; };

