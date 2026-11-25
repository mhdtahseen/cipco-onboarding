import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./supabase/admin";
import { loadPaymentsDue } from "./paymentsDueData";
import { viewOf } from "./paymentsDueView";
import { CATEGORY_LABEL } from "./pdf/paymentsDue";
import { loadBills } from "./billsData";
import { DOC_TYPES } from "./types";
import type { Snapshot } from "./reminders";
import { depositState, rentFor, vendorNextBills } from "./rentals";
import { loadRentalBook } from "./rentalBook";

// Everything the Dashboard shows (the plain address, Admin only), gathered in one call. Each part is read on its own: if one fails, its section is left out
// and named in `warnings`, the rest still shows. Numbers are sent per project where it matters, so the page's site picker filters without asking again.
export type DashSite = { id: string; name: string; people: number; marked: number; unmarked: number; worked: number; workDay: boolean; meals: { breakfast: number; lunch: number; dinner: number };
  legsExpected: number; legsRecorded: number; hasSupervisor: boolean; submittedAt: string | null; verifiedAt: string | null; missing: string[] };
export type DashAlert = { level: "bad" | "warn" | "info"; text: string; href: string; p?: string | null };
export type Dash = {
  today: string; minutes: number; projects: { id: string; name: string }[]; sites: DashSite[];
  att: { d: string; p: string; present: number; half: number; absent: number }[];
  emps: { p: string | null; ho: boolean; stage: string; join: string | null; left: string | null }[];
  docsMissing: { p: string | null; type: string; label: string }[];
  dues: { p: string; cat: string; label: string; overdue: number; pending: number }[];
  payees: { p: string; name: string; label: string; overdue: number; pending: number }[];
  spend: { m: string; p: string; c: string; amt: number }[]; cats: { id: string; name: string }[];
  payroll: { p: string; month: string; status: string }[];
  billsNoFile: number; jsl: { authorized: number; failed: number; needsCheck: number; sending: number; toReview: number };
  docs: { title: string; validUntil: string; days: number }[];
  app: { activeToday: number; users: number; siteUsersNoDevice: number };
  alerts: DashAlert[]; warnings: string[];
};

type Any = Record<string, any>;
async function all(q: () => any): Promise<Any[]> {
  const out: Any[] = [];
  for (let off = 0; ; off += 1000) { const { data, error } = await q().range(off, off + 999); if (error) throw new Error(error.message); out.push(...(data || [])); if (!data || data.length < 1000) return out; }
}
const ist = (now: Date) => now.toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" });
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const addMonths = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const REQUIRED_DOCS = ["aadhaar", "pan", "bank"];

export async function loadDashboard(sb: SupabaseClient): Promise<Dash> {
  const now = new Date(), stamp = ist(now), today = stamp.slice(0, 10), minutes = Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16)), month = today.slice(0, 7);
  const warnings: string[] = [];
  const safe = async <T,>(label: string, f: () => Promise<T>, empty: T): Promise<T> => { try { return await f(); } catch (e) { warnings.push(`${label}: ${(e as Error).message}`); return empty; } };

  const [projects, snap, attRows, emps, edocs, due, exps, cats, runs, bills, inv, cdocs, sessions, roles, subs, rentals] = await Promise.all([
    safe("Projects", () => all(() => sb.from("projects").select("id, name, status").eq("status", "active").order("name")), [] as Any[]),
    safe("Today at the sites", async () => { const { data, error } = await adminClient().rpc("day_watch_snapshot", { p_date: today }); if (error) throw new Error(error.message); return data as Snapshot; }, null as Snapshot | null),
    safe("Attendance", () => all(() => sb.from("attendance").select("work_date, status, project_id").gte("work_date", addDays(today, -29)).lte("work_date", today)), [] as Any[]),
    safe("Employees", () => all(() => sb.from("employees").select("id, stage, outcome, project_id, stationed_at, join_date, left_on")), [] as Any[]),
    safe("Employee documents", () => all(() => sb.from("employee_documents").select("employee_id, doc_type, status, file_path").in("doc_type", REQUIRED_DOCS)), [] as Any[]),
    safe("Payments due", () => loadPaymentsDue(sb), null as Awaited<ReturnType<typeof loadPaymentsDue>> | null),
    safe("Expenses", () => all(() => sb.from("project_expenses").select("project_id, category_id, expense_date, amount").gte("expense_date", `${addMonths(month, -5)}-01`)), [] as Any[]),
    safe("Expense categories", () => all(() => sb.from("expense_categories").select("id, name")), [] as Any[]),
    safe("Payroll", () => all(() => sb.from("payroll_runs").select("project_id, pay_month, status").gte("pay_month", `${addMonths(month, -1)}-01`)), [] as Any[]),
    safe("Bills", () => loadBills(sb).then((b) => b.rows), [] as Awaited<ReturnType<typeof loadBills>>["rows"]),
    safe("Inventory", () => all(() => sb.from("inventory_bills").select("project_id, status, jsl_status, jsl_wanted").is("voided_at", null).or("status.eq.submitted,jsl_status.in.(authorized,failed,needs_check,sending,submitting)")), [] as Any[]),
    all(() => sb.from("company_documents").select("title, valid_until").is("archived_at", null).not("valid_until", "is", null).lte("valid_until", addDays(today, 45))).catch(() => [] as Any[]),   // not there before its migration: simply no section
    safe("App activity", () => all(() => sb.from("usage_sessions").select("user_id, last_seen_at").gte("last_seen_at", new Date(Date.parse(today + "T00:00:00+05:30")).toISOString())), [] as Any[]),
    safe("Users", () => all(() => sb.from("user_roles").select("user_id, role")), [] as Any[]),
    safe("Phones", () => all(() => adminClient().from("push_subscriptions").select("user_id")), [] as Any[]),
    loadRentalBook(sb),   // rented items: before the migrations, simply no alerts
  ]);

  const pname = new Map(projects.map((p) => [p.id, p.name as string]));
  const sites: DashSite[] = (snap?.projects ?? []).filter((x) => pname.has(x.project_id)).map((x) => ({ id: x.project_id, name: x.name, people: x.r.people, marked: x.r.marked, unmarked: x.r.unmarked, worked: x.r.worked, workDay: x.r.work_day,
    meals: x.r.meals, legsExpected: x.r.legs_expected, legsRecorded: x.r.legs_recorded, hasSupervisor: x.r.has_supervisor, submittedAt: x.submitted_at, verifiedAt: x.verified_at, missing: x.r.missing ?? [] }));

  const am = new Map<string, { d: string; p: string; present: number; half: number; absent: number }>();
  attRows.forEach((r) => { if (r.status === "off") return; const k = `${r.work_date}|${r.project_id}`; const x = am.get(k) ?? { d: r.work_date, p: r.project_id, present: 0, half: 0, absent: 0 }; x[r.status as "present" | "half" | "absent"]++; am.set(k, x); });

  const live = emps.filter((e) => e.outcome === "active");
  const onboarded = new Map(live.filter((e) => e.stage === "onboarded" && (!e.left_on || e.left_on > today)).map((e) => [e.id, e]));
  const docOk = new Set(edocs.filter((d) => d.file_path || ["received", "verified", "not_required"].includes(d.status)).map((d) => `${d.employee_id}|${d.doc_type}`));
  const docsMissing: Dash["docsMissing"] = [];
  onboarded.forEach((e) => REQUIRED_DOCS.forEach((t) => { if (!docOk.has(`${e.id}|${t}`)) docsMissing.push({ p: e.project_id ?? null, type: t, label: DOC_TYPES.find((d) => d.key === t)?.label ?? t }); }));

  const dues: Dash["dues"] = [], payees: Dash["payees"] = [];
  (due?.projects ?? []).forEach((pr) => pr.payees.forEach((py) => {
    const v = viewOf(py, { scope: "now", month, lens: "due", running: false, includePaid: false, today }); if (!v || (v.pending <= 0.5 && v.overdue <= 0.5)) return;
    const label = CATEGORY_LABEL[py.category] ?? py.category;
    const hit = dues.find((x) => x.p === pr.id && x.cat === py.category); if (hit) { hit.overdue += v.overdue; hit.pending += v.pending; } else dues.push({ p: pr.id, cat: py.category, label, overdue: v.overdue, pending: v.pending });
    payees.push({ p: pr.id, name: py.name, label, overdue: v.overdue, pending: v.pending });
  }));

  const sm = new Map<string, Dash["spend"][number]>();
  exps.forEach((e) => { const m = String(e.expense_date).slice(0, 7), k = `${m}|${e.project_id}|${e.category_id}`; const x = sm.get(k) ?? { m, p: e.project_id, c: e.category_id, amt: 0 }; x.amt += Number(e.amount) || 0; sm.set(k, x); });

  const since = addDays(today, -90);
  const billsNoFile = bills.filter((b) => !b.file && b.date >= since).length;
  const jsl = { authorized: 0, failed: 0, needsCheck: 0, sending: 0, toReview: 0 };
  inv.forEach((b) => { if (b.status === "submitted") jsl.toReview++; if (!b.jsl_wanted) return; if (b.jsl_status === "authorized") jsl.authorized++; else if (b.jsl_status === "failed") jsl.failed++; else if (b.jsl_status === "needs_check") jsl.needsCheck++; else if (b.jsl_status === "sending" || b.jsl_status === "submitting") jsl.sending++; });
  const docs = cdocs.map((d) => ({ title: d.title as string, validUntil: d.valid_until as string, days: Math.round((Date.parse(d.valid_until + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000) })).sort((a, b) => a.days - b.days);
  const withPhone = new Set(subs.map((s) => s.user_id));
  const siteUsers = roles.filter((r) => ["supervisor", "site_engineer", "attendance"].includes(r.role));
  const app = { activeToday: new Set(sessions.map((s) => s.user_id)).size, users: roles.length, siteUsersNoDevice: siteUsers.filter((r) => !withPhone.has(r.user_id)).length };

  // ---------- what needs attention, most urgent first ----------
  const alerts: DashAlert[] = []; const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  const sunday = new Date(today + "T00:00:00Z").getUTCDay() === 0;
  sites.forEach((s) => {
    if (!s.people) return;   // nobody is posted there: nothing to chase
    if (!s.hasSupervisor) alerts.push({ level: "bad", p: s.id, text: `${s.name}: no supervisor is assigned to this site`, href: "/users" });
    if (!sunday && s.unmarked > 0 && minutes >= 10 * 60 + 30) alerts.push({ level: minutes >= 15 * 60 ? "bad" : "warn", p: s.id, text: `${s.name}: ${plural(s.unmarked, "person", "people")} not marked today`, href: "/attendance" });
    if (s.submittedAt && !s.verifiedAt) alerts.push({ level: "info", p: s.id, text: `${s.name}: the day is submitted and waits for your check`, href: "/attendance" });
  });
  const overdue = dues.reduce((s, x) => s + x.overdue, 0), overduePayees = payees.filter((x) => x.overdue > 0.5).length;
  if (overdue > 0.5) alerts.push({ level: "bad", text: `${inr(overdue)} is overdue to ${plural(overduePayees, "payee")}`, href: "/expenses?tab=due" });
  // purchases on credit fall due at the month end: a reminder in its last 3 days
  { const [y, m] = today.split("-").map(Number); const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); const left = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
    const credit = dues.filter((x) => x.cat === "purchases").reduce((s, x) => s + x.pending, 0);
    if (left <= 3 && credit > 0.5) alerts.push({ level: left <= 1 ? "bad" : "warn", text: `${inr(credit)} of purchases on credit is due ${left === 0 ? "today" : `in ${plural(left, "day")}`} (month end)`, href: "/inventory?tab=vendors" }); }
  if (jsl.failed + jsl.needsCheck > 0) alerts.push({ level: "bad", text: `JSL portal: ${[jsl.failed && `${plural(jsl.failed, "bill")} failed`, jsl.needsCheck && `${jsl.needsCheck} to check on the portal`].filter(Boolean).join(", ")}`, href: "/inventory" });
  docs.forEach((d) => alerts.push({ level: d.days <= 7 ? "bad" : "warn", text: d.days < 0 ? `${d.title} expired ${plural(-d.days, "day")} ago` : d.days === 0 ? `${d.title} expires today` : `${d.title} expires in ${plural(d.days, "day")}`, href: "/company" }));
  if (jsl.toReview) alerts.push({ level: "warn", text: `${plural(jsl.toReview, "inventory bill")} waiting for review`, href: "/inventory" });
  const prev = addMonths(month, -1), day = Number(today.slice(8, 10));
  if (day >= 3) projects.forEach((p) => { const r = runs.find((x) => x.project_id === p.id && String(x.pay_month).slice(0, 7) === prev); if (!r && !sites.find((x) => x.id === p.id)?.people) return; if (!r || r.status !== "approved") alerts.push({ level: day >= 7 ? "bad" : "warn", p: p.id, text: `${p.name}: payroll for ${new Date(prev + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long" })} is ${r ? "not approved yet" : "not started"}`, href: "/payroll" }); });
  if (app.siteUsersNoDevice) alerts.push({ level: "warn", text: `${plural(app.siteUsersNoDevice, "site login")} without a phone registered for reminders`, href: "/users" });
  if (billsNoFile) alerts.push({ level: "warn", text: `${plural(billsNoFile, "payment")} in the last 90 days without a bill`, href: "/expenses?tab=bills" });
  if (jsl.authorized) alerts.push({ level: "info", text: `${plural(jsl.authorized, "bill")} authorized for the JSL portal, going out at 08:30`, href: "/inventory" });
  // rented items: a rent period about to renew (return them first if they are not needed), a month-end bill due, a deposit waiting to come back
  // per vendor and project: the next bill expected by the vendor's billing setting (2026-11-rentals-vendor.sql)
  const rbook = rentals; const groups = new Map<string, typeof rbook.rentals>(); rbook.rentals.forEach((r) => { const k = `${r.vendor_id}|${r.project_id}`; groups.set(k, [...(groups.get(k) ?? []), r]); });
  groups.forEach((rs) => {
    const vt = rbook.vterms(rs[0].vendor_id), vname = rs[0].vendor_name;
    if (vt.billing !== "on_return") vendorNextBills(rs, vt, today).forEach((nb) => {
      const days = nb.dueOn ? Math.round((Date.parse(nb.dueOn + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000) : null; if (days === null || days < 0 || days > 3) return;
      const amt = rs.filter((r) => nb.rentalIds.includes(r.id)).reduce((s, r) => s + rentFor(r, r.items, r.rates, r.terms, nb.from, nb.to).total, 0); const span = `${nb.from.slice(8)}/${nb.from.slice(5, 7)}–${nb.to.slice(8)}/${nb.to.slice(5, 7)}`;
      const when = days === 0 ? "today" : `in ${plural(days, "day")}`;
      alerts.push({ level: days <= 1 ? "bad" : "warn", p: rs[0].project_id, href: "/site-supplies", text: vt.billing === "month_end" ? `${vname}: month-end rent bill expected ${when} (about ${inr(amt)} for ${span})` : `${vname}: rent for ${span} due ${when} (about ${inr(amt)}). Return what is not needed first` });
    });
    rs.forEach((r) => { const dep = depositState(r, r.terms);
      if (dep.toCollect > 0 && r.returned_on) alerts.push({ level: "warn", p: r.project_id, href: "/site-supplies", text: `${vname}: deposit ${inr(dep.toCollect)} to collect (items returned ${r.returned_on.slice(8)}/${r.returned_on.slice(5, 7)})` }); });
  });
  if (docsMissing.length) alerts.push({ level: "info", text: `${plural(docsMissing.length, "Aadhaar, PAN or bank document")} missing for people on the rolls`, href: "/employees" });
  const rank = { bad: 0, warn: 1, info: 2 }; alerts.sort((a, b) => rank[a.level] - rank[b.level]);

  return {
    today, minutes, projects: projects.map((p) => ({ id: p.id, name: p.name })), sites, att: [...am.values()].sort((a, b) => a.d.localeCompare(b.d)),
    emps: live.filter((e) => e.stage !== "onboarded" || !e.left_on || e.left_on >= `${month}-01`).map((e) => ({ p: e.project_id ?? null, ho: e.stationed_at === "head_office", stage: e.stage, join: e.join_date ?? null, left: e.left_on ?? null })),
    docsMissing, dues, payees: payees.sort((a, b) => b.overdue - a.overdue || b.pending - a.pending).slice(0, 40), spend: [...sm.values()], cats: cats.map((c) => ({ id: c.id, name: c.name })),
    payroll: runs.map((r) => ({ p: r.project_id, month: String(r.pay_month).slice(0, 7), status: r.status })), billsNoFile, jsl, docs, app, alerts, warnings,
  };
}
