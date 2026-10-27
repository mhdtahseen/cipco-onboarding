"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { fmtTime, istToday, type DayRow, type Trip } from "@/lib/attendance";
import type { Project } from "@/lib/types";

type Row = { p: Project; people: number; marked: number; present: number; trips: number; day: DayRow | null };

// Admin overview: every active site today — how many are marked, whether the day was submitted / verified, and transport stamped.
export default function SitesToday() {
  const today = istToday(); const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState("");
  useEffect(() => { (async () => {
    const sb = supabase(); const { data: ps, error } = await sb.from("projects").select("*").eq("status", "active").order("name"); if (error) { setErr(error.message); setLoading(false); return; }
    const out: Row[] = await Promise.all(((ps || []) as Project[]).map(async (p) => {
      const { data: roster } = await sb.rpc("attendance_roster", { p_project: p.id, p_from: today, p_to: today }); const ids = ((roster || []) as { employee_id: string }[]).map((x) => x.employee_id);
      const [a, t, d] = await Promise.all([ids.length ? sb.from("attendance").select("status").eq("work_date", today).in("employee_id", ids) : Promise.resolve({ data: [] as { status: string }[] }), sb.from("transport_trips").select("id").eq("project_id", p.id).eq("work_date", today), sb.from("attendance_days").select("*").eq("project_id", p.id).eq("work_date", today).maybeSingle()]);
      const att = (a.data || []) as { status: string }[]; return { p, people: ids.length, marked: att.length, present: att.filter((x) => x.status === "present" || x.status === "half").length, trips: ((t.data || []) as Trip[]).length, day: (d.data as DayRow) ?? null };
    }));
    setRows(out); setLoading(false);
  })(); }, [today]);
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold">Sites today</h1><p className="text-sm text-slate-500">{new Date(today + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p></div>
      {err && <p className="warn">{err}</p>}{loading && <p className="text-slate-500">Loading…</p>}
      {!loading && !err && !rows.length && <p className="card text-center text-sm text-slate-500">No active projects.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => { const state = r.day?.verified_at ? ["Verified", fmtTime(r.day.verified_at), "text-emerald-700 bg-emerald-50"] : r.day?.submitted_at ? ["Submitted", fmtTime(r.day.submitted_at), "text-blue-700 bg-blue-50"] : r.marked ? ["In progress", "", "text-amber-800 bg-amber-50"] : ["Not started", "", "text-slate-500 bg-slate-100"]; return (
          <Link key={r.p.id} href="/attendance" onClick={() => { try { sessionStorage.setItem("att_tab", "day"); } catch { /* ignore */ } }} className="rounded-2xl bg-white border border-slate-200/80 p-4 space-y-2 hover:border-slate-300" data-site>
            <div className="flex items-start gap-2"><div className="min-w-0"><div className="font-medium text-slate-900 truncate">{r.p.name}</div><div className="text-xs text-slate-400 truncate">{r.p.location || "—"}</div></div><span className={`ml-auto shrink-0 text-xs rounded-full px-2.5 py-1 ${state[2]}`}>{state[0]}{state[1] && ` · ${state[1]}`}</span></div>
            <div className="text-sm text-slate-600"><b className="text-slate-900 tabular-nums">{r.marked}</b> of {r.people} marked · <b className="text-slate-900 tabular-nums">{r.present}</b> working · {r.trips} {r.trips === 1 ? "trip" : "trips"}</div>
          </Link>); })}
      </div>
    </div>
  );
}
