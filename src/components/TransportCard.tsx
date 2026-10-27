"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Icon } from "./NavIcons";
import { LEG_LABEL, fmtTime, istISO, type Leg, type Run, type Vehicle } from "@/lib/attendance";

// Transport for the day: did each hired vehicle show up for the pickup and the drop? Stamped with the server's clock.
// Independent of attendance. Prices and payments are the Admin's, on the Transport page.
export default function TransportCard({ projectId, date, vehicles, runs, canWrite, today, myRank, names, reload }: { projectId: string; date: string; vehicles: Vehicle[]; runs: Run[]; canWrite: boolean; today: boolean; myRank: number; names: Record<string, string>; reload: () => void }) {
  const prot = (r?: Run) => !!r?.rank && r.rank > myRank;   // set by a higher role: shown, not editable
  const [busy, setBusy] = useState(""); const [err, setErr] = useState(""); const [editing, setEditing] = useState<string | null>(null); const [hhmm, setHhmm] = useState("");
  const list = vehicles.filter((v) => v.active || runs.some((r) => r.vehicle_id === v.id));
  const find = (v: Vehicle, leg: Leg) => runs.find((r) => r.vehicle_id === v.id && r.leg === leg);
  const showed = runs.filter((r) => r.status === "showed").length, missed = runs.filter((r) => r.status === "no_show").length, expected = list.length * 2;

  async function mark(v: Vehicle, leg: Leg, status: "showed" | "no_show") {
    if (!canWrite || busy) return; setErr(""); const cur = find(v, leg); if (prot(cur)) { setErr(`This was set by the ${cur!.rank === 3 ? "Admin" : "Site Engineer"}; you can't change it.`); return; } const key = `${v.id}-${leg}`; setBusy(key); const sb = supabase();
    const stamp = status === "showed" && !today ? istISO(date, leg === "pickup" ? "07:00" : "18:00") : null;   // today: the server stamps the time; another day: a placeholder time to correct
    const { error } = !cur ? await sb.from("transport_runs").insert({ project_id: projectId, work_date: date, leg, vehicle_id: v.id, status, ...(stamp ? { at: stamp } : {}) })
      : cur.status === status ? await sb.from("transport_runs").delete().eq("id", cur.id)   // tapping the chosen one again clears it
      : await sb.from("transport_runs").update({ status, at: stamp }).eq("id", cur.id);
    setBusy(""); if (error) { setErr(error.message); return; } reload();
  }
  async function saveTime(r: Run) {
    if (!/^\d{2}:\d{2}$/.test(hhmm)) { setEditing(null); return; } setBusy(r.id); const { error } = await supabase().from("transport_runs").update({ at: istISO(date, hhmm) }).eq("id", r.id); setBusy(""); setEditing(null); if (error) { setErr(error.message); return; } reload();
  }

  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 p-4 space-y-3" data-transport>
      <div className="flex items-baseline gap-2"><Icon name="truck" className="h-4 w-4 text-slate-400 self-center" /><h3 className="text-sm font-medium text-slate-900">Transport</h3>
        {expected > 0 && <span className="ml-auto text-xs text-slate-500">{showed} showed{missed ? <> · <span className="text-rose-700">{missed} didn't show</span></> : ""}{showed + missed < expected ? ` · ${expected - showed - missed} not recorded` : ""}</span>}</div>
      {!list.length ? <p className="text-xs text-slate-400">No vehicles for this project yet. An Admin adds them under Operations → Transport.</p> :
        <div className="divide-y divide-slate-100">
          {list.map((v) => <div key={v.id} className="py-2.5 first:pt-0 last:pb-0 space-y-2" data-vehicle>
            <div className="flex items-baseline gap-2 min-w-0"><span className="text-sm font-medium text-slate-900 truncate">{v.name}</span>{v.operator && <span className="text-xs text-slate-400 truncate">{v.operator}</span>}</div>
            <div className="grid grid-cols-2 gap-3">
              {(["pickup", "drop"] as Leg[]).map((leg) => { const r = find(v, leg); const k = `${v.id}-${leg}`; return (
                <div key={leg} className="min-w-0" data-leg={leg}>
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-400 mb-1 pl-1"><span>{LEG_LABEL[leg]}</span>
                    <span className="flex items-center min-w-0">
                    {r?.status === "showed" && r.at && (editing === r.id ? <input autoFocus type="time" value={hhmm} onChange={(e) => setHhmm(e.target.value)} onBlur={() => saveTime(r)} onKeyDown={(e) => e.key === "Enter" && saveTime(r)} className="h-7 w-24 rounded border border-slate-300 px-1 text-xs normal-case" aria-label="Time it showed up" />
                      : <button type="button" disabled={!canWrite || prot(r)} onClick={() => { setHhmm(fmtTime(r.at!)); setEditing(r.id); }} className="normal-case tracking-normal text-xs text-slate-500 tabular-nums underline decoration-dotted disabled:no-underline" title="Correct the time">{fmtTime(r.at)}</button>)}
                    {r && r.updated_by && names[r.updated_by] && <span className="ml-1.5 normal-case tracking-normal text-[11px] text-slate-400 truncate" data-stamp>{names[r.updated_by]}</span>}</span></div>
                  <div role="group" aria-label={`${LEG_LABEL[leg]} – ${v.name}`} className="grid grid-cols-2 gap-0.5 rounded-xl bg-slate-100 p-1">
                    {([["showed", "Showed", "text-emerald-700"], ["no_show", "No show", "text-rose-700"]] as const).map(([st, label, tone]) => <button key={st} type="button" disabled={!canWrite || prot(r) || busy === k} aria-pressed={r?.status === st} onClick={() => mark(v, leg, st)} className={`h-11 rounded-lg text-[13px] font-medium touch-manipulation transition-colors disabled:opacity-60 ${r?.status === st ? `bg-white shadow-sm ${tone}` : "text-slate-500"}`}>{label}</button>)}</div>
                </div>); })}
            </div>
          </div>)}
        </div>}
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
    </div>
  );
}
