"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Employee } from "@/lib/types";
import { DOC_TYPES } from "@/lib/types";

export default function Dashboard() {
  const [rows, setRows] = useState<Employee[]>([]); const [docs, setDocs] = useState<Record<string, number>>({}); const [q, setQ] = useState(""); const [sel, setSel] = useState<string[]>([]); const [err, setErr] = useState("");
  useEffect(() => { (async () => {
    const sb = supabase();
    const { data, error } = await sb.from("employees").select("*").order("created_at", { ascending: false });
    if (error) setErr(error.message); setRows((data || []) as Employee[]);
    const { data: d } = await sb.from("employee_documents").select("employee_id,status");
    const c: Record<string, number> = {}; (d || []).forEach((x: any) => { if (x.status === "verified" || x.status === "received") c[x.employee_id] = (c[x.employee_id] || 0) + 1; }); setDocs(c);
  })(); }, []);
  const shown = rows.filter((r) => (r.full_name + " " + (r.designation || "") + " " + (r.project || "") + " " + (r.emp_no || "")).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold mr-auto">Employees</h1>
        <input className="inp !w-64" placeholder="Search name, role, project…" value={q} onChange={(e) => setQ(e.target.value)} />
        <a className="btn" href={`/api/export/excel${sel.length ? `?ids=${sel.join(",")}` : ""}`}>⬇ Excel import file{sel.length ? ` (${sel.length})` : " (all)"}</a>
        <Link className="btn btn-primary" href="/employees/new">+ New employee</Link>
      </div>
      {err && <p className="warn">{err} — has the schema been run in Supabase?</p>}
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3 w-8"></th><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Project / site</th><th className="p-3">Joining</th><th className="p-3">Documents</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-3"><input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} /></td>
                <td className="p-3"><Link className="font-medium text-blue-800 hover:underline" href={`/employees/${r.id}`}>{r.full_name}</Link><div className="text-xs text-slate-500">{r.emp_no}</div></td>
                <td className="p-3">{r.designation}<div className="text-xs text-slate-500">{r.department}</div></td>
                <td className="p-3">{r.project}<div className="text-xs text-slate-500">{r.site_location}</div></td>
                <td className="p-3">{r.join_date}</td>
                <td className="p-3"><span className="text-xs bg-slate-100 rounded-full px-2 py-1">{docs[r.id] || 0}/{DOC_TYPES.length} received</span></td>
              </tr>))}
            {!shown.length && <tr><td className="p-6 text-center text-slate-500" colSpan={6}>No employees yet — add the first one.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
