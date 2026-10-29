import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildPayslips } from "@/lib/pdf/payslip";
import { SAMPLE_SLIP } from "@/components/payroll/SalarySlip";

// The salary slip layout filled with made-up figures, for checking the design (Admin only). Contains no real data.
export async function GET() {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: r } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).maybeSingle(); if (r?.role !== "admin") return new NextResponse("Forbidden", { status: 403 });
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const pdf = await buildPayslips([{ projectName: "Sample Project", payMonth: month, line: SAMPLE_SLIP }]);
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="Salary slip template.pdf"' } });
}
