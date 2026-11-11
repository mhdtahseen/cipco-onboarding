"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { fmtTime } from "@/lib/attendance";

type Candidate = { user_id: string; name: string; role: string };
type Grant = { id: string; user_id: string; expires_at: string; reason: string | null };
export const GRANT_HOURS = [1, 3, 6, 12, 24] as const;
const ROLE: Record<string, string> = { supervisor: "Supervisor", attendance: "Supervisor", site_engineer: "Site Engineer" };

/** Admin only. After 11:00 PM a day is locked for Supervisors and Site Engineers. Here the Admin opens that one day for one login, for 1 to 24 hours; it closes by itself,
 *  or the Admin can take it back. The database (check_write) is what enforces it; this only records the grant. */
export default function DayGrants({ projectId, date }: { projectId: string; date: string }) {
  const [open, setOpen] = useState(false); const [cands, setCands] = useState<Candidate[]>([]); const [grants, setGrants] = useState<Grant[]>([]);
  const [who, setWho] = useState(""); const [hours, setHours] = useState<number>(3); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [ok, setOk] = useState(""); const [ready, setReady] = useState(true);

  const load = useCallback(async () => {
    const sb = supabase();
    const [c, g] = await Promise.all([
      sb.rpc("day_grant_candidates", { p_project: projectId }),
      sb.from("attendance_day_grants").select("id,user_id,expires_at,reason").eq("project_id", projectId).eq("work_date", date).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("expires_at"),
    ]);
    if (c.error) { setReady(false); return; }   // the migration has not been run yet
    setReady(true); setCands((c.data || []) as Candidate[]); setGrants((g.data || []) as Grant[]);
  }, [projectId, date]);
  useEffect(() => { setWho(""); setErr(""); setOk(""); load(); }, [load]);

  const nameOf = (id: string) => cands.find((c) => c.user_id === id)?.name ?? "someone";
  async function give() {
    if (!who) { setErr("Choose who to open it for."); return; }
    setBusy(true); setErr(""); setOk("");
    const { data, error } = await supabase().rpc("grant_day_edit", { p_project: projectId, p_user: who, p_date: date, p_hours: hours, p_reason: reason.trim() || null });
    setBusy(false); if (error) { setErr(error.message); return; }
    setOk(`${nameOf(who)} can edit ${date} until ${fmtTime(data as string)}.`); setReason(""); load();
  }
  async function take(id: string) {
    setBusy(true); setErr(""); setOk("");
    const { error } = await supabase().rpc("revoke_day_edit", { p_grant: id });
    setBusy(false); if (error) { setErr(error.message); return; } load();
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 space-y-2" data-day-grants>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm text-slate-600 min-w-0 flex-1">Locked for Supervisors and Site Engineers.{grants.length ? ` Open for ${grants.map((g) => nameOf(g.user_id)).join(", ")}.` : ""}</span>
        <button type="button" className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close" : "Let someone edit this day"}</button>
      </div>
      {open && (!ready ? <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2">Not available yet: run 2026-11-attendance-day-grants.sql in the Supabase SQL editor.</p> : <>
        {grants.map((g) => (
          <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm rounded-xl bg-blue-50 px-3 py-2">
            <span className="min-w-0 flex-1 text-blue-900"><b className="font-medium">{nameOf(g.user_id)}</b> can edit this day until {fmtTime(g.expires_at)}{g.reason ? ` · ${g.reason}` : ""}</span>
            <button type="button" className="text-xs text-red-700 underline" disabled={busy} onClick={() => take(g.id)}>Take back</button>
          </div>))}
        {cands.length === 0 ? <p className="text-sm text-slate-500">No Supervisor or Site Engineer is assigned to this project.</p> : (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] items-end">
            <label className="block text-xs text-slate-500">Open it for
              <select className="inp mt-1" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose a person…</option>{cands.map((c) => <option key={c.user_id} value={c.user_id}>{c.name} · {ROLE[c.role] ?? c.role}</option>)}</select></label>
            <label className="block text-xs text-slate-500">For
              <select className="inp mt-1" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{GRANT_HOURS.map((h) => <option key={h} value={h}>{h} hour{h > 1 ? "s" : ""}</option>)}</select></label>
            <label className="block text-xs text-slate-500">Reason (optional)
              <input className="inp mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. forgot to mark meals" maxLength={200} /></label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={give}>Open {date}</button>
          </div>)}
        <p className="text-[11px] text-slate-400">Only this person, only this day. It closes by itself when the time is up. A day the Site Engineer has verified must be reopened first.</p>
      </>)}
      {ok && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">{ok}</p>}
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
    </div>
  );
}
