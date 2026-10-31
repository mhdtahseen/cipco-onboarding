"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { effectiveStatus, fmtTime, isLockedFor, isSupervisorRole, istToday, type AttRow, type DayRow, type Person, type Run, type Vehicle } from "@/lib/attendance";
import { trackEntry } from "@/lib/geo";
import type { Readiness } from "@/lib/reminders";
import PromptDialog, { type PromptSpec } from "./PromptDialog";

type Notice = { kind: string; created_at: string; sent_by: string | null };

// Day sign-off. The Supervisor submits the day, the Site Engineer (or Admin) verifies it.
//   - A day can only be submitted when attendance and transport are complete, and only verified once the Supervisor has submitted it complete: the database enforces
//     this (day_readiness / day_submit / day_verify); the buttons just show why they are off. Meals are watched, never required.
//   - The Site Engineer / Admin can ask the Supervisor to update the tracker ("Notify supervisor"); automatic reminders go out on a schedule too.
//   - Before the day-rules migration is run, the screen falls back to the old behaviour (a list of what looks missing; nothing blocked).
export default function DayBar({ projectId, date, role, day, names, people, rows, vehicles, runs, canWrite, reload }: { projectId: string; date: string; role: string | null; day: DayRow | null; names: Record<string, string>; people: Person[]; rows: Record<string, AttRow>; vehicles: Vehicle[]; runs: Run[]; canWrite: boolean; reload: () => void }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [info, setInfo] = useState("");
  const [r, setR] = useState<Readiness | null>(null); const [notices, setNotices] = useState<Notice[]>([]); const [dlg, setDlg] = useState<PromptSpec | null>(null);
  const ask = (s: Omit<PromptSpec, "resolve">) => new Promise<string | null>((res) => setDlg({ ...s, resolve: (x) => { setDlg(null); res(x); } }));
  const isAdmin = role === "admin"; const verifier = role === "site_engineer" || role === "staff" || isAdmin; const submitted = !!day?.submitted_at, verified = !!day?.verified_at;
  const who = (id: string | null) => (id && names[id]) || "someone";

  // the database's own answer to "is this day complete?": the same rule the buttons are enforced by (a moment after each change, so a burst of taps is one question)
  const loadNotices = async () => { const { data, error } = await supabase().from("day_notices").select("kind,created_at,sent_by").eq("project_id", projectId).eq("work_date", date).order("created_at"); if (!error) setNotices((data || []) as Notice[]); };
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const { data, error } = await supabase().rpc("day_readiness", { p_project: projectId, p_date: date });
      if (alive) setR(error ? null : (data as Readiness));   // not available yet (migration not run): behave as before
      await loadNotices();
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [projectId, date, people, rows, runs, day]);   // eslint-disable-line react-hooks/exhaustive-deps

  // what looks missing, worked out here: used only until the readiness check above is available
  const issues = useMemo(() => {
    const out: { label: string; names: string[] }[] = []; const act = vehicles.filter((v) => v.active || runs.some((x) => x.vehicle_id === v.id));
    const unmarked = people.filter((p) => effectiveStatus(p, date, rows[p.employee_id]) === null).map((p) => p.full_name); if (unmarked.length) out.push({ label: "Not marked yet", names: unmarked });
    const todo: string[] = [], missed: string[] = [];
    act.forEach((v) => (["pickup", "drop"] as const).forEach((leg) => { const x = runs.find((q) => q.vehicle_id === v.id && q.leg === leg); const t = `${v.name} ${leg}`; if (!x) todo.push(t); else if (x.status === "no_show") missed.push(t); }));
    if (todo.length) out.push({ label: "Transport not recorded", names: todo }); if (missed.length) out.push({ label: "Vehicle didn't show", names: missed });
    return out;
  }, [people, rows, vehicles, runs, date]);
  const count = issues.reduce((n, i) => n + i.names.length, 0);

  async function clearDay() { if (!confirm(`Clear everyone's attendance and meals for ${date} on this project and reset its sign-off? The Supervisor can then fill it in again. Transport records are kept.`)) return; setBusy(true); setErr(""); const { error } = await supabase().rpc("day_clear", { p_project: projectId, p_date: date }); setBusy(false); if (error) { setErr(error.message); return; } reload(); }
  async function run(fn: "day_submit" | "day_verify" | "day_reopen", reason?: string) {
    setBusy(true); setErr(""); setInfo("");
    const { error } = await supabase().rpc(fn, { p_project: projectId, p_date: date, ...(reason ? { p_reason: reason } : {}) });
    setBusy(false); if (error) { setErr(error.message); return; }
    trackEntry(role, projectId, date, fn === "day_submit" ? "submit" : fn === "day_verify" ? "verify" : "reopen"); reload();
  }
  // an Admin may close a day that is not complete, but has to say why (it is then marked "verified incomplete" with that reason)
  async function verify() {
    if (isAdmin && r && (!r.complete || (r.has_supervisor && !submitted))) {
      const why = await ask({ title: "This day is not complete", label: "Reason for verifying it anyway", hint: `${r.missing.join("; ") || "The Supervisor has not submitted it."} This is recorded on the day.`, confirmLabel: "Verify anyway", validate: (x) => (x ? null : "Give a reason") });
      if (!why) return; await run("day_verify", why); return;
    }
    await run("day_verify");
  }
  async function notify() {
    setBusy(true); setErr(""); setInfo("");
    const res = await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, date }) }); const j = await res.json().catch(() => ({}));
    setBusy(false); if (!res.ok) { setErr(j.error || "Could not send the reminder."); return; }
    const reached = (j.recipients || []).filter((x: { devices: number }) => x.devices > 0).map((x: { name: string }) => x.name), silent = (j.recipients || []).filter((x: { devices: number }) => x.devices === 0).map((x: { name: string }) => x.name);
    setInfo(!j.configured ? "The reminder is logged, but notifications are not set up on the server yet." : [reached.length ? `Reminder sent to ${reached.join(", ")}.` : "", silent.length ? `${silent.join(", ")} has not switched on reminders on a phone yet: please call.` : ""].filter(Boolean).join(" "));
    loadNotices();
  }

  const submitBlocked = !!r && !r.complete;
  const verifyBlocked = !isAdmin && !!r && (!r.complete || (r.has_supervisor && !submitted));
  const verifyWhy = verifyBlocked ? (!r!.complete ? "Waiting for the Supervisor to complete the day" : "Waiting for the Supervisor to submit the day") : "";
  const canNotify = verifier && !verified && date === istToday() && !isLockedFor(role, date) && (r ? !r.complete || !submitted : true);
  const when = (iso: string) => fmtTime(iso);
  const remindedLine = notices.filter((n) => n.kind !== "ready").slice(-3).map((n) => `${when(n.created_at)} ${n.sent_by ? `by ${who(n.sent_by)}` : "(automatic)"}`).join(" · ");
  const tick = (ok: boolean) => <span className={ok ? "text-emerald-600" : "text-rose-600"} aria-hidden>{ok ? "✓" : "✗"}</span>;

  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 px-4 py-3 space-y-2" data-daybar>
      <PromptDialog spec={dlg} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`inline-flex items-center gap-1.5 text-sm ${verified ? "text-emerald-700" : submitted ? "text-blue-700" : "text-slate-500"}`}>
          <span className={`h-2 w-2 rounded-full ${verified ? "bg-emerald-500" : submitted ? "bg-blue-500" : "bg-slate-300"}`} />
          {verified ? <>Verified by <b className="font-medium">{who(day!.verified_by)}</b> · {fmtTime(day!.verified_at!)}</> : submitted ? <>Submitted by <b className="font-medium">{who(day!.submitted_by)}</b> · {fmtTime(day!.submitted_at!)} — waiting for the Site Engineer</> : "Day open"}</span>
        {!r && <button type="button" onClick={() => setOpen(!open)} className="text-xs text-slate-500 underline decoration-dotted">{count ? `${count} to review` : "Nothing to review"}</button>}
        <div className="ml-auto flex flex-wrap gap-2">
          {canWrite && !verified && !submitted && isSupervisorRole(role) && <button className="btn btn-primary !min-h-9" disabled={busy || submitBlocked} title={submitBlocked ? "Attendance and transport must be complete first" : undefined} onClick={() => run("day_submit")}>Submit day</button>}
          {canWrite && verifier && !verified && <button className="btn btn-primary !min-h-9" disabled={busy || verifyBlocked} title={verifyWhy || undefined} onClick={verify}>Verify day</button>}
          {canNotify && <button className="btn !min-h-9" disabled={busy} onClick={notify}>Notify supervisor</button>}
          {role === "admin" && canWrite && <button className="btn btn-danger !min-h-9" disabled={busy} onClick={clearDay}>Clear day</button>}
          {canWrite && verifier && (verified || submitted) && <button className="btn !min-h-9" disabled={busy} onClick={() => run("day_reopen")}>Reopen</button>}
        </div>
      </div>

      {r && <div className="border-t border-slate-100 pt-2 space-y-1 text-sm" data-checklist>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span>{tick(r.unmarked === 0)} Attendance <span className="text-slate-500">{r.marked} of {r.people} marked</span></span>
          <span>{tick(!r.work_day || (r.pickup_missing === 0 && r.drop_missing === 0))} Transport <span className="text-slate-500">{!r.work_day ? "not needed today" : r.vehicles ? `${r.legs_recorded} of ${r.legs_expected} recorded` : "no vehicles"}</span></span>
          <span className="text-slate-500">Meals <span className={r.work_day && r.meals.breakfast === 0 ? "text-amber-700" : ""}>Breakfast {r.meals.breakfast}</span> · <span className={r.work_day && r.meals.lunch === 0 ? "text-amber-700" : ""}>Lunch {r.meals.lunch}</span> · <span className={r.work_day && r.meals.dinner === 0 ? "text-amber-700" : ""}>Dinner {r.meals.dinner}</span></span>
        </div>
        {!r.complete && r.missing.length > 0 && <p className="text-xs text-rose-700">{r.missing.join(" · ")}</p>}
        {verifyBlocked && <p className="text-xs text-slate-500">{verifyWhy}.</p>}
        {verified && day?.verified_incomplete && <p className="text-xs text-amber-700">Verified although incomplete{day.verify_note ? `: ${day.verify_note}` : ""}.</p>}
        {remindedLine && !verified && <p className="text-xs text-slate-400">Reminded {remindedLine}</p>}
      </div>}
      {!r && open && <div className="text-sm space-y-1.5 border-t border-slate-100 pt-2">{issues.length ? issues.map((i) => <div key={i.label}><span className="text-slate-500">{i.label}:</span> <span className="text-slate-800">{i.names.slice(0, 6).join(", ")}{i.names.length > 6 ? ` and ${i.names.length - 6} more` : ""}</span></div>) : <span className="text-slate-400">Everything looks consistent.</span>}</div>}
      {info && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">{info}</p>}
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
    </div>
  );
}
