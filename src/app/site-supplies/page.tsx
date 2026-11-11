"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { useRole } from "@/lib/roles";
import { keepProject, rememberedProject } from "@/lib/lastProject";
import SiteBills from "@/components/SiteBills";
import { useGas, type SupplyProject } from "@/components/supplies/useGas";
import { useEquipment } from "@/components/supplies/useEquipment";
import GasRuns from "@/components/supplies/GasRuns";
import GasCharges from "@/components/supplies/GasCharges";
import { InlineLoader, PageLoader } from "@/components/Loader";

type Area = "gas" | "equipment";
type GasTab = "stock" | "runs" | "charges" | "vendors";
type EqTab = "today" | "log" | "bills" | "setup";
const dayLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const KEY = "cipco_supplies_view";

// Site supplies: two separate things, chosen with the two large buttons at the top.
//   Gas        Stock (what is at the site, record a run) · Runs (each truck visit: challan, invoice, charges, JSL) · Charges (costs, payments, deposits) · Vendors & rates
//   Equipment  Today · Log · Bills · Setup, for cranes and other hired machines
// Anything with a rupee value is only for Operations, Admin and the read-only Viewer.
export default function SiteSupplies() {
  const { role, money } = useRole(); const today = istToday(); const [projects, setProjects] = useState<SupplyProject[]>([]); const [pid, setPid] = useState(""); const [loaded, setLoaded] = useState(false); const [pErr, setPErr] = useState("");
  const [area, setArea0] = useState<Area>("gas"); const [gTab, setGTab0] = useState<GasTab>("stock"); const [eTab, setETab0] = useState<EqTab>("today");
  const [logMonth, setLogMonth] = useState(today.slice(0, 7));
  // the last view is remembered on this device
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); if (v.area) setArea0(v.area); if (v.g) setGTab0(v.g); if (v.e) setETab0(v.e); } catch { /* storage unavailable */ } }, []);
  const remember = (patch: Record<string, string>) => { try { localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(KEY) || "{}"), ...patch })); } catch { /* ignore */ } };
  const setArea = (a: Area) => { setArea0(a); remember({ area: a }); }; const setGTab = (t: GasTab) => { setGTab0(t); remember({ g: t }); }; const setETab = (t: EqTab) => { setETab0(t); remember({ e: t }); };
  useEffect(() => { (async () => { const { data, error } = await supabase().from("projects").select("id, name, location, status, closed_on").order("status").order("name"); if (error) { setPErr(error.message); setLoaded(true); return; } const pl = (data || []) as SupplyProject[]; setProjects(pl); setPid((c) => c || rememberedProject(pl) || pl[0]?.id || ""); setLoaded(true); })(); }, []);
  const project = projects.find((p) => p.id === pid);
  const gas = useGas(project, () => setGTab("stock")); const eq = useEquipment(project);
  const gasTabs: [GasTab, string][] = [["stock", "Stock"], ["runs", "Runs"], ...(money ? ([["charges", "Charges"], ["vendors", "Vendors & rates"]] as [GasTab, string][]) : [])];
  const eqTabs: [EqTab, string][] = [["today", "Today"], ["log", "Log"], ...(money ? ([["bills", "Bills & payments"], ["setup", "Machines & rates"]] as [EqTab, string][]) : [])];
  useEffect(() => { if (!money && (gTab === "charges" || gTab === "vendors")) setGTab0("stock"); if (!money && (eTab === "bills" || eTab === "setup")) setETab0("today"); }, [money, gTab, eTab]);
  const gasToday = gas.logItems.filter((x) => x.date === today).sort((a, b) => String(b.stamp).localeCompare(String(a.stamp)));
  const eqLog = useMemo(() => eq.logItems.filter((x) => x.date.startsWith(logMonth)), [eq.logItems, logMonth]);
  const eqToday = eq.logItems.filter((x) => x.date === today);
  const byDate = (items: typeof eqLog) => { const days = [...new Set(items.map((x) => x.date))].sort().reverse(); return days.map((d) => ({ d, items: items.filter((x) => x.date === d).sort((a, b) => String(b.stamp).localeCompare(String(a.stamp))) })); };
  const notes = [pErr, gas.err, eq.err].filter(Boolean), oks = [gas.msg, eq.msg].filter(Boolean);
  const big = (a: Area, title: string, sub: string) => <button type="button" role="tab" aria-selected={area === a} onClick={() => setArea(a)}
    className={`rounded-2xl border px-4 py-3 text-left transition-colors ${area === a ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
    <span className={`block text-base font-semibold ${area === a ? "text-blue-800" : ""}`}>{title}</span><span className="block text-xs text-slate-500">{sub}</span></button>;
  const subTabs = <T extends string>(tabs: [T, string][], cur: T, set: (t: T) => void) => <div role="tablist" className="flex gap-1 overflow-x-auto tabs-scroll border-b border-slate-200">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={cur === k} className={`tab whitespace-nowrap ${cur === k ? "tab-on" : ""}`} onClick={() => set(k)}>{l}</button>)}</div>;
  const entries = (items: { key: string; node: React.ReactNode }[], empty: string) => <div className="card !p-3"><div className="text-sm font-medium mb-1">Today's entries</div>{items.length ? <div className="divide-y divide-slate-100">{items.map((x) => <div key={x.key}>{x.node}</div>)}</div> : <p className="text-sm text-slate-500">{empty}</p>}</div>;

  return (
    <div className="space-y-4 mob">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Site supplies</h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => { setPid(e.target.value); keepProject(e.target.value); gas.closeForms(); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}{p.status === "closed" ? " (closed)" : ""}</option>)}</select>}</div>
      <div role="tablist" aria-label="Supplies" className="grid grid-cols-2 gap-2 sm:gap-3 sm:max-w-xl">{big("gas", "Gas", "Cylinders, runs, charges")}{big("equipment", "Equipment", "Cranes and hired machines")}</div>
      {area === "gas" ? subTabs(gasTabs, gTab, setGTab) : subTabs(eqTabs, eTab, setETab)}
      {notes.map((n, i) => <p key={i} className="warn" role="alert">{n}</p>)}{oks.map((n, i) => <p key={i} className="text-sm text-green-700" role="status">{n}</p>)}
      {!loaded ? <PageLoader /> : (gas.loading || eq.loading) ? <InlineLoader /> : null}
      {loaded && !projects.length && !pErr && <p className="text-slate-500">No projects{role === "supervisor" || role === "site_engineer" ? " assigned to you" : ""}.</p>}

      {pid && area === "gas" && <>
        {gTab === "stock" && <div className="space-y-4">{gas.todayNode}{entries(gasToday, "Nothing recorded today.")}</div>}
        {gTab === "runs" && <GasRuns c={gas.ctx} />}
        {gTab === "charges" && money && <GasCharges c={gas.ctx} deposits={gas.depositsNode} />}
        {gTab === "vendors" && money && gas.setupNode}
      </>}

      {pid && area === "equipment" && <>
        {eTab === "today" && <div className="space-y-4">{eq.todayNode}{entries(eqToday, "Nothing logged today.")}</div>}
        {eTab === "log" && <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><label className="text-xs text-slate-500 flex items-center gap-2">Month<input type="month" className="inp !w-40" value={logMonth} onChange={(e) => e.target.value && setLogMonth(e.target.value)} /></label>
            <span className="text-xs text-slate-500">{eq.hoursText(eq.hoursIn(logMonth))} logged · {eq.toVerify(logMonth)} to verify</span>{eq.canAdd && <button className="btn btn-sm sm:ml-auto" onClick={eq.addStretch}>Add a stretch of work</button>}</div>
          {eq.manualForm}
          {!eqLog.length && <p className="text-sm text-slate-500">Nothing logged this month.</p>}
          {byDate(eqLog).map(({ d, items }) => <section key={d} className="card !p-3"><div className="text-sm font-medium mb-1">{dayLabel(d)}{eq.dayNote(d) && <span className="ml-2 text-xs font-normal text-slate-500">{eq.dayNote(d)}</span>}</div><div className="divide-y divide-slate-100">{items.map((x) => <div key={x.key}>{x.node}</div>)}</div></section>)}</div>}
        {eTab === "bills" && money && <SiteBills projectId={pid} sources={[{ kind: "equipment", label: "Equipment", vendors: eq.billVendors, compute: eq.compute }]} />}
        {eTab === "setup" && money && eq.setupNode}
      </>}
    </div>
  );
}
