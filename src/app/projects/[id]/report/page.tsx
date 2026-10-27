"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { stageLabel } from "@/lib/pipeline";
import { inr } from "@/lib/quote";
import { fmtD, useProjectData } from "@/lib/projectData";

export default function ProjectReport() {
  const { id } = useParams<{ id: string }>();
  const { p, err, loading, exps, expErr, r, cost } = useProjectData(id);

  function csv() {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Name", "Emp no.", "Designation", "Department", "Employment type", "Date of joining", "Stage", "Phone", "Monthly CTC"],
      ...r.live.map((e) => [e.full_name, e.emp_no, e.designation, e.department, e.employment_type, e.join_date, stageLabel(e.stage), e.phone, e.monthly_ctc])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((x) => x.map(q).join(",")).join("\n")], { type: "text/csv" })); a.download = `${p?.name || "project"} - people.csv`; a.click();
  }
  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (err || !p) return <p className="warn">{err || "Project not found"}</p>;
  const card = (label: string, value: string, sub?: string) => <div className="card !p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-bold">{value}</div>{sub && <div className="text-xs text-slate-400">{sub}</div>}</div>;
  const bars = (rows: (readonly [string, number])[], max: number, money = false) => <div className="space-y-1.5">{rows.map(([k, n]) => <div key={k} className="flex items-center gap-2 text-sm"><span className="w-28 sm:w-44 truncate" title={k}>{k}</span><div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#1e4fa3]" style={{ width: `${(n / Math.max(1, max)) * 100}%` }} /></div><span className={`${money ? "w-24" : "w-8"} text-right text-slate-500`}>{money ? `₹${inr(n)}` : n}</span></div>)}{!rows.length && <p className="text-sm text-slate-400">No data.</p>}</div>;

  return (
    <div className="space-y-4">
      <Link href={`/projects/${id}`} className="text-sm text-blue-700">← Back to project</Link>
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold">{p.name} — report</h1>
        <span className={`text-xs rounded-full px-2 py-0.5 ${p.status === "active" ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}`}>{p.status === "active" ? "Active" : `Closed ${fmtD(p.closed_on)}`}</span>
        <button className="btn sm:ml-auto" onClick={csv} disabled={!r.live.length}>⬇ People (CSV)</button><button className="btn" onClick={() => window.print()}>Print</button></div>
      <p className="text-sm text-slate-500">{p.location || "No location set"}{p.description ? ` · ${p.description}` : ""}</p>

      <h2 className="font-semibold pt-2">People</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {card("People on project", String(r.live.length), r.rejected ? `${r.rejected} rejected / declined not counted` : undefined)}
        {card("Onboarded", String(r.live.filter((e) => e.stage === "onboarded").length), `${r.live.filter((e) => e.stage !== "onboarded").length} still in process`)}
        {card("Monthly CTC", r.withCtc ? `₹${inr(r.ctc)}` : "—", r.withCtc ? `${r.withCtc} of ${r.live.length} have a salary set` : "no salaries set yet")}
        {card("Joining dates", r.first ? fmtD(r.first) : "—", r.last && r.last !== r.first ? `to ${fmtD(r.last)}` : undefined)}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card space-y-2"><h3 className="font-semibold">By department</h3>{bars(r.byDept, r.live.length)}</div>
        <div className="card space-y-2"><h3 className="font-semibold">By stage</h3>{bars(r.byStage, r.live.length)}</div>
        <div className="card space-y-2"><h3 className="font-semibold">By employment type</h3>{bars(r.byType, r.live.length)}</div>
      </div>

      <h2 className="font-semibold pt-2">Cost to date</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {card("Expenses recorded", `₹${inr(cost.spent)}`, `${exps.length} entr${exps.length === 1 ? "y" : "ies"}`)}
        {card("Est. salary cost", r.withCtc ? `₹${inr(Math.round(cost.salary))}` : "—", "monthly CTC from each joining date (estimate)")}
        {card("Total project cost", `₹${inr(Math.round(cost.total))}`, "expenses + estimated salary")}
        {card("Cost per head", r.live.length ? `₹${inr(Math.round(cost.total / r.live.length))}` : "—", `across ${r.live.length} ${r.live.length === 1 ? "person" : "people"}`)}
      </div>
      {expErr && <p className="warn">{expErr}</p>}
      {!expErr && cost.byCat.length > 0 && <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-2"><h3 className="font-semibold">Expenses by category</h3>{bars(cost.byCat, cost.spent, true)}</div>
        <div className="card space-y-2"><h3 className="font-semibold">Expenses by month</h3>{bars(cost.byMonth, Math.max(...cost.byMonth.map(([, v]) => v), 1), true)}</div>
      </div>}

      <h2 className="font-semibold pt-2">People list</h2>
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Department</th><th className="p-3">Joining</th><th className="p-3">Stage</th><th className="p-3 text-right">Monthly CTC</th></tr></thead>
          <tbody>{r.live.map((e) => <tr key={e.id} className="border-t border-slate-100"><td className="p-3"><Link className="font-medium text-blue-800 hover:underline" href={`/employees/${e.id}`}>{e.full_name}</Link><div className="text-xs text-slate-500">{e.emp_no}</div></td><td className="p-3">{e.designation || "—"}</td><td className="p-3">{e.department || "—"}</td><td className="p-3 whitespace-nowrap">{fmtD(e.join_date)}</td><td className="p-3"><span className="text-xs bg-blue-50 text-blue-800 rounded-full px-2 py-1">{stageLabel(e.stage)}</span></td><td className="p-3 text-right whitespace-nowrap">{Number(e.monthly_ctc) > 0 ? `₹${inr(Number(e.monthly_ctc))}` : "—"}</td></tr>)}
            {!r.live.length && <tr><td className="p-6 text-center text-slate-500" colSpan={6}>Nobody is assigned to this project yet.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}
