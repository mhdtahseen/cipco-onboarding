import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildQuotationPdf } from "@/lib/pdf/quotation";
import type { Quote } from "@/lib/quote";

export const runtime = "nodejs";

/** POST { quote } → a DRAFT pdf of exactly what is on screen. Nothing is saved and no reference number is used. */
export async function POST(req: NextRequest) {
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { quote } = (await req.json()) as { quote: Quote };
  if (!quote || !Array.isArray(quote.items)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try {
    const bytes = await buildQuotationPdf(quote, quote.ref_no || "DRAFT – not issued");
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="quotation-draft.pdf"' } });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
