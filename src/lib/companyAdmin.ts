import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverClient } from "./supabase/server";

// The Company page's routes are Admin only. The page guard (nav.ts) already refuses everyone else; this asks the database as well, so a route can never
// be reached by someone who is not an Admin. Returns the person's database client, or the response to send back.
export async function companyAdmin(): Promise<{ sb: SupabaseClient; uid: string } | { res: NextResponse }> {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser();
  if (!u.user) return { res: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) };
  const { data: admin } = await sb.rpc("is_admin");
  if (!admin) return { res: NextResponse.json({ error: "Only an Admin can open the company documents." }, { status: 403 }) };
  return { sb: sb as unknown as SupabaseClient, uid: u.user.id };
}
/** A file name that keeps its extension and reads well when saved: "GST registration certificate.pdf". */
export const fileNameFor = (title: string, stored: string | null | undefined) => {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(stored || "")?.[1]?.toLowerCase();
  const base = title.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "document";
  return ext ? `${base}.${ext}` : base;
};
