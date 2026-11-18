import { NextRequest, NextResponse } from "next/server";
import { companyAdmin } from "@/lib/companyAdmin";
import { brandingImages } from "@/lib/companyServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The seal or signature now in use (uploaded, or the built-in one), for the preview on the Company page. Admin only: they are no longer public files.
export async function GET(req: NextRequest) {
  const a = await companyAdmin(); if ("res" in a) return a.res;
  const which = req.nextUrl.searchParams.get("which") === "signature" ? "sign" : "seal";
  const img = (await brandingImages())[which];
  const png = img[0] === 0x89 && img[1] === 0x50;
  return new NextResponse(Buffer.from(img), { headers: { "content-type": png ? "image/png" : "image/jpeg", "cache-control": "private, no-store" } });
}
