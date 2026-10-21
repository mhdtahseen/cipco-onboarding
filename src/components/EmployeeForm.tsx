"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { EMPTY, FIELD_GROUPS, validate } from "@/lib/fields";
import SalaryEditor from "./SalaryEditor";
import { calcSalary } from "@/lib/salary";

export default function EmployeeForm({ initial, onSaved }: { initial: Record<string, any> | null; onSaved?: (e: any) => void }) {
  const [v, setV] = useState<Record<string, any>>(initial ?? EMPTY); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const router = useRouter();
  const warn = validate(v);
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
    const res = v.id ? await sb.from("employees").update(clean).eq("id", v.id).select().single() : await sb.from("employees").insert(clean).select().single();
    setBusy(false);
    if (res.error) { setMsg(res.error.message); return; }
    setMsg("Saved ✓"); onSaved?.(res.data);
    if (!v.id) router.push(`/employees/${res.data.id}`);
  }
  return (
    <div className="space-y-5">
      {FIELD_GROUPS.map((g) => (
        <div key={g.title} className="card">
          <h3 className="font-semibold mb-3">{g.title}</h3>
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
      <SalaryEditor value={v.salary ?? {}} gender={v.gender} onChange={(c) => set("salary", c)} />
      <div className="flex items-center gap-3 sticky bottom-0 bg-[#f6f7fb] py-3">
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : v.id ? "Save changes" : "Create employee"}</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
