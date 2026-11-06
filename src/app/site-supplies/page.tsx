"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { useRole } from "@/lib/roles";
import { keepProject, rememberedProject } from "@/lib/lastProject";
import SiteBills from "@/components/SiteBills";
import { useGas, type SupplyProject } from "@/components/supplies/useGas";
import { useEquipment } from "@/components/supplies/useEquipment";

type Tab = "today" | "orders" | "log" | "bills" | "deposits" | "setup";
const dayLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

// Site supplies: gas cylinders and hired equipment on one page, organised by the job at hand rather than by what is being recorded. Today is what happened on site; Orders is gas orders; Log is every entry by date.
// Bills, deposits and setup (anything with a rupee value) only appear for Operations, Admin and the read-only Viewer. Supervisors and Site Engineers reach this page once the switch in nav.ts is on.
export default function SiteSupplies() {
  const { role, money } = useRole(); const today = istToday(); const [projects, setProjects] = useState<SupplyProject[]>([]); const [pid, setPid] = useState(""); const [loaded, setLoaded] = useState(false); const [pErr, setPErr] = useState("");
  const [tab, setTab] = useState<Tab>("today"); const [setupOf, setSetupOf] = useState<"gas" | "equipment">("gas"); const [logMonth, setLogMonth] = useState(today.slice(0, 7)); const [logShow, setLogShow] = useState<"all" | "gas" | "equipment">("all");
  useEffect(() => { (async () => { const { data, error } = await supabase().from("projects").select("id, name, location, status, closed_on").order("status").order("name"); if (error) { setPErr(error.message); setLoaded(true); return; } const pl = (data || []) as SupplyProject[]; setProjects(pl); setPid((c) => c || rememberedProject(pl) || pl[0]?.id || ""); setLoaded(true); })(); }, []);
  const project = projects.find((p) => p.id === pid);
  const gas = useGas(project, setTab); const eq = useEquipment(project);
  const tabs: [Tab, string][] = [["today", "Today"], ["orders", "Orders"], ["log", "Log"], ...(money ? ([["bills", "Bills & payments"], ["deposits", "Deposits"], ["setup", "Setup"]] as [Tab, string][]) : [])];
  const allLog = useMemo(() => [...gas.logItems, ...eq.logItems], [gas.logItems, eq.logItems]);
  const byDate = (items: typeof allLog) => { const days = [...new Set(items.map((x) => x.date))].sort().reverse(); return days.map((d) => ({ d, items: items.filter((x) => x.date === d).sort((a, b) => String(b.stamp).localeCompare(String(a.stamp))) })); };
  const todayItems = allLog.filter((x) => x.date === today).sort((a, b) => String(b.stamp).localeCompare(String(a.stamp)));
  const logItems = allLog.filter((x) => x.date.startsWith(logMonth) && (logShow === "all" || x.kind === logShow));
  const seg = (active: boolean) => `px-3 py-1.5 text-sm rounded-md ${active ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-600 hover:bg-slate-50"}`;
  const notes = [pErr, gas.err, eq.err].filter(Boolean), oks = [gas.msg, eq.msg].filter(Boolean);

  return (
    <div className="space-y-4 mob">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Site supplies</h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => { setPid(e.target.value); keepProject(e.target.value); gas.closeForms(); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}{p.status === "closed" ? " (closed)" : ""}</option>)}</select>}</div>
      <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto tabs-scroll">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab whitespace-nowrap ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{l}{k === "orders" && gas.awaiting > 0 && money ? ` (${gas.awaiting})` : ""}</button>)}</div>
      {notes.map((n, i) => <p key={i} className="warn" role="alert">{n}</p>)}{oks.map((n, i) => <p key={i} className="text-sm text-green-700" role="status">{n}</p>)}
      {(!loaded || gas.loading || eq.loading) && <p className="text-slate-500">Loading…</p>}
      {loaded && !projects.length && !pErr && <p className="text-slate-500">No projects{role === "supervisor" || role === "site_engineer" ? " assigned to you" : ""}.</p>}

      {pid && tab === "today" && <div className="space-y-6">{eq.todayNode}{gas.todayNode}
        <div className="card !p-3"><div className="text-sm font-medium mb-1">Today's entries</div>{todayItems.length ? <div className="divide-y divide-slate-100">{todayItems.map((x) => <div key={x.key}>{x.node}</div>)}</div> : <p className="text-sm text-slate-500">Nothing recorded today.</p>}</div></div>}

      {pid && tab === "orders" && gas.ordersNode}

      {pid && tab === "log" && <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2"><label className="text-xs text-slate-500 flex items-center gap-2">Month<input type="month" className="inp !w-40" value={logMonth} onChange={(e) => e.target.value && setLogMonth(e.target.value)} /></label>
          <div role="group" aria-label="Show" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">{([["all", "All"], ["gas", "Gas"], ["equipment", "Equipment"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={logShow === k} className={seg(logShow === k)} onClick={() => setLogShow(k)}>{l}</button>)}</div>
          <span className="text-xs text-slate-500">{eq.hoursText(eq.hoursIn(logMonth))} of equipment logged · {eq.toVerify(logMonth)} to verify</span>{eq.canAdd && <button className="btn btn-sm sm:ml-auto" onClick={eq.addStretch}>Add a stretch of work</button>}</div>
        {eq.manualForm}
        {!logItems.length && <p className="text-sm text-slate-500">Nothing recorded for this month.</p>}
        {byDate(logItems).map(({ d, items }) => <section key={d} className="card !p-3"><div className="text-sm font-medium mb-1">{dayLabel(d)}{logShow !== "gas" && eq.dayNote(d) && <span className="ml-2 text-xs font-normal text-slate-500">{eq.dayNote(d)}</span>}</div><div className="divide-y divide-slate-100">{items.map((x) => <div key={x.key}>{x.node}</div>)}</div></section>)}</div>}

      {pid && tab === "bills" && money && <div className="space-y-4">{gas.costCard}<SiteBills projectId={pid} sources={[{ kind: "gas", label: "Gas", vendors: gas.billVendors, compute: gas.compute }, { kind: "equipment", label: "Equipment", vendors: eq.billVendors, compute: eq.compute }]} /></div>}
      {pid && tab === "deposits" && money && gas.depositsNode}
      {tab === "setup" && money && <div className="space-y-4"><div role="group" aria-label="Set up" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">{([["gas", "Gas: rates & terms"], ["equipment", "Equipment & rates"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={setupOf === k} className={seg(setupOf === k)} onClick={() => setSetupOf(k)}>{l}</button>)}</div>{setupOf === "gas" ? gas.setupNode : eq.setupNode}</div>}
    </div>
  );
}
