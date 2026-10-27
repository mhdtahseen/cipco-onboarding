"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRole } from "@/lib/roles";
import type { MealRate, Vehicle, Vendor } from "@/lib/attendance";
import type { Project } from "@/lib/types";
import AttendanceSheet from "@/components/AttendanceSheet";
import AttendanceMonth from "@/components/AttendanceMonth";
import ActivityFeed from "@/components/ActivityFeed";
import ErrorBoundary from "@/components/ErrorBoundary";

export default function AttendancePage() {
  const { role, rank } = useRole();
  const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState(""); const [vendors, setVendors] = useState<Vendor[]>([]); const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [names, setNames] = useState<Record<string, string>>({}); const [rates, setRates] = useState<MealRate[]>([]);
  const [tab, setTabState] = useState<"day" | "month" | "activity">("day");
  const setTab = (t: "day" | "month" | "activity") => { setTabState(t); try { sessionStorage.setItem("att_tab", t); } catch { /* private mode */ } };
  useEffect(() => { try { const t = sessionStorage.getItem("att_tab"); if (t === "month") setTabState("month"); } catch { /* ignore */ } }, []); const [err, setErr] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => {
    const sb = supabase(); const [p, v, r, tv, up] = await Promise.all([sb.from("projects").select("*").order("name"), sb.from("food_vendors").select("*").order("sort_order"), sb.from("meal_rates").select("*"), sb.from("transport_vehicles").select("*").order("sort_order"), sb.from("user_profiles").select("user_id, full_name")]);   // vehicles / names: empty until the accountability migration is run
    if (p.error || v.error) { setErr((p.error || v.error)!.message + " — has the roles & attendance SQL migration been run?"); setLoading(false); return; }
    const list = ((p.data || []) as Project[]).sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1));
    setProjects(list); setPid((cur) => cur || list[0]?.id || ""); setVendors((v.data || []) as Vendor[]); setRates((r.data || []) as MealRate[]); setVehicles((tv.data || []) as Vehicle[]); setNames(Object.fromEntries(((up.data || []) as { user_id: string; full_name: string }[]).filter((x) => x.full_name).map((x) => [x.user_id, x.full_name]))); setLoading(false);
  })(); }, []);
  const proj = projects.find((x) => x.id === pid);
  return (
    <div className="att space-y-3 sm:space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="hidden sm:block text-xl font-semibold sm:mr-auto">Attendance</h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => setPid(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === "closed" ? " (closed)" : ""}{p.location ? ` — ${p.location}` : ""}</option>)}</select>}</div>
      {err && <p className="warn">{err}</p>}
      {loading && <p className="text-slate-500">Loading…</p>}
      {!loading && !err && !projects.length && <p className="card text-center text-sm text-slate-500">{rank === 1 ? "No project has been assigned to you yet. Please ask an admin." : "No projects yet."}</p>}
      {proj && <>
        <div role="tablist" className="flex border-b border-slate-200">{([["day", "Daily sheet"], ["month", "Monthly"], ...(rank >= 2 ? [["activity", "Activity"] as const] : [])] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab flex-1 sm:flex-none justify-center min-h-12 touch-manipulation ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
        <ErrorBoundary key={`${tab}-${pid}`} label={tab === "day" ? "The daily sheet" : tab === "month" ? "The monthly view" : "The activity log"}>{tab === "day" ? <AttendanceSheet projectId={pid} role={role} vendors={vendors} vehicles={vehicles} names={names} /> : tab === "month" ? <AttendanceMonth projectId={pid} projectName={proj.name} vendors={vendors} rates={rates} /> : <ActivityFeed projectId={pid} />}</ErrorBoundary>
      </>}
    </div>
  );
}
