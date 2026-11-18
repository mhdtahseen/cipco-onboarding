import type { adminClient } from "./supabase/admin";
import { sendPush } from "./push";
import { istDate } from "./reminders";

// Company documents that are about to expire (Company page, valid until): the Admins get a push 30 days before, 7 days before and on the day.
// Called by the 5-minute job in the daytime. Each reminder is recorded first (company_doc_reminders), so it goes once even if two runs overlap; a renewed
// document (new "valid until") starts again. A day missed (the job down) is caught up: the reminder goes on the next run inside its window.
type Db = ReturnType<typeof adminClient>;
const STAGES: { stage: "30" | "7" | "0"; within: number }[] = [{ stage: "0", within: 0 }, { stage: "7", within: 7 }, { stage: "30", within: 30 }];

export async function companyDocReminders(db: Db): Promise<{ sent: number } | { off: string } | { error: string }> {
  const today = istDate(new Date());
  const until30 = new Date(Date.parse(today + "T00:00:00Z") + 30 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await db.from("company_documents").select("id, title, valid_until").is("archived_at", null).not("valid_until", "is", null).lte("valid_until", until30).gte("valid_until", new Date(Date.parse(today + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10));
  if (error) return error.code === "42P01" || error.code === "PGRST205" ? { off: "2026-11-company-profile.sql is not run yet" } : { error: error.message };
  const docs = (data ?? []) as { id: string; title: string; valid_until: string }[]; if (!docs.length) return { sent: 0 };
  const { data: adm } = await db.from("user_roles").select("user_id").eq("role", "admin");
  const admins = (adm ?? []).map((r: { user_id: string }) => r.user_id); if (!admins.length) return { sent: 0 };
  let sent = 0;
  for (const d of docs) {
    const left = Math.round((Date.parse(d.valid_until + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
    const s = STAGES.find((x) => left <= x.within); if (!s) continue;   // the nearest stage it has reached; an earlier, larger one missed is not sent late
    const { error: e } = await db.from("company_doc_reminders").insert({ document_id: d.id, valid_until: d.valid_until, stage: s.stage });
    if (e) continue;   // already sent (or the table is missing)
    const when = left < 0 ? `expired ${-left} day${left === -1 ? "" : "s"} ago` : left === 0 ? "expires today" : `expires in ${left} day${left === 1 ? "" : "s"}`;
    await sendPush(admins, { title: `${d.title} ${when}`, body: `Valid until ${d.valid_until.split("-").reverse().join("/")}. Renew it, then upload the new copy on the Company page.`, url: "/company", tag: `company-doc-${d.id}` }).catch(() => {});
    sent++;
  }
  return { sent };
}
