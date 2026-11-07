"use client";
import { Fragment, useMemo, useState } from "react";
import { istToday } from "@/lib/attendance";
import { CATEGORY_LABEL } from "@/lib/paymentsDueLabels";
import type { PaymentsDue } from "@/lib/paymentsDueData";
import { monthGrid, titleOf, viewOf, type Lens, type PayeeView, type Scope, type View } from "@/lib/paymentsDueView";

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const noBank = (v: PayeeView) => v.pending > 0 && v.payee.mode !== "portal" && v.payee.mode !== "cash" && !v.payee.bank;
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const addMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const SCOPES: [Scope, string][] = [["now", "Pay now"], ["month", "By month"], ["all", "All time"]];

// The Due tab of Expenses (Admin and Viewer): what the company owes, project by project. It opens on "Pay now": everything unpaid that is overdue or falls due this month (last month's meals, transport and salaries, this month's
// rent in advance). Choose a month, or all time, to look at it differently. "Running" costs (this month so far, not billed yet) are separate and only shown when you ask.
// Untick anyone to leave them out, then download the PDF: it is built on the server from the same figures and the same choices.
export default function DueView({ d, err, project }: { d: PaymentsDue | null; err: string; project: string }) {
  const today = istToday(); const cur = today.slice(0, 7);
  const [off, setOff] = useState<Set<string>>(new Set()); const [openRow, setOpenRow] = useState<Set<string>>(new Set()); const [grid, setGrid] = useState(false);
  const [scope, setScope] = useState<Scope>("now"); const [month, setMonth] = useState(cur); const [lens, setLens] = useState<Lens>("due"); const [running, setRunning] = useState(false); const [includePaid, setIncludePaid] = useState(false);
  const view: View = { scope, month, lens, running, includePaid, today };
  const shown = useMemo(() => (d?.projects ?? []).filter((p) => !project || p.id === project), [d, project]);
  const sections = useMemo(() => shown.map((p) => ({ p, views: p.payees.map((x) => viewOf(x, { scope, month, lens, running, includePaid, today })).filter(Boolean) as PayeeView[] })).filter((s) => s.views.length), [shown, scope, month, lens, running, includePaid, today]);
  const chosen = sections.flatMap((s) => s.views).filter((v) => !off.has(v.payee.key));
  const tot = chosen.reduce((a, v) => ({ total: a.total + v.total, paid: a.paid + v.paid, pending: a.pending + v.pending, advance: a.advance + v.advance, overdue: a.overdue + v.overdue, running: a.running + v.runningTotal }), { total: 0, paid: 0, pending: 0, advance: 0, overdue: 0, running: 0 });
  const g = useMemo(() => monthGrid(shown.flatMap((p) => p.payees)), [shown]);
  const toggle = (k: string) => setOff((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const setMany = (keys: string[], on: boolean) => setOff((s) => { const n = new Set(s); keys.forEach((k) => (on ? n.delete(k) : n.add(k))); return n; });
  const q = new URLSearchParams({ scope, month, lens }); if (running) q.set("running", "1"); if (includePaid) q.set("paid", "1"); if (project) q.set("project", project); if (off.size) q.set("exclude", [...off].join(","));
  const card = (l: string, v: number, c = "", sub?: string) => <div className="card !p-3"><div className="text-xs text-slate-400">{l}</div><div className={`text-xl font-semibold tabular-nums ${c}`}>₹{inr(v)}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
  const stateChip = (s: string) => s === "running" ? <span className="rounded-full bg-sky-50 text-sky-700 px-1.5 py-0.5 text-[10px]">running</span> : s === "draft" ? <span className="rounded-full bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[10px]">draft</span> : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[16rem]"><p className="text-sm text-slate-500">{titleOf(view)}. Who to pay, how much, and how to pay them, project by project. Untick anyone to leave them out of the report.</p></div>
        <a className={`btn btn-primary keep ${chosen.length ? "" : "pointer-events-none opacity-50"}`} href={`/api/payments-due/pdf?${q}`} target="_blank">⬇ Download PDF report</a>
      </div>
      {err && <p className="warn">{err}</p>}
      {!d && !err && <div className="h-40 rounded-xl bg-slate-100 animate-pulse" />}
      {d && <>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="What to show" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">{SCOPES.map(([k, l]) => <button key={k} role="tab" aria-selected={scope === k} className={`px-3 py-1.5 text-sm rounded-md ${scope === k ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => setScope(k)}>{l}</button>)}</div>
          {scope === "month" && <><button className="btn btn-sm" aria-label="Previous month" onClick={() => setMonth(addMonth(month, -1))}>‹</button><input type="month" className="inp !w-40" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /><button className="btn btn-sm" aria-label="Next month" onClick={() => setMonth(addMonth(month, 1))}>›</button>
            <div className="flex gap-3 text-sm ml-1"><label className="flex items-center gap-1.5"><input type="radio" name="lens" checked={lens === "due"} onChange={() => setLens("due")} />Due in the month</label><label className="flex items-center gap-1.5"><input type="radio" name="lens" checked={lens === "cost"} onChange={() => setLens("cost")} />Cost month</label></div></>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={running} onChange={(e) => setRunning(e.target.checked)} />Show running costs (not billed yet)</label>
          {scope !== "now" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includePaid} onChange={(e) => setIncludePaid(e.target.checked)} />Include fully paid</label>}
          <span className="text-xs text-slate-400">{chosen.length} of {sections.flatMap((s) => s.views).length} included</span></div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{card("To pay", tot.pending, tot.pending ? "text-rose-700" : "text-emerald-700", `${chosen.filter((v) => v.pending > 0).length} payees waiting`)}{card("Overdue", tot.overdue, tot.overdue ? "text-rose-700" : "text-emerald-700", tot.overdue ? "past their due date" : "nothing late")}{running ? card("Running, not billed yet", tot.running, "text-sky-700", "building up this month") : card("Paid in this view", tot.paid, "text-emerald-700", `of ₹${inr(tot.total)} billed`)}{card("Advance paid", tot.advance, "text-emerald-700", "credit against future bills")}</div>

        <section className="card !p-3 space-y-2"><button className="text-sm font-medium text-left" onClick={() => setGrid(!grid)} aria-expanded={grid}>{grid ? "▾" : "▸"} Month by month <span className="text-xs font-normal text-slate-400">what is unpaid, by the month each cost belongs to</span></button>
          {grid && (g.rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm min-w-[32rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Kind</th>{g.months.map((m) => <th key={m} className="text-right">{monthLabel(m)}</th>)}<th className="text-right">Unpaid</th>{running && <th className="text-right text-sky-700">Running</th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">{g.rows.map((r) => <tr key={r.category}><td className="py-1.5">{CATEGORY_LABEL[r.category]}</td>{g.months.map((m) => <td key={m} className="text-right tabular-nums">{r.cells[m] ? <button className="underline decoration-dotted" title="Show this month's costs" onClick={() => { setScope("month"); setLens("cost"); setMonth(m); }}>₹{inr(r.cells[m])}</button> : <span className="text-slate-300">–</span>}</td>)}<td className="text-right tabular-nums font-medium">₹{inr(r.total)}</td>{running && <td className="text-right tabular-nums text-sky-700">{r.running ? `₹${inr(r.running)}` : "–"}</td>}</tr>)}
              <tr className="font-medium"><td className="py-1.5">Total</td>{g.months.map((m) => <td key={m} className="text-right tabular-nums">₹{inr(g.rows.reduce((s, r) => s + (r.cells[m] ?? 0), 0))}</td>)}<td className="text-right tabular-nums">₹{inr(g.rows.reduce((s, r) => s + r.total, 0))}</td>{running && <td className="text-right tabular-nums text-sky-700">₹{inr(g.rows.reduce((s, r) => s + r.running, 0))}</td>}</tr></tbody></table></div> : <p className="text-sm text-slate-400">Nothing is unpaid.</p>)}</section>

        {!sections.length && <p className="card text-center text-sm text-slate-500">{scope === "now" ? "Nothing needs paying right now." : "Nothing matches this view."}</p>}
        {sections.map(({ p, views }) => { const keys = views.map((v) => v.payee.key), st = views.filter((v) => !off.has(v.payee.key)).reduce((a, v) => ({ total: a.total + v.total, paid: a.paid + v.paid, pending: a.pending + v.pending, run: a.run + v.runningTotal }), { total: 0, paid: 0, pending: 0, run: 0 });
          return <section key={p.id} className="card !p-3 space-y-2" data-project>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><h2 className="font-semibold">{p.name}</h2><span className="text-xs text-slate-500">Billed ₹{inr(st.total)} · Paid ₹{inr(st.paid)} · <b className={st.pending ? "text-rose-700" : "text-emerald-700"}>To pay ₹{inr(st.pending)}</b>{running && st.run > 0 ? <span className="text-sky-700"> · running ₹{inr(st.run)}</span> : null}</span>
              <span className="sm:ml-auto text-xs"><button className="text-blue-700 underline" onClick={() => setMany(keys, true)}>all</button> · <button className="text-blue-700 underline" onClick={() => setMany(keys, false)}>none</button></span></div>
            <div className="overflow-x-auto"><table className="w-full text-sm min-w-[46rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="w-8"></th><th className="text-left py-1">Pay to</th><th className="text-left">Kind</th><th className="text-right">Billed</th><th className="text-right">Paid</th><th className="text-right">To pay</th><th className="text-left pl-3">Due</th><th className="text-left pl-3">How to pay</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{views.map((v) => { const x = v.payee; const first = v.items.filter((i) => i.state !== "running" && i.total - i.paid > 0.004 && i.dueOn).map((i) => i.dueOn!).sort()[0]; const isOpen = openRow.has(x.key); return (<Fragment key={x.key}>
                <tr className={off.has(x.key) ? "opacity-40" : ""}>
                  <td className="py-2"><input type="checkbox" className="h-4 w-4" aria-label={`Include ${x.name}`} checked={!off.has(x.key)} onChange={() => toggle(x.key)} /></td>
                  <td><div className="font-medium">{x.name}{x.draft && <span className="ml-1.5 rounded-full bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[10px] font-normal" title="From a payroll that is not approved yet">draft payroll</span>}</div><div className="text-xs text-slate-400">{x.forWhat}</div>{v.items.length > 0 && <button className="text-[11px] text-blue-700 underline" onClick={() => setOpenRow((s) => { const n = new Set(s); n.has(x.key) ? n.delete(x.key) : n.add(x.key); return n; })}>{isOpen ? "hide" : "show"} {v.items.length} item{v.items.length === 1 ? "" : "s"}</button>}</td>
                  <td className="text-xs text-slate-500">{CATEGORY_LABEL[x.category]}</td>
                  <td className="text-right tabular-nums">₹{inr(v.total)}</td><td className="text-right tabular-nums text-emerald-700">₹{inr(v.paid)}</td>
                  <td className="text-right tabular-nums"><b className={v.pending ? "text-rose-700" : "text-emerald-700"}>₹{inr(v.pending)}</b>{v.advance > 0 && <div className="text-[11px] text-emerald-700">advance ₹{inr(v.advance)}</div>}{running && v.runningTotal > 0 && <div className="text-[11px] text-sky-700">+ ₹{inr(v.runningTotal)} running</div>}</td>
                  <td className="pl-3 text-xs whitespace-nowrap">{v.pending > 0 && first ? (first < today ? <span className="text-rose-700">{dayDiff(first, today)} day{dayDiff(first, today) === 1 ? "" : "s"} overdue</span> : <span className="text-slate-600">by {dmy(first)}</span>) : <span className="text-slate-300">–</span>}</td>
                  <td className="pl-3 text-xs text-slate-600">{x.mode === "portal" ? "Government portal (challan)" : x.mode === "cash" ? "Cash" : noBank(v) ? <span className="text-amber-800">⚠ Bank details missing</span> : x.bank ? <>{[x.bank.bank, x.bank.accountNo && `A/c ${x.bank.accountNo}`, x.bank.ifsc].filter(Boolean).join(" · ")}{x.bank.upi ? ` · UPI ${x.bank.upi}` : ""}</> : "—"}</td></tr>
                {isOpen && <tr className="bg-slate-50/60"><td /><td colSpan={7} className="p-2.5"><table className="w-full text-xs"><tbody>{v.items.map((i, n) => <tr key={n} className={i.state === "running" ? "text-sky-800" : ""}><td className="py-0.5 pr-3">{i.label} {stateChip(i.state)}</td><td className="text-slate-400 pr-3 whitespace-nowrap">{i.state === "running" ? "not billed yet" : i.dueOn ? `due ${dmy(i.dueOn)}` : ""}</td><td className="text-right tabular-nums pr-3">₹{inr(i.total)}</td><td className="text-right tabular-nums text-emerald-700 pr-3">{i.state === "running" ? "" : `paid ₹${inr(Math.min(i.paid, i.total))}`}</td><td className="text-right tabular-nums">{i.state === "running" ? "" : i.total - i.paid > 0.004 ? <b className={i.dueOn && i.dueOn < today ? "text-rose-700" : ""}>₹{inr(i.total - i.paid)} to pay</b> : "paid"}</td></tr>)}</tbody></table></td></tr>}</Fragment>); })}</tbody></table></div>
          </section>; })}
        {d.notIncluded.length > 0 && <section className="card !p-3 space-y-1 border-amber-200 bg-amber-50"><h2 className="text-sm font-medium text-amber-900">Not in these totals</h2>
          <ul className="text-xs text-amber-900 space-y-0.5">{d.notIncluded.map((n, i) => <li key={i}>• {n.label}{n.amount !== undefined ? ` · ₹${inr(n.amount)}` : ""}</li>)}</ul></section>}
        <p className="text-xs text-slate-400"><b>Pay now</b> = unpaid and overdue or due this month. Food, transport, equipment and meals bills fall due on the 1st to 4th of the month after they cover; rent on the 1st; salaries on the 1st to 4th; PF and ESI on their statutory dates; gas on the vendor's terms. <b>Running</b> costs are this month so far and not yet billed: they are not owed until billed. Payments for food, transport, gas and equipment are applied to the oldest bill first. Payments beyond what was billed show as an advance. Add bank details where each payee is set up; employees' come from their record.</p>
      </>}
    </div>
  );
}
