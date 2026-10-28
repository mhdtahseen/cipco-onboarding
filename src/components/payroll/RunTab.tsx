"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { computeLine, monthEnd, monthName, monthStart, type LineResult, type Adjustment } from "@/lib/payroll";
import type { usePayroll, Line } from "@/lib/payrollData";

type P = ReturnType<typeof usePayroll>;
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtD = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

export default function RunTab({ P, pid, ym, today, projectName }: { P: P; pid: string; ym: string; today: string; projectName: string }) {
  const d = P.d!; const run = d.run; const approved = run?.status === "approved";
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [open, setOpen] = useState<string | null>(null);
  const [af, setAf] = useState({ kind: "earning", label: "", amount: "", days: "", reason: "" });
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  // the fresh calculation for everyone on the project
  const results = useMemo(() => d.emps.map((e) => ({ e, r: computeLine(e, ym, d.att[e.id] ?? {}, d.revs[e.id] ?? [], d.adjs.filter((a) => a.employee_id === e.id && !a.voided_at) as Adjustment[], approved ? [] : P.owedFor(e.id)) })), [d, ym, approved]);
  const inRun = results.filter((x) => x.r.treatment === "in_run"); const next = results.filter((x) => x.r.treatment === "next_run"); const noDate = results.filter((x) => x.r.treatment === "no_joining_date");
  const blockers = results.flatMap((x) => x.r.blockers); const warnings = inRun.flatMap((x) => x.r.warnings);
  const fresh = inRun.filter((x) => x.r.line);
  const saved = new Map(d.lines.map((l) => [l.employee_id, l]));
  const sigOf = (net: number, gross: number, items: number) => `${Math.round(net)}|${Math.round(gross)}|${items}`;
  const stale = !approved && !!run && (saved.size !== fresh.length || fresh.some((x) => { const l = saved.get(x.e.id); return !l || sigOf(l.net, l.gross, l.items.length) !== sigOf(x.r.line!.net, x.r.line!.gross, x.r.line!.items.length); }));
  const shown = approved ? d.lines.map((l) => ({ id: l.employee_id, name: l.snapshot.name as string, emp_no: l.snapshot.emp_no as string | null, line: l, flags: [] as string[] })) : fresh.map((x) => ({ id: x.e.id, name: x.e.full_name, emp_no: x.e.emp_no, line: { ...x.r.line!, employee_id: x.e.id } as any, flags: x.r.flags }));
  const sum = (k: "gross" | "deductions" | "net" | "er_total") => shown.reduce((s, x) => s + Number(x.line[k]), 0);

  async function calculate() {
    if (blockers.length) { setErr("Fix what blocks the payroll first (listed above)."); return; } if (!fresh.length) { setErr("Nobody is in this month's payroll."); return; }
    setBusy(true); setErr(""); const sb = supabase(); let runId = run?.id;
    if (!runId) { const { data, error } = await sb.from("payroll_runs").insert({ project_id: pid, pay_month: monthStart(ym) }).select().single(); if (error || !data) { setErr(error?.message ?? "Couldn't start the payroll."); setBusy(false); return; } runId = data.id; }
    const del = await sb.from("payroll_lines").delete().eq("run_id", runId); if (del.error) { setErr(del.error.message); setBusy(false); return; }
    const rows = fresh.map((x) => ({ run_id: runId, employee_id: x.e.id, project_id: pid, kind: x.r.line!.kind, days_in_month: x.r.line!.days_in_month, paid_days: x.r.line!.paid_days, lop_days: x.r.line!.lop_days, gross: x.r.line!.gross, deductions: x.r.line!.deductions, net: x.r.line!.net, pf_emp: x.r.line!.pf_emp, pf_er: x.r.line!.pf_er, pf_admin: x.r.line!.pf_admin, esi_emp: x.r.line!.esi_emp, esi_er: x.r.line!.esi_er, pt: x.r.line!.pt, er_total: x.r.line!.er_total, pay_mode: x.r.line!.pay_mode, items: x.r.line!.items, snapshot: x.r.line!.snapshot }));
    const ins = await sb.from("payroll_lines").insert(rows); setBusy(false); if (ins.error) { setErr(ins.error.message); return; } note(`Draft saved for ${rows.length} people ✓`); P.load();
  }
  async function approve() { if (!run) return; if (!confirm(`Approve ${monthName(ym)} payroll for ${projectName}? The figures are locked. Net pay ₹${inr(sum("net"))} for ${shown.length} people.`)) return; setBusy(true); setErr(""); const { error } = await supabase().rpc("payroll_approve", { p_run: run.id }); setBusy(false); if (error) { setErr(error.message); return; } note("Approved ✓ Record payments on the Pay tab."); P.load(); }
  async function reopen() { if (!run || !confirm("Reopen this payroll? The figures become editable again, and advance recoveries are undone.")) return; setBusy(true); setErr(""); const { error } = await supabase().rpc("payroll_reopen", { p_run: run.id }); setBusy(false); if (error) { setErr(error.message); return; } note("Reopened ✓"); P.load(); }
  async function addAdj(employeeId: string) {
    const amount = parseFloat(af.amount), days = parseFloat(af.days); if (!af.label.trim() && af.kind !== "lop_waiver") { setErr("Give the adjustment a label."); return; } setErr("");
    const row: Record<string, any> = { project_id: pid, employee_id: employeeId, pay_month: monthStart(ym), kind: af.kind, label: af.label.trim() || "LOP waived", reason: af.reason.trim(), amount: af.kind === "lop_waiver" ? 0 : amount || 0 }; if (af.kind === "lop_waiver") row.days = days || null;
    const { error } = await supabase().from("payroll_adjustments").insert(row); if (error) { setErr(error.message); return; } setAf({ kind: af.kind, label: "", amount: "", days: "", reason: "" }); note("Adjustment added. Recalculate to include it."); P.load();
  }
  async function voidAdj(id: string) { const { error } = await supabase().from("payroll_adjustments").update({ voided_at: new Date().toISOString() }).eq("id", id); if (error) { setErr(error.message); return; } P.load(); }
  function csv() {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`; const rows = [["Name", "Emp no.", "Type", "Paid days", "LOP days", "Gross", "Deductions", "Net", "Employer cost"], ...shown.map((x) => [x.name, x.emp_no ?? "", x.line.kind, x.line.paid_days, x.line.lop_days, x.line.gross, x.line.deductions, x.line.net, x.line.er_total])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" })); a.download = `${projectName} - payroll ${ym}.csv`; a.click();
  }
  const chip = !run ? <span className="rounded-full bg-slate-100 text-slate-600 text-xs px-2.5 py-1">Not started</span> : approved ? <span className="rounded-full bg-emerald-50 text-emerald-700 text-xs px-2.5 py-1">Approved {fmtD(run.approved_at)}</span> : stale ? <span className="rounded-full bg-amber-50 text-amber-800 text-xs px-2.5 py-1">Draft · out of date</span> : <span className="rounded-full bg-blue-50 text-blue-800 text-xs px-2.5 py-1">Draft saved</span>;
  const card = (l: string, v: string, sub?: string) => <div className="rounded-2xl bg-white border border-slate-200/80 p-3"><div className="text-xs text-slate-400">{l}</div><div className="text-lg font-medium tabular-nums">{v}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
  const adjFor = (id: string) => d.adjs.filter((a) => a.employee_id === id && !a.voided_at);

  return (
    <div className="space-y-4" data-run>
      <div className="flex flex-wrap items-center gap-2">{chip}
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn" onClick={csv} disabled={!shown.length}>⬇ CSV</button>
          {approved && <a className="btn" href={`/api/payslips?run=${run!.id}`} target="_blank">All salary slips (PDF)</a>}
          {approved && <button className="btn btn-danger" disabled={busy} onClick={reopen}>Reopen</button>}
          {!approved && <button className="btn" disabled={busy || !!blockers.length || !fresh.length} onClick={calculate}>{run ? "Recalculate draft" : "Calculate draft"}</button>}
          {!approved && <button className="btn btn-primary" disabled={busy || !run || stale || !!blockers.length || !saved.size} onClick={approve}>Approve payroll</button>}</div></div>
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
      {!approved && <section className={`rounded-2xl border p-3 space-y-1.5 text-sm ${blockers.length ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`} data-readiness>
        <div className="font-medium">{blockers.length ? `Not ready: ${blockers.length} thing${blockers.length > 1 ? "s" : ""} to fix` : "Ready to calculate"}</div>
        {blockers.slice(0, 12).map((b, i) => <div key={i}>• {b}{/not marked/.test(b) && <> · <Link className="underline" href={`/attendance?p=${pid}&d=${monthEnd(ym)}`}>open attendance</Link></>}</div>)}{blockers.length > 12 && <div>…and {blockers.length - 12} more</div>}
        {warnings.length > 0 && <div className="text-amber-900 pt-1">{warnings.slice(0, 6).map((w, i) => <div key={i}>⚠ {w}</div>)}{warnings.length > 6 && <div>…and {warnings.length - 6} more</div>}</div>}
        {stale && !blockers.length && <div className="text-amber-900">Something changed since the draft was saved (attendance, salary or an adjustment). Recalculate before approving.</div>}</section>}
      {noDate.length > 0 && <p className="text-xs text-amber-800">No joining date, so not in the payroll: {noDate.map((x) => x.e.full_name).join(", ")}.</p>}
      {next.length > 0 && <p className="text-xs text-slate-500" data-next>Joined after the 20th, so paid in the next run: {next.map((x) => `${x.e.full_name} (${new Date(x.e.join_date! + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })})`).join(", ")}.</p>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{card("People", String(shown.length))}{card("Gross", `₹${inr(sum("gross"))}`)}{card("Deductions", `₹${inr(sum("deductions"))}`)}{card("Net to pay", `₹${inr(sum("net"))}`)}{card("Cost to company", `₹${inr(sum("gross") + sum("er_total"))}`, `incl. employer PF / ESI ₹${inr(sum("er_total"))}`)}</div>
      <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm min-w-[52rem]" data-lines><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="text-left p-2.5">Employee</th><th className="text-left">Type</th><th className="text-right">P / ½ / A / Off</th><th className="text-right">LOP</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net</th><th className="text-left pl-3">Pay by</th><th></th></tr></thead>
        <tbody className="divide-y divide-slate-100">{shown.map((x) => { const c = (x.line.snapshot?.counts ?? {}) as Record<string, number>; const isOpen = open === x.id; return (<>
          <tr key={x.id} className="hover:bg-slate-50/70 cursor-pointer" onClick={() => setOpen(isOpen ? null : x.id)}>
            <td className="p-2.5"><div className="font-medium">{x.name}</div><div className="text-xs text-slate-400">{x.emp_no ?? ""}{x.flags.length > 0 && <span className="text-amber-700"> ⚑ {x.flags.join(" · ")}</span>}</div></td>
            <td>{x.line.kind === "daily" ? "Daily" : "Salaried"}</td><td className="text-right tabular-nums">{c.present ?? 0} / {c.half ?? 0} / {c.absent ?? 0} / {c.off ?? 0}</td><td className="text-right tabular-nums">{x.line.kind === "salaried" ? x.line.lop_days || "–" : "–"}</td>
            <td className="text-right tabular-nums">₹{inr(x.line.gross)}</td><td className="text-right tabular-nums">₹{inr(x.line.deductions)}</td><td className="text-right tabular-nums font-medium">₹{inr(x.line.net)}</td><td className="pl-3 capitalize">{x.line.pay_mode}</td><td className="text-right pr-2 text-slate-400">{isOpen ? "▾" : "▸"}</td></tr>
          {isOpen && <tr key={x.id + "-d"} className="bg-slate-50/60"><td colSpan={9} className="p-3"><div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1"><div className="text-xs font-medium text-slate-500">Earnings and deductions</div>{x.line.items.map((it: any, i: number) => <div key={i} className="flex gap-2 text-sm"><span className="flex-1">{it.label}{it.note ? <span className="text-xs text-slate-400"> · {it.note}</span> : null}</span><span className={`tabular-nums ${it.kind === "deduction" ? "text-rose-700" : ""}`}>{it.kind === "deduction" ? "−" : ""}₹{inr(it.amount)}</span></div>)}
              <div className="flex gap-2 text-sm font-medium border-t border-slate-200 pt-1"><span className="flex-1">Net pay</span><span className="tabular-nums">₹{inr(x.line.net)}</span></div>
              {x.line.snapshot?.arrears && <div className="text-xs text-slate-500">Arrears window {x.line.snapshot.arrears.from} to {x.line.snapshot.arrears.to}: P {x.line.snapshot.arrears.present}, ½ {x.line.snapshot.arrears.half}, A {x.line.snapshot.arrears.absent}</div>}</div>
            <div className="space-y-2"><div className="text-xs font-medium text-slate-500">Adjustments for {monthName(ym)}</div>
              {adjFor(x.id).map((a) => <div key={a.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{a.kind === "deduction" ? "−" : "+"} {a.label}{a.kind === "lop_waiver" ? ` (${a.days} days)` : ` ₹${inr(a.amount)}`}{a.reason ? <span className="text-xs text-slate-400"> · {a.reason}</span> : null}</span>{!approved && <button className="text-xs text-red-700 underline" onClick={(e) => { e.stopPropagation(); voidAdj(a.id); }}>Void</button>}</div>)}
              {!adjFor(x.id).length && <div className="text-xs text-slate-400">None.</div>}
              {!approved && <div className="flex flex-wrap gap-1.5 items-end" onClick={(e) => e.stopPropagation()}>
                <select className="inp !w-32 !py-1" aria-label="Adjustment type" value={af.kind} onChange={(e) => setAf({ ...af, kind: e.target.value })}><option value="earning">Bonus / earning</option><option value="deduction">Deduction / fine</option><option value="lop_waiver">Waive LOP days</option></select>
                <input className="inp !w-32 !py-1" placeholder="Label" aria-label="Adjustment label" value={af.label} onChange={(e) => setAf({ ...af, label: e.target.value })} />
                {af.kind === "lop_waiver" ? <input className="inp !w-20 !py-1" inputMode="decimal" placeholder="Days" aria-label="Days to waive" value={af.days} onChange={(e) => setAf({ ...af, days: e.target.value })} /> : <input className="inp !w-24 !py-1" inputMode="decimal" placeholder="Amount ₹" aria-label="Adjustment amount" value={af.amount} onChange={(e) => setAf({ ...af, amount: e.target.value })} />}
                <input className="inp !w-36 !py-1" placeholder="Reason" aria-label="Adjustment reason" value={af.reason} onChange={(e) => setAf({ ...af, reason: e.target.value })} /><button className="btn !min-h-8" onClick={() => addAdj(x.id)}>Add</button></div>}
              {approved && <a className="btn inline-flex" href={`/api/payslips/${(x.line as Line).id}`} target="_blank" onClick={(e) => e.stopPropagation()}>Salary slip (PDF)</a>}</div></div></td></tr>}
        </>); })}</tbody></table>
        {!shown.length && <p className="p-6 text-center text-sm text-slate-500">{d.emps.length ? "Nobody is in this month's payroll yet. Calculate the draft once the month's attendance is complete." : "Nobody is on this project."}</p>}</div>
      <p className="text-xs text-slate-400">Salaried: gross × paid days ÷ calendar days (weekly off paid; absent and unmarked days are LOP). Daily wage: rate × days worked (weekly off unpaid). Everyone who joined on or before the 20th is paid from their joining date; later joiners are paid in the next run with arrears. PF, ESI and Professional Tax follow each person's salary structure.</p>
    </div>
  );
}
