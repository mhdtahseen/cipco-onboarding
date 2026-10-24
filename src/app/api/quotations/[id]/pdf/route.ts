import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildQuotationPdf } from "@/lib/pdf/quotation";
import type { Quote } from "@/lib/quote";

export const runtime = "nodejs";
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data } = await sb.from("quotations").select("*").eq("id", id).single();
  if (!data) return new NextResponse("Not found", { status: 404 });
  const q = data as Quote;
  const bytes = await buildQuotationPdf(q, q.ref_no || "DRAFT – not issued");
  const fname = `Quotation ${q.ref_no ? q.ref_no.split("/").pop() + " " : ""}- ${q.client_name}.pdf`;
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${encodeURIComponent(fname)}"` } });
}
