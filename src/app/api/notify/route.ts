import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { sendPush, type PushResult } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Notify supervisor": the Site Engineer or Admin asks the Supervisor(s) of a project to update today's tracker. The database decides whether they may
// (and refuses a repeat within 30 minutes, and says what is missing); this only delivers it and reports whether it reached a phone.
export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const b = await req.json().catch(() => null) as { project_id?: string; date?: string } | null;
  if (!b?.project_id || !/^[0-9a-f-]{36}$/.test(b.project_id) || !b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { data, error } = await sb.rpc("nudge_supervisor", { p_project: b.project_id, p_date: b.date });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const r = data as { title: string; body: string; url: string; recipients: { user_id: string; name: string }[] };
  let res: PushResult; try { res = await sendPush(r.recipients.map((x) => x.user_id), { title: r.title, body: r.body, url: r.url, tag: `nudge-${b.project_id}` }); } catch { res = { configured: false, devices: {} }; }
  return NextResponse.json({ ok: true, configured: res.configured, recipients: r.recipients.map((x) => ({ name: x.name, devices: res.devices[x.user_id] ?? 0 })) });
}
