import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildPayslips } from "@/lib/pdf/payslip";

// All salary slips of an approved payroll run, one page each (Admin only: the data is behind the staff rules).
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const runId = req.nextUrl.searchParams.get("run") || ""; if (!/^[0-9a-f-]{36}$/.test(runId)) return new NextResponse("Bad request", { status: 400 });
  const { data: run } = await sb.from("payroll_runs").select("*").eq("id", runId).maybeSingle(); if (!run) return new NextResponse("Not found", { status: 404 });
  if (run.status !== "approved") return new NextResponse("Approve the payroll before printing salary slips.", { status: 409 });
  const [{ data: lines }, { data: proj }] = await Promise.all([sb.from("payroll_lines").select("*").eq("run_id", runId), sb.from("projects").select("name").eq("id", run.project_id).maybeSingle()]);
  const sorted = ((lines || []) as any[]).sort((a, b) => String(a.snapshot?.name ?? "").localeCompare(String(b.snapshot?.name ?? "")));
  if (!sorted.length) return new NextResponse("No lines", { status: 404 });
  const pdf = await buildPayslips(sorted.map((line) => ({ projectName: proj?.name ?? "", payMonth: run.pay_month, line })));
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Salary slips ${String(run.pay_month).slice(0, 7)}.pdf"` } });
}
