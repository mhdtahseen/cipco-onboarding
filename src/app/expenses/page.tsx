"use client";
import { useEffect, useMemo, useState } from "react";
import { useRole } from "@/lib/roles";
import { useAllowedTabs, usePerms } from "@/lib/perms";
import { istToday } from "@/lib/attendance";
import { useExpenseData } from "@/lib/expensesData";
import { viewOf, type View } from "@/lib/paymentsDueView";
import type { PaymentsDue } from "@/lib/paymentsDueData";
import DueView from "@/components/DueView";
import SpentView from "@/components/SpentView";
import { PageLoader } from "@/components/Loader";

type Tab = "due" | "spent";
const TABS: readonly (readonly [Tab, string])[] = [["due", "Due"], ["spent", "Spent"]];
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const addMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthWord = (ym: string) => new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" });

// One place for company money. Due: what we owe, project by project (Admin and Viewer: it reads payroll and bank details). Spent: what has been spent, across projects (Operations too).
// Which tabs and buttons a person gets comes from the Permissions page (Expenses → Due, Spent): with no Due tab they open on Spent, with View only there is no Add button. The project picker and the summary figures above the tabs apply to both.
export default function ExpensesPage() {
  const { role } = useRole(); const today = istToday(); const cur = today.slice(0, 7);
  const [tab, setTab] = useState<Tab>("due"); const [project, setProject] = useState(""); const [add, setAdd] = useState(false); const [ready, setReady] = useState(false);
  const { tabs: shownTabs } = useAllowedTabs("expenses", TABS, tab, setTab); const see = shownTabs.some(([k]) => k === "due"), mayList = shownTabs.some(([k]) => k === "spent"); const mayAdd = usePerms().can("expenses", "create", "spent");
  const data = useExpenseData();
  const [due, setDue] = useState<PaymentsDue | null>(null); const [dueErr, setDueErr] = useState("");

  // ?tab=spent&project=<id>&add=1 : links from the project page
  useEffect(() => { const q = new URLSearchParams(window.location.search); if (q.get("tab") === "spent") setTab("spent"); const p = q.get("project"); if (p) setProject(p); if (q.get("add") === "1") { setTab("spent"); setAdd(true); } setReady(true); }, []);
  useEffect(() => { if (!ready) return; const q = new URLSearchParams(); q.set("tab", tab); if (project) q.set("project", project); window.history.replaceState(null, "", `/expenses?${q}`); }, [tab, project, ready]);
  useEffect(() => { if (!see) return; (async () => { const r = await fetch("/api/payments-due"); if (!r.ok) { setDueErr(await r.text()); return; } setDue(await r.json()); })(); }, [see]);

  const strip = useMemo(() => {
    const payees = (due?.projects ?? []).filter((p) => !project || p.id === project).flatMap((p) => p.payees);
    const sum = (v: View, k: "overdue" | "pending") => payees.reduce((s, x) => s + (viewOf(x, v)?.[k] ?? 0), 0);
    const base = { running: false, includePaid: false, today };
    const mine = data.exps.filter((e) => !project || e.project_id === project), amt = (m: string) => mine.filter((e) => e.expense_date.startsWith(m)).reduce((s, e) => s + Number(e.amount), 0);
    return {
      overdue: sum({ ...base, scope: "now", month: cur, lens: "due" }, "overdue"), dueMonth: sum({ ...base, scope: "month", month: cur, lens: "due" }, "pending"),
      next: sum({ ...base, scope: "month", month: addMonth(cur, 1), lens: "due" }, "pending"), spent: amt(cur), spentPrev: amt(addMonth(cur, -1)),
    };
  }, [due, project, data.exps, today, cur]);

  const card = (label: string, value: number, sub: string, opts: { bad?: boolean; go?: Tab } = {}) => (
    <button type="button" onClick={() => opts.go && setTab(opts.go)} className="card !p-3 text-left hover:bg-slate-50 min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${opts.bad && value > 0 ? "text-rose-700" : ""}`}>{inr(value)}</div><div className="text-xs text-slate-400 truncate">{sub}</div>
    </button>);
  const scope = project ? data.projects.find((p) => p.id === project)?.name ?? "this project" : "all projects";

  if (!role) return <PageLoader />;
  if (!see && !mayList) return <p className="text-slate-500">You do not have access to expenses.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]"><h1 className="text-xl font-semibold">Expenses</h1><p className="text-sm text-slate-500">What we owe and what has been spent, for {scope}.</p></div>
        <select className="inp !w-56" aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        {mayAdd && <div className="hidden md:block"><button className="btn btn-primary" onClick={() => { setTab("spent"); setAdd(true); }}>+ Add expense</button></div>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {see ? <>
          {card("Overdue", strip.overdue, "to pay now", { bad: true, go: "due" })}
          {card("Due this month", strip.dueMonth, monthWord(cur) + ", unpaid", { go: "due" })}
          {card("Spent this month", strip.spent, monthWord(cur), { go: "spent" })}
          {card("Forecast next month", strip.next, monthWord(addMonth(cur, 1)) + ", billed so far", { go: "due" })}
        </> : <>
          {card("Spent this month", strip.spent, monthWord(cur), { go: "spent" })}
          {card("Spent last month", strip.spentPrev, monthWord(addMonth(cur, -1)), { go: "spent" })}
        </>}
      </div>

      <div role="tablist" aria-label="Expenses" className="flex border-b border-slate-200">
        {see && <button role="tab" aria-selected={tab === "due"} className={`tab ${tab === "due" ? "tab-on" : ""}`} onClick={() => setTab("due")}>Due{strip.overdue > 0 && <span className="ml-1.5 rounded-full bg-rose-50 text-rose-700 px-1.5 text-[11px]">overdue</span>}</button>}
        {mayList && <button role="tab" aria-selected={tab === "spent"} className={`tab ${tab === "spent" ? "tab-on" : ""}`} onClick={() => setTab("spent")}>Spent</button>}
      </div>

      {tab === "due" && see && <DueView d={due} err={dueErr} project={project} />}
      {tab === "spent" && (data.err ? <p className="warn">{data.err}</p> : data.loading ? <PageLoader /> :
        <SpentView projects={data.projects} cats={data.cats} setCats={data.setCats} exps={data.exps} reload={data.reload} project={project} setProject={setProject} openAdd={add} onAddClosed={() => setAdd(false)} />)}
    </div>
  );
}
