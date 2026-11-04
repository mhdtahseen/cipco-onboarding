import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildBankLetter, type BankLetterRow } from "@/lib/pdf/bankLetter";
import { monthName } from "@/lib/payroll";
import { bankFor, type EmpBank } from "@/lib/payee";

const num = (v: unknown) => Number(v ?? 0);
const MODES = ["NEFT", "RTGS", "IMPS", "transfer within the bank"];

// The letter to the bank for an approved payroll run: who to credit, how much, to which account. Admin only, like payroll itself.
// Only people paid by bank transfer who still have something left to pay are on it; `lines` limits it to the ones ticked on the page.
// A person with no account number or IFSC stops the letter (listed in the error) unless `skipMissing=1`, so nobody is left off it by accident.
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: admin } = await sb.rpc("is_admin"); if (!admin) return new NextResponse("Not allowed", { status: 403 });
  const p = req.nextUrl.searchParams; const runId = p.get("run") || ""; if (!/^[0-9a-f-]{36}$/.test(runId)) return new NextResponse("Bad request", { status: 400 });
  const only = new Set((p.get("lines") || "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x))); const mode = MODES.includes(p.get("mode") || "") ? p.get("mode")! : "NEFT";
  const clean = (k: string, max = 120) => (p.get(k) || "").replace(/[\r\n]+/g, " ").trim().slice(0, max); const value = /^\d{4}-\d{2}-\d{2}$/.test(p.get("value") || "") ? p.get("value")! : null;
  const { data: run } = await sb.from("payroll_runs").select("*").eq("id", runId).maybeSingle(); if (!run) return new NextResponse("Run not found", { status: 404 });
  if (run.status !== "approved") return new NextResponse("Approve the payroll first.", { status: 409 });
  const [{ data: proj }, { data: lines }, { data: pays }] = await Promise.all([sb.from("projects").select("name").eq("id", run.project_id).maybeSingle(), sb.from("payroll_lines").select("id, employee_id, net, held, pay_mode, snapshot").eq("run_id", runId), sb.from("payroll_payments").select("line_id, amount").eq("run_id", runId).is("voided_at", null)]);
  const paid = new Map<string, number>(); (pays || []).forEach((x: any) => paid.set(x.line_id, (paid.get(x.line_id) ?? 0) + num(x.amount)));
  const due = (lines || []).filter((l: any) => l.pay_mode === "bank" && !l.held && num(l.net) - (paid.get(l.id) ?? 0) > 0.004 && (!only.size || only.has(l.id)));
  if (!due.length) return new NextResponse("Nobody is left to pay by bank transfer.", { status: 404 });
  // where each person's salary goes: their own account, or the account of the employee they are linked to ("pay into another person's account")
  const F = "id, full_name, bank_name, bank_branch, account_no, ifsc"; const ids = due.map((l: any) => l.employee_id);
  let { data: emps, error: ee } = await sb.from("employees").select(`${F}, pay_to_employee_id`).in("id", ids);
  if (ee) { const r = await sb.from("employees").select(F).in("id", ids); emps = (r.data || []) as any; }   // before the link column exists: everyone is paid into their own account
  const targets = [...new Set((emps || []).map((e: any) => e.pay_to_employee_id).filter(Boolean))] as string[];
  const { data: tgt } = targets.length ? await sb.from("employees").select(F).in("id", targets) : { data: [] as any[] };
  const pool = [...(emps || []), ...(tgt || [])] as EmpBank[];
  const eff = due.map((l: any) => ({ l, name: String(l.snapshot?.name ?? ""), b: bankFor(l.employee_id, l.snapshot, pool), left: Math.round((num(l.net) - (paid.get(l.id) ?? 0)) * 100) / 100 }));
  const missing = eff.filter((x) => !(x.b.account && x.b.ifsc)).map((x) => x.name || "Employee");
  if (missing.length && p.get("skipMissing") !== "1") return new NextResponse(`No account number or IFSC for: ${missing.join(", ")}.`, { status: 422 });
  // people paid into the same account are one line on the letter, under the account holder's name
  const groups = new Map<string, typeof eff>(); eff.filter((x) => x.b.account && x.b.ifsc).forEach((x) => { const k = `${x.b.account}|${x.b.ifsc}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(x); });
  const rows: BankLetterRow[] = [...groups.values()].map((g) => { const b = g[0].b; const others = g.filter((x) => x.name !== b.holder).map((x) => x.name); const ownerIn = g.some((x) => x.name === b.holder);
    return { name: others.length ? `${b.holder} (${ownerIn ? "incl." : "for"} ${others.join(", ")})` : b.holder, amount: Math.round(g.reduce((s, x) => s + x.left, 0) * 100) / 100, bank: b.bank, branch: b.branch, account: b.account, ifsc: b.ifsc }; }).sort((a, b) => a.name.localeCompare(b.name));
  const ym = String(run.pay_month).slice(0, 7); const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
  const pdf = await buildBankLetter({ refNo: clean("ref", 60) || `CIPCO/SAL/${ym}`, date: today, bankName: clean("bank"), bankBranch: clean("branch"), debitAccount: clean("account", 30), mode, valueDate: value, payMonth: monthName(ym), projectName: proj?.name ?? "", rows });
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Salary bank letter ${ym}.pdf"` } });
}
