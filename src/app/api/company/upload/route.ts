import { NextRequest, NextResponse } from "next/server";
import { companyAdmin } from "@/lib/companyAdmin";
import { r2Put } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stores a company document, or a new seal or signature, in private storage under company/ and returns where. The page then records it (Admin only, by the
// database rules). A seal or signature must be a PNG or JPEG image (a PNG with a transparent background prints best).
const MAX = 10 * 1024 * 1024;
export async function POST(req: NextRequest) {
  const a = await companyAdmin(); if ("res" in a) return a.res;
  const form = await req.formData().catch(() => null); const file = form?.get("file"); const what = String(form?.get("what") || "doc");
  if (!(file instanceof File) || !["doc", "seal", "signature"].includes(what)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "The file is larger than 10 MB. Please upload a smaller scan or compressed PDF." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes[0] === 0x89 && bytes[1] === 0x50, jpg = bytes[0] === 0xff && bytes[1] === 0xd8, pdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (what !== "doc" && !png && !jpg) return NextResponse.json({ error: "The seal and signature must be a PNG or JPEG image." }, { status: 415 });
  if (what === "doc" && !png && !jpg && !pdf && !/^image\//.test(file.type)) return NextResponse.json({ error: "Upload a PDF or a photo." }, { status: 415 });
  const name = (file.name || "file").replace(/[^\w.\-]/g, "_");
  const path = what === "doc" ? `company/docs/${Date.now()}-${name}` : `company/branding/${what}-${Date.now()}.${png ? "png" : "jpg"}`;
  try { await r2Put(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, png ? "image/png" : jpg ? "image/jpeg" : pdf ? "application/pdf" : file.type || "application/octet-stream"); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  return NextResponse.json({ path, name: file.name || name });
}
