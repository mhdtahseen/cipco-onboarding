"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase/client";
import { addMonth, monthEnd, monthStart, type Adjustment, type DayStatus, type OwedAdvance, type PayEmp, type Revision } from "./payroll";

export type Run = { id: string; project_id: string; pay_month: string; status: "draft" | "approved"; note: string; approved_by: string | null; approved_at: string | null };
export type Line = { id: string; run_id: string; employee_id: string; project_id: string; kind: "salaried" | "daily"; days_in_month: number; paid_days: number; lop_days: number; gross: number; deductions: number; net: number; pf_emp: number; pf_er: number; pf_admin: number; esi_emp: number; esi_er: number; pt: number; er_total: number; pay_mode: string; items: { kind: "earning" | "deduction"; label: string; amount: number; advance_id?: string; note?: string }[]; snapshot: Record<string, any>; held: boolean; hold_reason: string };
export type Payment = { id: string; line_id: string; run_id: string; employee_id: string; project_id: string; amount: number; mode: string; paid_on: string; reference: string; voided_at: string | null };
export type AdjRow = Adjustment & { employee_id: string; pay_month: string; project_id: string; voided_at: string | null };
export type AdvanceRow = { id: string; employee_id: string; project_id: string; amount: number; given_on: string; instalment: number; note: string; voided_at: string | null };
export type StatPay = { id: string; project_id: string; pay_month: string; kind: "pf" | "esi" | "pt" | "tds" | "other"; amount: number; paid_on: string; challan_no: string; note: string; voided_at: string | null };
const num = <T extends Record<string, any>>(o: T, keys: string[]): T => { const c: Record<string, any> = { ...o }; keys.forEach((k) => { if (c[k] !== null && c[k] !== undefined) c[k] = Number(c[k]); }); return c as T; };

// Everything the payroll screens need for one project and month: the people, their attendance (this month and the previous month's tail),
// salary history, adjustments, advances, the saved run with its lines and payments, and statutory remittances.
export function usePayroll(pid: string, ym: string) {
  const [d, setD] = useState<{ emps: PayEmp[]; att: Record<string, Record<string, DayStatus>>; revs: Record<string, Revision[]>; adjs: AdjRow[]; advances: AdvanceRow[]; recovered: Record<string, number>; run: Run | null; lines: Line[]; payments: Payment[]; stat: StatPay[]; names: Record<string, string> } | null>(null);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState("");
  const load = useCallback(async () => {
    if (!pid) return; const sb = supabase(); setErr("");
    const from = monthStart(addMonth(ym, -1)), to = monthEnd(ym);
    const [emp, runQ, advQ, adjQ, statQ, recQ] = await Promise.all([
      sb.from("employees").select("*").eq("project_id", pid).neq("outcome", "rejected"),
      sb.from("payroll_runs").select("*").eq("project_id", pid).eq("pay_month", monthStart(ym)).maybeSingle(),
      sb.from("employee_advances").select("*").eq("project_id", pid).order("given_on", { ascending: false }),
      sb.from("payroll_adjustments").select("*").eq("project_id", pid).eq("pay_month", monthStart(ym)).is("voided_at", null),
      sb.from("statutory_payments").select("*").eq("project_id", pid).order("paid_on", { ascending: false }),
      sb.from("advance_recoveries").select("*"),
    ]);
    const bad = emp.error || runQ.error || advQ.error || adjQ.error || statQ.error || recQ.error; if (bad) { setErr(bad.message + " — has the accountability SQL migration been run?"); setLoading(false); return; }
    let emps = (emp.data || []) as PayEmp[];
    // attendance on this project over the window (this month and last month's tail), in pages of 1000
    const rows: { employee_id: string; work_date: string; status: DayStatus }[] = [];
    for (let f = 0; ; f += 1000) { const { data, error } = await sb.from("attendance").select("employee_id, work_date, status").eq("project_id", pid).gte("work_date", from).lte("work_date", to).order("work_date").range(f, f + 999); if (error) { setErr(error.message); break; } rows.push(...((data || []) as typeof rows)); if (!data || data.length < 1000) break; }
    const have = new Set(emps.map((e) => e.id)); const extra = [...new Set(rows.map((r) => r.employee_id))].filter((i) => !have.has(i));   // people who worked here but have since moved project
    if (extra.length) { const { data } = await sb.from("employees").select("*").in("id", extra); emps = [...emps, ...((data || []) as PayEmp[])]; }
    const att: Record<string, Record<string, DayStatus>> = {}; rows.forEach((r) => { if (r.status) (att[r.employee_id] ??= {})[r.work_date] = r.status; });
    const ids = emps.map((e) => e.id); const revs: Record<string, Revision[]> = {};
    if (ids.length) { const { data } = await sb.from("salary_history").select("employee_id, effective_from, salary").in("employee_id", ids); ((data || []) as { employee_id: string; effective_from: string; salary: any }[]).forEach((r) => (revs[r.employee_id] ??= []).push({ effective_from: r.effective_from, salary: r.salary })); }
    const run = (runQ.data as Run | null) ?? null; let lines: Line[] = [], payments: Payment[] = [];
    if (run) { const [l, p] = await Promise.all([sb.from("payroll_lines").select("*").eq("run_id", run.id), sb.from("payroll_payments").select("*").eq("run_id", run.id).order("paid_on", { ascending: false })]); lines = ((l.data || []) as Line[]).map((x) => num(x, ["paid_days", "lop_days", "gross", "deductions", "net", "pf_emp", "pf_er", "pf_admin", "esi_emp", "esi_er", "pt", "er_total"])); payments = ((p.data || []) as Payment[]).map((x) => num(x, ["amount"])); }
    const recovered: Record<string, number> = {}; ((recQ.data || []) as { advance_id: string; amount: number }[]).forEach((r) => (recovered[r.advance_id] = (recovered[r.advance_id] || 0) + Number(r.amount)));
    const names: Record<string, string> = {}; emps.forEach((e) => (names[e.id] = e.full_name));
    setD({ emps, att, revs, adjs: ((adjQ.data || []) as AdjRow[]).map((x) => num(x, ["amount", "days"])), advances: ((advQ.data || []) as AdvanceRow[]).map((x) => num(x, ["amount", "instalment"])), recovered, run, lines, payments, stat: ((statQ.data || []) as StatPay[]).map((x) => num(x, ["amount"])), names }); setLoading(false);
  }, [pid, ym]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  /** What is still owed on each live advance of a person (the recovery in an approved run is already counted). */
  const owedFor = (employeeId: string): OwedAdvance[] => (d?.advances ?? []).filter((a) => a.employee_id === employeeId && !a.voided_at).map((a) => ({ id: a.id, instalment: Number(a.instalment), owed: Number(a.amount) - (d!.recovered[a.id] || 0), note: a.note })).filter((a) => a.owed > 0);
  return { d, loading, err, load, owedFor };
}
