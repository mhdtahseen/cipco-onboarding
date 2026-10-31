import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { adminClient } from "@/lib/supabase/admin";
import { sendPush } from "@/lib/push";
import { decideNotices, istDate, istMinutes, WATCH_FROM, WATCH_UNTIL, type Snapshot } from "@/lib/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called every 5 minutes by the database's scheduled job (see 2026-10-push-and-reminders.sql), with the shared secret. It looks at today's state of every active
// project, decides who is due a reminder (src/lib/reminders.ts), records each one so it is sent only once, and delivers it.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || ""; const got = req.headers.get("x-cron-secret") || "";
  const a = Buffer.from(secret), b = Buffer.from(got);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const now = new Date(), minutes = istMinutes(now), date = istDate(now);
  if (minutes < WATCH_FROM || minutes > WATCH_UNTIL) return NextResponse.json({ ok: true, skipped: "outside 08:00 to 23:30 India time" });
  let db: ReturnType<typeof adminClient>; try { db = adminClient(); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
  const { data, error } = await db.rpc("day_watch_snapshot", { p_date: date });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const sent: { project: string; kind: string; devices: number }[] = [];
  for (const n of decideNotices(minutes, data as Snapshot)) {
    // record first: the unique rule means two overlapping runs can never both send the same reminder
    const { error: e } = await db.from("day_notices").insert({ project_id: n.project_id, work_date: date, kind: n.kind, sent_for: n.sent_for, recipients: n.messages.flatMap((m) => m.to), detail: n.detail });
    if (e) { if (e.code !== "23505") console.error("day-watch: could not record", n.kind, e.message); continue; }
    let devices = 0;
    for (const m of n.messages) { const r = await sendPush(m.to, { title: m.title, body: m.body, url: n.url, tag: `${n.kind}-${n.project_id}` }); devices += Object.values(r.devices).reduce((s, x) => s + x, 0); }
    sent.push({ project: n.project_id, kind: n.kind, devices });
  }
  return NextResponse.json({ ok: true, date, minutes, sent });
}
