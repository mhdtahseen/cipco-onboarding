"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import type { Employee } from "@/lib/types";

// Resume lives in the same R2 bucket / employee_documents table as the other documents, under doc_type "resume".
export default function ResumeCard({ emp }: { emp: Employee }) {
  const [path, setPath] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  useEffect(() => { (async () => { const { data } = await supabase().from("employee_documents").select("file_path").eq("employee_id", emp.id).eq("doc_type", "resume").maybeSingle(); setPath(data?.file_path ?? null); })(); }, [emp.id]);
  async function upload(picked: File) {
    const file = await prepareUpload(picked); setMsg("");
    if (file.size > MAX_UPLOAD) { setMsg("File is larger than 5 MB — please compress it first."); return; }
    setBusy(true);
    const fd = new FormData(); fd.set("file", file); fd.set("employeeId", emp.id); fd.set("docType", "resume");
    const r = await fetch("/api/docs/upload", { method: "POST", body: fd });
    if (!r.ok) { setMsg(await r.text()); setBusy(false); return; }
    const { path: p } = await r.json();
    const { error } = await supabase().from("employee_documents").upsert({ employee_id: emp.id, doc_type: "resume", status: "received", file_path: p, updated_at: new Date().toISOString() }, { onConflict: "employee_id,doc_type" });
    if (error) setMsg(error.message); else setPath(p);
    setBusy(false);
  }
  const name = path ? path.split("/").pop()!.replace(/^\d+-/, "") : "";
  return (
    <div className="card !py-3 flex flex-wrap items-center gap-3">
      <div className="text-sm font-semibold w-20">Resume</div>
      {path ? <span className="text-sm text-slate-600 truncate max-w-64" title={name}>📄 {name}</span> : <span className="text-sm text-slate-500">No resume uploaded yet</span>}
      {path && <a className="btn" href={`/api/docs/view?path=${encodeURIComponent(path)}`} target="_blank">View</a>}
      <label className="btn cursor-pointer">{busy ? "Uploading…" : path ? "Replace" : "Upload resume"}
        <input type="file" className="hidden" accept=".pdf,.doc,.docx,image/*" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} /></label>
      <span className="text-xs text-slate-400">PDF, Word or photo · max 5 MB</span>
      {msg && <span className="text-sm text-red-700 w-full">{msg}</span>}
    </div>
  );
}
