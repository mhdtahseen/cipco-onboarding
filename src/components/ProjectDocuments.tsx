"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { todayISO } from "@/lib/format";
import type { DocType, Project, ProjectDocument } from "@/lib/types";

const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const BLANK = { title: "", type_id: "", doc_date: "", recipient: "", ref_no: "", notes: "" };

// Documents kept against a project (letters, JSAs, POs, emails…): upload, search, open, edit, replace the file, delete.
export default function ProjectDocuments({ project, types, setTypes, docs, reload, openSignal }: { openSignal?: number; project: Project; types: DocType[]; setTypes: (t: DocType[]) => void; docs: ProjectDocument[]; reload: () => void }) {
  const [f, setF] = useState({ ...BLANK, doc_date: todayISO() }); const [file, setFile] = useState<File | null>(null); const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false); useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);   // form stays hidden until asked for
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [typeF, setTypeF] = useState(""); const [q, setQ] = useState("");
  const typeName = (id: string | null) => types.find((t) => t.id === id)?.name ?? "—";
  const set = (p: Partial<typeof BLANK>) => setF((x) => ({ ...x, ...p }));
  const reset = () => { setF({ ...BLANK, doc_date: todayISO() }); setFile(null); setEditId(null); setOpen(false); };
  const shown = docs.filter((d) => (!typeF || d.type_id === typeF) && (!q.trim() || [d.title, d.recipient, d.ref_no, d.notes, d.file_name, typeName(d.type_id)].join(" ").toLowerCase().includes(q.toLowerCase())));

  async function addType() {
    const name = prompt("New document type (it will be available on every project):")?.trim(); if (!name) return;
    const ex = types.find((t) => t.name.toLowerCase() === name.toLowerCase()); if (ex) { set({ type_id: ex.id }); return; }
    const { data, error } = await supabase().from("document_types").insert({ name, sort_order: Math.max(0, ...types.map((t) => t.sort_order)) + 10 }).select().single();
    if (error) { setMsg(error.message); return; } setTypes([...types, data as DocType]); set({ type_id: (data as DocType).id });
  }
  async function save() {
    setMsg("");
    if (!f.title.trim()) { setMsg("Give the document a title."); return; } if (!editId && !file) { setMsg("Choose the file to upload."); return; } if (!f.doc_date) { setMsg("Choose the document date."); return; }
    setBusy(true);
    let up: { file_path: string; file_name: string } | undefined;
    if (file) {
      const prepared = await prepareUpload(file);
      if (prepared.size > MAX_UPLOAD) { setMsg("That file is larger than 5 MB — please compress it first."); setBusy(false); return; }
      const fd = new FormData(); fd.set("file", prepared); fd.set("employeeId", `proj-${project.id}`); fd.set("docType", "projdoc");
      const r = await fetch("/api/docs/upload", { method: "POST", body: fd });
      if (!r.ok) { setMsg(await r.text()); setBusy(false); return; } up = { file_path: (await r.json()).path, file_name: file.name };
    }
    const row = { project_id: project.id, type_id: f.type_id || null, title: f.title.trim(), doc_date: f.doc_date, recipient: f.recipient.trim(), ref_no: f.ref_no.trim(), notes: f.notes.trim(), ...(up ?? {}), updated_at: new Date().toISOString() };
    const { error } = editId ? await supabase().from("project_documents").update(row).eq("id", editId) : await supabase().from("project_documents").insert(row);
    setBusy(false);
    if (error) { setMsg(error.message + " — has the project-documents SQL migration been run?"); return; }
    setMsg(editId ? "Saved ✓" : "Document added ✓"); reset(); reload();
  }
  function edit(d: ProjectDocument) { setOpen(true); setEditId(d.id); setFile(null); setF({ title: d.title, type_id: d.type_id ?? "", doc_date: d.doc_date, recipient: d.recipient, ref_no: d.ref_no, notes: d.notes }); document.getElementById("doc-form")?.scrollIntoView({ behavior: "smooth" }); }
  async function del(d: ProjectDocument) { if (!confirm(`Delete “${d.title}”?`)) return; await supabase().from("project_documents").delete().eq("id", d.id); if (editId === d.id) reset(); reload(); }

  return (
    <div className="card space-y-4" id="doc-form">
      <div className="flex items-center gap-3"><h3 className="font-semibold">Documents</h3>{!open && <button className="btn btn-primary ml-auto" onClick={() => setOpen(true)}>+ Add document</button>}{!open && msg && <span className="text-sm text-green-700">{msg}</span>}</div>
      <p className="text-sm text-slate-500 -mt-2">Letters, Job Safety Analyses, POs, emails and anything else made or sent for this project, kept for later reference.</p>
      {open && <div className="rounded-xl border border-slate-200 p-3 space-y-3">
        <div className="text-sm font-medium">{editId ? "Edit document" : "Add a document"}</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2"><label className="lbl">Title</label><input className="inp" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Letter permitting mobile phones on site" /></div>
          <div><label className="lbl">Type</label><select className="inp" value={f.type_id} onChange={(e) => (e.target.value === "__new" ? addType() : set({ type_id: e.target.value }))}><option value=""></option>{types.filter((t) => t.active || t.id === f.type_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}<option value="__new">+ Add new type…</option></select></div>
          <div><label className="lbl">Document date</label><input className="inp" type="date" value={f.doc_date} onChange={(e) => set({ doc_date: e.target.value })} /></div>
          <div><label className="lbl">To / from <span className="font-normal text-slate-400">(optional)</span></label><input className="inp" value={f.recipient} onChange={(e) => set({ recipient: e.target.value })} placeholder="e.g. MAN Industries – Mr Rahul Singla" /></div>
          <div><label className="lbl">Ref. / PO no. <span className="font-normal text-slate-400">(optional)</span></label><input className="inp" value={f.ref_no} onChange={(e) => set({ ref_no: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="lbl">Notes <span className="font-normal text-slate-400">(optional)</span></label><input className="inp" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
          <div className="sm:col-span-2 lg:col-span-4"><label className="lbl">File{editId ? " (leave empty to keep the current one)" : ""}</label>
            <label className="btn cursor-pointer max-w-full"><span className="truncate">{file ? file.name : editId ? "Replace file" : "Choose file"}</span><input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.eml,.msg,.txt,image/*" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
            <span className="ml-2 text-xs text-slate-400">PDF, Word, Excel, email or photo · max 5 MB</span></div>
        </div>
        <div className="flex flex-wrap items-center gap-3"><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : editId ? "Save changes" : "+ Add document"}</button><button className="btn" onClick={reset}>Cancel</button>{msg && <span className="text-sm text-slate-600">{msg}</span>}</div>
      </div>}

      <div className="flex flex-wrap items-center gap-2">
        <input className="inp !w-auto flex-1 min-w-44 sm:flex-none sm:!w-64" placeholder="Search title, recipient, ref, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp !w-auto" aria-label="Filter by type" value={typeF} onChange={(e) => setTypeF(e.target.value)}><option value="">All types</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <span className="text-sm text-slate-500 sm:ml-auto">{shown.length} document{shown.length === 1 ? "" : "s"}</span>
      </div>
      <div className="space-y-2">
        {shown.map((d) => (
          <div key={d.id} className="rounded-xl border border-slate-200 p-3 flex flex-wrap items-start gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1 basis-64">
              <div className="font-medium break-words">{d.title}</div>
              <div className="text-xs text-slate-500">{typeName(d.type_id)} · {fmt(d.doc_date)}{d.recipient ? ` · ${d.recipient}` : ""}{d.ref_no ? ` · Ref ${d.ref_no}` : ""}</div>
              {d.notes && <div className="text-sm text-slate-600 mt-1">{d.notes}</div>}
              <div className="text-xs text-slate-400 mt-1 truncate">📄 {d.file_name || d.file_path.split("/").pop()?.replace(/^\d+-/, "")}</div>
            </div>
            <div className="flex gap-2 shrink-0"><a className="btn !py-1" href={`/api/docs/view?path=${encodeURIComponent(d.file_path)}`} target="_blank">Open</a><button className="btn !py-1" onClick={() => edit(d)}>Edit</button><button className="btn btn-danger !py-1" onClick={() => del(d)} aria-label="Delete document">✕</button></div>
          </div>))}
        {!shown.length && <p className="text-center text-sm text-slate-500 py-4">{docs.length ? "Nothing matches the search." : "No documents added for this project yet."}</p>}
      </div>
    </div>
  );
}
