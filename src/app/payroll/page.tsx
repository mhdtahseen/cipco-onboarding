"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { creditWindow, monthName, addMonth } from "@/lib/payroll";
import { usePayroll } from "@/lib/payrollData";
import type { Project } from "@/lib/types";
import RunTab from "@/components/payroll/RunTab";
import PayTab from "@/components/payroll/PayTab";
import StatutoryTab from "@/components/payroll/StatutoryTab";
import AdvancesTab from "@/components/payroll/AdvancesTab";

type Tab = "run" | "pay" | "statutory" | "advances";

// Admin: monthly payroll for a project. Calendar-month pay, calculated on the last day of the month, credited 1st to 4th of the next month.
// Joined on or before the 20th: paid for the month. Joined after the 20th: paid in the next run (the full month plus the days from joining).
export default function Payroll() {
  const today = istToday();
  const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState(""); const [tab, setTab] = useState<Tab>("run");
  // default month: the month whose last day has come (or is today); in the first days of a month, the month just ended
  const [ym, setYm] = useState(() => { const t = istToday(); const last = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0).getDate(); return Number(t.slice(8)) >= last ? t.slice(0, 7) : addMonth(t.slice(0, 7), -1); });
  useEffect(() => { (async () => { const { data } = await supabase().from("projects").select("*").eq("status", "active").order("name"); const pl = (data || []) as Project[]; setProjects(pl); setPid((c) => c || pl[0]?.id || ""); })(); }, []);
  const P = usePayroll(pid, ym); const win = creditWindow(ym);
  const proj = projects.find((p) => p.id === pid);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Payroll <Link href="/payroll/template" className="ml-2 align-middle text-xs font-normal text-blue-700 underline">Salary slip template</Link></h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => setPid(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}</option>)}</select>}
        <label className="flex items-center gap-2 text-sm text-slate-500">Month<input type="month" className="inp !w-40" aria-label="Payroll month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label></div>
      <p className="text-xs text-slate-500">{monthName(ym)} salary · calculated on {new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" })} {new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate()}, credited {win.from.slice(8)}–{win.to.slice(8)} {new Date(`${win.from}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}. Joined after the 20th: paid in the next run.</p>
      <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">{([["run", "Payroll run"], ["pay", "Pay"], ["statutory", "Statutory"], ["advances", "Advances"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab whitespace-nowrap ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {P.err && <p className="warn">{P.err}</p>}{P.loading && <p className="text-slate-500">Loading…</p>}
      {!P.loading && P.d && <div key={tab} className="fade-in space-y-4">
        {tab === "run" && <RunTab P={P} pid={pid} ym={ym} today={today} projectName={proj?.name ?? ""} />}
        {tab === "pay" && <PayTab P={P} ym={ym} today={today} />}
        {tab === "statutory" && <StatutoryTab P={P} pid={pid} ym={ym} today={today} />}
        {tab === "advances" && <AdvancesTab P={P} pid={pid} today={today} />}
      </div>}
    </div>
  );
}
