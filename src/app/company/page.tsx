"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRole } from "@/lib/roles";
import { COMPANY_FIELDS, COMPANY_GROUPS, companyPan, fieldValue, type CompanyData, type CompanyField } from "@/lib/company";
import { loadCompanyInfo } from "@/lib/useCompany";
import { prepareUpload } from "@/lib/compress";
import { PageLoader } from "@/components/Loader";

// Company (profile menu → Company, Admin only; 2026-11-company-profile.sql).
//  - Details: every number tap-to-copy, "Copy all" for registration forms, each with where it prints ("Used on"). Saving changes them on every PDF within a minute.
//  - Documents: GST, Udyam, PTRC, EPFO, ESIC, PAN, Aadhaar, cheque, WC policy... preview, share the file itself from a phone, download, a private 7-day link,
//    replace with a newer copy (older ones kept), validity dates with reminders to the Admins (30 days, 7 days, on the day).
//  - Seal and signature: the built-in ones stay until new ones are uploaded; the sample PDF shows how they print.
type Doc = { id: string; kind: string; title: string; doc_no: string; issued_on: string | null; valid_until: string | null; notes: string; file_path: string | null; file_name: string | null; updated_at: string };
type DocFile = { id: string; document_id: string; file_name: string | null; uploaded_at: string };
type Profile = { data: CompanyData; seal_path: string | null; signature_path: string | null };
const KINDS: [string, string][] = [["gst", "GST registration certificate"], ["udyam", "Udyam registration certificate"], ["ptrc", "Professional tax (PTRC) certificate"], ["epfo", "EPFO code allotment letter"],
  ["esic", "ESIC registration letter"], ["pan", "PAN card"], ["aadhaar", "Proprietor's Aadhaar"], ["cheque", "Cancelled cheque"], ["wc", "WC policy (Employees' Compensation insurance)"], ["other", "Other document"]];
const kindLabel = (k: string) => KINDS.find(([x]) => x === k)?.[1] ?? "Document";
const todayIST = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
const dmy = (iso?: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
const daysTo = (iso: string) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(todayIST() + "T00:00:00Z")) / 86400000);
const mask = (v: string) => { const d = v.replace(/\D/g, ""); return d.length >= 4 ? `XXXX XXXX ${d.slice(-4)}` : "••••"; };
const ext = (n?: string | null) => /\.([a-z0-9]{2,4})$/i.exec(n || "")?.[1]?.toLowerCase() || "";
const nice = (title: string, stored?: string | null) => `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "document"}${ext(stored) ? "." + ext(stored) : ""}`;
const svg = (d: React.ReactNode) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const I = {
  copy: svg(<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>),
  eye: svg(<><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: svg(<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="m1 1 22 22" /></>),
  share: svg(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" /></>),
  download: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>),
  link: svg(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),
  upload: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></>),
  edit: svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  trash: svg(<><path d="M3 6h18" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>),
};

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch { const a = document.createElement("textarea"); a.value = t; a.style.position = "fixed"; a.style.opacity = "0"; document.body.appendChild(a); a.select(); const ok = document.execCommand("copy"); a.remove(); return ok; }
}
async function upload(file: File, what: "doc" | "seal" | "signature"): Promise<{ path: string; name: string } | { error: string }> {
  const f = what === "doc" ? await prepareUpload(file) : file;
  const fd = new FormData(); fd.set("file", f); fd.set("what", what);
  const r = await fetch("/api/company/upload", { method: "POST", body: fd }); const j = await r.json().catch(() => ({}));
  return r.ok ? { path: j.path, name: j.name } : { error: j.error || `Upload failed (${r.status}).` };
}

export default function CompanyPage() {
  const { role } = useRole(); const admin = role === "admin";
  const [p, setP] = useState<Profile | null>(null); const [docs, setDocs] = useState<Doc[]>([]); const [files, setFiles] = useState<DocFile[]>([]);
  const [missing, setMissing] = useState(false); const [err, setErr] = useState(""); const [toast, setToast] = useState(""); const [q, setQ] = useState("");
  const [editGroup, setEditGroup] = useState(""); const [draft, setDraft] = useState<CompanyData>({}); const [busy, setBusy] = useState("");
  const [reveal, setReveal] = useState(false); const [stamp, setStamp] = useState(Date.now());

  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? "" : t)), 2500); };
  const load = useCallback(async () => {
    const sb = supabase();
    const [{ data: pr, error: e1 }, { data: ds, error: e2 }, { data: fs }] = await Promise.all([
      sb.from("company_profile").select("data, seal_path, signature_path").eq("id", 1).maybeSingle(),
      sb.from("company_documents").select("*").is("archived_at", null).order("title"),
      sb.from("company_document_files").select("id, document_id, file_name, uploaded_at").order("uploaded_at", { ascending: false }),
    ]);
    if (e1 || e2) { const m = (e1 || e2)!; if (m.code === "42P01" || m.code === "PGRST205" || /does not exist|schema cache/i.test(m.message)) { setMissing(true); setP({ data: {}, seal_path: null, signature_path: null }); return; } setErr(m.message); return; }
    setMissing(false); setP({ data: (pr?.data ?? {}) as CompanyData, seal_path: pr?.seal_path ?? null, signature_path: pr?.signature_path ?? null }); setDocs((ds ?? []) as Doc[]); setFiles((fs ?? []) as DocFile[]);
  }, []);
  useEffect(() => { if (admin) void load(); }, [admin, load]);

  const data = p?.data ?? {};
  const value = (f: CompanyField) => (f.key === "pan" ? (data.pan || "").trim() || companyPan() : fieldValue(data, f));
  const afterSave = async () => { await fetch("/api/company/refresh", { method: "POST" }).catch(() => {}); await loadCompanyInfo(true); };

  async function saveGroup() {
    setBusy("save"); setErr("");
    const next: CompanyData = { ...data };
    COMPANY_FIELDS.filter((f) => f.group === editGroup).forEach((f) => { const v = (draft[f.key] ?? "").trim(); if (!v || v === f.def) delete next[f.key]; else next[f.key] = v; });   // only changes are kept
    const { error } = await supabase().from("company_profile").upsert({ id: 1, data: next, updated_at: new Date().toISOString() });
    setBusy(""); if (error) { setErr(error.message); return; }
    setEditGroup(""); await load(); await afterSave(); say("Saved. New PDFs use it within a minute.");
  }
  const startEdit = (g: string) => { setEditGroup(g); setDraft(Object.fromEntries(COMPANY_FIELDS.filter((f) => f.group === g).map((f) => [f.key, f.key === "pan" ? (data.pan || "") : value(f)]))); };

  const copyAll = async () => {
    const v = (k: string) => value(COMPANY_FIELDS.find((f) => f.key === k)!);
    const lines = [v("name"), `Address: ${v("formAddress")}`, `Phone: ${v("phones")}`, `Email: ${v("email")}`, "", `GSTIN: ${v("gstin")}`, `PAN: ${v("pan")}`, `Udyam: ${v("udyam")}`,
      ...(["ptrc", "epfo", "esic"].map((k) => [COMPANY_FIELDS.find((f) => f.key === k)!.label, v(k)]).filter(([, x]) => x).map(([l, x]) => `${l}: ${x}`)), "",
      "Bank account", `Name: ${v("accountName")}`, `Bank: ${v("bank")}, ${v("branch")}`, `Account no: ${v("accountNo")}`, `IFSC: ${v("ifsc")}`];
    if (await copyText(lines.join("\n"))) say("Company details copied");
  };

  // ---------- documents ----------
  const [form, setForm] = useState<{ id?: string; kind: string; title: string; doc_no: string; issued_on: string; valid_until: string; notes: string; file?: File | null } | null>(null);
  const openNew = (kind = "other") => setForm({ kind, title: kind === "other" ? "" : kindLabel(kind), doc_no: "", issued_on: "", valid_until: "", notes: "", file: null });
  const openEdit = (d: Doc) => setForm({ id: d.id, kind: d.kind, title: d.title, doc_no: d.doc_no, issued_on: d.issued_on ?? "", valid_until: d.valid_until ?? "", notes: d.notes, file: null });
  async function saveDoc() {
    if (!form) return; if (!form.title.trim()) { setErr("Give the document a name."); return; }
    setBusy("doc"); setErr("");
    let up: { path: string; name: string } | null = null;
    if (form.file) { const u = await upload(form.file, "doc"); if ("error" in u) { setErr(u.error); setBusy(""); return; } up = u; }
    const row = { kind: form.kind, title: form.title.trim(), doc_no: form.doc_no.trim(), issued_on: form.issued_on || null, valid_until: form.valid_until || null, notes: form.notes.trim(), updated_at: new Date().toISOString(), ...(up ? { file_path: up.path, file_name: up.name } : {}) };
    const sb = supabase();
    const res = form.id ? await sb.from("company_documents").update(row).eq("id", form.id).select("id").single() : await sb.from("company_documents").insert(row).select("id").single();
    if (res.error) { setErr(res.error.message); setBusy(""); return; }
    if (up) await sb.from("company_document_files").insert({ document_id: res.data.id, file_path: up.path, file_name: up.name });
    setBusy(""); setForm(null); await load(); say("Document saved");
  }
  async function replaceFile(d: Doc, file?: File) {
    if (!file) return; setBusy(`file:${d.id}`); setErr("");
    const u = await upload(file, "doc"); if ("error" in u) { setErr(u.error); setBusy(""); return; }
    const sb = supabase();
    const { error } = await sb.from("company_documents").update({ file_path: u.path, file_name: u.name, updated_at: new Date().toISOString() }).eq("id", d.id);
    if (!error) await sb.from("company_document_files").insert({ document_id: d.id, file_path: u.path, file_name: u.name });
    setBusy(""); if (error) { setErr(error.message); return; } await load(); say(d.file_path ? "New copy uploaded. The older one is kept." : "File uploaded");
  }
  async function removeDoc(d: Doc) {
    if (!confirm(`Remove "${d.title}"? Its files stay in storage, and links already sent stop working.`)) return;
    const { error } = await supabase().from("company_documents").update({ archived_at: new Date().toISOString() }).eq("id", d.id);
    if (error) { setErr(error.message); return; } await load(); say("Removed");
  }
  async function linkFor(d: Doc): Promise<{ url: string; until: string } | null> {
    const r = await fetch(`/api/company/link?doc=${d.id}`); const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Could not make the link."); return null; } return j;
  }
  async function copyLink(d: Doc) { const l = await linkFor(d); if (l && (await copyText(l.url))) say(`Link copied (works until ${l.until})`); }
  async function share(d: Doc) {
    setBusy(`share:${d.id}`); setErr("");
    try {
      const r = await fetch(`/api/company/file?doc=${d.id}&raw=1`);
      if (r.ok) {
        const blob = await r.blob(); const file = new File([blob], nice(d.title, d.file_name), { type: blob.type || "application/pdf" });
        if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: d.title }); return; }
      }
      const l = await linkFor(d); if (!l) return;   // a computer, or a file too large to hand over: share a private link instead
      if (navigator.share) await navigator.share({ title: d.title, text: `${d.title} (link works until ${l.until})`, url: l.url });
      else if (await copyText(l.url)) say(`This device cannot share files, so a link was copied (works until ${l.until})`);
    } catch (e) { if ((e as Error).name !== "AbortError") setErr("Sharing did not work on this device. Use Download or Copy link."); }
    finally { setBusy(""); }
  }

  // ---------- seal and signature ----------
  async function setBranding(which: "seal" | "signature", file?: File | null) {
    setBusy(which); setErr(""); let path: string | null = null;
    if (file) { const u = await upload(file, which); if ("error" in u) { setErr(u.error); setBusy(""); return; } path = u.path; }
    const { error } = await supabase().from("company_profile").upsert({ id: 1, data, seal_path: which === "seal" ? path : p?.seal_path ?? null, signature_path: which === "signature" ? path : p?.signature_path ?? null, updated_at: new Date().toISOString() });
    setBusy(""); if (error) { setErr(error.message); return; }
    await load(); await afterSave(); setStamp(Date.now()); say(file ? `New ${which} saved. Every PDF uses it within a minute.` : `Back to the original ${which}.`);
  }

  const term = q.trim().toLowerCase();
  const fieldsShown = useMemo(() => COMPANY_FIELDS.filter((f) => !term || f.label.toLowerCase().includes(term) || (!f.secret && value(f).toLowerCase().includes(term))), [term, data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const docsShown = docs.filter((d) => !term || [d.title, d.doc_no, d.notes, kindLabel(d.kind)].join(" ").toLowerCase().includes(term));
  const missingKinds = KINDS.filter(([k]) => k !== "other" && !docs.some((d) => d.kind === k));

  if (!role) return <PageLoader />;
  if (!admin) return <p className="text-slate-500">Only an Admin can open the company details and documents.</p>;
  if (!p) return err ? <p className="warn">{err}</p> : <PageLoader />;

  const iconBtn = "btn btn-sm !px-1.5";
  const fieldRow = (f: CompanyField) => {
    const v = value(f), editing = editGroup === f.group;
    return (
      <div key={f.key} className={`py-2.5 border-t border-slate-100 first:border-t-0 ${f.wide ? "sm:col-span-2" : ""}`}>
        <div className="text-xs text-slate-500">{f.label}{(data[f.key] ?? "").trim() && !editing && <span className="ml-1.5 rounded-full bg-blue-50 text-blue-700 px-1.5 text-[10px]">changed</span>}</div>
        {editing ? <>
          <input className="inp mt-1" value={draft[f.key] ?? ""} placeholder={f.key === "pan" ? `${companyPan()} (from the GSTIN)` : f.def || ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} autoComplete="off" />
          {f.hint && <div className="text-[11px] text-slate-400 mt-0.5">{f.hint}</div>}
        </> : <div className="flex items-start gap-2">
          <div className={`min-w-0 flex-1 font-medium break-words ${v ? "" : "text-slate-400 font-normal italic"}`}>{f.secret && v && !reveal ? mask(v) : v || "not added yet"}</div>
          {f.secret && v && <button type="button" className={iconBtn} onClick={() => setReveal(!reveal)} title={reveal ? "Hide" : "Show"} aria-label={reveal ? "Hide" : "Show"}>{reveal ? I.eyeOff : I.eye}</button>}
          {v && <button type="button" className={iconBtn} onClick={async () => { if (await copyText(f.secret ? v.replace(/\s/g, "") : v)) say(`${f.label} copied`); }} title={`Copy ${f.label}`} aria-label={`Copy ${f.label}`}>{I.copy}</button>}
        </div>}
        <div className="text-[11px] text-slate-400 mt-0.5">{f.usedOn ? <>Used on: {f.usedOn}</> : "Kept for copying. Not printed on any document yet."}</div>
      </div>);
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[14rem]"><h1 className="text-xl font-semibold">Company</h1><p className="text-sm text-slate-500">Details, registrations and documents, ready to copy or send from any device. Admin only.</p></div>
        <button type="button" className="btn" onClick={copyAll}>{I.copy} Copy all details</button>
      </div>
      {missing && <div role="alert" className="card !p-3 border-amber-200 bg-amber-50 text-sm text-amber-900">The company tables are not in the database yet, so the built-in details are shown and nothing can be saved. Run <b>supabase/migrations/2026-11-company-profile.sql</b> in Supabase, then reload this page.</div>}
      {err && <p className="warn" role="alert">{err}</p>}
      <input className="inp" type="search" placeholder="Search: GST, PAN, account, WC policy…" aria-label="Search the company details and documents" value={q} onChange={(e) => setQ(e.target.value)} />

      {/* ---------- documents ---------- */}
      <section className="card !p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold flex-1">Documents</h2><button type="button" className="btn btn-sm btn-primary" disabled={missing} onClick={() => openNew()}>+ Add document</button></div>
        {!docsShown.length && <p className="text-sm text-slate-500">{docs.length ? "No document matches the search." : "No documents yet. Add them once and they are with you on every device."}</p>}
        <div className="grid gap-2 sm:grid-cols-2">{docsShown.map((d) => {
          const left = d.valid_until ? daysTo(d.valid_until) : null; const older = files.filter((f) => f.document_id === d.id).slice(1);
          return (
            <div key={d.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1"><div className="font-medium">{d.title}</div>
                  {d.doc_no && <button type="button" className="text-sm text-slate-600 hover:underline inline-flex items-center gap-1" onClick={async () => { if (await copyText(d.doc_no)) say("Number copied"); }} title="Copy the number">{d.doc_no} {I.copy}</button>}
                  <div className="text-xs text-slate-500">{[d.issued_on && `Issued ${dmy(d.issued_on)}`, d.valid_until && `valid until ${dmy(d.valid_until)}`].filter(Boolean).join(" · ")}</div>
                  {left !== null && left <= 30 && <span className={`inline-block mt-1 rounded-full px-2 text-[11px] ${left < 0 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>{left < 0 ? `expired ${-left} day${left === -1 ? "" : "s"} ago` : left === 0 ? "expires today" : `expires in ${left} day${left === 1 ? "" : "s"}`}</span>}
                  {d.notes && <div className="text-xs text-slate-500 mt-1">{d.notes}</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {d.file_path ? <>
                  <a className={iconBtn} href={`/api/company/file?doc=${d.id}`} target="_blank" rel="noreferrer" title="Preview" aria-label="Preview">{I.eye}</a>
                  <button type="button" className={iconBtn} disabled={busy === `share:${d.id}`} onClick={() => share(d)} title="Share (WhatsApp, email…)" aria-label="Share">{busy === `share:${d.id}` ? "…" : I.share}</button>
                  <a className={iconBtn} href={`/api/company/file?doc=${d.id}&dl=1`} title="Download" aria-label="Download">{I.download}</a>
                  <button type="button" className={iconBtn} onClick={() => copyLink(d)} title="Copy a private link (works 7 days)" aria-label="Copy a private link">{I.link}</button>
                </> : <span className="text-xs text-amber-700 self-center mr-1">No file yet</span>}
                <label className={`${iconBtn} cursor-pointer ${busy === `file:${d.id}` ? "opacity-50 pointer-events-none" : ""}`} title={d.file_path ? "Upload a newer copy (the old one is kept)" : "Upload the file"} aria-label="Upload a file">{busy === `file:${d.id}` ? "…" : I.upload}<input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => { void replaceFile(d, e.target.files?.[0]); e.target.value = ""; }} /></label>
                <button type="button" className={iconBtn} onClick={() => openEdit(d)} title="Edit the details" aria-label="Edit">{I.edit}</button>
                <button type="button" className={`${iconBtn} text-rose-700`} onClick={() => removeDoc(d)} title="Remove" aria-label="Remove">{I.trash}</button>
              </div>
              {older.length > 0 && <details className="text-xs text-slate-500"><summary className="cursor-pointer">{older.length} older cop{older.length === 1 ? "y" : "ies"}</summary>
                <ul className="mt-1 space-y-0.5">{older.map((f) => <li key={f.id}><a className="text-blue-700 underline" href={`/api/company/file?doc=${d.id}&file=${f.id}`} target="_blank" rel="noreferrer">{f.file_name || "file"}</a> · uploaded {dmy(f.uploaded_at.slice(0, 10))}</li>)}</ul></details>}
            </div>); })}</div>
        {!term && missingKinds.length > 0 && !missing && <div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="text-slate-500">Not added yet:</span>{missingKinds.map(([k, l]) => <button key={k} type="button" className="chip" onClick={() => openNew(k)}>+ {l}</button>)}</div>}
      </section>

      {/* ---------- details ---------- */}
      {COMPANY_GROUPS.map((g) => { const list = fieldsShown.filter((f) => f.group === g); if (!list.length) return null; const editing = editGroup === g;
        return (
          <section key={g} className="card !p-3">
            <div className="flex items-center gap-2 mb-1"><h2 className="font-semibold flex-1">{g}</h2>
              {editing ? <><button type="button" className="btn btn-sm" onClick={() => setEditGroup("")}>Cancel</button><button type="button" className="btn btn-sm btn-primary" disabled={busy === "save"} onClick={saveGroup}>{busy === "save" ? "Saving…" : "Save"}</button></>
                : <button type="button" className="btn btn-sm" disabled={missing || !!editGroup} onClick={() => startEdit(g)}>{I.edit} Edit</button>}
            </div>
            {editing && <p className="text-xs text-slate-500 mb-1">Leave a box as it is to keep printing today's value. A change reaches every new PDF within a minute; PDFs already sent do not change.</p>}
            <div className="grid sm:grid-cols-2 gap-x-6">{list.map(fieldRow)}</div>
          </section>); })}

      {/* ---------- seal and signature ---------- */}
      {!term && <section className="card !p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold flex-1">Seal and signature</h2><a className="btn btn-sm" href={`/api/company/sample?v=${stamp}`} target="_blank" rel="noreferrer">See a sample PDF</a></div>
        <p className="text-xs text-slate-500">Stamped on the joining form, PF Form 11 and Gratuity Form F (when "stamp seal" is ticked), all letters and exit letters, invoices and gas orders. The original images stay in use until new ones are uploaded. Use a PNG with a transparent background.</p>
        <div className="grid gap-3 sm:grid-cols-2">{(["seal", "signature"] as const).map((w) => { const custom = w === "seal" ? !!p.seal_path : !!p.signature_path;
          return (
            <div key={w} className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center gap-2"><span className="font-medium capitalize flex-1">{w}</span><span className="text-[11px] text-slate-500">{custom ? "uploaded" : "original"}</span></div>
              <div className="h-28 grid place-items-center rounded-lg bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]"><img src={`/api/company/branding?which=${w}&v=${stamp}`} alt={`Current ${w}`} className="max-h-24 max-w-full object-contain" /></div>
              <div className="flex flex-wrap gap-2">
                <label className={`btn btn-sm cursor-pointer ${busy === w ? "opacity-50 pointer-events-none" : ""}`}>{I.upload} {busy === w ? "Uploading…" : `Upload new ${w}`}<input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={missing} onChange={(e) => { void setBranding(w, e.target.files?.[0]); e.target.value = ""; }} /></label>
                {custom && <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => { if (confirm(`Go back to the original ${w}?`)) void setBranding(w, null); }}>Use the original</button>}
              </div>
            </div>); })}</div>
      </section>}

      {/* ---------- add / edit a document ---------- */}
      {form && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label={form.id ? "Edit document" : "Add document"} onClick={() => setForm(null)}>
        <div className="w-full max-w-md rounded-2xl bg-white p-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <h2 className="font-semibold">{form.id ? "Edit document" : "Add document"}</h2>
          <label className="block"><span className="lbl">Type</span><select className="inp" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, title: !form.title || form.title === kindLabel(form.kind) ? (e.target.value === "other" ? "" : kindLabel(e.target.value)) : form.title })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="block"><span className="lbl">Name</span><input className="inp" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. WC policy 2026–27" /></label>
          <label className="block"><span className="lbl">Number on it</span><input className="inp" value={form.doc_no} onChange={(e) => setForm({ ...form, doc_no: e.target.value })} placeholder="Policy, certificate or registration number" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="lbl">Issued on</span><input className="inp" type="date" value={form.issued_on} onChange={(e) => setForm({ ...form, issued_on: e.target.value })} /></label>
            <label className="block"><span className="lbl">Valid until</span><input className="inp" type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></label>
          </div>
          <p className="text-[11px] text-slate-400 -mt-1">With a "valid until" date, the Admins get a reminder 30 days before, 7 days before and on the day.</p>
          <label className="block"><span className="lbl">Notes</span><textarea className="inp" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. covers 25 people at Chromeni, Kundrodi" /></label>
          <label className="block"><span className="lbl">{form.id ? "Replace the file (optional)" : "File (PDF or photo)"}</span><input className="inp" type="file" accept="application/pdf,image/*" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} /></label>
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy === "doc"} onClick={saveDoc}>{busy === "doc" ? "Saving…" : "Save"}</button></div>
        </div></div>}

      {toast && <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-[calc(var(--bottom-nav-h,0px)+1rem)] z-50 rounded-full bg-slate-900 text-white text-sm px-4 py-2 shadow-lg">{toast}</div>}
    </div>
  );
}
