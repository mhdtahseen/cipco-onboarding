import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/supabase/admin";
import { buildPayslips } from "@/lib/pdf/payslip";

// One person's salary slip for an approved payroll run.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params; if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Bad request", { status: 400 });
  // Admin reads payroll directly. Operations may open one person's slip from the employee's Exit tab, so for them it is read with the server's key after the role check.
  const { data: admin } = await sb.rpc("is_admin"); const { data: staff } = admin ? { data: true } : await sb.rpc("is_staff"); if (!staff) return new NextResponse("Not allowed", { status: 403 });
  const db = admin ? sb : adminClient();
  const { data: line } = await db.from("payroll_lines").select("*").eq("id", id).maybeSingle(); if (!line) return new NextResponse("Not found", { status: 404 });
  const { data: run } = await db.from("payroll_runs").select("*").eq("id", line.run_id).maybeSingle(); if (!run || run.status !== "approved") return new NextResponse("Approve the payroll before printing salary slips.", { status: 409 });
  const { data: proj } = await db.from("projects").select("name").eq("id", run.project_id).maybeSingle();
  const pdf = await buildPayslips([{ projectName: proj?.name ?? "", payMonth: run.pay_month, line }]);
  const name = String(line.snapshot?.name ?? "employee").replace(/[^\w ]/g, "").trim();
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Salary slip ${name} ${String(run.pay_month).slice(0, 7)}.pdf"` } });
}
