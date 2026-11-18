import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { companyData } from "@/lib/companyServer";
import { publicCompanyData } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The letterhead and bank details saved on the Company page, for screens that show them (salary slip, invoice, bank letter). Anyone signed in may read these:
// they print on documents anyway. Never the proprietor's Aadhaar or name, and never the documents.
export async function GET() {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  return NextResponse.json({ data: publicCompanyData(await companyData()) }, { headers: { "cache-control": "private, max-age=60" } });
}
