import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The vendor's page enters an errand. Public (no app sign-in): the database checks the link and the phone's session, saves the errand as waiting,
// and says which Admins to tell; this only delivers that notification.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null) as { token?: string; session?: string; date?: string; description?: string; amount?: number; asked_by?: string; from?: unknown; to?: unknown } | null;
  const place = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");
  if (!b?.token || !/^[0-9a-f]{64}$/.test(b.token) || !b.session || !b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc("vendor_add_errand", { p_token: b.token, p_session: b.session, p_date: b.date, p_description: b.description ?? "", p_amount: Number(b.amount), p_asked_by: b.asked_by ?? "", p_from: place(b?.from), p_to: place(b?.to) });
  if (error) return NextResponse.json({ error: error.message, pin: /PIN again/.test(error.message) }, { status: 400 });
  const r = data as { id: string; title: string; body: string; url: string; recipients: string[] };
  try { await sendPush(r.recipients, { title: r.title, body: r.body, url: r.url, tag: `vendor-errand-${r.id}` }); } catch { /* the errand is saved; the badge on Transport shows it even if no phone was reached */ }
  return NextResponse.json({ ok: true });
}
