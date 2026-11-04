"use client";
import { useEffect, useMemo, useState } from "react";
import { useRole } from "@/lib/roles";
import { istToday } from "@/lib/attendance";
import { CATEGORY_LABEL } from "@/lib/paymentsDueLabels";
import type { PaymentsDue, KeyedPayee } from "@/lib/paymentsDueData";

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pend = (p: KeyedPayee) => Math.max(0, p.total - p.paid), adv = (p: KeyedPayee) => Math.max(0, p.paid - p.total);
const noBank = (p: KeyedPayee) => pend(p) > 0 && p.mode !== "portal" && p.mode !== "cash" && !p.bank;
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);

// Admin only: everything the company owes, project by project, in one place: total billed, paid so far (advances shown apart) and pending.
// Untick anyone to leave them out, then download the PDF. The PDF is built on the server from the same figures (/api/payments-due/pdf).
export default function PaymentsDuePage() {
  const { see: admin } = useRole(); const today = istToday();
  const [d, setD] = useState<PaymentsDue | null>(null); const [err, setErr] = useState(""); const [off, setOff] = useState<Set<string>>(new Set()); const [project, setProject] = useState("");
  useEffect(() => { if (!admin) return; (async () => { const r = await fetch("/api/payments-due"); if (!r.ok) { setErr(await r.text()); return; } setD(await r.json()); })(); }, [admin]);
  const shown = useMemo(() => (d?.projects ?? []).filter((p) => !project || p.id === project), [d, project]);
  const chosen = useMemo(() => shown.flatMap((p) => p.payees).filter((x) => !off.has(x.key)), [shown, off]);
  const tot = chosen.reduce((a, p) => ({ total: a.total + p.total, paid: a.paid + Math.min(p.paid, p.total), pending: a.pending + pend(p), advance: a.advance + adv(p) }), { total: 0, paid: 0, pending: 0, advance: 0 });
  const toggle = (k: string) => setOff((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const setMany = (keys: string[], on: boolean) => setOff((s) => { const n = new Set(s); keys.forEach((k) => (on ? n.delete(k) : n.add(k))); return n; });
  const q = new URLSearchParams(); if (project) q.set("project", project); if (off.size) q.set("exclude", [...off].join(","));
  const card = (l: string, v: number, c = "", sub?: string) => <div className="card !p-3"><div className="text-xs text-slate-400">{l}</div><div className={`text-xl font-semibold tabular-nums ${c}`}>₹{inr(v)}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
  if (!admin) return <p className="text-slate-500">Only admins can see payments due.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[16rem]"><h1 className="text-xl font-semibold">Payments due</h1><p className="text-sm text-slate-500">Who to pay, how much, and how to pay them, project by project. Untick anyone to leave them out of the report.</p></div>
        <a className={`btn btn-primary ${chosen.length ? "" : "pointer-events-none opacity-50"}`} href={`/api/payments-due/pdf?${q}`} target="_blank">⬇ Download PDF report</a>
      </div>
      {err && <p className="warn">{err}</p>}
      {!d && !err && <div className="h-40 rounded-xl bg-slate-100 animate-pulse" />}
      {d && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{card("Total billed", tot.total)}{card("Paid so far", tot.paid, "text-emerald-700", tot.advance ? `plus ₹${inr(tot.advance)} advance (credit)` : undefined)}{card("Still to pay", tot.pending, tot.pending ? "text-rose-700" : "text-emerald-700", `${chosen.filter((p) => pend(p) > 0).length} payees waiting`)}{card("Advance paid", tot.advance, "text-emerald-700", "credit against future bills")}</div>
        <div className="flex flex-wrap items-center gap-2"><select className="inp !w-56" aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)}><option value="">All projects</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <span className="text-xs text-slate-400">{chosen.length} of {shown.flatMap((p) => p.payees).length} included</span></div>
        {!d.projects.length && <p className="card text-center text-sm text-slate-500">Nothing is due right now.</p>}
        {shown.map((p) => { const keys = p.payees.map((x) => x.key), st = p.payees.filter((x) => !off.has(x.key)).reduce((a, x) => ({ total: a.total + x.total, paid: a.paid + Math.min(x.paid, x.total), pending: a.pending + pend(x) }), { total: 0, paid: 0, pending: 0 });
          return <section key={p.id} className="card !p-3 space-y-2" data-project>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><h2 className="font-semibold">{p.name}</h2><span className="text-xs text-slate-500">Billed ₹{inr(st.total)} · Paid ₹{inr(st.paid)} · <b className={st.pending ? "text-rose-700" : "text-emerald-700"}>Pending ₹{inr(st.pending)}</b></span>
              <span className="sm:ml-auto text-xs"><button className="text-blue-700 underline" onClick={() => setMany(keys, true)}>all</button> · <button className="text-blue-700 underline" onClick={() => setMany(keys, false)}>none</button></span></div>
            <div className="overflow-x-auto"><table className="w-full text-sm min-w-[44rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="w-8"></th><th className="text-left py-1">Pay to</th><th className="text-left">Kind</th><th className="text-right">Billed</th><th className="text-right">Paid</th><th className="text-right">Pending</th><th className="text-left pl-3">How to pay</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{p.payees.map((x) => <tr key={x.key} className={off.has(x.key) ? "opacity-40" : ""}>
                <td className="py-2"><input type="checkbox" className="h-4 w-4" aria-label={`Include ${x.name}`} checked={!off.has(x.key)} onChange={() => toggle(x.key)} /></td>
                <td><div className="font-medium">{x.name}{x.draft && <span className="ml-1.5 rounded-full bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[10px] font-normal" title="From a payroll that is not approved yet">draft payroll</span>}</div><div className="text-xs text-slate-400">{x.forWhat}</div></td><td className="text-xs text-slate-500">{CATEGORY_LABEL[x.category]}</td>
                <td className="text-right tabular-nums">₹{inr(x.total)}</td><td className="text-right tabular-nums text-emerald-700">₹{inr(Math.min(x.paid, x.total))}</td>
                <td className="text-right tabular-nums"><b className={pend(x) ? "text-rose-700" : "text-emerald-700"}>₹{inr(pend(x))}</b>{adv(x) > 0 && <div className="text-[11px] text-emerald-700">advance ₹{inr(adv(x))}</div>}{pend(x) > 0 && x.oldestDue && x.oldestDue < today && <div className="text-[11px] text-rose-700">{dayDiff(x.oldestDue, today)} days overdue</div>}</td>
                <td className="pl-3 text-xs text-slate-600">{x.mode === "portal" ? "Government portal (challan)" : x.mode === "cash" ? "Cash" : noBank(x) ? <span className="text-amber-800">⚠ Bank details missing</span> : x.bank ? <>{[x.bank.bank, x.bank.accountNo && `A/c ${x.bank.accountNo}`, x.bank.ifsc].filter(Boolean).join(" · ")}{x.bank.upi ? ` · UPI ${x.bank.upi}` : ""}</> : "—"}</td></tr>)}</tbody></table></div>
          </section>; })}
        {d.notIncluded.length > 0 && <section className="card !p-3 space-y-1 border-amber-200 bg-amber-50"><h2 className="text-sm font-medium text-amber-900">Not in these totals</h2>
          <ul className="text-xs text-amber-900 space-y-0.5">{d.notIncluded.map((n, i) => <li key={i}>• {n.label}{n.amount !== undefined ? ` · ₹${inr(n.amount)}` : ""}</li>)}</ul></section>}
        <p className="text-xs text-slate-400">Food: approved bills only. Transport, accommodation and salaries follow each tab's own balance. Payments made beyond what has been billed show as an advance. Fully paid payees are not listed. Add bank details where each payee is set up (vendors, vehicles, rooms); employees' come from their record.</p>
      </>}
    </div>
  );
}
