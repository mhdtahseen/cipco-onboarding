import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildPayslips } from "@/lib/pdf/payslip";
import { mailBcc, mailConfigured, mailFrom, mailTransport, validEmail } from "@/lib/mail";
import { slipEmail } from "@/lib/slipEmail";
import { COMPANY } from "@/lib/company";

export const maxDuration = 60;

// Emails each person their own salary slip (PDF attached) from the payroll mailbox. Admin only, approved runs only.
// GET  ?run=<id>                 who has an email address and what was already sent
// POST { run, lineIds?: [...] }  sends to everyone in the run with an email address, or only the given lines (to re-send a failure)
async function guard(run: string, needApproved = true) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return { err: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  const { data: admin } = await sb.rpc("is_admin"); if (!admin) return { err: NextResponse.json({ error: "Not allowed." }, { status: 403 }) };
  if (!/^[0-9a-f-]{36}$/.test(run)) return { err: NextResponse.json({ error: "Bad request." }, { status: 400 }) };
  const { data: r } = await sb.from("payroll_runs").select("*").eq("id", run).maybeSingle(); if (!r) return { err: NextResponse.json({ error: "Run not found." }, { status: 404 }) };
  if (needApproved && r.status !== "approved") return { err: NextResponse.json({ error: "Approve the payroll first." }, { status: 409 }) };
  return { sb, r };
}
async function people(sb: Awaited<ReturnType<typeof serverClient>>, run: string) {
  const { data: lines } = await sb.from("payroll_lines").select("*").eq("run_id", run);
  const ids = [...new Set(((lines || []) as any[]).map((l) => l.employee_id))];
  const { data: emps } = ids.length ? await sb.from("employees").select("id,email").in("id", ids) : { data: [] as any[] };
  const mail = new Map(((emps || []) as any[]).map((e) => [e.id, (e.email || "").trim()]));
  return ((lines || []) as any[]).map((line) => ({ line, email: mail.get(line.employee_id) || "" })).sort((a, b) => String(a.line.snapshot?.name ?? "").localeCompare(String(b.line.snapshot?.name ?? "")));
}
const sent = async (sb: any, run: string) => { const { data, error } = await sb.from("payroll_slip_emails").select("line_id,channel,status,error,sent_at,to_email").eq("run_id", run).order("sent_at", { ascending: false }); return error ? null : (data || []); };   // null = the log table does not exist yet: then nothing is remembered between visits

export async function GET(req: NextRequest) {
  const run = req.nextUrl.searchParams.get("run") || ""; const g = await guard(run); if (g.err) return g.err;
  const list = await people(g.sb!, run); const log = await sent(g.sb, run);
  const latest = (line: string, channel: string) => { const x = (log || []).find((y: any) => y.line_id === line && y.channel === channel); return x && x.status !== "cleared" ? x : null; };   // newest first; a 'cleared' row undoes a mark
  return NextResponse.json({ configured: mailConfigured(), from: process.env.MAIL_USER || null, logged: log !== null, people: list.map(({ line, email }) => ({ lineId: line.id, name: String(line.snapshot?.name ?? ""), email, ok: validEmail(email), last: latest(line.id, "email"), wa: latest(line.id, "whatsapp") })) });
}

// A test send for a demo: one slip from the run (approved or still a draft) goes to ONE company address of your choice, marked [TEST]. Nothing is recorded and no employee is emailed.
async function testSend(sb: Awaited<ReturnType<typeof serverClient>>, r: any, run: string, to: string) {
  const domain = "@" + COMPANY.supportEmail.split("@")[1];
  if (!validEmail(to) || !to.trim().toLowerCase().endsWith(domain)) return NextResponse.json({ error: `A test can only go to a ${domain} address.` }, { status: 400 });
  const { data: proj } = await sb.from("projects").select("name").eq("id", r.project_id).maybeSingle(); const all = await people(sb, run);
  if (!all.length) return NextResponse.json({ error: "Calculate the draft first, so there is a salary slip to send." }, { status: 409 });
  const { line } = all[0]; const name = String(line.snapshot?.name ?? "");
  try {
    const pdf = await buildPayslips([{ projectName: proj?.name ?? "", payMonth: r.pay_month, line }]); const m = slipEmail(name, r.pay_month);
    await mailTransport().sendMail({ from: mailFrom(), to: to.trim(), subject: `[TEST] ${m.subject}`, text: `This is a test. In a real send, this goes to ${name || "the employee"} only.\n\n${m.text}`, html: `<p style="font:12px Arial;color:#b54708">This is a test. In a real send, this goes to ${name.replace(/[<&]/g, "") || "the employee"} only.</p>${m.html}`, attachments: [{ filename: m.file, content: Buffer.from(pdf), contentType: "application/pdf" }] });
    return NextResponse.json({ ok: true, to: to.trim(), sample: name });
  } catch (e) { return NextResponse.json({ error: `The mailbox refused it: ${String((e as Error).message || e).slice(0, 200)}` }, { status: 502 }); }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})); const run = String(body.run || "");
  if (body.mark) {   // a WhatsApp send (or Mark sent / Unmark) pressed by an admin
    const g1 = await guard(run); if (g1.err) return g1.err; const lineId = String(body.mark.lineId || ""); if (!/^[0-9a-f-]{36}$/.test(lineId)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const { error } = await g1.sb!.from("payroll_slip_emails").insert({ run_id: run, line_id: lineId, channel: "whatsapp", status: body.mark.on === false ? "cleared" : "sent" });
    return NextResponse.json({ ok: !error, logged: !error });
  }
  if (body.test) { const g0 = await guard(run, false); if (g0.err) return g0.err; if (!mailConfigured()) return NextResponse.json({ error: "Email is not set up yet. Add MAIL_USER and MAIL_PASSWORD in the app settings." }, { status: 503 }); return testSend(g0.sb!, g0.r, run, String(body.to || "")); } const only: string[] | null = Array.isArray(body.lineIds) ? body.lineIds.map(String) : null;
  const g = await guard(run); if (g.err) return g.err; const { sb, r } = g as { sb: Awaited<ReturnType<typeof serverClient>>; r: any };
  if (!mailConfigured()) return NextResponse.json({ error: "Email is not set up yet. Add MAIL_USER and MAIL_PASSWORD in the app settings." }, { status: 503 });
  const { data: proj } = await sb.from("projects").select("name").eq("id", r.project_id).maybeSingle();
  const all = await people(sb, run); const todo = all.filter((p) => (!only || only.includes(p.line.id)));
  const tx = mailTransport(); const results: { lineId: string; name: string; email: string; status: "sent" | "failed" | "no_email"; error?: string }[] = [];
  for (const { line, email } of todo) {
    const name = String(line.snapshot?.name ?? "");
    if (!validEmail(email)) { results.push({ lineId: line.id, name, email, status: "no_email" }); continue; }
    try {
      const pdf = await buildPayslips([{ projectName: proj?.name ?? "", payMonth: r.pay_month, line }]); const m = slipEmail(name, r.pay_month);
      await tx.sendMail({ from: mailFrom(), to: email.trim(), bcc: mailBcc(), subject: m.subject, text: m.text, html: m.html, attachments: [{ filename: m.file, content: Buffer.from(pdf), contentType: "application/pdf" }] });
      results.push({ lineId: line.id, name, email, status: "sent" });
    } catch (e) { results.push({ lineId: line.id, name, email, status: "failed", error: String((e as Error).message || e).slice(0, 200) }); }
    await new Promise((res) => setTimeout(res, 1200));   // a steady pace: mailboxes cap how fast and how many they send
  }
  try { if (results.length) await sb.from("payroll_slip_emails").insert(results.map((x) => ({ run_id: run, channel: "email", line_id: x.lineId, to_email: x.email || null, status: x.status, error: x.error ?? null }))); } catch { /* the log table is optional until its migration is applied */ }
  return NextResponse.json({ results });
}
