import { NextRequest, NextResponse } from "next/server";
import { companyAdmin } from "@/lib/companyAdmin";
import { COMPANY_DOC_LINK_DAYS, signCompanyDoc } from "@/lib/companyDocLink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A private 7-day link to one company document, to paste into an email or WhatsApp (Admin only). The link opens without signing in (/api/cdoc/<token>).
export async function GET(req: NextRequest) {
  const a = await companyAdmin(); if ("res" in a) return a.res;
  const doc = req.nextUrl.searchParams.get("doc") || "";
  if (!/^[0-9a-f-]{36}$/i.test(doc)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { data: d } = await a.sb.from("company_documents").select("id, file_path").eq("id", doc).is("archived_at", null).maybeSingle();
  if (!d?.file_path) return NextResponse.json({ error: "Upload the document first." }, { status: 404 });
  const until = new Date(Date.now() + COMPANY_DOC_LINK_DAYS * 86400000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  return NextResponse.json({ url: `${req.nextUrl.origin}/api/cdoc/${signCompanyDoc(doc)}`, days: COMPANY_DOC_LINK_DAYS, until });
}
