"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { ROLE_LABEL } from "@/lib/roles";

type Log = { id: number; at: string; tx: number; user_name: string | null; user_role: string | null; work_date: string | null; employee_name: string | null; field: string; old_value: string | null; new_value: string | null; action: string; overrode: string | null };
const FIELD: Record<string, string> = { status: "work", breakfast: "breakfast", lunch: "lunch", dinner: "dinner", pickup: "pickup", drop: "drop", day: "day" };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

// Who changed what, newest first. Read-only: the database writes this log and nothing can edit it.
export default function ActivityFeed({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Log[]>([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [only, setOnly] = useState(false); const [limit, setLimit] = useState(100);
  useEffect(() => { (async () => { setLoading(true); const { data, error } = await supabase().from("attendance_log").select("*").eq("project_id", projectId).order("at", { ascending: false }).order("id", { ascending: false }).limit(limit); if (error) setErr(error.message + " — has the accountability migration been run?"); else setRows((data || []) as Log[]); setLoading(false); })(); }, [projectId, limit]);
  const shown = rows.filter((r) => !only || r.overrode);
  const line = (r: Log) => {
    const who = r.employee_name ? <b className="font-medium text-slate-900">{r.employee_name}</b> : null;
    if (r.action === "submit" || r.action === "verify" || r.action === "reopen") return <>{r.action === "submit" ? "submitted" : r.action === "verify" ? "verified" : "reopened"} the day</>;
    if (r.field === "pickup" || r.field === "drop") return r.action === "delete" ? <>cleared {r.field}: {r.old_value}</> : r.action === "create" ? <>{r.field}: {r.new_value}</> : <>{r.field}: {r.old_value} → {r.new_value}</>;
    if (r.action === "create") return <>{FIELD[r.field] ?? r.field}: {who} → {r.new_value || "—"}</>;
    if (r.action === "delete") return <>removed {FIELD[r.field] ?? r.field}: {who} (was {r.old_value || "—"})</>;
    return <>{FIELD[r.field] ?? r.field}: {who} {r.old_value || "—"} → {r.new_value || "—"}</>;
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><button type="button" aria-pressed={only} onClick={() => setOnly(!only)} className={`h-9 rounded-full px-3 text-sm border touch-manipulation ${only ? "bg-blue-50 border-blue-200 text-blue-800" : "bg-white border-slate-200 text-slate-600"}`}>Overrides only</button><span className="text-xs text-slate-400">Newest first · times in India</span></div>
      {err && <p className="warn">{err}</p>}{loading && <p className="text-sm text-slate-400">Loading…</p>}
      {!loading && !err && !shown.length && <p className="card text-center text-sm text-slate-500">{only ? "No overrides yet." : "No changes recorded yet."}</p>}
      <ul className="rounded-2xl bg-white border border-slate-200/80 divide-y divide-slate-100" data-activity>
        {shown.map((r) => <li key={r.id} className="px-4 py-2.5 text-sm text-slate-600 flex flex-wrap gap-x-2">
          <span className="text-xs text-slate-400 tabular-nums w-28 shrink-0">{when(r.at)}</span>
          <span className="min-w-0 flex-1"><b className="font-medium text-slate-900">{r.user_name || "Someone"}</b> <span className="text-xs text-slate-400">({ROLE_LABEL[r.user_role ?? ""] ?? r.user_role})</span> {line(r)}{r.work_date && <span className="text-xs text-slate-400"> · for {r.work_date}</span>}{r.overrode && <span className="ml-1.5 text-[11px] rounded-full bg-amber-50 text-amber-800 px-2 py-0.5">overrode {ROLE_LABEL[r.overrode] ?? r.overrode}</span>}</span></li>)}
      </ul>
      {rows.length >= limit && <button className="btn" onClick={() => setLimit(limit + 100)}>Show more</button>}
    </div>
  );
}
