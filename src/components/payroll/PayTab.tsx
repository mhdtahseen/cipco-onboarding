"use client";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { creditWindow, monthName } from "@/lib/payroll";
import type { usePayroll } from "@/lib/payrollData";

type P = ReturnType<typeof usePayroll>;
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Who to pay and how much, after the payroll is approved. Bank transfers go out as a CSV; UPI payments open the UPI app pre-filled.
export default function PayTab({ P, ym, today }: { P: P; ym: string; today: string }) {
  const d = P.d!; const run = d.run; const win = creditWindow(ym);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [form, setForm] = useState<{ id: string; amount: string; paid_on: string; reference: string } | null>(null); const [busy, setBusy] = useState(false);
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };
  const rows = useMemo(() => d.lines.map((l) => { const paid = d.payments.filter((p) => p.line_id === l.id && !p.voided_at).reduce((s, p) => s + p.amount, 0); const left = Math.max(0, l.net - paid); const status = l.held ? "On hold" : l.net <= 0 ? "Nothing to pay" : left <= 0 ? "Paid" : paid > 0 ? "Part paid" : "Unpaid"; return { l, paid, left, status, name: (l.snapshot.name as string) ?? "", snap: l.snapshot as Record<string, any> }; }).sort((a, b) => a.name.localeCompare(b.name)), [d]);
  const due = rows.filter((r) => r.left > 0 && !r.l.held && r.l.net > 0); const overdue = today > win.to && due.length > 0;
  if (!run || run.status !== "approved") return <p className="card text-sm text-slate-500">Approve the payroll on the Payroll run tab first. Then this page lists whom to pay and how much.</p>;
  const label = `Salary ${monthName(ym)}`;
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  function download(name: string, table: (string | number)[][]) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + table.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" })); a.download = name; a.click(); }
  const bankCsv = () => download(`bank transfers ${ym}.csv`, [["Name", "Emp no.", "Bank", "Account no.", "IFSC", "Amount", "Narration"], ...due.filter((r) => r.l.pay_mode === "bank").map((r) => [r.name, r.snap.emp_no ?? "", r.snap.bank_name ?? "", r.snap.account_no ?? "", r.snap.ifsc ?? "", r.left, label])]);
  const upiCsv = () => download(`upi payments ${ym}.csv`, [["Name", "Emp no.", "UPI ID", "Amount", "Narration"], ...due.filter((r) => r.l.pay_mode === "upi").map((r) => [r.name, r.snap.emp_no ?? "", r.snap.upi_id ?? "", r.left, label])]);
  async function pay(lineId: string, amount: number, mode: string, paid_on: string, reference: string) { return supabase().from("payroll_payments").insert({ line_id: lineId, amount, mode, paid_on, reference }); }
  async function submit(r: (typeof rows)[number]) { if (!form) return; const amount = parseFloat(form.amount); if (!(amount > 0)) { setErr("Enter the amount."); return; } setBusy(true); setErr(""); const { error } = await pay(r.l.id, amount, r.l.pay_mode, form.paid_on, form.reference.trim()); setBusy(false); if (error) { setErr(error.message); return; } setForm(null); note(`Paid ${r.name} ₹${inr(amount)}. It is in the project's Salaries & wages expense ✓`); P.load(); }
  async function payAll(mode: "bank" | "upi") {
    const todo = due.filter((r) => r.l.pay_mode === mode); if (!todo.length) { note(`Nobody is left to pay by ${mode}.`); return; }
    const ref = prompt(`Record ${todo.length} ${mode} payment${todo.length > 1 ? "s" : ""} as paid today (₹${inr(todo.reduce((s, r) => s + r.left, 0))})?\nBatch reference / UTR (optional):`); if (ref === null) return; setBusy(true); setErr("");
    for (const r of todo) { const { error } = await pay(r.l.id, r.left, mode, today, ref.trim()); if (error) { setErr(`${r.name}: ${error.message}`); break; } }
    setBusy(false); note(`${mode === "bank" ? "Bank" : "UPI"} payments recorded ✓`); P.load();
  }
  async function hold(r: (typeof rows)[number]) { const reason = r.l.held ? "" : prompt(`Put ${r.name}'s pay on hold. Reason:`); if (reason === null) return; const { error } = await supabase().from("payroll_lines").update({ held: !r.l.held, hold_reason: reason ?? "" }).eq("id", r.l.id); if (error) { setErr(error.message); return; } P.load(); }
  async function voidPay(id: string) { if (!confirm("Void this payment? It stays in the list, marked void, and the project's salary expense goes down by that amount.")) return; const { error } = await supabase().from("payroll_payments").update({ voided_at: new Date().toISOString() }).eq("id", id); if (error) { setErr(error.message); return; } note("Voided ✓"); P.load(); }
  const upiLink = (r: (typeof rows)[number]) => `upi://pay?pa=${encodeURIComponent(r.snap.upi_id ?? "")}&pn=${encodeURIComponent(r.name)}&am=${r.left}&cu=INR&tn=${encodeURIComponent(label)}`;
  const nameOf = (id: string) => rows.find((r) => r.l.employee_id === id)?.name ?? d.names[id] ?? "?";
  const pill = (s: string) => <span className={`rounded-full px-2 py-0.5 text-[11px] ${s === "Paid" ? "bg-emerald-50 text-emerald-700" : s === "On hold" ? "bg-rose-50 text-rose-700" : s === "Part paid" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{s}</span>;
  const totals = rows.reduce((a, r) => ({ net: a.net + r.l.net, paid: a.paid + r.paid }), { net: 0, paid: 0 });

  return (
    <div className="space-y-4" data-pay>
      <div className="grid grid-cols-3 gap-3 text-center">{[["Net to pay", totals.net], ["Paid", totals.paid], ["Still to pay", Math.max(0, totals.net - totals.paid)]].map(([l, n]) => <div key={l as string} className="rounded-2xl bg-white border border-slate-200/80 p-3"><div className="text-xs text-slate-400">{l}</div><div className="text-lg font-medium tabular-nums">₹{inr(n as number)}</div></div>)}</div>
      <p className={`text-sm rounded-xl px-3 py-2 ${overdue ? "bg-rose-50 text-rose-800" : "bg-slate-50 text-slate-600"}`} data-window>{overdue ? <><b>{due.length}</b> {due.length === 1 ? "person is" : "people are"} still unpaid after the credit window.</> : <>Salary is credited between {win.from.slice(8)} and {win.to.slice(8)} {new Date(`${win.from}T00:00:00`).toLocaleDateString("en-IN", { month: "long" })}.</>}</p>
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
      <div className="flex flex-wrap gap-2"><button className="btn" onClick={bankCsv} disabled={!due.some((r) => r.l.pay_mode === "bank")}>⬇ Bank transfer CSV</button><button className="btn" onClick={upiCsv} disabled={!due.some((r) => r.l.pay_mode === "upi")}>⬇ UPI list CSV</button>
        <button className="btn btn-primary" disabled={busy || !due.some((r) => r.l.pay_mode === "bank")} onClick={() => payAll("bank")}>Mark all bank paid</button><button className="btn btn-primary" disabled={busy || !due.some((r) => r.l.pay_mode === "upi")} onClick={() => payAll("upi")}>Mark all UPI paid</button></div>
      <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm min-w-[50rem]"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="text-left p-2.5">Employee</th><th className="text-left">Pay by</th><th className="text-left">Payee details</th><th className="text-right">Net</th><th className="text-right">Paid</th><th className="text-right">Left</th><th className="text-left pl-3">Status</th><th></th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((r) => <>
          <tr key={r.l.id}><td className="p-2.5 font-medium">{r.name}<div className="text-xs font-normal text-slate-400">{r.snap.emp_no ?? ""}</div></td><td className="capitalize">{r.l.pay_mode}</td>
            <td className="text-xs text-slate-500">{r.l.pay_mode === "upi" ? (r.snap.upi_id || <span className="text-rose-700">UPI ID missing</span>) : r.l.pay_mode === "bank" ? (r.snap.account_no ? `${r.snap.bank_name ?? ""} · ${r.snap.account_no} · ${r.snap.ifsc ?? ""}` : <span className="text-rose-700">bank details missing</span>) : "cash"}</td>
            <td className="text-right tabular-nums">₹{inr(r.l.net)}</td><td className="text-right tabular-nums">₹{inr(r.paid)}</td><td className="text-right tabular-nums">₹{inr(r.left)}</td><td className="pl-3">{pill(r.status)}{r.l.held && r.l.hold_reason && <div className="text-[11px] text-slate-400">{r.l.hold_reason}</div>}</td>
            <td className="text-right pr-2 whitespace-nowrap space-x-2">{r.left > 0 && !r.l.held && <button className="btn !py-0.5 !px-2 !text-xs" onClick={() => setForm({ id: r.l.id, amount: String(r.left), paid_on: today, reference: "" })}>Pay</button>}
              {r.left > 0 && !r.l.held && r.l.pay_mode === "upi" && r.snap.upi_id && <a className="text-xs text-blue-700 underline" href={upiLink(r)}>UPI app</a>}
              <button className="text-xs text-slate-500 underline" onClick={() => hold(r)}>{r.l.held ? "Release" : "Hold"}</button>{r.snap && <a className="text-xs text-blue-700 underline" href={`/api/payslips/${r.l.id}`} target="_blank">Slip</a>}</td></tr>
          {form?.id === r.l.id && <tr key={r.l.id + "f"} className="bg-slate-50"><td colSpan={8} className="p-2.5"><div className="flex flex-wrap gap-2 items-end"><input className="inp !w-32" inputMode="decimal" aria-label="Payment amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /><input className="inp !w-40" type="date" aria-label="Paid on" value={form.paid_on} onChange={(e) => setForm({ ...form, paid_on: e.target.value })} /><input className="inp !w-48" placeholder="Reference / UTR" aria-label="Payment reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /><button className="btn btn-primary" disabled={busy} onClick={() => submit(r)}>Record payment</button><button className="btn" onClick={() => setForm(null)}>Cancel</button></div></td></tr>}</>)}</tbody></table></div>
      <section className="card space-y-2"><h2 className="font-medium">Payments</h2><p className="text-xs text-slate-400">Every payment adds to one Salaries &amp; wages expense for this month on the project; voiding a payment lowers it. Payments are never edited; a wrong one is voided and entered again.</p>
        <ul className="divide-y divide-slate-100 text-sm" data-payments>{d.payments.map((p) => <li key={p.id} className={`py-2 flex flex-wrap items-center gap-x-3 ${p.voided_at ? "text-slate-400 line-through" : ""}`}><span className="tabular-nums w-24">{p.paid_on}</span><span className="w-40 truncate">{nameOf(p.employee_id)}</span><span className="tabular-nums w-24">₹{inr(p.amount)}</span><span className="text-xs uppercase w-12">{p.mode}</span><span className="text-xs text-slate-400 flex-1 truncate">{p.reference}</span>{p.voided_at ? <span className="text-xs">void</span> : <button className="text-xs text-red-700 underline" onClick={() => voidPay(p.id)}>Void</button>}</li>)}</ul>
        {!d.payments.length && <p className="text-sm text-slate-400">No payments recorded yet.</p>}</section>
    </div>
  );
}
