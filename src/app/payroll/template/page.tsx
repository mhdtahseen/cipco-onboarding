"use client";
import Link from "next/link";
import SalarySlip, { SAMPLE_DAILY_SLIP, SAMPLE_SLIP } from "@/components/payroll/SalarySlip";
import { istToday } from "@/lib/attendance";

// Admin only (the whole /payroll area is). A salary slip filled with made-up figures, to check the layout without touching real payroll.
export default function SlipTemplate() {
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center gap-2"><Link href="/payroll" className="text-sm text-blue-700 underline">← Payroll</Link><h1 className="text-xl font-semibold sm:mr-auto">Salary slip template</h1>
        <a className="btn" href="/api/payslips/template" target="_blank">Salaried PDF</a><a className="btn" href="/api/payslips/template?kind=daily" target="_blank">Daily-wage PDF</a></div>
      <p className="text-xs text-slate-500">Sample data only, no real person. This is the on-screen slip shown for each employee in the payroll run; the PDF is what gets printed once a run is approved. Both are built from <code>components/payroll/SalarySlip.tsx</code> and <code>lib/pdf/payslip.ts</code>.</p>
      <h2 className="font-medium pt-2">Salaried</h2>
      <SalarySlip projectName="Sample Project" payMonth={istToday()} line={SAMPLE_SLIP} />
      <h2 className="font-medium pt-2">Daily wage</h2>
      <p className="text-xs text-slate-500">No basic / HRA split: one wage line (rate × days worked), and no Deductions section. The company pays their ESI as an added cost, so net pay equals gross.</p>
      <SalarySlip projectName="Sample Project" payMonth={istToday()} line={SAMPLE_DAILY_SLIP} />
    </div>
  );
}
