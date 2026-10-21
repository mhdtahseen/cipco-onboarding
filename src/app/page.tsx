"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Employee } from "@/lib/types";
import { DOC_TYPES } from "@/lib/types";
import { STAGES, pileOf, stageLabel } from "@/lib/pipeline";

export default function Dashboard() {
  const [rows, setRows] = useState<Employee[]>([]); const [docs, setDocs] = useState<Record<string, number>>({}); const [q, setQ] = useState(""); const [sel, setSel] = useState<string[]>([]); const [err, setErr] = useState(""); const [loading, setLoading] = useState(true); const [pile, setPile] = useState<"process" | "onboarded" | "rejected">("process"); const [stage, setStage] = useState("");
  useEffect(() => { (async () => {
    const sb = supabase();
    const { data, error } = await sb.from("employees").select("*").order("created_at", { ascending: false });
    if (error) setErr(error.message); setRows((data || []) as Employee[]);
    const { data: d } = await sb.from("employee_documents").select("employee_id,status").neq("doc_type", "resume");
    const c: Record<string, number> = {}; (d || []).forEach((x: any) => { if (x.status === "verified" || x.status === "received") c[x.employee_id] = (c[x.employee_id] || 0) + 1; }); setDocs(c); setLoading(false);
  })(); }, []);
  const inPile = rows.filter((r) => pileOf(r) === pile);
  const count = (k: string) => rows.filter((r) => pileOf(r) === "process" && r.stage === k).length;
  const n = (k: string) => rows.filter((r) => pileOf(r) === k).length;
  const shown = inPile.filter((r) => !stage || pile === "rejected" || r.stage === stage).filter((r) => (r.full_name + " " + (r.designation || "") + " " + (r.project || "") + " " + (r.emp_no || "")).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold mr-auto">Candidates &amp; employees</h1>
        <input className="inp !w-64" placeholder="Search name, role, project…" value={q} onChange={(e) => setQ(e.target.value)} />
        <a className="btn" href={`/api/export/excel${sel.length ? `?ids=${sel.join(",")}` : ""}`}>⬇ Excel import file{sel.length ? ` (${sel.length})` : " (all)"}</a>
        <Link className="btn btn-primary" href="/employees/new">+ New candidate</Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {([["process", `In process (${n("process")})`], ["onboarded", `Onboarded (${n("onboarded")})`], ["rejected", `Rejected / declined (${n("rejected")})`]] as const).map(([k, l]) => <button key={k} className={`btn ${pile === k ? "btn-primary" : ""}`} onClick={() => { setPile(k); setStage(""); setSel([]); }}>{l}</button>)}
        {pile === "process" && <span className="mx-1 h-5 w-px bg-slate-200" />}
        {pile === "process" && <button className={`btn !py-1 !text-xs ${!stage ? "!bg-slate-100" : ""}`} onClick={() => setStage("")}>All stages</button>}
        {pile === "process" && STAGES.filter((s) => s.key !== "onboarded").map((s) => <button key={s.key} className={`btn !py-1 !text-xs ${stage === s.key ? "!bg-blue-50 !border-[#1e4fa3] !text-blue-800" : ""}`} onClick={() => setStage(stage === s.key ? "" : s.key)}>{s.label} <span className="text-slate-400">{count(s.key)}</span></button>)}
      </div>
      {err && <p className="warn">{err} — has the schema been run in Supabase?</p>}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3 w-8"><input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.every((r) => sel.includes(r.id))} onChange={(e) => setSel(e.target.checked ? shown.map((r) => r.id) : [])} /></th><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Project / site</th><th className="p-3">Joining</th><th className="p-3">{pile === "rejected" ? "Closed" : "Stage"}</th><th className="p-3">Documents</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-3"><input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} /></td>
                <td className="p-3"><Link className="font-medium text-blue-800 hover:underline" href={`/employees/${r.id}`}>{r.full_name}</Link><div className="text-xs text-slate-500">{r.emp_no}</div></td>
                <td className="p-3">{r.designation}<div className="text-xs text-slate-500">{r.department}</div></td>
                <td className="p-3">{r.project}<div className="text-xs text-slate-500">{r.site_location}</div></td>
                <td className="p-3 whitespace-nowrap">{r.join_date ? new Date(r.join_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
                <td className="p-3">{pile === "rejected" ? <><div className="text-xs font-medium text-red-800">{r.closed_reason}</div><div className="text-xs text-slate-500">at {stageLabel(r.closed_stage)}</div></> : <span className="text-xs bg-blue-50 text-blue-800 rounded-full px-2 py-1">{stageLabel(r.stage)}</span>}</td>
                <td className="p-3"><div className="flex items-center gap-2"><div className="h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-[#1e4fa3]" style={{ width: `${((docs[r.id] || 0) / DOC_TYPES.length) * 100}%` }} /></div><span className="text-xs text-slate-500">{docs[r.id] || 0}/{DOC_TYPES.length}</span></div></td>
              </tr>))}
            {loading && <tr><td className="p-6 text-center text-slate-500" colSpan={7}>Loading…</td></tr>}
            {!loading && !shown.length && <tr><td className="p-6 text-center text-slate-500" colSpan={7}>{q ? "Nothing matches your search." : pile === "rejected" ? "Nobody has been rejected or declined." : pile === "onboarded" ? "Nobody has been marked Onboarded yet." : "No candidates here yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
