import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildPayrollRegister } from "@/lib/pdf/payrollRegister";

// The payroll register (one table for the whole run) as a PDF. Works for a saved draft and an approved run; the PDF says which. Admin only: the data is behind the staff rules.
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const runId = req.nextUrl.searchParams.get("run") || ""; if (!/^[0-9a-f-]{36}$/.test(runId)) return new NextResponse("Bad request", { status: 400 });
  const { data: run } = await sb.from("payroll_runs").select("*").eq("id", runId).maybeSingle(); if (!run) return new NextResponse("Not found", { status: 404 });
  const [{ data: lines }, { data: proj }] = await Promise.all([sb.from("payroll_lines").select("*").eq("run_id", runId), sb.from("projects").select("name").eq("id", run.project_id).maybeSingle()]);
  const rows = ((lines || []) as any[]).map((l) => ({ name: String(l.snapshot?.name ?? ""), empNo: String(l.snapshot?.emp_no ?? ""), kind: String(l.kind), paidDays: Number(l.paid_days), lopDays: Number(l.lop_days), gross: Number(l.gross), deductions: Number(l.deductions), net: Number(l.net), erTotal: Number(l.er_total) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!rows.length) return new NextResponse("Calculate the payroll first: nothing is saved for this month yet.", { status: 404 });
  const approved = run.status === "approved";
  const pdf = await buildPayrollRegister({ projectName: proj?.name ?? "", payMonth: run.pay_month, approved, approvedAt: run.approved_at, rows });
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Payroll register ${String(run.pay_month).slice(0, 7)}${approved ? "" : " (draft)"}.pdf"` } });
}
