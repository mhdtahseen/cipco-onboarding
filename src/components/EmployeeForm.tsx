"use client";
import { useState } from "react";
import Link from "next/link";
import { stageLabel } from "@/lib/pipeline";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { EMPTY, FIELD_GROUPS, validate } from "@/lib/fields";
import SalaryEditor from "./SalaryEditor";
import { calcSalary } from "@/lib/salary";

export default function EmployeeForm({ initial, onSaved }: { initial: Record<string, any> | null; onSaved?: (e: any) => void }) {
  const [v, setV] = useState<Record<string, any>>(initial ?? EMPTY); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [dup, setDup] = useState<{ id: string; full_name: string; why: string; where: string } | null>(null); const router = useRouter();
  const warn = validate(v); const isNew = !initial;
  const groups = isNew ? [{ title: "Candidate", fields: FIELD_GROUPS.flatMap((g) => g.fields).filter((f) => ["full_name", "phone", "email", "designation", "department"].includes(f.key)) }] : FIELD_GROUPS;
  const need: Record<string, string> = { Employment: "needed for offer", "Personal & family": "needed for joining forms", Address: "needed for joining forms", "Statutory & bank": "needed for joining forms", "Nominee & emergency contact": "needed for joining forms" };
  const set = (k: string, val: any) => setV((p) => ({ ...p, [k]: val }));
  async function save() {
    if (!v.full_name) { setMsg("Full name is required"); return; }
    setBusy(true); setMsg("");
    const clean: Record<string, any> = {};
    FIELD_GROUPS.flatMap((g) => g.fields).forEach((f) => { const x = v[f.key]; clean[f.key] = x === "" || x === undefined ? null : f.type === "number" && x !== null ? Number(x) : x; });
    if (clean.aadhaar) clean.aadhaar = String(clean.aadhaar).replace(/\s/g, "");
    if (clean.pan) clean.pan = String(clean.pan).toUpperCase(); if (clean.ifsc) clean.ifsc = String(clean.ifsc).toUpperCase();
    clean.salary = v.salary ?? {};
    clean.monthly_ctc = calcSalary(v.salary ?? {}, v.gender)?.monthly.ctc ?? null;
    clean.updated_at = new Date().toISOString();
    const sb = supabase();
    // Duplicate guard: same phone / email / Aadhaar / PAN = same person. Same name alone only asks for confirmation.
    if (clean.phone) { const d = String(clean.phone).replace(/\D/g, ""); clean.phone = d.length > 10 && d.startsWith("91") ? d.slice(-10) : d; }
    if (clean.email) clean.email = String(clean.email).trim().toLowerCase();
    const keys: [string, string][] = (["phone", "email", "aadhaar", "pan"] as const).filter((k) => clean[k]).map((k) => [k, k === "phone" ? "phone number" : k === "pan" ? "PAN" : k === "aadhaar" ? "Aadhaar" : "email"]);
    setDup(null);
    if (keys.length) {
      let q = sb.from("employees").select("id,full_name,stage,outcome,phone,email,aadhaar,pan").or(keys.map(([k]) => `${k}.eq."${clean[k]}"`).join(","));
      if (v.id) q = q.neq("id", v.id);
      const { data: hit } = await q;
      if (hit?.length) { const h: any = hit[0]; const why = keys.filter(([k]) => h[k] === clean[k]).map(([, l]) => l).join(" / "); setDup({ id: h.id, full_name: h.full_name, why, where: h.outcome === "rejected" ? "Rejected pile" : stageLabel(h.stage) }); setBusy(false); return; }
    }
    if (!v.id || v.full_name !== initial?.full_name) {
      let q = sb.from("employees").select("id,full_name").ilike("full_name", String(clean.full_name).trim().replace(/[%_]/g, "\\$&")).limit(1); if (v.id) q = q.neq("id", v.id);
      const { data: same } = await q;
      if (same?.length && !confirm(`Someone named “${same[0].full_name}” already exists. Save anyway as a separate person?`)) { setBusy(false); return; }
    }
    const res = v.id ? await sb.from("employees").update(clean).eq("id", v.id).select().single() : await sb.from("employees").insert(clean).select().single();
    setBusy(false);
    if (res.error) { setMsg(/duplicate key|unique/i.test(res.error.message) ? "A record with the same phone, email, Aadhaar or PAN already exists." : res.error.message); return; }
    setMsg("Saved ✓"); onSaved?.(res.data);
    if (!v.id) router.push(`/employees/${res.data.id}`);
  }
  return (
    <div className="space-y-5">
      {!isNew && <p className="text-sm text-slate-500">Fill in only what you have — only the name is required. Letters and forms print blank for anything missing, so complete each section before the stage that needs it.</p>}
      {groups.map((g) => (
        <div key={g.title} className="card">
          <h3 className="font-semibold mb-3">{g.title}{need[g.title] && <span className="ml-2 text-xs font-normal text-slate-400">{need[g.title]}</span>}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map((f) => (
              <div key={f.key} className={f.wide ? "sm:col-span-2 lg:col-span-3" : ""}>
                <label className="lbl">{f.label}</label>
                {f.type === "select" ? (
                  <select className="inp" value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}><option value=""></option>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
                ) : f.type === "textarea" ? (
                  <textarea className="inp" rows={2} value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                ) : (
                  <input className="inp" type={f.type ?? "text"} value={v[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                )}
                {warn[f.key] && <p className="warn">{warn[f.key]}</p>}
              </div>))}
          </div>
        </div>))}
      {!isNew && <SalaryEditor value={v.salary ?? {}} gender={v.gender} onChange={(c) => set("salary", c)} />}
      <div className="flex items-center gap-3 sticky bottom-0 bg-[#f6f7fb] py-3">
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : v.id ? "Save changes" : "Add candidate"}</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
        {dup && <span className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">Already exists — same {dup.why}: <Link className="underline font-medium" href={`/employees/${dup.id}`}>{dup.full_name}</Link> ({dup.where}). Open that record{dup.where === "Rejected pile" ? " and use Reopen" : ""} instead of adding again.</span>}
      </div>
    </div>
  );
}
