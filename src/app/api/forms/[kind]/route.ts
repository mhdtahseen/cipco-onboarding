import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { blankPccForm, buildKit, fillForm11, fillGratuity, fillJoiningForm, fillPccForm } from "@/lib/pdf/forms";
import { r2Get } from "@/lib/r2";
import type { Employee } from "@/lib/types";

export const runtime = "nodejs";
const names: Record<string, string> = { joining: "Joining-Form", form11: "PF-Form-11", gratuity: "Gratuity-Form-F", kit: "Joining-Kit", pcc: "Police-Verification-Form" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  if (kind === "pcc-blank") return new NextResponse(Buffer.from(await blankPccForm()), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Police-Verification-Form (blank).pdf"` } });
  const id = req.nextUrl.searchParams.get("employee");
  const seal = req.nextUrl.searchParams.get("seal") !== "0";
  const { data: e } = await sb.from("employees").select("*").eq("id", id).single();
  if (!e || !names[kind]) return new NextResponse("Not found", { status: 404 });
  const emp = e as Employee;
  let photo: Uint8Array | null = null;   // passport photo from the Documents tab, if one has been uploaded
  if (kind === "joining" || kind === "kit" || kind === "pcc") {
    const { data: d } = await sb.from("employee_documents").select("file_path").eq("employee_id", emp.id).eq("doc_type", "photo").maybeSingle();
    if (d?.file_path) photo = await r2Get(d.file_path);
  }
  // the person's project decides the unit details on the police verification form, and whether the kit includes it
  let proj: any = null;
  if ((kind === "pcc" || kind === "kit") && emp.project_id) {
    const { data: pr } = await sb.from("projects").select("*").eq("id", emp.project_id).maybeSingle();
    if (pr?.client_id) { const { data: c } = await sb.from("clients").select("name").eq("id", pr.client_id).maybeSingle(); proj = { ...pr, client_name: c?.name ?? null }; } else proj = pr;
  }
  const pcc = kind === "pcc" || (kind === "kit" && proj?.police_verification) ? await fillPccForm(emp, proj, photo, req.nextUrl.searchParams.get("pan") === "1") : null;
  const bytes = kind === "joining" ? await fillJoiningForm(emp, seal, photo) : kind === "form11" ? await fillForm11(emp, seal) : kind === "gratuity" ? await fillGratuity(emp, seal) : kind === "pcc" ? pcc! : await buildKit(emp, seal, photo, pcc);
  const fname = `${names[kind]} - ${emp.full_name}.pdf`;
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${encodeURIComponent(fname)}"` } });
}
