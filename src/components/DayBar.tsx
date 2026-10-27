"use client";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { effectiveStatus, fmtTime, isSupervisorRole, type AttRow, type DayRow, type Passenger, type Person, type Trip } from "@/lib/attendance";

// Day sign-off: the Supervisor submits the day, the Site Engineer (or Admin) verifies it. Before either, the exceptions are listed.
export default function DayBar({ projectId, date, role, day, names, people, rows, trips, passengers, canWrite, reload }: { projectId: string; date: string; role: string | null; day: DayRow | null; names: Record<string, string>; people: Person[]; rows: Record<string, AttRow>; trips: Trip[]; passengers: Passenger[]; canWrite: boolean; reload: () => void }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const verifier = role === "site_engineer" || role === "staff" || role === "admin"; const submitted = !!day?.submitted_at, verified = !!day?.verified_at;
  const who = (id: string | null) => (id && names[id]) || "someone";
  const issues = useMemo(() => {
    const onPick = new Set(passengers.filter((p) => p.leg === "pickup").map((p) => p.employee_id)), onDrop = new Set(passengers.filter((p) => p.leg === "drop").map((p) => p.employee_id));
    const hasPick = trips.some((t) => t.leg === "pickup"), hasDrop = trips.some((t) => t.leg === "drop"); const out: { label: string; names: string[] }[] = [];
    const st = (p: Person) => effectiveStatus(p, date, rows[p.employee_id]);
    const add = (label: string, list: Person[]) => { if (list.length) out.push({ label, names: list.map((p) => p.full_name) }); };
    add("Not marked yet", people.filter((p) => st(p) === null));
    add("Marked absent but on a trip", people.filter((p) => st(p) === "absent" && (onPick.has(p.employee_id) || onDrop.has(p.employee_id))));
    if (hasPick) add("Present but not on a pickup", people.filter((p) => (st(p) === "present" || st(p) === "half") && !onPick.has(p.employee_id)));
    if (hasDrop) add("Present but not on a drop", people.filter((p) => (st(p) === "present" || st(p) === "half") && !onDrop.has(p.employee_id)));
    return out;
  }, [people, rows, trips, passengers, date]);
  async function run(fn: "day_submit" | "day_verify" | "day_reopen") { setBusy(true); setErr(""); const { error } = await supabase().rpc(fn, { p_project: projectId, p_date: date }); setBusy(false); if (error) { setErr(error.message); return; } reload(); }
  const count = issues.reduce((n, i) => n + i.names.length, 0);

  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 px-4 py-3 space-y-2" data-daybar>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`inline-flex items-center gap-1.5 text-sm ${verified ? "text-emerald-700" : submitted ? "text-blue-700" : "text-slate-500"}`}>
          <span className={`h-2 w-2 rounded-full ${verified ? "bg-emerald-500" : submitted ? "bg-blue-500" : "bg-slate-300"}`} />
          {verified ? <>Verified by <b className="font-medium">{who(day!.verified_by)}</b> · {fmtTime(day!.verified_at!)}</> : submitted ? <>Submitted by <b className="font-medium">{who(day!.submitted_by)}</b> · {fmtTime(day!.submitted_at!)} — waiting for the Site Engineer</> : "Day open"}</span>
        <button type="button" onClick={() => setOpen(!open)} className="text-xs text-slate-500 underline decoration-dotted">{count ? `${count} to review` : "Nothing to review"}</button>
        <div className="ml-auto flex gap-2">
          {canWrite && !verified && !submitted && isSupervisorRole(role) && <button className="btn btn-primary !min-h-9" disabled={busy} onClick={() => run("day_submit")}>Submit day</button>}
          {canWrite && verifier && !verified && <button className="btn btn-primary !min-h-9" disabled={busy} onClick={() => run("day_verify")}>Verify day</button>}
          {canWrite && verifier && (verified || submitted) && <button className="btn !min-h-9" disabled={busy} onClick={() => run("day_reopen")}>Reopen</button>}
        </div>
      </div>
      {open && <div className="text-sm space-y-1.5 border-t border-slate-100 pt-2">{issues.length ? issues.map((i) => <div key={i.label}><span className="text-slate-500">{i.label}:</span> <span className="text-slate-800">{i.names.slice(0, 6).join(", ")}{i.names.length > 6 ? ` and ${i.names.length - 6} more` : ""}</span></div>) : <span className="text-slate-400">Everything looks consistent.</span>}</div>}
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
    </div>
  );
}
