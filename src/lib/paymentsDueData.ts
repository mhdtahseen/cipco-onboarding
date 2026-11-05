import type { SupabaseClient } from "@supabase/supabase-js";
import { istToday, tripRate, type TransportRate } from "./attendance";
import { chargeOf, monthOf, monthsBilled, type Adjustment, type Landlord, type Rent, type Room } from "./accommodation";
import { creditWindow, monthName, statDue, statutoryTotals } from "./payroll";
import type { Bank, NotIncluded, Payee, ProjectDues } from "./pdf/paymentsDue";
import { bankFor } from "./payee";

export type KeyedPayee = Payee & { key: string };
export type PaymentsDue = { projects: (Omit<ProjectDues, "payees"> & { id: string; payees: KeyedPayee[] })[]; notIncluded: NotIncluded };

const num = (v: unknown) => Number(v ?? 0);
const dm = (iso: string) => new Date(iso + "T00:00:00+05:30").toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const span = (a: string, b: string) => (a === b ? dm(a) : `${dm(a)}–${dm(b)}`);

// Whole tables, 1000 rows at a time (the database returns at most that many per request).
async function all<T>(q: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) { const { data, error } = await q().range(off, off + 999); if (error) throw new Error(error.message); out.push(...((data || []) as T[])); if (!data || data.length < 1000) break; }
  return out;
}

/** Who is owed what, project by project: the total billed, how much of it is paid, and the pending part. Anything paid beyond the billed total is an advance (shown by the report as a credit). Admin only (reads payroll). */
export async function loadPaymentsDue(sb: SupabaseClient): Promise<PaymentsDue> {
  const today = istToday(), thisMonth = monthOf(today);
  const [projects, vendors, bills, vpays, vehicles, rates, runsT, errands, tpays, rooms, rents, rpays, pruns, plines, ppays, spays, bank] = await Promise.all([
    all<{ id: string; name: string }>(() => sb.from("projects").select("id, name").order("name")),
    all<{ id: string; name: string; project_id: string | null }>(() => sb.from("food_vendors").select("id, name, project_id").order("sort_order")),
    all<any>(() => sb.from("vendor_bills").select("id, vendor_id, project_id, bill_no, bill_from, bill_to, bill_amount, approved_amount, status").is("voided_at", null).order("bill_from")),
    all<{ vendor_id: string; amount: number }>(() => sb.from("vendor_payments").select("vendor_id, amount").is("voided_at", null)),
    all<{ id: string; name: string; operator: string; billing: string; project_id: string | null }>(() => sb.from("transport_vehicles").select("id, name, operator, billing, project_id")),
    all<TransportRate>(() => sb.from("transport_rates").select("id, vehicle_id, price, effective_from")),
    all<{ vehicle_id: string; work_date: string; status: string }>(() => sb.from("transport_runs").select("vehicle_id, work_date, status").order("work_date")),
    all<{ vehicle_id: string; amount: number }>(() => sb.from("transport_errands").select("vehicle_id, amount").is("voided_at", null)),
    all<{ vehicle_id: string; amount: number }>(() => sb.from("transport_payments").select("vehicle_id, amount").is("voided_at", null)),
    all<Room>(() => sb.from("accommodation_rooms").select("*")),
    all<Rent>(() => sb.from("accommodation_rents").select("*")),
    all<{ room_id: string; amount: number }>(() => sb.from("accommodation_payments").select("room_id, amount").is("voided_at", null)),
    all<{ id: string; project_id: string; pay_month: string; status: string }>(() => sb.from("payroll_runs").select("id, project_id, pay_month, status")),
    all<any>(() => sb.from("payroll_lines").select("id, run_id, employee_id, project_id, net, held, pay_mode, kind, pf_emp, pf_er, pf_admin, esi_emp, esi_er, pt, snapshot")),
    all<{ line_id: string; amount: number }>(() => sb.from("payroll_payments").select("line_id, amount").is("voided_at", null)),
    all<{ project_id: string; pay_month: string; kind: string; amount: number }>(() => sb.from("statutory_payments").select("project_id, pay_month, kind, amount").is("voided_at", null)),
    sb.from("payee_bank").select("*").then((r: any) => (r.error ? [] : (r.data || []) as any[])),   // not created yet = no bank details yet
  ]);
  const pname = new Map(projects.map((p) => [p.id, p.name]));
  const by = new Map<string, KeyedPayee[]>(); const notIncluded: NotIncluded = [];
  const add = (pid: string | null, p: KeyedPayee) => { if (!pid || (p.total - p.paid <= 0.004 && p.paid - p.total <= 0.004)) return; (by.get(pid) ?? by.set(pid, []).get(pid)!).push(p); };
  const sumBy = <T extends Record<string, any>>(rows: T[], k: string, id: string, f: string = "amount") => rows.filter((r) => r[k] === id).reduce((s, r) => s + num(r[f]), 0);
  const bankOf = (kind: string, id: string): Bank | null => { const b = bank.find((x: any) => x.kind === kind && x.ref_id === id); if (!b || !(b.account_no || b.upi)) return null; return { holder: b.holder, bank: b.bank, branch: b.branch, accountNo: b.account_no, ifsc: b.ifsc, upi: b.upi }; };

  // Food: approved bills only. Payments are not tied to a bill, so they are applied to the oldest bill first.
  vendors.forEach((v) => {
    const mine = bills.filter((b) => b.vendor_id === v.id); const ap = mine.filter((b) => b.status === "approved");
    mine.filter((b) => b.status !== "approved").forEach((b) => notIncluded.push({ label: `${pname.get(b.project_id ?? v.project_id ?? "") ?? "—"} · ${v.name} · Bill ${b.bill_no || "(no number)"}, ${span(b.bill_from, b.bill_to)} (received, not approved yet)`, amount: num(b.bill_amount) }));
    const total = ap.reduce((s, b) => s + num(b.approved_amount ?? b.bill_amount), 0), paid = sumBy(vpays, "vendor_id", v.id); let left = paid; let oldest: string | null = null;
    const lines = ap.map((b) => { const t = num(b.approved_amount ?? b.bill_amount), p = Math.min(t, left); left -= p; if (p < t && !oldest) oldest = b.bill_to; return { label: `Bill ${b.bill_no || "–"} · ${span(b.bill_from, b.bill_to)}`, total: t, paid: p }; });
    add(v.project_id, { key: `food:${v.id}`, category: "food", name: v.name, forWhat: ap.length ? `${ap.length} approved bill${ap.length === 1 ? "" : "s"}` : "Paid ahead of any approved bill", total, paid, oldestDue: oldest, bank: bankOf("food_vendor", v.id), lines });
  });

  // Transport: per-trip vehicles bill the trips that showed up; monthly vehicles bill each month that has records; errands are extra.
  vehicles.forEach((v) => {
    const mine = runsT.filter((r) => r.vehicle_id === v.id); let total = 0, unpriced = 0;
    if (v.billing === "per_trip") mine.filter((r) => r.status === "showed").forEach((r) => { const pr = tripRate(rates, v.id, r.work_date); if (pr === null) unpriced++; else total += pr; });
    else { const first: Record<string, string> = {}; mine.forEach((r) => { const m = r.work_date.slice(0, 7); if (!first[m] || r.work_date < first[m]) first[m] = r.work_date; }); Object.values(first).forEach((d) => { const pr = tripRate(rates, v.id, d); if (pr === null) unpriced++; else total += pr; }); }
    const er = errands.filter((e) => e.vehicle_id === v.id); total += er.reduce((s, e) => s + num(e.amount), 0);
    if (unpriced) notIncluded.push({ label: `${pname.get(v.project_id ?? "") ?? "—"} · ${v.name}: ${unpriced} ${v.billing === "monthly" ? "month" : "trip"}${unpriced === 1 ? " has" : "s have"} no price set, so ${unpriced === 1 ? "it is" : "they are"} not in the amount` });
    add(v.project_id, { key: `transport:${v.id}`, category: "transport", name: v.operator || v.name, forWhat: `${v.name} · ${v.billing === "monthly" ? "monthly hire" : "per-trip hire"}${er.length ? ` + ${er.length} errand${er.length === 1 ? "" : "s"}` : ""}`, total, paid: sumBy(tpays, "vehicle_id", v.id), bank: bankOf("vehicle", v.id) });
  });

  // landlords and month adjustments (2026-11-accommodation-landlords.sql): without them, rooms are grouped by the landlord name typed on them and every month is charged in full
  const landlords = await (async () => { try { return await all<Landlord>(() => sb.from("accommodation_landlords").select("id, name")); } catch { return [] as Landlord[]; } })();
  const adjs = await (async () => { try { return (await all<any>(() => sb.from("accommodation_adjustments").select("*"))).map((a) => ({ ...a, amount: num(a.amount) })) as Adjustment[]; } catch { return [] as Adjustment[]; } })();
  const landlordName = new Map(landlords.map((l) => [l.id, l.name]));
  // Accommodation: the rent charged for every month billed up to this month (a full month, unless a month was adjusted to a part amount or to nothing); payments are applied to the oldest month first.
  // Rooms of the same landlord on a project are one person to pay, so they are one row, with the landlord's bank details.
  const lords = new Map<string, { pid: string; name: string; id: string; landlordId: string | null; rooms: Room[] }>();
  rooms.forEach((r) => { const lid = (r as Room).landlord_id ?? null; const k = lid ? `${r.project_id}:${lid}` : r.landlord.trim() ? `${r.project_id}:${r.landlord.trim().toLowerCase()}` : `room:${r.id}`;
    const e = lords.get(k) ?? { pid: r.project_id, name: (lid && landlordName.get(lid)) || r.landlord.trim() || r.name, id: r.id, landlordId: lid, rooms: [] }; e.rooms.push(r); lords.set(k, e); });
  lords.forEach((g, k) => {
    let total = 0, paid = 0, oldest: string | null = null, nMonths = 0;
    const lines = g.rooms.map((r) => { const months = monthsBilled(r, thisMonth), rent = months.map((m) => chargeOf(r, rents, adjs, m)), t = rent.reduce((a, x) => a + x, 0), p = sumBy(rpays, "room_id", r.id); let left = p;
      months.forEach((m, i) => { const q = Math.min(rent[i], left); left -= q; if (q < rent[i] && (!oldest || `${m}-01` < oldest)) oldest = `${m}-01`; }); total += t; paid += p; nMonths += months.length; return { label: `${r.name}`, total: t, paid: Math.min(p, t) }; });
    const b = (g.landlordId ? bankOf("landlord", g.landlordId) : null) ?? g.rooms.map((r) => bankOf("room", r.id)).find(Boolean) ?? null;
    add(g.pid, { key: k.startsWith("room:") ? k : `landlord:${k}`, category: "accommodation", name: g.name, forWhat: g.rooms.length === 1 ? `${g.rooms[0].name} · rent, ${nMonths} month${nMonths === 1 ? "" : "s"} billed` : `${g.rooms.length} rooms · rent`, total, paid, oldestDue: oldest, bank: b, lines: g.rooms.length > 1 ? lines : undefined });
  });

  // Gas and hired equipment: approved site bills only; payments are applied to the oldest bill first. Not created until the consumables migration is run: then there is simply nothing here.
  const soft = async <T,>(q: () => any): Promise<T[]> => { try { return await all<T>(q); } catch { return []; } };
  // people whose salary goes into another employee's account (the column exists once 2026-11-pay-to-account.sql is run)
  const linked = await soft<{ id: string; pay_to_employee_id: string }>(() => sb.from("employees").select("id, pay_to_employee_id").not("pay_to_employee_id", "is", null));
  const linkTargets = linked.length ? await soft<any>(() => sb.from("employees").select("id, full_name, bank_name, bank_branch, account_no, ifsc").in("id", [...new Set(linked.map((x) => x.pay_to_employee_id))])) : [];
  const linkPool = [...linked.map((x) => ({ id: x.id, full_name: "", pay_to_employee_id: x.pay_to_employee_id })), ...linkTargets];
  const [gvendors, sbills, spayments, gterms] = await Promise.all([
    soft<{ id: string; name: string; kind: string }>(() => sb.from("gas_vendors").select("id, name, kind")),
    soft<any>(() => sb.from("site_bills").select("id, kind, vendor_id, project_id, bill_no, bill_date, period_from, period_to, bill_amount, approved_amount, status").is("voided_at", null).order("bill_date")),
    soft<{ vendor_id: string; project_id: string; kind: string; amount: number }>(() => sb.from("site_payments").select("vendor_id, project_id, kind, amount").is("voided_at", null)),
    soft<any>(() => sb.from("gas_terms").select("vendor_id, due_day_first_half, due_day_second_half")),
  ]);
  const gdue = (vid: string, billDate: string) => { const t = gterms.find((x: any) => x.vendor_id === vid); if (!t) return billDate; const [y, m, d] = billDate.split("-").map(Number); const first = d <= 15; const mm = first ? m : m + 1; const yy = mm > 12 ? y + 1 : y; const day = first ? t.due_day_first_half : t.due_day_second_half; return `${yy}-${String(mm > 12 ? 1 : mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`; };
  const sv = new Map<string, any[]>(); sbills.forEach((b) => { const k = `${b.vendor_id}|${b.project_id}|${b.kind}`; (sv.get(k) ?? sv.set(k, []).get(k)!).push(b); });
  const spaid = new Map<string, number>(); spayments.forEach((p) => { const k = `${p.vendor_id}|${p.project_id}|${p.kind}`; spaid.set(k, (spaid.get(k) ?? 0) + num(p.amount)); });
  new Set([...sv.keys(), ...spaid.keys()]).forEach((k) => { const [vid, pid, kind] = k.split("|"); const v = gvendors.find((x) => x.id === vid); const mine = sv.get(k) ?? []; const ap = mine.filter((b) => b.status === "approved");
    mine.filter((b) => b.status !== "approved").forEach((b) => notIncluded.push({ label: `${pname.get(pid) ?? "—"} · ${v?.name ?? "Vendor"} · Bill ${b.bill_no || "(no number)"}, ${span(b.period_from, b.period_to)} (received, not approved yet)`, amount: num(b.bill_amount) }));
    const total = ap.reduce((s, b) => s + num(b.approved_amount ?? b.bill_amount), 0), paid = spaid.get(k) ?? 0; let left = paid; let oldest: string | null = null;
    const lines = ap.map((b) => { const t = num(b.approved_amount ?? b.bill_amount), p = Math.min(t, left); left -= p; if (p < t && !oldest) oldest = kind === "gas" ? gdue(vid, b.bill_date) : b.bill_date; return { label: `Bill ${b.bill_no || "–"} · ${span(b.period_from, b.period_to)}`, total: t, paid: p }; });
    add(pid, { key: `${kind}:${vid}:${pid}`, category: kind === "gas" ? "gas" : "equipment", name: v?.name ?? "Vendor", forWhat: ap.length ? `${ap.length} approved bill${ap.length === 1 ? "" : "s"}` : "Paid ahead of any approved bill", total, paid, oldestDue: oldest, bank: bankOf(kind === "gas" ? "gas_vendor" : "equipment_vendor", vid), lines }); });

  // Salaries: one row per person for the months not yet fully paid. A payroll that is still a draft is included but marked draft (its amounts can change until it is approved).
  // A salary on hold is not due, so it is listed as not included.
  const runOf = new Map(pruns.map((r) => [r.id, r])); const paidOn = new Map<string, number>(); ppays.forEach((p) => paidOn.set(p.line_id, (paidOn.get(p.line_id) ?? 0) + num(p.amount)));
  const person = new Map<string, { pid: string; sn: any; mode: string; total: number; paid: number; months: string[]; draft: boolean }>();
  plines.filter((l) => runOf.has(l.run_id) && num(l.net) > 0).forEach((l) => {
    const run = runOf.get(l.run_id)!, ym = String(run.pay_month).slice(0, 7), paid = paidOn.get(l.id) ?? 0, net = num(l.net); if (paid >= net) return;
    if (l.held) { notIncluded.push({ label: `${pname.get(l.project_id) ?? "—"} · ${l.snapshot?.name ?? "Employee"}: salary ${monthName(ym)} is on hold`, amount: net - paid }); return; }
    const k = `${l.employee_id}:${l.project_id}`; const e = person.get(k) ?? { pid: l.project_id, sn: l.snapshot ?? {}, mode: l.pay_mode, total: 0, paid: 0, months: [] as string[], draft: false }; e.total += net; e.paid += paid; e.months.push(ym); if (run.status !== "approved") e.draft = true; person.set(k, e);
  });
  person.forEach((e, k) => { const ms = e.months.sort(), sn = e.sn; const via = e.mode === "bank" ? bankFor(k.split(":")[0], sn, linkPool as any) : null; const acct = via && via.via ? via : null;
    const bank: Bank | null = e.mode === "upi" ? (sn.upi_id ? { upi: sn.upi_id } : null) : e.mode === "bank" ? (acct ? (acct.account ? { holder: acct.holder, bank: acct.bank, branch: acct.branch, accountNo: acct.account, ifsc: acct.ifsc } : null) : sn.account_no ? { bank: sn.bank_name, accountNo: sn.account_no, ifsc: sn.ifsc } : null) : null;
    add(e.pid, { key: `salary:${k}`, category: "salary", name: sn.name ?? "Employee", forWhat: `Salary ${ms.map((m) => monthName(m).replace(/ \d{4}$/, "")).join(", ")}${sn.designation ? ` · ${sn.designation}` : ""}${acct ? ` · paid into ${acct.via}'s account` : ""}`, total: e.total, paid: e.paid, oldestDue: creditWindow(ms[0]).to, draft: e.draft, bank, mode: e.mode === "cash" ? "cash" : e.mode === "upi" ? "upi" : "bank" }); });

  // PF, ESI and Professional Tax for approved payroll months, against what has been remitted.
  const KIND = { pf: "Provident fund (EPFO)", esi: "ESI (ESIC)", pt: "Professional tax" } as const;
  const stat = new Map<string, { total: number; paid: number; months: string[]; oldest: string | null }>();
  pruns.filter((r) => r.status === "approved").forEach((run) => { const t = statutoryTotals(plines.filter((l) => l.run_id === run.id)); const ym = String(run.pay_month).slice(0, 7);
    (["pf", "esi", "pt"] as const).forEach((k) => { const total = t[k]; if (total <= 0) return; const paid = spays.filter((s) => s.project_id === run.project_id && String(s.pay_month).slice(0, 7) === ym && s.kind === k).reduce((s, x) => s + num(x.amount), 0);
      if (paid >= total) return; const key = `${run.project_id}:${k}`; const e = stat.get(key) ?? { total: 0, paid: 0, months: [], oldest: null }; e.total += total; e.paid += Math.min(paid, total); e.months.push(ym); const due = statDue(ym, k); if (!e.oldest || due < e.oldest) e.oldest = due; stat.set(key, e); }); });
  stat.forEach((e, key) => { const [pid, k] = key.split(":") as [string, keyof typeof KIND]; add(pid, { key: `statutory:${key}`, category: "statutory", name: KIND[k], forWhat: `${e.months.sort().map((m) => monthName(m).replace(/ \d{4}$/, "")).join(", ")}: pay on the government portal`, total: e.total, paid: e.paid, oldestDue: e.oldest, mode: "portal" }); });

  const out = projects.filter((p) => by.has(p.id)).map((p) => ({ id: p.id, name: p.name, payees: by.get(p.id)! }));
  return { projects: out, notIncluded };
}
