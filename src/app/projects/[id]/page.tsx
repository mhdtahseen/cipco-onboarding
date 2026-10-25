"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { pileOf, stageLabel, STAGES } from "@/lib/pipeline";
import { inr } from "@/lib/quote";
import ProjectExpenses from "@/components/ProjectExpenses";
import type { Employee, ExpenseCategory, Project, ProjectExpense } from "@/lib/types";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const tally = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);

export default function ProjectReport() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Project | null>(null); const [emps, setEmps] = useState<Employee[]>([]); const [err, setErr] = useState(""); const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<ExpenseCategory[]>([]); const [exps, setExps] = useState<ProjectExpense[]>([]); const [expErr, setExpErr] = useState("");
  async function loadExpenses() {
    const sb = supabase(); const [c, x] = await Promise.all([sb.from("expense_categories").select("*").order("sort_order"), sb.from("project_expenses").select("*").eq("project_id", id).order("expense_date", { ascending: false }).order("created_at", { ascending: false })]);
    if (c.error || x.error) { setExpErr((c.error || x.error)!.message + " — has the project-expenses SQL migration been run?"); return; }
    setExpErr(""); setCats((c.data || []) as ExpenseCategory[]); setExps((x.data || []) as ProjectExpense[]);
  }
  useEffect(() => { (async () => {
    const sb = supabase(); const [pr, em] = await Promise.all([sb.from("projects").select("*").eq("id", id).single(), sb.from("employees").select("*").eq("project_id", id).order("join_date", { nullsFirst: false })]);
    if (pr.error) { setErr(pr.error.message); setLoading(false); return; }
    setP(pr.data as Project); setEmps((em.data || []) as Employee[]); setLoading(false); loadExpenses();
  })(); }, [id]);

  const r = useMemo(() => {
    const live = emps.filter((e) => pileOf(e) !== "rejected"), rejected = emps.length - live.length;
    const ctc = live.reduce((s, e) => s + (Number(e.monthly_ctc) || 0), 0), withCtc = live.filter((e) => Number(e.monthly_ctc) > 0).length;
    const joins = live.map((e) => e.join_date).filter(Boolean).sort() as string[];
    return { live, rejected, ctc, withCtc, first: joins[0] ?? null, last: joins.at(-1) ?? null,
      byDept: tally(live.map((e) => e.department || "No department")), byType: tally(live.map((e) => e.employment_type || "—")),
      byStage: STAGES.map((s) => [s.label, live.filter((e) => e.stage === s.key).length] as const).filter(([, n]) => n) };
  }, [emps]);

  const cost = useMemo(() => {
    const spent = exps.reduce((t, e) => t + Number(e.amount), 0);
    const end = p?.closed_on ? new Date(p.closed_on + "T00:00:00") : new Date();   // salary is estimated from each person's joining date to today (or the closing date)
    const salary = r.live.reduce((t, e) => { if (!e.join_date || !(Number(e.monthly_ctc) > 0)) return t; const days = (end.getTime() - new Date(e.join_date + "T00:00:00").getTime()) / 864e5; return days > 0 ? t + (days / 30.4375) * Number(e.monthly_ctc) : t; }, 0);
    const byCat = tally(exps.map((e) => e.category_id)).map(([id]) => [cats.find((c) => c.id === id)?.name ?? "—", exps.filter((e) => e.category_id === id).reduce((t, e) => t + Number(e.amount), 0)] as const).sort((a, b) => b[1] - a[1]);
    const mo: Record<string, number> = {}; exps.forEach((e) => { const k = e.expense_date.slice(0, 7); mo[k] = (mo[k] || 0) + Number(e.amount); });
    const byMonth = Object.entries(mo).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [new Date(k + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" }), v] as const);
    return { spent, salary, total: spent + salary, byCat, byMonth };
  }, [exps, cats, r, p]);

  function csv() {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Name", "Emp no.", "Designation", "Department", "Employment type", "Date of joining", "Stage", "Phone", "Monthly CTC"],
      ...r.live.map((e) => [e.full_name, e.emp_no, e.designation, e.department, e.employment_type, e.join_date, stageLabel(e.stage), e.phone, e.monthly_ctc])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((x) => x.map(q).join(",")).join("\n")], { type: "text/csv" })); a.download = `${p?.name || "project"} - people.csv`; a.click();
  }
  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (err || !p) return <p className="warn">{err || "Project not found"}</p>;
  const card = (label: string, value: string, sub?: string) => <div className="card !p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-bold">{value}</div>{sub && <div className="text-xs text-slate-400">{sub}</div>}</div>;
  const bars = (rows: (readonly [string, number])[]) => <div className="space-y-1.5">{rows.map(([k, n]) => <div key={k} className="flex items-center gap-2 text-sm"><span className="w-36 sm:w-48 truncate" title={k}>{k}</span><div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#1e4fa3]" style={{ width: `${(n / Math.max(1, r.live.length)) * 100}%` }} /></div><span className="w-8 text-right text-slate-500">{n}</span></div>)}{!rows.length && <p className="text-sm text-slate-400">No data.</p>}</div>;

  const costBars = (rows: (readonly [string, number])[], max: number) => <div className="space-y-1.5">{rows.map(([k, v]) => <div key={k} className="flex items-center gap-2 text-sm"><span className="w-28 sm:w-36 truncate" title={k}>{k}</span><div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#1e4fa3]" style={{ width: `${(v / Math.max(1, max)) * 100}%` }} /></div><span className="w-24 text-right text-slate-500">₹{inr(v)}</span></div>)}</div>;
  return (
    <div className="space-y-4">
      <Link href="/projects" className="text-sm text-blue-700">← Projects</Link>
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold">{p.name}</h1>
        <span className={`text-xs rounded-full px-2 py-0.5 ${p.status === "active" ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}`}>{p.status === "active" ? "Active" : `Closed ${fmt(p.closed_on)}`}</span>
        <button className="btn sm:ml-auto" onClick={csv} disabled={!r.live.length}>⬇ People (CSV)</button><button className="btn" onClick={() => window.print()}>Print</button></div>
      <p className="text-sm text-slate-500">{p.location || "No location set"}{p.description ? ` · ${p.description}` : ""}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {card("People on project", String(r.live.length), r.rejected ? `${r.rejected} rejected / declined not counted` : undefined)}
        {card("Onboarded", String(r.live.filter((e) => e.stage === "onboarded").length), `${r.live.filter((e) => e.stage !== "onboarded").length} still in process`)}
        {card("Monthly CTC", r.withCtc ? `₹${inr(r.ctc)}` : "—", r.withCtc ? `${r.withCtc} of ${r.live.length} have a salary set` : "no salaries set yet")}
        {card("Joining dates", r.first ? fmt(r.first) : "—", r.last && r.last !== r.first ? `to ${fmt(r.last)}` : undefined)}
      </div>
      <h2 className="font-semibold pt-2">Cost to date</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {card("Expenses recorded", `₹${inr(cost.spent)}`, `${exps.length} entr${exps.length === 1 ? "y" : "ies"}`)}
        {card("Est. salary cost", r.withCtc ? `₹${inr(Math.round(cost.salary))}` : "—", "monthly CTC from each joining date (estimate)")}
        {card("Total project cost", `₹${inr(Math.round(cost.total))}`, "expenses + estimated salary")}
        {card("Cost per head", r.live.length ? `₹${inr(Math.round(cost.total / r.live.length))}` : "—", `across ${r.live.length} ${r.live.length === 1 ? "person" : "people"}`)}
      </div>
      {expErr && <p className="warn">{expErr}</p>}
      {!expErr && (cost.byCat.length > 0) && <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-2"><h3 className="font-semibold">Expenses by category</h3>{costBars(cost.byCat, cost.spent)}</div>
        <div className="card space-y-2"><h3 className="font-semibold">Expenses by month</h3>{costBars(cost.byMonth, Math.max(...cost.byMonth.map(([, v]) => v), 1))}</div>
      </div>}
      {!expErr && <ProjectExpenses project={p} cats={cats} setCats={setCats} expenses={exps} people={r.live} reload={loadExpenses} />}
      <h2 className="font-semibold pt-2">People</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card space-y-2"><h3 className="font-semibold">By department</h3>{bars(r.byDept)}</div>
        <div className="card space-y-2"><h3 className="font-semibold">By stage</h3>{bars(r.byStage)}</div>
        <div className="card space-y-2"><h3 className="font-semibold">By employment type</h3>{bars(r.byType)}</div>
      </div>
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Department</th><th className="p-3">Joining</th><th className="p-3">Stage</th><th className="p-3 text-right">Monthly CTC</th></tr></thead>
          <tbody>{r.live.map((e) => <tr key={e.id} className="border-t border-slate-100"><td className="p-3"><Link className="font-medium text-blue-800 hover:underline" href={`/employees/${e.id}`}>{e.full_name}</Link><div className="text-xs text-slate-500">{e.emp_no}</div></td><td className="p-3">{e.designation || "—"}</td><td className="p-3">{e.department || "—"}</td><td className="p-3 whitespace-nowrap">{fmt(e.join_date)}</td><td className="p-3"><span className="text-xs bg-blue-50 text-blue-800 rounded-full px-2 py-1">{stageLabel(e.stage)}</span></td><td className="p-3 text-right whitespace-nowrap">{Number(e.monthly_ctc) > 0 ? `₹${inr(Number(e.monthly_ctc))}` : "—"}</td></tr>)}
            {!r.live.length && <tr><td className="p-6 text-center text-slate-500" colSpan={6}>Nobody is assigned to this project yet.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}
