import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { prepareLetter, type LetterRequest } from "@/lib/letterBuild";
import { buildLetterPdf } from "@/lib/pdf/letters";
import { todayISO } from "@/lib/format";

export const runtime = "nodejs";

/** POST → issue a letter (snapshot + reference number). With preview:true → just returns a DRAFT pdf, nothing saved. */
export async function POST(req: NextRequest) {
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const body = (await req.json()) as LetterRequest;
  if (!["offer", "appointment"].includes(body.kind)) return NextResponse.json({ error: "bad kind" }, { status: 400 });
  try {
    const { vars, sections, annexure } = await prepareLetter(sb, body);
    const withSeal = body.with_seal !== false;
    if (body.preview) {
      const bytes = await buildLetterPdf({ kind: body.kind, sections, vars, refNo: "DRAFT – not issued", issuedOn: todayISO(), withSeal, annexure });
      return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="draft.pdf"' } });
    }
    const { data: ref, error: refErr } = await sb.rpc("next_ref", { p_kind: body.kind });
    if (refErr) return NextResponse.json({ error: refErr.message }, { status: 500 });
    const { data: row, error } = await sb.from("letters").insert({ employee_id: body.employee_id, kind: body.kind, ref_no: ref, sections, vars, with_seal: withSeal, annexure }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(row);
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
