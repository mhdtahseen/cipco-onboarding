"use client";
import { useEffect, useState } from "react";
import { openViewer } from "@/lib/viewer";
import { supabase } from "@/lib/supabase/client";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { docTypesFor, isHeadOffice, type Employee } from "@/lib/types";
import { openScanner } from "@/components/scan/ScanProvider";

// how the upload scanner treats each document: the Aadhaar's two sides on one page, a passport photo, anything else as pages
const SCAN: Record<string, string> = { aadhaar: "id", photo: "photo" };

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
    const file = await prepareUpload(picked, { forceJpeg: doc_type === "photo" });   // photos go on the joining form, which needs JPEG/PNG
    if (file.size > MAX_UPLOAD) return alert("File is larger than 5 MB. Please compress the PDF or upload a smaller photo.");
    setBusy(doc_type);
    const fd = new FormData(); fd.set("file", file); fd.set("employeeId", emp.id); fd.set("docType", doc_type);
    const r = await fetch("/api/docs/upload", { method: "POST", body: fd });
    if (r.ok) { const { path } = await r.json(); await upsert(doc_type, { file_path: path, status: "received" }); } else alert(await r.text()); setBusy("");
  }
  // Fix: open a file already uploaded in the scanner and replace it with the cleaned-up version
  async function fix(d: { key: string; label: string }, path: string) {
    setBusy(d.key); const r = await fetch(`/api/docs/view?raw=1&path=${encodeURIComponent(path)}`); setBusy("");
    if (!r.ok) return alert("The file could not be opened.");
    const blob = await r.blob(); const name = path.split("/").pop()!.replace(/^\d+-/, "") || "document";
    const file = new File([blob], name, { type: blob.type || (name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg") });
    const out = await openScanner({ files: [file], mode: (SCAN[d.key] ?? "pages") as "id" | "photo" | "pages", accept: "image/*,application/pdf", name: `${d.label} - ${emp.full_name}` });
    if (out?.[0]) await upload(d.key, out[0]);
  }
  // opens in the in-app viewer, with every uploaded document of this person to step through (Aadhaar, PAN, bank…)
  function view(path: string) {
    const list = types.filter((d) => rows[d.key]?.file_path).map((d) => ({ src: `/api/docs/view?path=${encodeURIComponent(rows[d.key].file_path!)}`, name: `${d.label} - ${emp.full_name}`, path: rows[d.key].file_path }));
    openViewer(list.map(({ src, name }) => ({ src, name })), Math.max(0, list.findIndex((x) => x.path === path)));
  }
  const types = docTypesFor(emp);   // head office: no ESIC or medical documents
  const done = types.filter((d) => ["received", "verified", "not_required"].includes(rows[d.key]?.status)).length;
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3"><h3 className="font-semibold">Document checklist</h3><span className="text-sm text-slate-500">{done}/{types.length} complete{isHeadOffice(emp) ? " · head office: no ESIC or medical documents" : ""}</span></div>
      <div className="divide-y divide-slate-100">
        {types.map((d) => { const r = rows[d.key]; return (
          <div key={d.key} className="py-3 flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-64 text-sm font-medium">{d.label}</div>
            <select className="inp !w-auto sm:!w-36" value={r?.status || "pending"} onChange={(e) => upsert(d.key, { status: e.target.value })}>{STATUS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
            <label className="btn cursor-pointer">{busy === d.key ? "Uploading…" : r?.file_path ? "Replace file" : "Upload file"}<input type="file" className="hidden" accept="image/*,application/pdf" data-scan={SCAN[d.key]} data-scan-name={`${d.label} - ${emp.full_name}`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(d.key, f); }} /></label>
            {r?.file_path && <button className="btn" onClick={() => view(r.file_path!)}>View</button>}
            {r?.file_path && <button className="btn" title="Open in the scanner: crop, straighten, put both sides on one page" onClick={() => fix(d, r.file_path!)}>Fix</button>}
            <input className="inp w-full sm:w-auto sm:flex-1 sm:min-w-40" placeholder="Notes" defaultValue={r?.notes || ""} onBlur={(e) => e.target.value !== (r?.notes || "") && upsert(d.key, { notes: e.target.value })} />
          </div>); })}
      </div>
    </div>
  );
}
