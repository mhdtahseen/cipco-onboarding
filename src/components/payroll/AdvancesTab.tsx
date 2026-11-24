"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { usePayroll } from "@/lib/payrollData";
import { prepareUpload, MAX_UPLOAD } from "@/lib/compress";

type P = ReturnType<typeof usePayroll>;
const proofUrl = (p: string) => `/api/payroll/advance-proof?path=${encodeURIComponent(p)}`;
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Advances given to people, recovered in instalments through payroll until cleared.
export default function AdvancesTab({ P, pid, today }: { P: P; pid: string; today: string }) {
  const d = P.d!; const [f, setF] = useState({ employee_id: "", amount: "", instalment: "", given_on: today, note: "" }); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState("");
  const name = (id: string) => d.names[id] ?? "?";
  // Sends the proof to storage and returns where it is, or null (with the error shown).
  async function upload(picked: File): Promise<string | null> {
    const p = await prepareUpload(picked); if (p.size > MAX_UPLOAD) { setErr("The file is larger than 5 MB."); return null; }
    const fd = new FormData(); fd.set("file", p); fd.set("projectId", pid); const r = await fetch("/api/payroll/advance-proof", { method: "POST", body: fd });
    if (!r.ok) { setErr(await r.text()); return null; } return (await r.json()).path;
  }
  async function attach(id: string, picked: File | undefined) {
    if (!picked) return; setErr(""); setBusy(id); const path = await upload(picked); if (!path) { setBusy(""); return; }
    const { error } = await supabase().from("employee_advances").update({ proof_path: path }).eq("id", id); setBusy(""); if (error) { setErr(error.message); return; }
    setMsg("Proof of payment attached ✓"); setTimeout(() => setMsg(""), 4000); P.load();
  }
  async function add() {
    const amount = parseFloat(f.amount), inst = parseFloat(f.instalment); if (!f.employee_id || !(amount > 0) || !(inst > 0)) { setErr("Choose the person and enter the amount and the monthly instalment."); return; } setErr(""); setBusy("new");
    let proof_path: string | null = null; if (file) { proof_path = await upload(file); if (!proof_path) { setBusy(""); return; } }
    const { error } = await supabase().from("employee_advances").insert({ employee_id: f.employee_id, project_id: pid, amount, instalment: inst, given_on: f.given_on, note: f.note.trim(), ...(proof_path ? { proof_path } : {}) }); setBusy(""); if (error) { setErr(error.message); return; }
    setF({ ...f, amount: "", instalment: "", note: "" }); setFile(null); setMsg("Advance recorded. It is recovered through the next payroll you calculate ✓"); setTimeout(() => setMsg(""), 5000); P.load();
  }
  async function voidIt(id: string) { if (!confirm("Void this advance? It stays in the list, marked void.")) return; const { error } = await supabase().from("employee_advances").update({ voided_at: new Date().toISOString() }).eq("id", id); if (error) { setErr(error.message); return; } P.load(); }
  return (
    <div className="space-y-4" data-advances>
      <section className="card space-y-3"><h2 className="font-medium">Advances</h2>
        <p className="text-xs text-slate-400">An advance is recovered each month by the instalment, until it is cleared, as a deduction on the salary slip. The recovery is recorded when the payroll is approved. It is never more than the net pay available, and never more than what is still owed. An advance already recovered from cannot be voided. Attach proof of payment (bank or UPI screenshot, signed voucher) when recording it, or later from the list.</p>
        {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[40rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Person</th><th className="text-left">Given</th><th className="text-right">Amount</th><th className="text-right">Instalment</th><th className="text-right">Recovered</th><th className="text-right">Owed</th><th className="text-left pl-3">Proof</th><th></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{d.advances.map((a) => { const rec = d.recovered[a.id] || 0; return <tr key={a.id} className={a.voided_at ? "text-slate-400 line-through" : ""}><td className="py-2 font-medium">{name(a.employee_id)}{a.note && <div className="text-xs font-normal text-slate-400">{a.note}</div>}</td><td>{a.given_on}</td><td className="text-right tabular-nums">₹{inr(a.amount)}</td><td className="text-right tabular-nums">₹{inr(a.instalment)}</td><td className="text-right tabular-nums">₹{inr(rec)}</td><td className="text-right tabular-nums">₹{inr(Math.max(0, a.amount - rec))}</td><td className="pl-3 text-xs no-underline">{a.proof_path && <a className="tlink" href={proofUrl(a.proof_path)} target="_blank" rel="noreferrer">View</a>}{!a.voided_at && (busy === a.id ? <span className="text-slate-400">Uploading…</span> : <label className="tlink cursor-pointer ml-2">{a.proof_path ? "Replace" : "Attach"}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { attach(a.id, e.target.files?.[0]); e.target.value = ""; }} /></label>)}</td><td className="text-right">{a.voided_at ? "void" : !rec && <button className="text-xs text-red-700 underline" onClick={() => voidIt(a.id)}>Void</button>}</td></tr>; })}</tbody></table></div>
        {!d.advances.length && <p className="text-sm text-slate-400">No advances recorded for this project.</p>}</section>
      <section className="card space-y-2"><h3 className="font-medium text-sm">Record an advance</h3>
        <div className="flex flex-wrap gap-2 items-end"><select className="inp !w-48" aria-label="Advance person" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">Person…</option>{d.emps.filter((e) => !e.left_on).sort((a, b) => a.full_name.localeCompare(b.full_name)).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select>
          <input className="inp !w-32" inputMode="decimal" placeholder="Amount ₹" aria-label="Advance amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><input className="inp !w-32" inputMode="decimal" placeholder="Monthly instalment ₹" aria-label="Advance instalment" value={f.instalment} onChange={(e) => setF({ ...f, instalment: e.target.value })} />
          <input className="inp !w-40" type="date" aria-label="Given on" value={f.given_on} onChange={(e) => setF({ ...f, given_on: e.target.value })} /><input className="inp !w-48" placeholder="Note (optional)" aria-label="Advance note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <label className="text-xs text-slate-500">Proof of payment (optional)<input key={file ? "f" : "n"} type="file" accept="image/*,application/pdf" aria-label="Proof of payment" className="ml-2 text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <button className="btn btn-primary" disabled={busy === "new"} onClick={add}>{busy === "new" ? "Saving…" : "Record advance"}</button></div></section>
    </div>
  );
}
