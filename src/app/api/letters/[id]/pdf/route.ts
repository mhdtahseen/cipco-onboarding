import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { issuedLetterPdf } from "@/lib/letterPdf";
import type { LetterRow } from "@/lib/types";

export const runtime = "nodejs";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data } = await sb.from("letters").select("*").eq("id", id).single();
  if (!data) return new NextResponse("Not found", { status: 404 });
  const l = data as LetterRow;
  const seal = req.nextUrl.searchParams.has("seal") ? req.nextUrl.searchParams.get("seal") !== "0" : l.with_seal;
  const { bytes, file } = await issuedLetterPdf(l, seal);
  const how = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${how}; filename="${encodeURIComponent(file)}"` } });
}
