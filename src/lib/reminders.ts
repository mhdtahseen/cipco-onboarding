// Who to remind about a project's day, and when. Pure (no database, no network) so every time and state can be tested.
// The scheduled job (/api/cron/day-watch) gives it the day's state from the database (day_watch_snapshot) and sends what it returns.
// Each automatic reminder is sent once per project per day, and only if what it checks is still missing, so a Supervisor who keeps up gets none.

export type Readiness = {
  people: number; marked: number; unmarked: number; worked: number; work_day: boolean;
  vehicles: number; legs_expected: number; legs_recorded: number; pickup_missing: number; drop_missing: number;
  meals: { breakfast: number; lunch: number; dinner: number };
  has_supervisor: boolean; complete: boolean; missing: string[];
};
export type WatchProject = {
  project_id: string; name: string; supervisors: string[]; engineers: string[]; r: Readiness;
  submitted_at: string | null; verified_at: string | null; sent: string[]; ready_sent: boolean;
};
export type Snapshot = { date: string; admins: string[]; projects: WatchProject[] };

export type Kind = "morning" | "lunch" | "drop" | "dinner" | "final" | "escalate" | "ready" | "admin_late";
export type Message = { to: string[]; title: string; body: string };
export type Notice = { project_id: string; kind: Kind; sent_for: string | null; url: string; messages: Message[]; detail: { missing: string[] } };

const hm = (h: number, m = 0) => h * 60 + m;
/** Minutes after midnight, India time, at which each reminder becomes due. */
export const DUE = { morning: hm(10, 30), lunch: hm(15), drop: hm(19, 30), dinner: hm(21, 30), final: hm(22), escalate: hm(22, 30), admin_late: hm(23, 5) } as const;
/** A reminder is only sent while it still makes sense: if the scheduler was down and a reminder was missed, the next one in the day covers it (a message about 9:00 login
 *  is not sent at 22:00). Each runs from its DUE time until the next one is due. */
export const UNTIL = { morning: DUE.lunch, lunch: DUE.drop, drop: DUE.dinner, dinner: DUE.final, final: DUE.escalate, escalate: DUE.admin_late, admin_late: hm(23, 30) } as const;
const within = (minutes: number, k: keyof typeof DUE) => minutes >= DUE[k] && minutes < UNTIL[k];
/** Nothing is sent outside these hours (before 08:00; after 23:30). */
export const WATCH_FROM = hm(8), WATCH_UNTIL = hm(23, 30);

export const istMinutes = (now: Date) => { const [h, m] = now.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).split(":").map(Number); return (h % 24) * 60 + m; };
export const istDate = (now: Date) => now.toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }).slice(0, 10);

const list = (items: string[]) => (items.length <= 1 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1]);
const url = (p: WatchProject, date: string) => `/attendance?p=${p.project_id}&d=${date}`;

/** What is due right now for each project. Does not decide whether it has been sent already beyond what the snapshot says; the caller records each notice once. */
export function decideNotices(minutes: number, snap: Snapshot): Notice[] {
  if (minutes < WATCH_FROM || minutes > WATCH_UNTIL) return [];
  const out: Notice[] = [];
  for (const p of snap.projects) {
    if (p.verified_at) continue;                                           // a verified day needs nothing more
    const r = p.r, done = new Set(p.sent), submitted = !!p.submitted_at, name = p.name;
    const sup = p.supervisors.length ? p.supervisors : snap.admins;        // nobody assigned: the Admin hears instead, so a project never goes silent
    const eng = p.engineers.length ? p.engineers : snap.admins;
    const open = !r.complete || (r.has_supervisor && !submitted);          // still something for the Supervisor to do
    const make = (kind: Kind, messages: Message[], sentFor: string | null = null): void => {
      const seen = new Set<string>(); const kept: Message[] = [];
      for (const m of messages) { const to = m.to.filter((id) => !seen.has(id)); to.forEach((id) => seen.add(id)); if (to.length) kept.push({ ...m, to }); }   // each person gets one message per reminder, the most specific first
      if (kept.length) out.push({ project_id: p.project_id, kind, sent_for: sentFor, url: url(p, snap.date), messages: kept, detail: { missing: r.missing } });
    };

    // 10:30: attendance, the pickup and breakfast (login is at 9:00)
    if (within(minutes, "morning") && !done.has("morning")) {
      const what: string[] = []; if (r.unmarked > 0) what.push("attendance"); if (r.work_day && r.pickup_missing > 0) what.push("pickup"); if (r.work_day && r.meals.breakfast === 0) what.push("breakfast");
      if (what.length) make("morning", [
        { to: sup, title: `${name} · tracker`, body: `${name}: ${list(what)} ${what.length > 1 ? "aren't" : "isn't"} recorded yet. Login was 9:00. Please update the tracker.` },
        { to: eng, title: `${name} · not updated`, body: `${name}: ${list(what)} still ${what.length > 1 ? "aren't" : "isn't"} recorded at 10:30. Please follow up with the Supervisor.` }]);
    }
    if (within(minutes, "lunch") && !done.has("lunch") && r.work_day && r.meals.lunch === 0)
      make("lunch", [{ to: sup, title: `${name} · tracker`, body: `${name}: lunch isn't recorded yet. If nobody had lunch, you can ignore this.` }]);
    if (within(minutes, "drop") && !done.has("drop") && r.work_day && r.drop_missing > 0)
      make("drop", [{ to: sup, title: `${name} · tracker`, body: `${name}: the drop isn't recorded for ${r.drop_missing} vehicle${r.drop_missing > 1 ? "s" : ""} yet.` }]);
    if (within(minutes, "dinner") && !done.has("dinner") && r.work_day && r.meals.dinner === 0)
      make("dinner", [{ to: sup, title: `${name} · tracker`, body: `${name}: dinner isn't recorded yet. If nobody had dinner, you can ignore this.` }]);

    // 22:00 final call, 22:30 escalation to the Admin
    const missing = r.missing.join("; ");
    const finalMsgs = (lead: string): Message[] => r.complete
      ? [{ to: sup, title: `${name} · submit the day`, body: `${name}: everything is recorded. ${lead}Tap Submit day.` }, { to: eng, title: `${name} · not submitted`, body: `${name}: the Supervisor hasn't submitted the day yet.` }]
      : [{ to: sup, title: `${name} · finish the tracker`, body: `${name}: still incomplete: ${missing}. ${lead}Please finish now.` }, { to: eng, title: `${name} · still incomplete`, body: `${name}: the day is still incomplete: ${missing}.` }];
    if (within(minutes, "final") && !done.has("final") && open) make("final", finalMsgs("It must be done by 22:30. "));
    if (within(minutes, "escalate") && !done.has("escalate") && open) make("escalate", [...finalMsgs("Last call. "), { to: snap.admins, title: `${name} · not completed`, body: `${name}: the Supervisor hasn't completed the day by 22:30. ${r.complete ? "Everything is recorded but not submitted." : missing}` }]);

    // as soon as a complete day is submitted, the Site Engineer is told (once per submission)
    if (r.complete && submitted && !p.ready_sent && r.has_supervisor)
      make("ready", [{ to: eng, title: `${name} · ready to verify`, body: `${name} is complete and ready for you to verify and close.` }], p.submitted_at);

    // 23:05: nobody but an Admin can change it now
    if (within(minutes, "admin_late") && !done.has("admin_late") && r.work_day)
      make("admin_late", [{ to: snap.admins, title: `${name} · not verified`, body: `${name} wasn't verified by 23:00. Only an Admin can close it now.${r.complete ? "" : " It is also incomplete: " + missing}` }]);
  }
  return out;
}
