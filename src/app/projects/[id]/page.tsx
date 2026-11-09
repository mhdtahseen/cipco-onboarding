"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { swrDrop } from "@/lib/swr";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { stageLabel } from "@/lib/pipeline";
import { inr } from "@/lib/quote";
import { todayISO } from "@/lib/format";
import { fmtD, useProjectData } from "@/lib/projectData";
import ProjectDocuments from "@/components/ProjectDocuments";
import SalaryCost from "@/components/SalaryCost";
import ProjectCommercial from "@/components/ProjectCommercial";
import ForecastView from "@/components/ForecastView";
import { useRole } from "@/lib/roles";
import { usePerms } from "@/lib/perms";
import { baseScenario, forecast, type ForecastInput } from "@/lib/forecast";
import { guessState, STATE_OPTIONS, type Client } from "@/lib/invoice";
import { PageLoader } from "@/components/Loader";

type Tab = "overview" | "people" | "forecast" | "documents";

// One project at a glance. Overview first; people, expenses and documents each get their own tab; the report is its own page.
// The expense forecast is for the Admin only (it shows personal funding) and only while the project is active: the tab and card are hidden otherwise, and /api/forecast refuses anyone else.
const PCC_BLANK = { police_verification: false, unit_name: "", unit_location: "", unit_border_distance: "", unit_sensitive: "", contract_until: "", site_incharge_phone: "" };

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const d = useProjectData(id); const { p, r, exps, cats, pdocs, dTypes } = d;
  // The projects list is remembered between visits; drop it if what it shows for this project (people, expenses) changed while you were here.
  const seen = useRef<{ spent: number; people: number } | null>(null); const latest = useRef({ spent: 0, people: 0 });
  latest.current = { spent: d.cost.spent, people: d.r.live.length };
  useEffect(() => { if (!d.loading && !seen.current) seen.current = { ...latest.current }; });
  useEffect(() => () => { const s = seen.current, l = latest.current; if (s && (s.spent !== l.spent || s.people !== l.people)) swrDrop("projects"); }, []);
  // Edit, Close and Reopen need Edit on Projects (Permissions page)
  const { admin } = useRole(); const mayEdit = usePerms().can("projects", "edit"); const showForecast = admin && p?.status === "active"; const [fc, setFc] = useState<ForecastInput | null>(null); const [fcErr, setFcErr] = useState("");
  useEffect(() => { if (!showForecast) { setFc(null); return; } let live = true; (async () => { const res = await fetch(`/api/forecast?project=${id}`); if (!live) return; if (!res.ok) { setFcErr(await res.text()); return; } const list = (await res.json()) as ForecastInput[]; if (live) { setFc(list[0] ?? null); setFcErr(""); } })(); return () => { live = false; }; }, [showForecast, id, exps.length]);   // fresh after an expense is added or removed
  const [tab, setTab] = useState<Tab>("overview"); const [edit, setEdit] = useState(false); const [ed, setEd] = useState({ name: "", location: "", description: "", client_id: "", state_code: "", ...PCC_BLANK }); const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => { supabase().from("clients").select("*").eq("active", true).order("name").then(({ data }) => setClients((data || []) as Client[])); }, []);
  const [docOpen, setDocOpen] = useState(0); const [msg, setMsg] = useState("");
  if (d.loading) return <PageLoader />;
  if (d.err || !p) return <p className="warn">{d.err || "Project not found"}</p>;

  const hasPcc = "police_verification" in p;   // the PCC fields appear once 2026-11-pcc-form.sql has added the columns
  async function save() {
    const name = ed.name.trim(); if (!name) { setMsg("Enter a project name."); return; }
    const { error } = await supabase().from("projects").update({ name, location: ed.location.trim(), description: ed.description.trim(), client_id: ed.client_id || null, state_code: ed.state_code || guessState(ed.location) || null, ...(hasPcc ? { police_verification: ed.police_verification, unit_name: ed.unit_name.trim() || null, unit_location: ed.unit_location.trim() || null, unit_border_distance: ed.unit_border_distance.trim() || null, unit_sensitive: ed.unit_sensitive || null, contract_until: ed.contract_until || null, site_incharge_phone: ed.site_incharge_phone.trim() || null } : {}) }).eq("id", p!.id);
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? "A project with that name already exists." : error.message); return; }
    if (name !== p!.name) await supabase().from("employees").update({ project: name }).eq("project_id", p!.id);   // keep people's project text in step with a rename
    swrDrop("projects", "clients", "invoices", "workorders"); setEdit(false); setMsg(""); d.loadProject();
  }
  async function setStatus(status: "active" | "closed") {
    if (status === "closed" && !confirm(`Close “${p!.name}”? It disappears from the employee dropdown (people already on it keep it).`)) return;
    const { error } = await supabase().from("projects").update({ status, closed_on: status === "closed" ? todayISO() : null }).eq("id", p!.id); if (error) { setMsg(error.message); return; } setMsg(""); d.loadProject();
  }
  const expensesHref = `/expenses?tab=spent&project=${id}`; const goDoc = () => { setTab("documents"); setDocOpen((n) => n + 1); };
  const card = (label: string, value: string, sub?: string, onClick?: () => void) => <button type="button" onClick={onClick} className="card !p-3 text-left hover:bg-slate-50"><div className="text-xs text-slate-500">{label}</div><div className="text-xl font-bold">{value}</div>{sub && <div className="text-xs text-slate-400">{sub}</div>}</button>;
  const tabs: [Tab, string, number | null][] = [["overview", "Overview", null], ["people", "People", r.live.length], ...(showForecast ? [["forecast", "Forecast", null] as [Tab, string, null]] : []), ["documents", "Documents", pdocs.length]];
  const fcLikely = fc ? forecast(fc, baseScenario(fc)).likely : null; const fcMonth = fc ? new Date(`${fc.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long" }) : ""; const fcEmpty = !!fc && fc.salaried.n + fc.daily.n === 0 && fc.rooms.n === 0 && fc.spent === 0;
  const catName = (cid: string) => cats.find((c) => c.id === cid)?.name ?? "—";
  const typeName = (tid: string | null) => dTypes.find((t) => t.id === tid)?.name ?? "—";

  return (
    <div className="space-y-4">
      <Link href="/projects" className="text-sm text-blue-700">← Projects</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{p.name}</h1>
        <span className={`text-xs rounded-full px-2 py-0.5 ${p.status === "active" ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}`}>{p.status === "active" ? "Active" : `Closed ${fmtD(p.closed_on)}`}</span>
        <div className="flex gap-2 sm:ml-auto"><Link className="btn btn-primary" href={`/projects/${id}/report`}>Report</Link>{mayEdit && <button className="btn" onClick={() => { setEd({ name: p.name, location: p.location, description: p.description, client_id: p.client_id ?? "", state_code: p.state_code ?? "", police_verification: !!p.police_verification, unit_name: p.unit_name ?? "", unit_location: p.unit_location ?? "", unit_border_distance: p.unit_border_distance ?? "", unit_sensitive: p.unit_sensitive ?? "", contract_until: p.contract_until ?? "", site_incharge_phone: p.site_incharge_phone ?? "" }); setEdit(!edit); }}>Edit</button>}
          {mayEdit && (p.status === "active" ? <button className="btn" onClick={() => setStatus("closed")}>Close project</button> : <button className="btn" onClick={() => setStatus("active")}>Reopen</button>)}</div>
      </div>
      {edit ? (
        <div className="card space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div><label className="lbl">Project name</label><input className="inp" value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} /></div><div><label className="lbl">Location</label><input className="inp" value={ed.location} onChange={(e) => setEd({ ...ed, location: e.target.value })} /></div>
          <div><label className="lbl">Client</label><select className="inp" value={ed.client_id} onChange={(e) => setEd({ ...ed, client_id: e.target.value })}><option value="">Not linked yet</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="lbl">State of the site <span className="font-normal text-slate-400">(decides CGST + SGST or IGST on invoices)</span></label><select className="inp" value={ed.state_code || guessState(ed.location)} onChange={(e) => setEd({ ...ed, state_code: e.target.value })}><option value="">Choose…</option>{STATE_OPTIONS.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
          <div className="sm:col-span-2"><label className="lbl">Description</label><textarea className="inp" rows={2} value={ed.description} onChange={(e) => setEd({ ...ed, description: e.target.value })} /></div></div>
          {hasPcc && <details className="rounded-xl border border-slate-200 p-3" open={ed.police_verification}><summary className="cursor-pointer text-sm font-medium">Police verification (Gujarat PCC form)</summary>
            <label className="mt-2 text-sm flex items-center gap-2"><input type="checkbox" checked={ed.police_verification} onChange={(e) => setEd({ ...ed, police_verification: e.target.checked })} /> This site needs the police verification form (it is added to each person's joining kit)</label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><label className="lbl">Unit name <span className="font-normal text-slate-400">(blank = the client)</span></label><input className="inp" value={ed.unit_name} onChange={(e) => setEd({ ...ed, unit_name: e.target.value })} /></div>
              <div><label className="lbl">Unit location, village, taluka <span className="font-normal text-slate-400">(blank = location)</span></label><input className="inp" value={ed.unit_location} onChange={(e) => setEd({ ...ed, unit_location: e.target.value })} /></div>
              <div><label className="lbl">Distance from the border</label><input className="inp" placeholder="e.g. On site" value={ed.unit_border_distance} onChange={(e) => setEd({ ...ed, unit_border_distance: e.target.value })} /></div>
              <div><label className="lbl">Sensitive zone?</label><select className="inp" value={ed.unit_sensitive} onChange={(e) => setEd({ ...ed, unit_sensitive: e.target.value })}><option value="">Not set</option><option>Yes</option><option>No</option></select></div>
              <div><label className="lbl">Contract until <span className="font-normal text-slate-400">(also the tentative leaving date)</span></label><input className="inp" type="date" value={ed.contract_until} onChange={(e) => setEd({ ...ed, contract_until: e.target.value })} /></div>
              <div><label className="lbl">Site in-charge's mobile</label><input className="inp" inputMode="tel" value={ed.site_incharge_phone} onChange={(e) => setEd({ ...ed, site_incharge_phone: e.target.value })} /></div>
            </div></details>}
          <p className="text-xs text-slate-400">Renaming updates the project name on its employees. Changing the location does not change employees already assigned.</p>
          <div className="flex items-center gap-2"><button className="btn btn-primary" onClick={save}>Save</button><button className="btn" onClick={() => { setEdit(false); setMsg(""); }}>Cancel</button>{msg && <span className="text-sm text-red-700">{msg}</span>}</div></div>
      ) : <p className="text-sm text-slate-500">{p.location || "No location set"}{p.description ? ` · ${p.description}` : ""}</p>}

      {!edit && msg && <p className="warn" role="alert">{msg}</p>}

      <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">{tabs.map(([k, label, n]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{label}{n !== null && <span className="ml-1.5 text-xs text-slate-400">{n}</span>}</button>)}</div>

      {tab === "overview" && <div className="space-y-4">
        <div className={`grid grid-cols-2 gap-3 ${showForecast ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          {card("People", String(r.live.length), r.rejected ? `${r.rejected} rejected not counted` : "on this project", () => setTab("people"))}
          {card("Expenses to date", d.expErr ? "—" : `₹${inr(d.cost.spent)}`, `${exps.length} entr${exps.length === 1 ? "y" : "ies"}`, () => router.push(expensesHref))}
          {showForecast && card(fc ? `${fcMonth} forecast` : "Next month forecast", fcLikely !== null ? `₹${inr(Math.round(fcLikely))}` : fcErr ? "—" : "…", "what if? open the forecast", () => setTab("forecast"))}
          {card("Documents", d.docErr ? "—" : String(pdocs.length), "letters, JSAs, POs…", () => setTab("documents"))}
          {card("First joining", r.first ? fmtD(r.first) : "—", r.last && r.last !== r.first ? `latest ${fmtD(r.last)}` : undefined, () => setTab("people"))}
        </div>
        <ProjectCommercial projectId={id} clientId={p.client_id ?? null} stateCode={p.state_code ?? null} />
        <SalaryCost projectId={id} people={r.live} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card space-y-2">
            <div className="flex items-center gap-2"><h3 className="font-semibold">Recent expenses</h3><Link className="btn !py-1 ml-auto" href={`${expensesHref}&add=1`}>+ Add expense</Link></div>
            {d.expErr ? <p className="warn">{d.expErr}</p> : <>
              {exps.slice(0, 5).map((e) => <div key={e.id} className="flex items-baseline gap-2 text-sm border-b border-slate-100 pb-1.5"><span className="text-xs text-slate-400 w-20 shrink-0">{fmtD(e.expense_date)}</span><span className="min-w-0 flex-1 truncate">{catName(e.category_id)}{e.description ? ` · ${e.description}` : ""}</span><span className="font-medium whitespace-nowrap">₹{inr(Number(e.amount))}</span></div>)}
              {!exps.length && <p className="text-sm text-slate-400">No expenses recorded yet.</p>}
              {exps.length > 5 && <Link className="text-sm text-blue-700" href={expensesHref}>View all {exps.length} →</Link>}</>}
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

      {tab === "forecast" && (!showForecast ? <p className="text-sm text-slate-500">The forecast is only for active projects.</p> : fcErr ? <p className="warn" role="alert">{fcErr}</p> : !fc ? <PageLoader /> : fcEmpty ? <p className="card text-sm text-slate-500">Nothing to forecast yet: this project has no people, rooms or costs.</p> : <div className="mob"><ForecastView key={fc.projectId} input={fc} /></div>)}
      {tab === "documents" && (d.docErr ? <p className="warn">{d.docErr}</p> : <ProjectDocuments project={p} types={dTypes} setTypes={d.setDTypes} docs={pdocs} reload={d.loadDocs} openSignal={docOpen} />)}
    </div>
  );
}
