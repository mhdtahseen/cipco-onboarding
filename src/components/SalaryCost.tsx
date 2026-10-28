"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { calcSalary } from "@/lib/salary";
import { monthName } from "@/lib/payroll";
import type { Employee } from "@/lib/types";

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

// The project overview's salary cost: CTC of salaried staff, the estimated monthly cost of daily-wage workers, the total cost to the company,
// and where the latest payroll stands.
export default function SalaryCost({ projectId, people }: { projectId: string; people: Employee[] }) {
  const [pay, setPay] = useState<{ month: string; status: string; net: number; paid: number } | null>(null);
  useEffect(() => { (async () => {
    try {
      const sb = supabase(); const { data: run, error } = await sb.from("payroll_runs").select("*").eq("project_id", projectId).order("pay_month", { ascending: false }).limit(1).maybeSingle(); if (error || !run) return;
      const [l, p] = await Promise.all([sb.from("payroll_lines").select("net").eq("run_id", run.id), sb.from("payroll_payments").select("amount").eq("run_id", run.id).is("voided_at", null)]);
      setPay({ month: run.pay_month.slice(0, 7), status: run.status, net: ((l.data || []) as { net: number }[]).reduce((s, x) => s + Number(x.net), 0), paid: ((p.data || []) as { amount: number }[]).reduce((s, x) => s + Number(x.amount), 0) });
    } catch { /* payroll migration not run yet */ }
  })(); }, [projectId]);
  const today = new Date().toISOString().slice(0, 10);
  const x = useMemo(() => {
    const active = people.filter((e) => !e.left_on || e.left_on >= today); const rows = active.map((e) => ({ e, c: calcSalary((e.salary ?? {}) as any, e.gender) }));
    const sal = rows.filter((r) => r.c && !r.c.daily), dw = rows.filter((r) => r.c?.daily), none = rows.filter((r) => !r.c);
    const by: Record<string, { n: number; cost: number }> = {}; rows.forEach((r) => { if (!r.c) return; const k = r.e.department || "No department"; (by[k] ??= { n: 0, cost: 0 }).n++; by[k].cost += r.c.monthly.ctc; });
    return { sal, dw, none, salMonthly: sal.reduce((s, r) => s + r.c!.monthly.ctc, 0), salAnnual: sal.reduce((s, r) => s + r.c!.annual.ctc, 0), dwMonthly: dw.reduce((s, r) => s + r.c!.monthly.ctc, 0), by: Object.entries(by).sort((a, b) => b[1].cost - a[1].cost) };
  }, [people, today]);
  const card = (l: string, v: string, sub?: string) => <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-medium tabular-nums">{v}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
  return (
    <div className="card space-y-3" data-salary-cost><div className="flex items-center gap-2"><h3 className="font-semibold">Salary cost</h3><Link className="btn !py-1 ml-auto" href="/payroll">Payroll →</Link></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {card("Salaried CTC / month", `₹${inr(x.salMonthly)}`, `${x.sal.length} salaried · ₹${inr(x.salAnnual)} a year`)}
        {card("Daily wage (estimated) / month", `₹${inr(x.dwMonthly)}`, `${x.dw.length} on daily wage · rate × usual working days`)}
        {card("Total cost to company / month", `₹${inr(x.salMonthly + x.dwMonthly)}`, "incl. employer PF and ESI")}
        {pay ? card(`${monthName(pay.month)} payroll`, pay.status === "approved" ? `₹${inr(pay.paid)} paid` : "Draft", pay.status === "approved" ? `of ₹${inr(pay.net)} net · ₹${inr(Math.max(0, pay.net - pay.paid))} still to pay` : "not approved yet") : card("Payroll", "Not run yet", "calculated on the last day of the month")}</div>
      {x.none.length > 0 && <p className="text-xs text-amber-800">{x.none.length} {x.none.length === 1 ? "person has" : "people have"} no salary set, so {x.none.length === 1 ? "is" : "are"} not counted: {x.none.slice(0, 5).map((r) => r.e.full_name).join(", ")}{x.none.length > 5 ? "…" : ""}.</p>}
      {x.by.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Department</th><th className="text-right">People</th><th className="text-right">Cost / month</th></tr></thead><tbody className="divide-y divide-slate-100">{x.by.map(([k, v]) => <tr key={k}><td className="py-1.5">{k}</td><td className="text-right tabular-nums">{v.n}</td><td className="text-right tabular-nums">₹{inr(v.cost)}</td></tr>)}</tbody></table></div>}
    </div>
  );
}
