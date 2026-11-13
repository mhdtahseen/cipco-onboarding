"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import type { EmployeeProject, Project } from "@/lib/types";

// The projects a head-office person works on (2026-11-stationed-at.sql). They are never on these sites' attendance or onsite team; each link says
// their role, the dates, and whether they need the site's gate-pass documents (the joining kit, and the police verification form when the site asks
// for it). Changes save straight away. Staff only (the database refuses anyone else).
export default function ProjectLinks({ employeeId, projects }: { employeeId: string; projects: Project[] }) {
  const [rows, setRows] = useState<EmployeeProject[]>([]); const [err, setErr] = useState(""); const [loaded, setLoaded] = useState(false);
  const [add, setAdd] = useState({ project_id: "", role: "", from_date: "", to_date: "", gate_pass: true });
  const load = useCallback(async () => {
    const { data, error } = await supabase().from("employee_projects").select("*").eq("employee_id", employeeId).order("created_at");
    if (error) setErr(/employee_projects|schema cache/i.test(error.message) ? "Project links need the 2026-11-stationed-at.sql migration." : error.message); else { setRows((data || []) as EmployeeProject[]); setErr(""); }
    setLoaded(true);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? "Project";
  const free = projects.filter((p) => p.status === "active" && !rows.some((r) => r.project_id === p.id));

  async function create() {
    if (!add.project_id) { setErr("Choose the project."); return; }
    if (add.from_date && add.to_date && add.to_date < add.from_date) { setErr("The end date is before the start date."); return; }
    const { error } = await supabase().from("employee_projects").insert({ employee_id: employeeId, project_id: add.project_id, role: add.role.trim(), from_date: add.from_date || null, to_date: add.to_date || null, gate_pass: add.gate_pass });
    if (error) { setErr(error.message); return; }
    setAdd({ project_id: "", role: "", from_date: "", to_date: "", gate_pass: true }); load();
  }
  async function update(r: EmployeeProject, patch: Partial<EmployeeProject>) {
    const next = { ...r, ...patch };
    if (next.from_date && next.to_date && next.to_date < next.from_date) { setErr("The end date is before the start date."); return; }
    setRows((x) => x.map((y) => (y.id === r.id ? next : y)));
    const { error } = await supabase().from("employee_projects").update(patch).eq("id", r.id); if (error) { setErr(error.message); load(); } else setErr("");
  }
  async function remove(r: EmployeeProject) {
    if (!confirm(`Remove ${name(r.project_id)} from this person's projects?`)) return;
    const { error } = await supabase().from("employee_projects").delete().eq("id", r.id); if (error) setErr(error.message); else load();
  }

  return (
    <section className="card space-y-3" data-project-links>
      <div><h3 className="font-semibold">Projects (head office)</h3>
        <p className="text-xs text-slate-500">The projects this person works on from head office. They are not on these sites' attendance or onsite team. Tick <b>Gate pass</b> where they need the site's gate-pass documents.</p></div>
      {err && <p className="warn" role="alert">{err}</p>}
      {loaded && !rows.length && !err && <p className="text-sm text-slate-500">Not linked to any project yet.</p>}
      {rows.length > 0 && <div className="divide-y divide-slate-100">{rows.map((r) => (
        <div key={r.id} className="py-2.5 grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_auto_auto_auto_auto] sm:items-center">
          <Link className="font-medium text-blue-800 hover:underline truncate" href={`/projects/${r.project_id}`}>{name(r.project_id)}</Link>
          <input className="inp" aria-label="Role" placeholder="Role (e.g. Project manager)" defaultValue={r.role} onBlur={(e) => e.target.value.trim() !== r.role && update(r, { role: e.target.value.trim() })} />
          <input className="inp sm:!w-36" type="date" aria-label="From" value={r.from_date ?? ""} onChange={(e) => update(r, { from_date: e.target.value || null })} />
          <input className="inp sm:!w-36" type="date" aria-label="To" value={r.to_date ?? ""} onChange={(e) => update(r, { to_date: e.target.value || null })} />
          <label className="text-sm flex items-center gap-1.5 whitespace-nowrap"><input type="checkbox" checked={r.gate_pass} onChange={(e) => update(r, { gate_pass: e.target.checked })} />Gate pass</label>
          <button type="button" className="text-xs text-red-700 underline justify-self-start" onClick={() => remove(r)}>Remove</button>
        </div>))}</div>}
      {!err?.includes("migration") && <div className="border-t border-slate-100 pt-3 flex flex-wrap items-end gap-2">
        <select className="inp sm:!w-56" aria-label="Project to add" value={add.project_id} onChange={(e) => setAdd({ ...add, project_id: e.target.value })}><option value="">Add a project…</option>{free.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}</option>)}</select>
        <input className="inp sm:!w-48" placeholder="Role (optional)" aria-label="Role for the new project" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })} />
        <label className="text-xs text-slate-500">From<input className="inp sm:!w-36 block" type="date" value={add.from_date} onChange={(e) => setAdd({ ...add, from_date: e.target.value })} /></label>
        <label className="text-xs text-slate-500">To<input className="inp sm:!w-36 block" type="date" value={add.to_date} onChange={(e) => setAdd({ ...add, to_date: e.target.value })} /></label>
        <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" checked={add.gate_pass} onChange={(e) => setAdd({ ...add, gate_pass: e.target.checked })} />Gate pass</label>
        <button type="button" className="btn btn-primary" onClick={create}>Add</button>
      </div>}
    </section>);
}
