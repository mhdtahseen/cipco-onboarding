"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { FIELD_GROUPS, validate } from "@/lib/fields";

// Public page: the candidate fills in their own details. Talks to Supabase only through the invite_* functions.
const GROUPS = [
  { title: "Your name", fields: FIELD_GROUPS[0].fields.filter((f) => f.key === "full_name") },
  ...FIELD_GROUPS.slice(1),
];
const UPLOADS = [
  { key: "aadhaar", label: "Aadhaar card", hint: "Front and back (one PDF or photo)" },
  { key: "pan", label: "PAN card" },
  { key: "bank", label: "Bank passbook first page or cancelled cheque" },
  { key: "photo", label: "Passport-size photograph", hint: "Clear, plain background" },
  { key: "uan", label: "UAN / previous PF details", hint: "Only if you have worked before" },
  { key: "resume", label: "Resume / CV" },
];
const nice = (p?: string) => (p ? p.split("/").pop()!.replace(/^\d+-/, "") : "");

export default function ApplyPage() {
  const { token } = useParams<{ token: string }>();
  const [inv, setInv] = useState<any>(null); const [state, setState] = useState<"loading" | "bad" | "form" | "done" | "applied">("loading");
  const [v, setV] = useState<Record<string, string>>({}); const [files, setFiles] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(""); const [err, setErr] = useState(""); const [ok, setOk] = useState(false);
  useEffect(() => { (async () => {
    const { data } = await supabase().rpc("invite_get", { p_token: token });
    if (!data) { setState("bad"); return; }
    setInv(data); setFiles(data.files || {});
    setV({ full_name: data.name || "", phone: data.phone || "", email: data.email || "", father_spouse_type: "Father", ...(data.submission || {}) });
    setState(data.status === "applied" ? "applied" : "form");
  })(); }, [token]);
  const warn = validate(v); const set = (k: string, x: string) => setV((p) => ({ ...p, [k]: x }));

  async function upload(doc: string, picked: File) {
    setErr(""); const file = await prepareUpload(picked, { forceJpeg: doc === "photo" });
    if (file.size > MAX_UPLOAD) { setErr("That file is larger than 5 MB — please send a smaller photo or compressed PDF."); return; }
    setBusy(doc);
    const fd = new FormData(); fd.set("file", file); fd.set("token", token); fd.set("docType", doc);
    const r = await fetch("/api/apply/upload", { method: "POST", body: fd });
    setBusy("");
    if (!r.ok) { setErr(await r.text()); return; }
    setFiles((p) => ({ ...p, [doc]: file.name }));
  }
  async function submit() {
    setErr("");
    if (!v.full_name?.trim()) { setErr("Please enter your full name."); return; }
    if (!ok) { setErr("Please tick the confirmation at the bottom."); return; }
    setBusy("submit");
    const { data } = await supabase().rpc("invite_submit", { p_token: token, p_data: v });
    setBusy("");
    if (!data) { setErr("This link has expired or was already used. Please ask HR for a new one."); return; }
    setState("done"); window.scrollTo(0, 0);
  }

  const shell = (c: React.ReactNode) => <div className="apply max-w-2xl mx-auto space-y-4 pb-4"><div className="flex items-center gap-3"><img src="/branding/logo.png" alt="CIPCO" className="h-8 w-auto" /><span className="text-sm font-semibold text-slate-500">Joining details</span></div>{c}</div>;
  if (state === "loading") return shell(<p className="text-slate-500">Loading…</p>);
  if (state === "bad") return shell(<div className="card"><h1 className="font-bold text-lg">This link isn't active</h1><p className="text-sm text-slate-600 mt-1">It may have expired or been replaced. Please contact the CIPCO HR team for a new link.</p></div>);
  if (state === "applied") return shell(<div className="card"><h1 className="font-bold text-lg">Thank you</h1><p className="text-sm text-slate-600 mt-1">Your details have already been received. Nothing more is needed here.</p></div>);
  if (state === "done") return shell(<div className="card space-y-2"><h1 className="font-bold text-lg">Thank you, {v.full_name?.split(" ")[0]} ✓</h1><p className="text-sm text-slate-600">Your details and documents have been sent to the CIPCO HR team. You can reopen this link to correct anything until they confirm it.</p><button className="btn" onClick={() => setState("form")}>Edit my answers</button></div>);

  return shell(<>
    <div><h1 className="text-xl font-bold">Hello{inv?.name ? `, ${inv.name.split(" ")[0]}` : ""} 👋</h1>
      <p className="text-sm text-slate-500">Please fill in your details and upload your documents. Fill what you can — you can come back to this link later and edit until you submit.</p></div>
    {GROUPS.map((g) => (
      <div key={g.title} className="card">
        <h3 className="font-semibold mb-3">{g.title}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {g.fields.map((f) => (
            <div key={f.key} className={`min-w-0 ${f.wide ? "sm:col-span-2" : ""}`}>
              <label className="lbl" htmlFor={f.key}>{f.label}</label>
              {f.type === "select" ? <select id={f.key} className="inp" value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}><option value=""></option>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
                : f.type === "textarea" ? <textarea id={f.key} className="inp" rows={2} value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                : <input id={f.key} className="inp" type={f.type === "date" ? "date" : f.key === "email" ? "email" : "text"} inputMode={f.key === "email" ? "email" : ["phone", "alt_phone", "nominee_phone", "emergency_phone"].includes(f.key) ? "tel" : ["pin", "aadhaar", "account_no", "uan"].includes(f.key) ? "numeric" : undefined} autoComplete={f.key === "email" ? "email" : f.key === "phone" ? "tel" : f.key === "full_name" ? "name" : "off"} autoCapitalize={["pan", "ifsc"].includes(f.key) ? "characters" : undefined} value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />}
              {warn[f.key] && <p className="warn">{warn[f.key]}</p>}
            </div>))}
        </div>
      </div>))}
    <div className="card">
      <h3 className="font-semibold mb-1">Documents</h3><p className="text-xs text-slate-500 mb-3">PDF or clear photo · max 5 MB each. Photographing with your phone camera works.</p>
      <div className="divide-y divide-slate-100">{UPLOADS.map((u) => (
        <div key={u.key} className="py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-48"><div className="text-sm font-medium">{u.label}</div>{u.hint && <div className="text-xs text-slate-400">{u.hint}</div>}</div>
          {files[u.key] && <span className="text-xs text-green-700 truncate max-w-40" title={nice(files[u.key])}>✓ {nice(files[u.key])}</span>}
          <label className="btn cursor-pointer">{busy === u.key ? "Uploading…" : files[u.key] ? "Replace" : "Upload"}
            <input type="file" className="hidden" accept="image/*,.pdf" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(u.key, f); }} /></label>
        </div>))}</div>
    </div>
    <label className="flex items-start gap-3 text-sm text-slate-600"><input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} />I confirm these details and documents are mine and correct, and I agree to CIPCO using them for my employment, PF and statutory records.</label>
    {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
    <div className="sticky bottom-0 z-10 -mx-4 px-4 border-t border-slate-200 bg-[#f6f7fb] py-3"><button className="btn btn-primary w-full justify-center" disabled={!!busy} onClick={submit}>{busy === "submit" ? "Sending…" : "Submit to HR"}</button></div>
  </>);
}
