"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { FIELD_GROUPS } from "@/lib/fields";
import type { Employee } from "@/lib/types";

const LABEL: Record<string, string> = Object.fromEntries(FIELD_GROUPS.flatMap((g) => g.fields).map((f) => [f.key, f.label]));
const DOC_LABEL: Record<string, string> = { aadhaar: "Aadhaar card", pan: "PAN card", bank: "Bank passbook / cheque", uan: "UAN / PF details", photo: "Photograph", resume: "Resume" };
type Invite = { id: string; token: string; status: "sent" | "submitted" | "applied" | "revoked"; expires_at: string; submitted_at: string | null; submission: Record<string, string>; files: Record<string, string> };
const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const clean = (k: string, x: string) => k === "phone" || k === "alt_phone" || k === "nominee_phone" || k === "emergency_phone" ? (() => { const d = x.replace(/\D/g, ""); return d.length > 10 && d.startsWith("91") ? d.slice(-10) : d; })() : k === "email" ? x.trim().toLowerCase() : k === "aadhaar" || k === "uan" ? x.replace(/\s|-/g, "") : k === "pan" || k === "ifsc" ? x.replace(/\s/g, "").toUpperCase() : x.trim();

// Per-candidate self-fill link: create it, share it, then review what the candidate submitted before it touches the record.
export default function InviteCard({ emp, onChange, onApplied }: { emp: Employee; onChange: (e: Employee) => void; onApplied?: () => void }) {
  const [inv, setInv] = useState<Invite | null>(null); const [loaded, setLoaded] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [copied, setCopied] = useState(false);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  async function load() {
    const { data } = await supabase().from("form_invites").select("*").eq("employee_id", emp.id).neq("status", "revoked").order("created_at", { ascending: false }).limit(1);
    const row = (data?.[0] as Invite) ?? null; setInv(row); setLoaded(true);
    if (row?.status === "submitted") setPick(Object.fromEntries(Object.entries(row.submission).map(([k, x]) => { const cur = (emp as any)[k]; return [k, !cur || String(cur) === clean(k, x)]; })));
  }
  useEffect(() => { load(); }, [emp.id]);
  const url = inv ? `${location.origin}/apply/${inv.token}` : "";
  const expired = inv ? new Date(inv.expires_at) < new Date() : false;

  async function create() { setBusy(true); setMsg(""); const { error } = await supabase().from("form_invites").insert({ employee_id: emp.id }); setBusy(false); if (error) setMsg(error.message + " — has the form_invites SQL migration been run?"); else load(); }
  async function revoke() { if (!inv || !confirm("Disable this link? The candidate will no longer be able to open it.")) return; await supabase().from("form_invites").update({ status: "revoked" }).eq("id", inv.id); setInv(null); }
  async function apply() {
    if (!inv) return; setBusy(true); setMsg("");
    const patch: Record<string, any> = {}; Object.entries(inv.submission).forEach(([k, x]) => { if (pick[k]) patch[k] = clean(k, x); });
    const sb = supabase();
    if (Object.keys(patch).length) {
      const { data, error } = await sb.from("employees").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", emp.id).select().single();
      if (error) { setBusy(false); setMsg(/duplicate key|unique/i.test(error.message) ? "Another candidate already has that phone, email, Aadhaar or PAN — untick it and apply the rest." : error.message); return; }
      onChange(data as Employee);
    }
    const now = new Date().toISOString();
    const docs = Object.entries(inv.files).map(([doc_type, file_path]) => ({ employee_id: emp.id, doc_type, status: "received", file_path, updated_at: now }));
    if (docs.length) { const { error } = await sb.from("employee_documents").upsert(docs, { onConflict: "employee_id,doc_type" }); if (error) { setBusy(false); setMsg(error.message); return; } }
    await sb.from("form_invites").update({ status: "applied" }).eq("id", inv.id);
    setBusy(false); setMsg(`Applied ${Object.keys(patch).length} detail(s) and ${docs.length} document(s) ✓ — see the Details and Documents tabs.`); onApplied?.(); load();
  }

  if (!loaded) return null;
  const view = (p: string) => `/api/docs/view?path=${encodeURIComponent(p)}`;
  const fileList = inv && Object.keys(inv.files).length ? <div className="flex flex-wrap gap-2">{Object.entries(inv.files).map(([d, p]) => <a key={d} className="btn !py-1 !text-xs" href={view(p)} target="_blank">📄 {DOC_LABEL[d] || d}</a>)}</div> : null;
  return (
    <div className="card !py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm font-semibold sm:w-20">Self-fill</div>
        {!inv && <><span className="text-sm text-slate-500">Send the candidate a link to fill their own details and upload documents</span><button className="btn" disabled={busy} onClick={create}>Create link</button></>}
        {inv?.status === "sent" && !expired && <>
          <input readOnly className="inp !w-auto flex-1 min-w-48 !text-xs" value={url} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied ✓" : "Copy link"}</button>
          <a className="btn" target="_blank" href={`https://wa.me/${emp.phone && /^\d{10}$/.test(emp.phone) ? "91" + emp.phone : ""}?text=${encodeURIComponent(`Hello ${emp.full_name.split(" ")[0]}, please fill in your joining details and upload your documents here: ${url}`)}`}>WhatsApp</a>
          <button className="btn btn-danger" onClick={revoke}>Disable</button>
          <span className="text-xs text-slate-400 w-full">Waiting for the candidate · expires {fmt(inv.expires_at)}{Object.keys(inv.files).length ? ` · ${Object.keys(inv.files).length} file(s) uploaded so far` : ""}</span>
        </>}
        {inv?.status === "sent" && expired && <><span className="text-sm text-amber-700">Link expired {fmt(inv.expires_at)}</span><button className="btn" disabled={busy} onClick={async () => { await revoke(); await create(); }}>Create new link</button></>}
        {inv?.status === "applied" && <><span className="text-sm text-green-700">✓ Candidate's details applied</span><button className="btn" disabled={busy} onClick={create}>Send a new link</button></>}
        {inv?.status === "submitted" && <span className="text-sm font-medium text-blue-800">Candidate submitted their details{inv.submitted_at ? ` on ${fmt(inv.submitted_at)}` : ""} — review below</span>}
        {msg && <span className="text-sm text-slate-600 w-full">{msg}</span>}
      </div>
      {inv?.status === "submitted" && <div className="space-y-2 text-sm border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-500">Showing only new or changed answers. Tick what to save to the record. Fields that would replace a different existing value start unticked.</p>
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">{Object.entries(inv.submission).filter(([k, x]) => String((emp as any)[k] ?? "") !== clean(k, x)).map(([k, x]) => { const cur = (emp as any)[k]; const differs = cur && String(cur) !== clean(k, x); return (
          <label key={k} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={!!pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} />
            <span><span className="text-slate-500">{LABEL[k] || k}: </span><span className="font-medium break-words">{x}</span>{differs && <span className="block text-xs text-amber-700">currently “{String(cur)}”</span>}</span></label>); })}</div>
        {fileList && <div><div className="text-xs text-slate-500 mb-1">Uploaded documents (added to the Documents checklist as “received” when you apply)</div>{fileList}</div>}
        <div className="flex gap-2"><button className="btn btn-primary" disabled={busy} onClick={apply}>{busy ? "Applying…" : "Apply to candidate"}</button>
          <button className="btn" onClick={revoke}>Discard</button></div>
      </div>}
    </div>
  );
}
