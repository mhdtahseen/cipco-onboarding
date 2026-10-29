import { COMPANY } from "@/lib/company";
import { inr, rupeesWords } from "@/lib/salary";

export type SlipData = {
  kind: string; days_in_month: number; paid_days: number; lop_days: number; gross: number; deductions: number; net: number;
  pf_er: number; pf_admin: number; esi_er: number; er_total: number; pay_mode: string;
  items: { kind: "earning" | "deduction"; label: string; amount: number; note?: string }[]; snapshot: Record<string, any>;
};

const monthLabel = (iso: string) => new Date(iso.slice(0, 7) + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const dmy = (iso?: string | null) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const num = (n: unknown) => { const v = Number(n); return Number.isInteger(v) ? String(v) : v.toFixed(1); };
const paidBy = (sn: Record<string, any>) => (sn.pay_mode === "upi" ? `UPI · ${sn.upi_id ?? ""}` : sn.pay_mode === "cash" ? "Cash" : `Bank · ${sn.bank_name ?? ""}${sn.account_no ? " · A/c xxxx" + String(sn.account_no).slice(-4) : ""}`.trim());

/** On-screen salary slip with the same sections as the printed PDF (lib/pdf/payslip.ts): keep the two in step. */
export default function SalarySlip({ projectName, payMonth, line, draft }: { projectName: string; payMonth: string; line: SlipData; draft?: boolean }) {
  const sn = line.snapshot ?? {}; const c = (sn.counts ?? {}) as Record<string, number>;
  const earn = line.items.filter((i) => i.kind === "earning"), ded = line.items.filter((i) => i.kind === "deduction");
  const info: [string, string][] = [["Employee", sn.name ?? ""], ["Employee no.", sn.emp_no ?? "—"], ["Designation", sn.designation ?? "—"], ["Department", sn.department ?? "—"], ["Project", projectName], ["Date of joining", dmy(sn.join_date)], ["PAN", sn.pan ?? "—"], ["UAN", sn.uan ?? "—"], ["Paid by", paidBy(sn)], ["Pay month", monthLabel(payMonth)]];
  const att: [string, string][] = line.kind === "daily"
    ? [["Days worked", num(Number(c.present ?? 0) + Number(c.half ?? 0) * 0.5)], ["Present", num(c.present ?? 0)], ["Half-days", num(c.half ?? 0)], ["Absent", num(c.absent ?? 0)], ["Weekly offs", num(c.off ?? 0)]]
    : [["Days in month", num(line.days_in_month)], ["Paid days", num(line.paid_days)], ["LOP days", num(line.lop_days)], ["Present", num(c.present ?? 0)], ["Weekly offs", num(c.off ?? 0)]];
  const er = ([["PF", line.pf_er], ["PF admin / EDLI", line.pf_admin], ["ESI", line.esi_er]] as [string, number][]).filter(([, v]) => Number(v) > 0);
  const col = (title: string, items: typeof earn, total: number, label: string) => (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between bg-[#1e4fa3] text-white text-xs font-semibold px-2.5 py-1.5 rounded-t"><span>{title}</span><span>Amount</span></div>
      <div className="min-h-12 divide-y divide-slate-100">{items.map((it, i) => <div key={i} className="flex gap-2 px-2.5 py-1.5 text-sm"><span className="flex-1 min-w-0">{it.label}{it.note ? <span className="block text-[11px] text-slate-400">{it.note}</span> : null}</span><span className="tabular-nums">{inr(it.amount)}</span></div>)}
        {!items.length && <div className="px-2.5 py-1.5 text-sm text-slate-400">—</div>}</div>
      <div className="flex justify-between border-t border-slate-300 px-2.5 py-1.5 text-sm font-semibold"><span>{label}</span><span className="tabular-nums">{inr(total)}</span></div>
    </div>);

  return (
    <article className="relative rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 text-slate-900 space-y-4" aria-label={`Salary slip, ${sn.name ?? ""}, ${monthLabel(payMonth)}`} data-slip>
      {draft && <span aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 -rotate-12 select-none text-5xl font-bold tracking-widest text-slate-200/80">DRAFT</span>}
      <header className="border-b border-slate-200 pb-2">
        <div className="text-base sm:text-lg font-bold text-[#1e4fa3]">{COMPANY.name}</div>
        <div className="text-[11px] text-slate-500">{COMPANY.line1.replace("Office Address : ", "")}</div>
        <div className="text-[11px] text-slate-500">{COMPANY.line2.split("|")[0].trim()} · {COMPANY.line3.split("|")[0].trim()}</div>
      </header>
      <div className="flex items-baseline justify-between gap-2"><h3 className="font-bold">SALARY SLIP</h3><span className="font-bold text-[#1e4fa3]">{monthLabel(payMonth)}</span></div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm">{info.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-xs text-slate-500 pt-0.5">{k}</dt><dd className="font-semibold min-w-0 break-words">{v}</dd></div>)}</dl>
      <div className="grid grid-cols-5 gap-2 border-b border-slate-200 pb-3">{att.map(([k, v]) => <div key={k}><div className="text-[10px] sm:text-[11px] text-slate-500">{k}</div><div className="text-base font-bold tabular-nums">{v}</div></div>)}</div>
      {sn.arrears && <p className="text-xs italic text-slate-500">Arrears: {dmy(sn.arrears.from)} to {dmy(sn.arrears.to)} ({sn.arrears.days} days)</p>}
      <div className="flex flex-col sm:flex-row gap-4">{col("Earnings", earn, line.gross, "Gross earnings")}{col("Deductions", ded, line.deductions, "Total deductions")}</div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-baseline justify-between gap-2"><span className="text-xs font-bold text-slate-500">NET PAY</span><span className="text-xl font-bold text-[#1e4fa3] tabular-nums">{inr(line.net)}</span></div>
        <div className="text-xs italic">{rupeesWords(Math.max(0, Math.round(line.net)))}</div>
      </div>
      {er.length > 0 && <div><div className="text-xs font-bold text-slate-500">Employer contributions (not deducted from the employee&apos;s pay)</div><div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">{er.map(([k, v]) => <span key={k}>{k}: <span className="tabular-nums">{inr(Number(v))}</span></span>)}</div></div>}
      <footer className="flex flex-wrap items-end justify-between gap-2 pt-1 text-xs text-slate-500"><span className="italic">This is a computer-generated salary slip.</span><span>{COMPANY.signatoryLabel}</span></footer>
    </article>
  );
}

/** Made-up person and figures for the admin template preview. Never real data. */
export const SAMPLE_SLIP: SlipData = {
  kind: "salaried", days_in_month: 31, paid_days: 29, lop_days: 2, gross: 25000, deductions: 3150, net: 21850, pf_er: 1800, pf_admin: 150, esi_er: 0, er_total: 1950, pay_mode: "bank",
  items: [
    { kind: "earning", label: "Basic", amount: 11680, note: "29 of 31 days" }, { kind: "earning", label: "House rent allowance", amount: 4672 }, { kind: "earning", label: "Special allowance", amount: 5848 }, { kind: "earning", label: "Site bonus", amount: 2800, note: "Adjustment" },
    { kind: "deduction", label: "Provident fund (employee)", amount: 1800 }, { kind: "deduction", label: "Professional tax", amount: 200 }, { kind: "deduction", label: "Advance recovery", amount: 1150, note: "Instalment 2 of 4" },
  ],
  snapshot: { name: "Sample Employee", emp_no: "CIPCO-0000", designation: "Site Supervisor", department: "Operations", join_date: "2026-01-12", pan: "ABCDE1234F", uan: "100000000000", pay_mode: "bank", bank_name: "Sample Bank", account_no: "000000001234", counts: { present: 24, half: 0, absent: 2, off: 5 } },
};
