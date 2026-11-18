import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { loadBills } from "@/lib/billsData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every bill and receipt, for Expenses → Bills (src/lib/billsData.ts). Who may call it: the Permissions page, Expenses → Bills (Admin only until turned on).
export async function GET() {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  try { return NextResponse.json(await loadBills(sb), { headers: { "cache-control": "private, no-store" } }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
