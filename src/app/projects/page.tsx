"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { inr } from "@/lib/quote";
import { guessState, STATE_OPTIONS, type Client } from "@/lib/invoice";
import { swrDrop, swrGet, swrSet } from "@/lib/swr";

type PSnap = { projects: Project[]; clients: Client[]; people: Record<string, number>; spent: Record<string, number> };
import type { Project } from "@/lib/types";

export default function ProjectsPage() {
  const router = useRouter(); const snap = swrGet<PSnap>("projects");   // last result, shown at once while a fresh one loads
  const [projects, setProjects] = useState<Project[]>(snap?.projects ?? []); const [people, setPeople] = useState<Record<string, number>>(snap?.people ?? {}); const [spent, setSpent] = useState<Record<string, number>>(snap?.spent ?? {});
  const [filter, setFilter] = useState<"active" | "closed" | "all">("active"); const [q, setQ] = useState(""); const [adding, setAdding] = useState(false); const [draft, setDraft] = useState({ name: "", location: "", description: "", client_id: "", state_code: "" }); const [clients, setClients] = useState<Client[]>(snap?.clients ?? []);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [loading, setLoading] = useState(!snap);

  async function load() {
    const sb = supabase(); const [p, e, x, c] = await Promise.all([sb.from("projects").select("*").order("name"), sb.from("employees").select("project_id,outcome").not("project_id", "is", null), sb.from("project_expenses").select("project_id,amount"), sb.from("clients").select("*").eq("active", true).order("name")]);
    if (p.error) { setErr(p.error.message + " — has the projects & departments SQL migration been run?"); setLoading(false); return; }
    const pr = (p.data || []) as Project[]; const cl = (c.data || []) as Client[];
    const pc: Record<string, number> = {}; (e.data || []).forEach((r: any) => { if (r.outcome !== "rejected") pc[r.project_id] = (pc[r.project_id] || 0) + 1; });
    const sc: Record<string, number> = {}; (x.data || []).forEach((r: any) => { sc[r.project_id] = (sc[r.project_id] || 0) + Number(r.amount); });   // empty until the expenses migration has been run
    setProjects(pr); setClients(cl); setPeople(pc); setSpent(sc); setLoading(false);
    swrSet("projects", { projects: pr, clients: cl, people: pc, spent: sc } satisfies PSnap);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!draft.name.trim()) { setMsg("Enter a project name."); return; }
    const { data, error } = await supabase().from("projects").insert({ name: draft.name.trim(), location: draft.location.trim(), description: draft.description.trim(), client_id: draft.client_id || null, state_code: draft.state_code || guessState(draft.location) || null }).select("id").single();
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "A project with that name already exists." : error.message); return; }
    swrDrop("projects", "clients", "workorders", "invoices");
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
          <div><label className="lbl">Client</label><select className="inp" value={draft.client_id} onChange={(e) => setDraft({ ...draft, client_id: e.target.value })}><option value="">Not linked yet</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="lbl">State of the site <span className="font-normal text-slate-400">(decides CGST + SGST or IGST)</span></label><select className="inp" value={draft.state_code || guessState(draft.location)} onChange={(e) => setDraft({ ...draft, state_code: e.target.value })}><option value="">Choose…</option>{STATE_OPTIONS.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
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
            <div className="text-sm text-slate-500 truncate">{p.location || "No location"}</div>{p.client_id && <div className="text-xs text-slate-500 truncate">Client: {clients.find((c) => c.id === p.client_id)?.short_name || clients.find((c) => c.id === p.client_id)?.name || "…"}</div>}
            <div className="text-xs text-slate-400 pt-1">{people[p.id] || 0} {(people[p.id] || 0) === 1 ? "person" : "people"}{spent[p.id] ? ` · ₹${inr(spent[p.id])} expenses` : ""}</div>
          </Link>))}
      </div>
    </div>
  );
}
