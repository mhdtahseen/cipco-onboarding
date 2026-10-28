"use client";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { stageLabel } from "@/lib/pipeline";
import { inr } from "@/lib/quote";
import { todayISO } from "@/lib/format";
import { fmtD, useProjectData } from "@/lib/projectData";
import ProjectExpenses from "@/components/ProjectExpenses";
import ProjectDocuments from "@/components/ProjectDocuments";
import SalaryCost from "@/components/SalaryCost";

type Tab = "overview" | "people" | "expenses" | "documents";

// One project at a glance. Overview first; people, expenses and documents each get their own tab; the report is its own page.
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const d = useProjectData(id); const { p, r, exps, cats, pdocs, dTypes } = d;
  const [tab, setTab] = useState<Tab>("overview"); const [edit, setEdit] = useState(false); const [ed, setEd] = useState({ name: "", location: "", description: "" });
  const [expOpen, setExpOpen] = useState(0); const [docOpen, setDocOpen] = useState(0); const [msg, setMsg] = useState("");
  if (d.loading) return <p className="text-slate-500">Loading…</p>;
  if (d.err || !p) return <p className="warn">{d.err || "Project not found"}</p>;

  async function save() {
    const name = ed.name.trim(); if (!name) { setMsg("Enter a project name."); return; }
    const { error } = await supabase().from("projects").update({ name, location: ed.location.trim(), description: ed.description.trim() }).eq("id", p!.id);
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "A project with that name already exists." : error.message); return; }
    if (name !== p!.name) await supabase().from("employees").update({ project: name }).eq("project_id", p!.id);   // keep people's project text in step with a rename
    setEdit(false); setMsg(""); d.loadProject();
  }
  async function setStatus(status: "active" | "closed") {
    if (status === "closed" && !confirm(`Close “${p!.name}”? It disappears from the employee dropdown (people already on it keep it).`)) return;
    await supabase().from("projects").update({ status, closed_on: status === "closed" ? todayISO() : null }).eq("id", p!.id); d.loadProject();
  }
  const goExpense = () => { setTab("expenses"); setExpOpen((n) => n + 1); }; const goDoc = () => { setTab("documents"); setDocOpen((n) => n + 1); };
  const card = (label: string, value: string, sub?: string, onClick?: () => void) => <button type="button" onClick={onClick} className="card !p-3 text-left hover:bg-slate-50"><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-bold">{value}</div>{sub && <div className="text-xs text-slate-400">{sub}</div>}</button>;
  const tabs: [Tab, string, number | null][] = [["overview", "Overview", null], ["people", "People", r.live.length], ["expenses", "Expenses", exps.length], ["documents", "Documents", pdocs.length]];
  const catName = (cid: string) => cats.find((c) => c.id === cid)?.name ?? "—";
  const typeName = (tid: string | null) => dTypes.find((t) => t.id === tid)?.name ?? "—";

  return (
    <div className="space-y-4">
      <Link href="/projects" className="text-sm text-blue-700">← Projects</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{p.name}</h1>
        <span className={`text-xs rounded-full px-2 py-0.5 ${p.status === "active" ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}`}>{p.status === "active" ? "Active" : `Closed ${fmtD(p.closed_on)}`}</span>
        <div className="flex gap-2 sm:ml-auto"><Link className="btn btn-primary" href={`/projects/${id}/report`}>Report</Link><button className="btn" onClick={() => { setEd({ name: p.name, location: p.location, description: p.description }); setEdit(!edit); }}>Edit</button>
          {p.status === "active" ? <button className="btn" onClick={() => setStatus("closed")}>Close project</button> : <button className="btn" onClick={() => setStatus("active")}>Reopen</button>}</div>
      </div>
      {edit ? (
        <div className="card space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div><label className="lbl">Project name</label><input className="inp" value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} /></div><div><label className="lbl">Location</label><input className="inp" value={ed.location} onChange={(e) => setEd({ ...ed, location: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="lbl">Description</label><textarea className="inp" rows={2} value={ed.description} onChange={(e) => setEd({ ...ed, description: e.target.value })} /></div></div>
          <p className="text-xs text-slate-400">Renaming updates the project name on its employees. Changing the location does not change employees already assigned.</p>
          <div className="flex items-center gap-2"><button className="btn btn-primary" onClick={save}>Save</button><button className="btn" onClick={() => { setEdit(false); setMsg(""); }}>Cancel</button>{msg && <span className="text-sm text-red-700">{msg}</span>}</div></div>
      ) : <p className="text-sm text-slate-500">{p.location || "No location set"}{p.description ? ` · ${p.description}` : ""}</p>}

      <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">{tabs.map(([k, label, n]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{label}{n !== null && <span className="ml-1.5 text-xs text-slate-400">{n}</span>}</button>)}</div>

      {tab === "overview" && <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {card("People", String(r.live.length), r.rejected ? `${r.rejected} rejected not counted` : "on this project", () => setTab("people"))}
          {card("Expenses to date", d.expErr ? "—" : `₹${inr(d.cost.spent)}`, `${exps.length} entr${exps.length === 1 ? "y" : "ies"}`, () => setTab("expenses"))}
          {card("Documents", d.docErr ? "—" : String(pdocs.length), "letters, JSAs, POs…", () => setTab("documents"))}
          {card("First joining", r.first ? fmtD(r.first) : "—", r.last && r.last !== r.first ? `latest ${fmtD(r.last)}` : undefined, () => setTab("people"))}
        </div>
        <SalaryCost projectId={id} people={r.live} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card space-y-2">
            <div className="flex items-center gap-2"><h3 className="font-semibold">Recent expenses</h3><button className="btn !py-1 ml-auto" onClick={goExpense} disabled={!!d.expErr}>+ Add expense</button></div>
            {d.expErr ? <p className="warn">{d.expErr}</p> : <>
              {exps.slice(0, 5).map((e) => <div key={e.id} className="flex items-baseline gap-2 text-sm border-b border-slate-100 pb-1.5"><span className="text-xs text-slate-400 w-20 shrink-0">{fmtD(e.expense_date)}</span><span className="min-w-0 flex-1 truncate">{catName(e.category_id)}{e.description ? ` · ${e.description}` : ""}</span><span className="font-medium whitespace-nowrap">₹{inr(Number(e.amount))}</span></div>)}
              {!exps.length && <p className="text-sm text-slate-400">No expenses recorded yet.</p>}
              {exps.length > 5 && <button className="text-sm text-blue-700" onClick={() => setTab("expenses")}>View all {exps.length} →</button>}</>}
          </div>
          <div className="card space-y-2">
            <div className="flex items-center gap-2"><h3 className="font-semibold">Recent documents</h3><button className="btn !py-1 ml-auto" onClick={goDoc} disabled={!!d.docErr}>+ Add document</button></div>
            {d.docErr ? <p className="warn">{d.docErr}</p> : <>
              {pdocs.slice(0, 5).map((x) => <div key={x.id} className="flex items-baseline gap-2 text-sm border-b border-slate-100 pb-1.5"><span className="text-xs text-slate-400 w-20 shrink-0">{fmtD(x.doc_date)}</span><span className="min-w-0 flex-1 truncate">{x.title} <span className="text-xs text-slate-400">· {typeName(x.type_id)}</span></span><a className="text-blue-700 text-xs whitespace-nowrap" href={`/api/docs/view?path=${encodeURIComponent(x.file_path)}`} target="_blank">Open</a></div>)}
              {!pdocs.length && <p className="text-sm text-slate-400">No documents added yet.</p>}
              {pdocs.length > 5 && <button className="text-sm text-blue-700" onClick={() => setTab("documents")}>View all {pdocs.length} →</button>}</>}
          </div>
        </div>
        <p className="text-sm text-slate-500">Costs, charts and the full people breakdown are in the <Link className="text-blue-700 underline" href={`/projects/${id}/report`}>Report</Link>.</p>
      </div>}

      {tab === "people" && <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Department</th><th className="p-3">Joining</th><th className="p-3">Stage</th></tr></thead>
          <tbody>{r.live.map((e) => <tr key={e.id} className="border-t border-slate-100"><td className="p-3"><Link className="font-medium text-blue-800 hover:underline" href={`/employees/${e.id}`}>{e.full_name}</Link><div className="text-xs text-slate-500">{e.emp_no}</div></td><td className="p-3">{e.designation || "—"}</td><td className="p-3">{e.department || "—"}</td><td className="p-3 whitespace-nowrap">{fmtD(e.join_date)}</td><td className="p-3"><span className="text-xs bg-blue-50 text-blue-800 rounded-full px-2 py-1">{stageLabel(e.stage)}</span></td></tr>)}
            {!r.live.length && <tr><td className="p-6 text-center text-slate-500" colSpan={5}>Nobody is assigned to this project yet. Pick this project in a person's <b>Project</b> field to add them.</td></tr>}</tbody></table>
      </div>}

      {tab === "expenses" && (d.expErr ? <p className="warn">{d.expErr}</p> : <ProjectExpenses project={p} cats={cats} setCats={d.setCats} expenses={exps} people={r.live} reload={d.loadExpenses} openSignal={expOpen} />)}
      {tab === "documents" && (d.docErr ? <p className="warn">{d.docErr}</p> : <ProjectDocuments project={p} types={dTypes} setTypes={d.setDTypes} docs={pdocs} reload={d.loadDocs} openSignal={docOpen} />)}
    </div>
  );
}
