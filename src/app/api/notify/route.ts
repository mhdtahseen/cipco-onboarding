import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { sendPush, type PushResult } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Notify supervisor" / "Notify site engineer": the Site Engineer or Admin asks the Supervisor(s) of a project to update today's tracker, or an Admin asks the Site Engineer(s)
// to look at it. The database decides whether they may (and refuses a repeat within 30 minutes per person asked, and says what is missing); this only delivers it and
// reports whether it reached a phone. Before the day-grants migration is run, only the Supervisor reminder works (it falls back to the older function).
export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const b = await req.json().catch(() => null) as { project_id?: string; date?: string; to?: string } | null;
  if (!b?.project_id || !/^[0-9a-f-]{36}$/.test(b.project_id) || !b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const to = b.to === "site_engineer" ? "site_engineer" : "supervisor";
  let { data, error } = await sb.rpc("nudge_day", { p_project: b.project_id, p_date: b.date, p_to: to });
  if (error && to === "supervisor" && /nudge_day/.test(error.message) && /(find|exist|schema cache)/i.test(error.message)) ({ data, error } = await sb.rpc("nudge_supervisor", { p_project: b.project_id, p_date: b.date }));
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const r = data as { title: string; body: string; url: string; recipients: { user_id: string; name: string }[] };
  let res: PushResult; try { res = await sendPush(r.recipients.map((x) => x.user_id), { title: r.title, body: r.body, url: r.url, tag: `nudge-${to}-${b.project_id}` }); } catch { res = { configured: false, devices: {} }; }
  return NextResponse.json({ ok: true, configured: res.configured, recipients: r.recipients.map((x) => ({ name: x.name, devices: res.devices[x.user_id] ?? 0 })) });
}
