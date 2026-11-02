"use client";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MEALS, type MealRate, type Person } from "@/lib/attendance";
import { buildBreakdown, fmtMoney, spanLabel, type MealRowLite } from "@/lib/mealStatement";

const dayLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

// "How was this amount worked out?" for one bill, or any stretch of days: the price of each meal, how many were taken, the total, and day by day.
// Closed until opened. The PDF for the vendor is built on the server from the same figures (/api/vendor-statement).
export default function BillBreakdown({ projectId, vendorId, from, to, rows, rates, people, billId, billed }: {
  projectId: string; vendorId: string; from: string; to: string; rows: MealRowLite[]; rates: MealRate[]; people: Person[]; billId?: string; billed?: number }) {
  const [open, setOpen] = useState(false); const [names, setNames] = useState(false); const [verified, setVerified] = useState<Record<string, "ok" | "incomplete">>({});
  const who = useMemo(() => new Map(people.map((p) => [p.employee_id, { name: p.full_name, emp_no: p.emp_no }])), [people]);
  const b = useMemo(() => (open ? buildBreakdown({ vendorId, from, to, rows, rates, people: who }) : null), [open, vendorId, from, to, rows, rates, who]);
  async function toggle(isOpen: boolean) {
    setOpen(isOpen); if (!isOpen) return;
    const { data } = await supabase().from("attendance_days").select("work_date, verified_at, verified_incomplete").eq("project_id", projectId).gte("work_date", from).lte("work_date", to).not("verified_at", "is", null);
    setVerified(Object.fromEntries(((data || []) as { work_date: string; verified_incomplete?: boolean }[]).map((d) => [d.work_date, d.verified_incomplete ? "incomplete" : "ok"])));
  }
  const q = new URLSearchParams({ project: projectId, vendor: vendorId, from, to }); if (billId) q.set("bill", billId); if (names) q.set("names", "1");
  const diff = b && billed !== undefined ? billed - b.amount : 0;
  return (
    <details className="group rounded-lg bg-slate-50 border border-slate-200/70" onToggle={(e) => toggle((e.currentTarget as HTMLDetailsElement).open)} data-breakdown>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-3 py-2 text-xs text-slate-600 flex items-center gap-2"><span className="inline-block transition-transform -rotate-90 group-open:rotate-0">▾</span>How was this amount worked out?</summary>
      {b && <div className="px-3 pb-3 space-y-3 text-sm">
        <div className="overflow-x-auto"><table className="w-full min-w-[26rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Meal</th><th className="text-left">Days</th><th className="text-right">Price</th><th className="text-right">Meals</th><th className="text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-slate-200/70">{b.lines.map((l, i) => <tr key={i}><td className="py-1">{l.label}</td><td className="text-slate-500">{spanLabel(l.first, l.last)}</td><td className="text-right tabular-nums">{l.price === null ? <span className="text-amber-700">no price</span> : `₹${fmtMoney(l.price)}`}</td><td className="text-right tabular-nums">{l.count}</td><td className="text-right tabular-nums">₹{fmtMoney(l.amount)}</td></tr>)}
            <tr className="font-medium"><td className="py-1.5" colSpan={3}>Total</td><td className="text-right tabular-nums">{b.count}</td><td className="text-right tabular-nums">₹{fmtMoney(b.amount)}</td></tr></tbody></table></div>
        {b.unpriced > 0 && <p className="text-xs text-amber-800">{b.unpriced} meal{b.unpriced === 1 ? " has" : "s have"} no price set for its day, so {b.unpriced === 1 ? "it is" : "they are"} not in the amount. Set the price under Vendors &amp; prices.</p>}
        {billed !== undefined && <p className="text-xs">Vendor billed <b>₹{fmtMoney(billed)}</b> · meals come to <b>₹{fmtMoney(b.amount)}</b> · {Math.abs(diff) < 1 ? <span className="text-emerald-700">they match</span> : <span className={diff > 0 ? "text-rose-700 font-medium" : "text-emerald-700"}>{diff > 0 ? `charged ₹${fmtMoney(diff)} more than the meals recorded` : `charged ₹${fmtMoney(-diff)} less than the meals recorded`}</span>}</p>}
        <details className="rounded-md border border-slate-200 bg-white"><summary className="cursor-pointer px-2.5 py-1.5 text-xs text-slate-600">Day by day ({b.days.length} days)</summary>
          <div className="overflow-x-auto px-2.5 pb-2"><table className="w-full min-w-[26rem] text-sm"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Date</th>{MEALS.map((m) => <th key={m.key} className="text-right">{m.label}</th>)}<th className="text-right">Amount</th><th className="text-right">Day closed</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{b.days.map((d) => <tr key={d.date}><td className="py-1 whitespace-nowrap">{dayLabel(d.date)}</td>{d.counts.map((n, i) => <td key={i} className="text-right tabular-nums">{n || "—"}</td>)}<td className="text-right tabular-nums">₹{fmtMoney(d.amount)}</td><td className="text-right text-xs">{verified[d.date] === "ok" ? <span className="text-emerald-700">✓ verified</span> : verified[d.date] === "incomplete" ? <span className="text-amber-700">verified, incomplete</span> : <span className="text-slate-400">not verified</span>}</td></tr>)}</tbody></table></div></details>
        <details className="rounded-md border border-slate-200 bg-white"><summary className="cursor-pointer px-2.5 py-1.5 text-xs text-slate-600">Who ate (names)</summary>
          <div className="px-2.5 pb-2 space-y-2 max-h-80 overflow-y-auto">{b.register.map((d) => <div key={d.date}><div className="text-xs font-medium text-slate-700">{dayLabel(d.date)}</div>{d.meals.map((m) => <div key={m.label} className="text-xs text-slate-600"><span className="text-slate-400">{m.label} ({m.people.length}):</span> {m.people.map((p) => p.name).join(", ")}</div>)}</div>)}</div></details>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <a className={`btn ${b.count ? "" : "pointer-events-none opacity-50"}`} href={`/api/vendor-statement?${q}`} target="_blank">⬇ PDF for the vendor</a>
          <label className="text-xs text-slate-500 flex items-center gap-1.5"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} />Include names of who ate</label></div>
      </div>}
    </details>
  );
}
