"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { stageLabel } from "@/lib/pipeline";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { EMPTY, FIELD_GROUPS, PAYROLL_GROUP, validate } from "@/lib/fields";
import SalaryEditor from "./SalaryEditor";
import { calcSalary } from "@/lib/salary";
import type { Department, Project } from "@/lib/types";

export default function EmployeeForm({ initial, onSaved }: { initial: Record<string, any> | null; onSaved?: (e: any) => void }) {
  const [v, setV] = useState<Record<string, any>>(initial ?? EMPTY); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [dup, setDup] = useState<{ id: string; full_name: string; why: string; where: string } | null>(null); const router = useRouter();
  // If the record changes from outside the form (e.g. a candidate's self-fill answers were applied), show the new values
  // without discarding anything else typed in the meantime.
  const prev = useRef(initial);
  useEffect(() => {
    const before = prev.current; prev.current = initial; if (!initial || !before || initial === before) return;
    const diff: Record<string, any> = {}; Object.keys(initial).forEach((k) => { if (k !== "updated_at" && JSON.stringify(initial[k]) !== JSON.stringify(before[k])) diff[k] = initial[k]; });
    if (Object.keys(diff).length) setV((p) => ({ ...p, ...diff }));
  }, [initial]);
  const [projects, setProjects] = useState<Project[]>([]); const [depts, setDepts] = useState<Department[]>([]);
  useEffect(() => { (async () => {
    const sb = supabase(); const [p, d] = await Promise.all([sb.from("projects").select("*").order("name"), sb.from("departments").select("*").eq("active", true).order("name")]);
    setProjects((p.data || []) as Project[]); setDepts((d.data || []) as Department[]);   // empty until the projects migration has been run
  })(); }, []);
  const warn = validate(v); const isNew = !initial;
  const groups = isNew ? [{ title: "Candidate", fields: FIELD_GROUPS.flatMap((g) => g.fields).filter((f) => ["full_name", "phone", "email", "designation", "department"].includes(f.key)) }] : [...FIELD_GROUPS, ...(initial && "pay_mode" in (initial as object) ? [PAYROLL_GROUP] : [])];   // the payroll group appears once the payroll migration has added its columns
  const need: Record<string, string> = { Employment: "needed for offer", "Personal & family": "needed for joining forms", Address: "needed for joining forms", "Statutory & bank": "needed for joining forms", "Nominee & emergency contact": "needed for joining forms" };
  const set = (k: string, val: any) => setV((p) => ({ ...p, [k]: val }));
  async function addDept() {
    const name = prompt("New department name (it will be available in the dropdown from now on):")?.trim(); if (!name) return;
    const ex = depts.find((d) => d.name.toLowerCase() === name.toLowerCase()); if (ex) { set("department", ex.name); return; }
    const { data, error } = await supabase().from("departments").insert({ name }).select().single();
    if (error) { alert(error.message + " — has the projects & departments SQL migration been run?"); return; }
    setDepts((l) => [...l, data as Department].sort((a, b) => a.name.localeCompare(b.name))); set("department", name);
  }
  function pickProject(id: string) {
    if (id === "__legacy") return;
    if (!id) { setV((p) => ({ ...p, project: "", project_id: null })); return; }
    const pr = projects.find((x) => x.id === id); if (!pr) return;
    setV((p) => ({ ...p, project: pr.name, project_id: pr.id, ...(pr.location ? { site_location: pr.location } : {}) }));   // location follows the project
  }
  const refField = (key: string) => {
    if (key === "department") {
      const cur = v.department ?? ""; const hit = depts.find((d) => d.name.toLowerCase() === cur.toLowerCase()); const val = hit?.name ?? cur;
      return <select className="inp" value={val} onChange={(e) => (e.target.value === "__new" ? addDept() : set("department", e.target.value))}><option value=""></option>{cur && !hit && <option value={cur}>{cur}</option>}{depts.map((d) => <option key={d.id}>{d.name}</option>)}<option value="__new">+ Add new department…</option></select>;
    }
    const sel = projects.find((x) => x.id === v.project_id); const active = projects.filter((x) => x.status === "active");
    const val = v.project_id && sel ? sel.id : v.project ? "__legacy" : "";
    return <><select className="inp" value={val} onChange={(e) => pickProject(e.target.value)}><option value=""></option>
      {val === "__legacy" && <option value="__legacy">{v.project} (not in project list)</option>}
      {sel && sel.status === "closed" && <option value={sel.id}>{sel.name} (closed)</option>}
      {active.map((x) => <option key={x.id} value={x.id}>{x.name}{x.location ? ` — ${x.location}` : ""}</option>)}</select>
      <Link href="/projects" className="text-xs text-blue-700">Manage projects</Link></>;
  };
  async function save() {
    if (!v.full_name) { setMsg("Full name is required"); return; }
    setBusy(true); setMsg("");
    const clean: Record<string, any> = {};
    [...FIELD_GROUPS, ...(!isNew && "pay_mode" in (initial as object) ? [PAYROLL_GROUP] : [])].flatMap((g) => g.fields).forEach((f) => { const x = v[f.key]; clean[f.key] = x === "" || x === undefined ? null : f.type === "number" && x !== null ? Number(x) : x; });
    if ("pay_mode" in clean && !clean.pay_mode) clean.pay_mode = "bank";
    if (clean.aadhaar) clean.aadhaar = String(clean.aadhaar).replace(/\s/g, "");
    if (clean.pan) clean.pan = String(clean.pan).toUpperCase(); if (clean.ifsc) clean.ifsc = String(clean.ifsc).toUpperCase();
    if (v.project_id !== undefined) clean.project_id = v.project_id;   // only once the projects migration exists
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
    // A salary change is recorded with the date it takes effect, so payroll for earlier months keeps the old salary (needs the payroll migration)
    const sal = (x: any) => JSON.stringify(x ?? {}); let effective: string | null = null;
    const hasPay = !!v.id && !!initial && "pay_mode" in (initial as object); const amt = Number((v.salary as any)?.amount) > 0;
    if (hasPay && amt && sal(v.salary) !== sal(initial?.salary)) {
      const had = Number((initial?.salary as any)?.amount) > 0; const ans = had ? prompt("The salary has changed. From which date does the new salary apply? (YYYY-MM-DD; earlier payroll months keep the old salary)", new Date().toISOString().slice(0, 10)) : (initial?.join_date ?? new Date().toISOString().slice(0, 10));
      if (ans === null) { setBusy(false); setMsg("Not saved: choose the date the new salary applies from."); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ans)) { setBusy(false); setMsg("Enter the date as YYYY-MM-DD."); return; } effective = ans;
    }
    const res = v.id ? await sb.from("employees").update(clean).eq("id", v.id).select().single() : await sb.from("employees").insert(clean).select().single();
    if (!res.error && effective && v.id) {
      const { data: hist } = await sb.from("salary_history").select("id").eq("employee_id", v.id).limit(1); const rows: Record<string, any>[] = [];
      if (!hist?.length && Number((initial?.salary as any)?.amount) > 0) rows.push({ employee_id: v.id, effective_from: initial?.join_date || "2000-01-01", salary: initial?.salary, monthly_ctc: initial?.monthly_ctc ?? null, note: "Salary before the first revision" });
      rows.push({ employee_id: v.id, effective_from: effective, salary: clean.salary, monthly_ctc: clean.monthly_ctc, note: "Revised in the employee form" });
      await sb.from("salary_history").upsert(rows, { onConflict: "employee_id,effective_from" });
    }
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
                {f.key === "department" || f.key === "project" ? refField(f.key) : f.type === "select" ? (
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
      <div className="flex flex-wrap items-center gap-3 sticky bottom-[var(--bottom-nav-h,0px)] z-10 border-t border-slate-200 bg-[#f6f7fb] py-3">
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : v.id ? "Save changes" : "Add candidate"}</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
        {dup && <span className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">Already exists — same {dup.why}: <Link className="underline font-medium" href={`/employees/${dup.id}`}>{dup.full_name}</Link> ({dup.where}). Open that record{dup.where === "Rejected pile" ? " and use Reopen" : ""} instead of adding again.</span>}
      </div>
    </div>
  );
}
