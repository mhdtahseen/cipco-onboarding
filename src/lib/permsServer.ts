import type { SupabaseClient } from "@supabase/supabase-js";
import { levelRank } from "./permissions";

/** May the signed-in person look at this module (or tab) of the permission matrix? Asked of the database (perm_level, 2026-11-role-permissions.sql), so it matches what the row-level rules allow.
 *  Before that migration exists, the old rule holds: an Admin or a Viewer. */
export async function mayView(sb: SupabaseClient, module: string, tab?: string): Promise<boolean> {
  const { data: admin } = await sb.rpc("is_admin"); if (admin) return true;
  const { data, error } = await sb.rpc("perm_level", { p_module: tab ? `${module}.${tab}` : module });
  if (!error && typeof data === "string") return levelRank(data) > 0;
  const { data: viewer } = await sb.rpc("is_viewer"); return !!viewer;
}
