import { mayView } from "@/lib/permsServer";
import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { loadPaymentsDue } from "@/lib/paymentsDueData";
import { buildPaymentsDue, type Payee } from "@/lib/pdf/paymentsDue";
import { titleOf, viewOf, type Lens, type PayeeView, type Scope, type View } from "@/lib/paymentsDueView";

/** One payee as the report shows it for the chosen view: only the items in the view, what they come to, and what is still running. */
const toPayee = (v: PayeeView): Payee => ({ ...v.payee, total: v.total, paid: v.paid + v.advance, running: v.runningTotal || undefined, oldestDue: v.items.filter((i) => i.state !== "running" && i.total - i.paid > 0.004 && i.dueOn).map((i) => i.dueOn!).sort()[0] ?? null,
  lines: v.items.map((i) => ({ label: `${i.label}${i.state === "running" ? " (running)" : i.dueOn ? ` · due ${i.dueOn.slice(8)}/${i.dueOn.slice(5, 7)}` : ""}`, total: i.total, paid: i.state === "running" ? 0 : i.paid })) });

// The Payments due report as a PDF. It is worked out here from the database, so what is printed cannot be edited on the way. `exclude` lists payee keys
// the Admin unticked on the page; `project` limits it to one project. Admin only.
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await mayView(sb, "expenses", "due"))) return new NextResponse("Not allowed", { status: 403 });
  const p = req.nextUrl.searchParams; const exclude = new Set((p.get("exclude") || "").split(",").filter(Boolean)), only = p.get("project") || "";
  if (only && !/^[0-9a-f-]{36}$/.test(only)) return new NextResponse("Bad request", { status: 400 });
  let d; try { d = await loadPaymentsDue(sb); } catch (e: any) { return new NextResponse(e?.message || "Could not load", { status: 500 }); }
  // the same view the page shows: what needs paying now, one month (by due date or by cost month), or all time, with or without the running costs
  const scope = (["now", "month", "all"].includes(p.get("scope") || "") ? p.get("scope") : "now") as Scope; const lens = (p.get("lens") === "cost" ? "cost" : "due") as Lens;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" }); const month = /^\d{4}-\d{2}$/.test(p.get("month") || "") ? p.get("month")! : today.slice(0, 7);
  const view: View = { scope, month, lens, running: p.get("running") === "1", includePaid: p.get("paid") === "1", today }; let leftOut = 0;
  const projects = d.projects.filter((x) => !only || x.id === only).map((x) => ({ name: x.name, payees: x.payees.filter((y) => !exclude.has(y.key) || (leftOut++, false)).map((y) => viewOf(y, view)).filter(Boolean).map((v) => toPayee(v!)) })).filter((x) => x.payees.length);
  if (!projects.length) return new NextResponse("Nothing is due for the choices made.", { status: 404 });
  const name = (u.user.user_metadata?.full_name as string) || u.user.email || "";
  const pdf = await buildPaymentsDue({ projects, leftOut, notIncluded: d.notIncluded, preparedBy: name, title: titleOf(view) });
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Payments due ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" })}.pdf"` } });
}
