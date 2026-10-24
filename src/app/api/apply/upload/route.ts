import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { r2Put } from "@/lib/r2";

// Public (no login) — but only works with a valid, unexpired invite token. Stores into R2 under the candidate's folder
// and records the path on the invite; staff move it into the document checklist when they apply the submission.
const MAX = 5 * 1024 * 1024;
const DOCS = ["aadhaar", "pan", "bank", "uan", "photo", "resume"];
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file"); const token = String(form.get("token") || ""); const docType = String(form.get("docType") || "");
  if (!(file instanceof File) || !/^[a-f0-9]{64}$/.test(token) || !DOCS.includes(docType)) return new NextResponse("Bad request", { status: 400 });
  if (file.size > MAX) return new NextResponse("File too large (max 5 MB)", { status: 413 });
  if (!(file.type === "application/pdf" || /^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || (docType === "resume" && /\.(docx?|pdf)$/i.test(file.name)))) return new NextResponse("Please upload a PDF or a photo (JPG / PNG).", { status: 415 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data: inv } = await sb.rpc("invite_get", { p_token: token });
  if (!inv || !["sent", "submitted"].includes(inv.status)) return new NextResponse("This link is no longer active.", { status: 403 });
  const path = `${inv.employee_id}/${docType}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
  try { await r2Put(path, await file.arrayBuffer(), file.type || "application/octet-stream"); }
  catch { return new NextResponse("Upload failed, please try again.", { status: 502 }); }
  const { data: ok } = await sb.rpc("invite_file", { p_token: token, p_doc: docType, p_path: path });
  if (!ok) return new NextResponse("This link is no longer active.", { status: 403 });
  return NextResponse.json({ ok: true });
}
