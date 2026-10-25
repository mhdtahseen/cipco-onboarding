"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { todayISO } from "@/lib/format";
import type { Department, ExpenseCategory, Project } from "@/lib/types";

const BLANK = { name: "", location: "", description: "" };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]); const [depts, setDepts] = useState<Department[]>([]); const [counts, setCounts] = useState<Record<string, number>>({}); const [deptCounts, setDeptCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<"active" | "closed" | "all">("active"); const [draft, setDraft] = useState(BLANK); const [edit, setEdit] = useState<string | null>(null); const [ed, setEd] = useState(BLANK);
  const [cats, setCats] = useState<ExpenseCategory[]>([]); const [newCat, setNewCat] = useState(""); const [newDept, setNewDept] = useState(""); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  async function load() {
    const sb = supabase();
    const [p, d, e] = await Promise.all([sb.from("projects").select("*").order("name"), sb.from("departments").select("*").order("name"), sb.from("employees").select("project_id,department")]);
    if (p.error) { setErr(p.error.message + " — has the projects & departments SQL migration been run?"); return; }
    setProjects((p.data || []) as Project[]); setDepts((d.data || []) as Department[]);
    sb.from("expense_categories").select("*").order("sort_order").then(({ data }) => setCats((data || []) as ExpenseCategory[]));   // empty until the expenses migration has been run
    const pc: Record<string, number> = {}, dc: Record<string, number> = {};
    (e.data || []).forEach((r: any) => { if (r.project_id) pc[r.project_id] = (pc[r.project_id] || 0) + 1; if (r.department) dc[r.department.toLowerCase()] = (dc[r.department.toLowerCase()] || 0) + 1; });
    setCounts(pc); setDeptCounts(dc);
  }
  useEffect(() => { load(); }, []);
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  async function addProject() {
    if (!draft.name.trim()) { setMsg("Enter a project name."); return; }
    const { error } = await supabase().from("projects").insert({ name: draft.name.trim(), location: draft.location.trim(), description: draft.description.trim() });
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "A project with that name already exists." : error.message); return; }
    setDraft(BLANK); note("Project added ✓"); load();
  }
  async function saveProject(p: Project) {
    const name = ed.name.trim(); if (!name) return;
    const { error } = await supabase().from("projects").update({ name, location: ed.location.trim(), description: ed.description.trim() }).eq("id", p.id);
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "A project with that name already exists." : error.message); return; }
    if (name !== p.name) await supabase().from("employees").update({ project: name }).eq("project_id", p.id);   // keep people's project text in step with a rename
    setEdit(null); note("Saved ✓"); load();
  }
  async function setStatus(p: Project, status: "active" | "closed") {
    await supabase().from("projects").update({ status, closed_on: status === "closed" ? todayISO() : null }).eq("id", p.id); load();
  }
  async function addDept() {
    const name = newDept.trim(); if (!name) return;
    const { error } = await supabase().from("departments").insert({ name });
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "That department already exists." : error.message); return; }
    setNewDept(""); note("Department added ✓"); load();
  }
  async function renameDept(d: Department) {
    const name = prompt("Rename department", d.name)?.trim(); if (!name || name === d.name) return;
    const { error } = await supabase().from("departments").update({ name }).eq("id", d.id);
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "That department already exists." : error.message); return; }
    await supabase().from("employees").update({ department: name }).eq("department", d.name);   // keep people's department in step with the rename
    note("Renamed ✓"); load();
  }
  async function addCat() {
    const name = newCat.trim(); if (!name) return;
    const { error } = await supabase().from("expense_categories").insert({ name, sort_order: Math.max(0, ...cats.map((c) => c.sort_order)) + 10 });
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "That category already exists." : error.message + " — has the project-expenses SQL migration been run?"); return; }
    setNewCat(""); note("Category added ✓"); load();
  }
  async function renameCat(c: ExpenseCategory) {
    const name = prompt("Rename expense category", c.name)?.trim(); if (!name || name === c.name) return;
    const { error } = await supabase().from("expense_categories").update({ name }).eq("id", c.id);
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "That category already exists." : error.message); return; } note("Renamed ✓"); load();
  }
  async function toggleCat(c: ExpenseCategory) { await supabase().from("expense_categories").update({ active: !c.active }).eq("id", c.id); load(); }
  async function toggleDept(d: Department) { await supabase().from("departments").update({ active: !d.active }).eq("id", d.id); load(); }

  const shown = projects.filter((p) => filter === "all" || p.status === filter);
  const nActive = projects.filter((p) => p.status === "active").length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold sm:mr-auto w-full sm:w-auto">Projects &amp; departments</h1>{msg && <span className="text-sm text-green-700">{msg}</span>}</div>
      {err && <p className="warn">{err}</p>}

      <section className="space-y-3">
        <h2 className="font-semibold">Projects</h2>
        <p className="text-sm text-slate-500">Choosing a project on an employee fills in its location automatically. Several projects can share a location. Only <b>active</b> projects appear in the employee dropdown; closed ones stay here for records.</p>
        <div className="card space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="lbl">Project name</label><input className="inp" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div><label className="lbl">Location</label><input className="inp" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="e.g. Mundra, Gujarat" /></div>
            <div className="sm:col-span-2"><label className="lbl">Description</label><textarea className="inp" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
          </div>
          <button className="btn btn-primary" onClick={addProject}>+ Add project</button>
        </div>
        <div className="flex gap-2">{(["active", "closed", "all"] as const).map((k) => <button key={k} className={`btn ${filter === k ? "btn-primary" : ""}`} onClick={() => setFilter(k)}>{k === "active" ? `Active (${nActive})` : k === "closed" ? `Closed (${projects.length - nActive})` : "All"}</button>)}</div>
        {!shown.length && !err && <p className="card text-center text-sm text-slate-500">No {filter === "all" ? "" : filter + " "}projects yet.</p>}
        {shown.map((p) => (
          <div key={p.id} className={`card !p-3 space-y-2 ${p.status === "closed" ? "opacity-80" : ""}`}>
            {edit === p.id ? <>
              <div className="grid gap-2 sm:grid-cols-2"><input className="inp" value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} /><input className="inp" value={ed.location} onChange={(e) => setEd({ ...ed, location: e.target.value })} placeholder="Location" /><textarea className="inp sm:col-span-2" rows={2} value={ed.description} onChange={(e) => setEd({ ...ed, description: e.target.value })} /></div>
              <p className="text-xs text-slate-400">Renaming updates the project name on its employees. Changing the location does not change employees already assigned.</p>
              <div className="flex gap-2"><button className="btn btn-primary !py-1" onClick={() => saveProject(p)}>Save</button><button className="btn !py-1" onClick={() => setEdit(null)}>Cancel</button></div></> : <>
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.name}</span><span className="text-sm text-slate-500">{p.location || "no location"}</span>
                <span className={`text-xs rounded-full px-2 py-0.5 ${p.status === "active" ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}`}>{p.status === "active" ? "Active" : `Closed${p.closed_on ? ` · ${fmt(p.closed_on)}` : ""}`}</span>
                <span className="text-xs text-slate-400 sm:ml-auto">{counts[p.id] || 0} on this project</span></div>
              {p.description && <p className="text-sm text-slate-600">{p.description}</p>}
              <div className="flex flex-wrap gap-2"><Link className="btn !py-1" href={`/projects/${p.id}`}>Report</Link><button className="btn !py-1" onClick={() => { setEdit(p.id); setEd({ name: p.name, location: p.location, description: p.description }); }}>Edit</button>
                {p.status === "active" ? <button className="btn !py-1" onClick={() => confirm(`Close “${p.name}”? It disappears from the employee dropdown (people already on it keep it).`) && setStatus(p, "closed")}>Close project</button> : <button className="btn !py-1" onClick={() => setStatus(p, "active")}>Reopen</button>}</div></>}
          </div>))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Departments</h2>
        <p className="text-sm text-slate-500">The department dropdown on employees uses this list, so spellings stay uniform. You can also add one from the dropdown itself. Hidden departments leave the dropdown but stay on people who have them.</p>
        <div className="flex gap-2"><input className="inp !w-auto flex-1 sm:flex-none sm:!w-72" placeholder="New department" value={newDept} onChange={(e) => setNewDept(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addDept()} /><button className="btn btn-primary" onClick={addDept}>+ Add</button></div>
        <div className="card !p-0 divide-y divide-slate-100">
          {depts.map((d) => <div key={d.id} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${d.active ? "" : "opacity-60"}`}><span className="font-medium">{d.name}</span><span className="text-xs text-slate-400">{deptCounts[d.name.toLowerCase()] || 0} people</span>
            <button className="btn !py-1 sm:ml-auto" onClick={() => renameDept(d)}>Rename</button><button className="btn !py-1" onClick={() => toggleDept(d)}>{d.active ? "Hide" : "Show"}</button></div>)}
          {!depts.length && <p className="p-4 text-center text-sm text-slate-500">No departments yet.</p>}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Expense categories</h2>
        <p className="text-sm text-slate-500">Used when recording project expenses. Renaming changes it everywhere; hidden categories leave the dropdown but keep their past entries.</p>
        <div className="flex gap-2"><input className="inp !w-auto flex-1 sm:flex-none sm:!w-72" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} /><button className="btn btn-primary" onClick={addCat}>+ Add</button></div>
        <div className="card !p-0 divide-y divide-slate-100">
          {cats.map((c) => <div key={c.id} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${c.active ? "" : "opacity-60"}`}><span className="font-medium">{c.name}</span><button className="btn !py-1 sm:ml-auto" onClick={() => renameCat(c)}>Rename</button><button className="btn !py-1" onClick={() => toggleCat(c)}>{c.active ? "Hide" : "Show"}</button></div>)}
          {!cats.length && <p className="p-4 text-center text-sm text-slate-500">No categories yet — run the project-expenses SQL migration to add the starter list.</p>}
        </div>
      </section>
    </div>
  );
}
