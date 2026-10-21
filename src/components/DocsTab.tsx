"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { DOC_TYPES, type Employee } from "@/lib/types";

type Row = { doc_type: string; status: string; file_path: string | null; notes: string | null };
const STATUS = ["pending", "received", "verified", "not_required"];

export default function DocsTab({ emp }: { emp: Employee }) {
  const [rows, setRows] = useState<Record<string, Row>>({}); const [busy, setBusy] = useState("");
  async function load() { const { data } = await supabase().from("employee_documents").select("*").eq("employee_id", emp.id); const m: Record<string, Row> = {}; (data || []).forEach((r: any) => (m[r.doc_type] = r)); setRows(m); }
  useEffect(() => { load(); }, [emp.id]);
  async function upsert(doc_type: string, patch: Partial<Row>) {
    const cur = rows[doc_type] || { doc_type, status: "pending", file_path: null, notes: null };
    await supabase().from("employee_documents").upsert({ employee_id: emp.id, ...cur, ...patch, updated_at: new Date().toISOString() }, { onConflict: "employee_id,doc_type" }); await load();
  }
  async function upload(doc_type: string, picked: File) {
    const file = await prepareUpload(picked);
    if (file.size > MAX_UPLOAD) return alert("File is larger than 5 MB. Please compress the PDF or upload a smaller photo.");
    setBusy(doc_type);
    const fd = new FormData(); fd.set("file", file); fd.set("employeeId", emp.id); fd.set("docType", doc_type);
    const r = await fetch("/api/docs/upload", { method: "POST", body: fd });
    if (r.ok) { const { path } = await r.json(); await upsert(doc_type, { file_path: path, status: "received" }); } else alert(await r.text()); setBusy("");
  }
  function view(path: string) { window.open(`/api/docs/view?path=${encodeURIComponent(path)}`, "_blank"); }
  const done = DOC_TYPES.filter((d) => ["received", "verified", "not_required"].includes(rows[d.key]?.status)).length;
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">Document checklist</h3><span className="text-sm text-slate-500">{done}/{DOC_TYPES.length} complete</span></div>
      <div className="divide-y divide-slate-100">
        {DOC_TYPES.map((d) => { const r = rows[d.key]; return (
          <div key={d.key} className="py-3 flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-64 text-sm font-medium">{d.label}</div>
            <select className="inp !w-36" value={r?.status || "pending"} onChange={(e) => upsert(d.key, { status: e.target.value })}>{STATUS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
            <label className="btn cursor-pointer">{busy === d.key ? "Uploading…" : r?.file_path ? "Replace file" : "Upload file"}<input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(d.key, e.target.files[0])} /></label>
            {r?.file_path && <button className="btn" onClick={() => view(r.file_path!)}>View</button>}
            <input className="inp flex-1 min-w-40" placeholder="Notes" defaultValue={r?.notes || ""} onBlur={(e) => e.target.value !== (r?.notes || "") && upsert(d.key, { notes: e.target.value })} />
          </div>); })}
      </div>
    </div>
  );
}
