import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildKit, fillForm11, fillGratuity, fillJoiningForm } from "@/lib/pdf/forms";
import type { Employee } from "@/lib/types";

export const runtime = "nodejs";
const names: Record<string, string> = { joining: "Joining-Form", form11: "PF-Form-11", gratuity: "Gratuity-Form-F", kit: "Joining-Kit" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const id = req.nextUrl.searchParams.get("employee");
  const seal = req.nextUrl.searchParams.get("seal") !== "0";
  const { data: e } = await sb.from("employees").select("*").eq("id", id).single();
  if (!e || !names[kind]) return new NextResponse("Not found", { status: 404 });
  const emp = e as Employee;
  const bytes = kind === "joining" ? await fillJoiningForm(emp, seal) : kind === "form11" ? await fillForm11(emp, seal) : kind === "gratuity" ? await fillGratuity(emp, seal) : await buildKit(emp, seal);
  const fname = `${names[kind]} - ${emp.full_name}.pdf`;
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${encodeURIComponent(fname)}"` } });
}
