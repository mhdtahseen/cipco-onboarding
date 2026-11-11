import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildExitLetterPdf } from "@/lib/pdf/exitLetters";
import { todayISO } from "@/lib/format";
import { EXIT_LETTER, addressLines, isExitLetter, letterBlock, type Exit, type ExitItem, type SettlementRow } from "@/lib/offboarding";
import type { Employee } from "@/lib/types";

export const runtime = "nodejs";

type Body = { employee_id?: string; kind?: string; exit_id?: string | null; subject?: string; paragraphs?: string[]; rows?: SettlementRow[]; with_seal?: boolean; preview?: boolean; override?: boolean };

/** Exit letters. POST with preview:true → a DRAFT pdf, nothing saved. Without it → issued: a reference number, and the exact wording is kept so a reprint matches.
 *  Admin and Operations only. Operations follow the rules in letterBlock (checklist finished, not absconded…); an Admin may override them, but must say so. */
export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const [{ data: staff }, { data: admin }] = await Promise.all([sb.rpc("is_staff"), sb.rpc("is_admin")]);
  if (!staff) return NextResponse.json({ error: "Only Admin or Operations can issue letters." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b?.employee_id || !/^[0-9a-f-]{36}$/.test(b.employee_id) || !b.kind || !isExitLetter(b.kind)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const kind = b.kind; const paragraphs = (b.paragraphs || []).map((p) => String(p).trim()).filter(Boolean).slice(0, 20);
  const subject = String(b.subject || "").trim().slice(0, 140);
  if (!subject || !paragraphs.length) return NextResponse.json({ error: "The letter is empty." }, { status: 400 });
  if (paragraphs.some((p) => /\[(describe|date)[^\]]*\]/i.test(p)) && !b.preview) return NextResponse.json({ error: "Replace the text in [square brackets] before issuing." }, { status: 400 });
  const rows = kind === "settlement" ? (b.rows || []).map((r) => ({ label: String(r.label || "").trim().slice(0, 90), amount: Math.round((Number(r.amount) || 0) * 100) / 100 })).filter((r) => r.label).slice(0, 15) : null;
  if (kind === "settlement" && !rows?.length) return NextResponse.json({ error: "Add at least one line to the statement." }, { status: 400 });

  const { data: e } = await sb.from("employees").select("*").eq("id", b.employee_id).maybeSingle(); if (!e) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  const emp = e as Employee;
  let x: Exit | null = null, items: ExitItem[] = [];
  const xq = sb.from("employee_exits").select("*").eq("employee_id", emp.id).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1);
  const { data: xs } = b.exit_id ? await sb.from("employee_exits").select("*").eq("id", b.exit_id).eq("employee_id", emp.id).limit(1) : await xq;
  x = ((xs || [])[0] as Exit) ?? null;
  if (x) { const { data: it } = await sb.from("employee_exit_items").select("*").eq("exit_id", x.id); items = (it || []) as ExitItem[]; }

  const { data: lg } = await sb.from("user_profiles").select("disabled_at").eq("employee_id", emp.id).maybeSingle();   // a linked login must be disabled (2026-11-login-disable.sql)
  const block = letterBlock(kind, x, items, !lg || !!(lg as { disabled_at: string | null }).disabled_at);
  if (block && !b.preview) {
    if (!admin) return NextResponse.json({ error: `${block} Only an Admin can override this.` }, { status: 403 });
    if (!b.override) return NextResponse.json({ error: block, needOverride: true }, { status: 409 });
  }

  const hon = emp.gender === "Female" ? "Ms." : "Mr.";
  const snap = { subject, to: kind === "experience" || kind === "recommendation" ? "whom" : "person", name: `${hon} ${emp.full_name}`, address: addressLines(emp).join("\n"),
    emp_no: emp.emp_no || "", designation: emp.designation || "", full_name: emp.full_name, rows: rows ? JSON.stringify(rows) : "", ack: kind === "settlement" ? "1" : "", override: block ? block : "" };
  const withSeal = b.with_seal !== false;
  const pdf = (refNo: string, issuedOn: string) => buildExitLetterPdf({ subject, to: snap.to as "person" | "whom", name: snap.name, address: addressLines(emp), paragraphs, rows, ack: kind === "settlement", refNo, issuedOn, withSeal, empNo: snap.emp_no, designation: snap.designation });
  try {
    if (b.preview) return new NextResponse(Buffer.from(await pdf("DRAFT – not issued", todayISO())), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="draft.pdf"' } });
    const { data: ref, error: refErr } = await sb.rpc("next_ref", { p_kind: EXIT_LETTER[kind].code }); if (refErr) return NextResponse.json({ error: refErr.message }, { status: 500 });
    const { data: row, error } = await sb.from("letters").insert({ employee_id: emp.id, kind, ref_no: ref, sections: paragraphs.map((body) => ({ title: "", body })), vars: snap, with_seal: withSeal, annexure: null, exit_id: x?.id ?? null }).select().single();
    if (error) return NextResponse.json({ error: /letters_kind_check|exit_id/.test(error.message) ? "Run 2026-11-offboarding.sql in the Supabase SQL editor first." : error.message }, { status: 500 });
    return NextResponse.json(row);
  } catch (err: unknown) { return NextResponse.json({ error: err instanceof Error ? err.message : "Could not make the letter." }, { status: 500 }); }
}
