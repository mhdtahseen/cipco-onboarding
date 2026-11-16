import type { adminClient } from "./supabase/admin";
import { sendPush } from "./push";
import { sendSetupProblem, startRobot } from "./jslWorker";

// Bills authorized for the JSL portal but not sent go out by themselves from 08:30 India time, Monday to Saturday (2026-11-inventory-jsl-auto.sql).
// Called by the 5-minute job. The database decides what is due and keeps it to one bill at a time; here the robot is started for it, exactly as the Send button does.
// Once the morning's sends have all finished, the Admins get one notification with the outcome.
type Db = ReturnType<typeof adminClient>;
type Summary = { id: string; bill_no: string; status: string; ref: string | null }[];

export async function jslAutoSend(db: Db): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("inventory_jsl_auto_next");
  if (error) return error.code === "PGRST202" ? { off: "2026-11-inventory-jsl-auto.sql is not run yet" } : { error: error.message };
  const step = (data ?? {}) as { queued?: string; bill_no?: string };
  if (step.queued) {
    const failed = sendSetupProblem() ?? (await startRobot(step.queued));
    if (failed) { await db.rpc("inventory_jsl_auto_unqueue", { p_bill: step.queued, p_reason: `Automatic send: ${failed}` }); return { ...step, started: false, problem: failed }; }
    return { ...step, started: true };
  }
  const { data: sum } = await db.rpc("inventory_jsl_auto_summary");
  const done = (sum ?? null) as Summary | null;
  if (done?.length) await tellAdmins(db, done);
  return { ...step, summary: done?.length ?? 0 };
}

async function tellAdmins(db: Db, done: Summary) {
  const { data } = await db.from("user_roles").select("user_id").eq("role", "admin");
  const admins = (data ?? []).map((r: { user_id: string }) => r.user_id); if (!admins.length) return;
  const sent = done.filter((b) => b.status === "submitted"), other = done.filter((b) => b.status !== "submitted");
  const word = (s: string) => (s === "needs_check" ? "needs a check on the portal" : s === "failed" ? "failed, nothing on the portal" : s === "authorized" ? "could not start, will try tomorrow" : s);
  const body = [sent.length ? `${sent.length} sent: ${sent.map((b) => `${b.bill_no}${b.ref ? ` (${b.ref})` : ""}`).join(", ")}` : "", ...other.map((b) => `Bill ${b.bill_no} ${word(b.status)}`)].filter(Boolean).join(". ");
  await sendPush(admins, { title: other.length ? "JSL portal: automatic send needs a look" : "JSL portal: automatic send done", body, url: "/inventory", tag: "jsl-auto" }).catch(() => {});
}
