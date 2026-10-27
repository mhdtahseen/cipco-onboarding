"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { inr } from "@/lib/quote";
import type { Project } from "@/lib/types";

export default function ProjectsPage() {
  const router = useRouter(); const [projects, setProjects] = useState<Project[]>([]); const [people, setPeople] = useState<Record<string, number>>({}); const [spent, setSpent] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<"active" | "closed" | "all">("active"); const [q, setQ] = useState(""); const [adding, setAdding] = useState(false); const [draft, setDraft] = useState({ name: "", location: "", description: "" });
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [loading, setLoading] = useState(true);

  async function load() {
    const sb = supabase(); const [p, e, x] = await Promise.all([sb.from("projects").select("*").order("name"), sb.from("employees").select("project_id,outcome").not("project_id", "is", null), sb.from("project_expenses").select("project_id,amount")]);
    if (p.error) { setErr(p.error.message + " — has the projects & departments SQL migration been run?"); setLoading(false); return; }
    setProjects((p.data || []) as Project[]);
    const pc: Record<string, number> = {}; (e.data || []).forEach((r: any) => { if (r.outcome !== "rejected") pc[r.project_id] = (pc[r.project_id] || 0) + 1; }); setPeople(pc);
    const sc: Record<string, number> = {}; (x.data || []).forEach((r: any) => { sc[r.project_id] = (sc[r.project_id] || 0) + Number(r.amount); }); setSpent(sc);   // empty until the expenses migration has been run
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!draft.name.trim()) { setMsg("Enter a project name."); return; }
    const { data, error } = await supabase().from("projects").insert({ name: draft.name.trim(), location: draft.location.trim(), description: draft.description.trim() }).select("id").single();
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "A project with that name already exists." : error.message); return; }
    router.push(`/projects/${data.id}`);
  }
  const nActive = projects.filter((p) => p.status === "active").length;
  const shown = projects.filter((p) => (filter === "all" || p.status === filter) && (p.name + " " + p.location).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold sm:mr-auto w-full sm:w-auto">Projects</h1>
        <input className="inp w-full sm:!w-64" placeholder="Search name or location…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary flex-1 sm:flex-none justify-center" onClick={() => { setAdding(!adding); setMsg(""); }}>{adding ? "Cancel" : "+ New project"}</button>
      </div>
      {adding && <div className="card space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="lbl">Project name</label><input className="inp" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div><label className="lbl">Location</label><input className="inp" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="e.g. Mundra, Gujarat" /></div>
          <div className="sm:col-span-2"><label className="lbl">Description <span className="font-normal text-slate-400">(optional)</span></label><textarea className="inp" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
        </div>
        <div className="flex items-center gap-3"><button className="btn btn-primary" onClick={create}>Create project</button>{msg && <span className="text-sm text-red-700">{msg}</span>}</div>
      </div>}
      <div className="flex gap-2">{(["active", "closed", "all"] as const).map((k) => <button key={k} className={`btn ${filter === k ? "btn-primary" : ""}`} onClick={() => setFilter(k)}>{k === "active" ? `Active (${nActive})` : k === "closed" ? `Closed (${projects.length - nActive})` : "All"}</button>)}</div>
      {err && <p className="warn">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loading && <p className="card text-center text-sm text-slate-500 sm:col-span-full">Loading…</p>}
        {!loading && !shown.length && !err && <p className="card text-center text-sm text-slate-500 sm:col-span-full">{q ? "Nothing matches your search." : filter === "closed" ? "No closed projects." : "No projects yet — add your first one."}</p>}
        {shown.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className={`card !p-4 hover:bg-slate-50 space-y-1 ${p.status === "closed" ? "opacity-80" : ""}`}>
            <div className="flex items-start gap-2"><span className="font-semibold text-blue-800 break-words">{p.name}</span><span className={`ml-auto shrink-0 text-xs rounded-full px-2 py-0.5 ${p.status === "active" ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}`}>{p.status === "active" ? "Active" : "Closed"}</span></div>
            <div className="text-sm text-slate-500 truncate">{p.location || "No location"}</div>
            <div className="text-xs text-slate-400 pt-1">{people[p.id] || 0} {(people[p.id] || 0) === 1 ? "person" : "people"}{spent[p.id] ? ` · ₹${inr(spent[p.id])} expenses` : ""}</div>
          </Link>))}
      </div>
    </div>
  );
}
