import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { loadPaymentsDue } from "@/lib/paymentsDueData";
import { buildPaymentsDue } from "@/lib/pdf/paymentsDue";

// The Payments due report as a PDF. It is worked out here from the database, so what is printed cannot be edited on the way. `exclude` lists payee keys
// the Admin unticked on the page; `project` limits it to one project. Admin only.
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: admin } = await sb.rpc("is_admin"); const { data: viewer } = await sb.rpc("is_viewer"); if (!admin && !viewer) return new NextResponse("Not allowed", { status: 403 });
  const p = req.nextUrl.searchParams; const exclude = new Set((p.get("exclude") || "").split(",").filter(Boolean)), only = p.get("project") || "";
  if (only && !/^[0-9a-f-]{36}$/.test(only)) return new NextResponse("Bad request", { status: 400 });
  let d; try { d = await loadPaymentsDue(sb); } catch (e: any) { return new NextResponse(e?.message || "Could not load", { status: 500 }); }
  let leftOut = 0;
  const projects = d.projects.filter((x) => !only || x.id === only).map((x) => ({ name: x.name, payees: x.payees.filter((y) => { if (exclude.has(y.key)) { leftOut++; return false; } return true; }) })).filter((x) => x.payees.length);
  if (!projects.length) return new NextResponse("Nothing is due for the choices made.", { status: 404 });
  const name = (u.user.user_metadata?.full_name as string) || u.user.email || "";
  const pdf = await buildPaymentsDue({ projects, leftOut, notIncluded: d.notIncluded, preparedBy: name });
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Payments due ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" })}.pdf"` } });
}
