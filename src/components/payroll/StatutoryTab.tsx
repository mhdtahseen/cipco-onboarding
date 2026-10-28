"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { monthName, monthStart, statDue, statutoryTotals } from "@/lib/payroll";
import type { usePayroll } from "@/lib/payrollData";

type P = ReturnType<typeof usePayroll>;
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const KIND = { pf: "Provident fund", esi: "ESI", pt: "Professional tax", tds: "TDS", other: "Other" } as const;

// What is to be remitted to the authorities for the month (from the approved payroll) and what has been remitted.
// Each remittance posts a Statutory / compliance expense on the project; the salary expense is the net, so nothing is counted twice.
export default function StatutoryTab({ P, pid, ym, today }: { P: P; pid: string; ym: string; today: string }) {
  const d = P.d!; const run = d.run; const approved = run?.status === "approved";
  const [f, setF] = useState({ kind: "pf", amount: "", paid_on: today, challan_no: "", note: "" }); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const t = statutoryTotals(approved ? d.lines : []);
  const mine = d.stat.filter((s) => s.pay_month === monthStart(ym) || s.pay_month.slice(0, 7) === ym);
  const paidOf = (k: string) => mine.filter((s) => s.kind === k && !s.voided_at).reduce((s, x) => s + x.amount, 0);
  const rows = [{ k: "pf" as const, label: "Provident fund", parts: `employee ₹${inr(t.pfEmp)} + employer ₹${inr(t.pfEr)} + admin / EDLI ₹${inr(t.pfAdmin)}`, total: t.pf }, { k: "esi" as const, label: "ESI", parts: `employee ₹${inr(t.esiEmp)} + employer ₹${inr(t.esiEr)}`, total: t.esi }, { k: "pt" as const, label: "Professional tax", parts: "deducted from employees", total: t.pt }];
  async function add() { const amount = parseFloat(f.amount); if (!(amount > 0)) { setErr("Enter the amount."); return; } setErr(""); const { error } = await supabase().from("statutory_payments").insert({ project_id: pid, pay_month: monthStart(ym), kind: f.kind, amount, paid_on: f.paid_on, challan_no: f.challan_no.trim(), note: f.note.trim() }); if (error) { setErr(error.message); return; } setF({ ...f, amount: "", challan_no: "", note: "" }); setMsg("Recorded and posted to the project's Statutory / compliance expenses ✓"); setTimeout(() => setMsg(""), 5000); P.load(); }
  async function voidIt(id: string) { if (!confirm("Void this remittance? It stays in the list, marked void, and its expense is removed.")) return; const { error } = await supabase().from("statutory_payments").update({ voided_at: new Date().toISOString() }).eq("id", id); if (error) { setErr(error.message); return; } P.load(); }
  return (
    <div className="space-y-4" data-stat>
      {!approved && <p className="card text-sm text-slate-500">The statutory amounts come from the approved payroll for {monthName(ym)}. Approve the payroll first. You can still record a remittance below.</p>}
      <section className="card space-y-2"><h2 className="font-medium">To remit for {monthName(ym)}</h2>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[36rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Item</th><th className="text-left">Made up of</th><th className="text-right">Due</th><th className="text-left pl-3">By</th><th className="text-right">Remitted</th><th className="text-right">Left</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r) => { const left = Math.max(0, r.total - paidOf(r.k)); const by = statDue(ym, r.k); return <tr key={r.k}><td className="py-2 font-medium">{r.label}</td><td className="text-xs text-slate-500">{approved ? r.parts : "—"}</td><td className="text-right tabular-nums">₹{inr(r.total)}</td><td className={`pl-3 ${left > 0 && today > by ? "text-rose-700 font-medium" : "text-slate-500"}`}>{new Date(by + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td><td className="text-right tabular-nums">₹{inr(paidOf(r.k))}</td><td className={`text-right tabular-nums ${left > 0 ? "text-amber-800 font-medium" : ""}`}>₹{inr(left)}</td></tr>; })}</tbody></table></div>
        <p className="text-xs text-slate-400">PF and ESI are due by the 15th of the next month; Professional tax by the last day of the payroll month. Check the dates and the wage month with your CA.</p></section>
      <section className="card space-y-3"><h2 className="font-medium">Record a remittance</h2>
        {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
        <div className="flex flex-wrap gap-2 items-end"><select className="inp !w-40" aria-label="Remittance type" value={f.kind} onChange={(e) => { const k = e.target.value; const r = rows.find((x) => x.k === k); setF({ ...f, kind: k, amount: r ? String(Math.max(0, r.total - paidOf(k)) || "") : f.amount }); }}>{(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select>
          <input className="inp !w-32" inputMode="decimal" placeholder="Amount ₹" aria-label="Remittance amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><input className="inp !w-40" type="date" aria-label="Remitted on" value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} />
          <input className="inp !w-40" placeholder="Challan no." aria-label="Challan number" value={f.challan_no} onChange={(e) => setF({ ...f, challan_no: e.target.value })} /><input className="inp !w-48" placeholder="Note" aria-label="Remittance note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /><button className="btn btn-primary" onClick={add}>Record</button></div>
        <ul className="divide-y divide-slate-100 text-sm" data-stat-list>{mine.map((s) => <li key={s.id} className={`py-2 flex flex-wrap items-center gap-x-3 ${s.voided_at ? "text-slate-400 line-through" : ""}`}><span className="tabular-nums w-24">{s.paid_on}</span><span className="w-32">{KIND[s.kind]}</span><span className="tabular-nums w-28">₹{inr(s.amount)}</span><span className="text-xs text-slate-400 flex-1 truncate">{s.challan_no}{s.note ? ` · ${s.note}` : ""}</span>{s.voided_at ? <span className="text-xs">void</span> : <button className="text-xs text-red-700 underline" onClick={() => voidIt(s.id)}>Void</button>}</li>)}</ul>
        {!mine.length && <p className="text-sm text-slate-400">Nothing remitted for {monthName(ym)} yet.</p>}</section>
    </div>
  );
}
