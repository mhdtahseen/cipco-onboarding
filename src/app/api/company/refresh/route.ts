import { NextResponse } from "next/server";
import { companyAdmin } from "@/lib/companyAdmin";
import { forgetCompany } from "@/lib/companyServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called by the Company page after a save: this server forgets the remembered details at once (the others pick them up within a minute).
export async function POST() {
  const a = await companyAdmin(); if ("res" in a) return a.res;
  forgetCompany(); return NextResponse.json({ ok: true });
}
