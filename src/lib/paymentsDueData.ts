import type { SupabaseClient } from "@supabase/supabase-js";
import { MEALS, addDays, istToday, rateFor, tripRate, type MealRate, type TransportRate } from "./attendance";
import { chargeOf, monthOf, monthsBilled, type Adjustment, type Landlord, type Rent, type Room } from "./accommodation";
import { creditWindow, monthName, statDue, statutoryTotals } from "./payroll";
import type { Bank, NotIncluded, Payee, ProjectDues } from "./pdf/paymentsDue";
import { bankFor } from "./payee";
import { gasCost, type GMove, type GOrder, type GPricing, type GProduct, type GRate, type GRent, type GTerms } from "./gas";
import { chargeFor, type EqLog, type EqRate } from "./equipment";
import type { DueItem } from "./paymentsDueLabels";

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
    all<{ vehicle_id: string; amount: number; work_date: string }>(() => sb.from("transport_errands").select("vehicle_id, amount, work_date").is("voided_at", null)),
    all<{ vehicle_id: string; amount: number }>(() => sb.from("transport_payments").select("vehicle_id, amount").is("voided_at", null)),
    all<Room>(() => sb.from("accommodation_rooms").select("*")),
    all<Rent>(() => sb.from("accommodation_rents").select("*")),
    all<{ room_id: string; amount: number; for_month: string | null }>(() => sb.from("accommodation_payments").select("room_id, amount, for_month").is("voided_at", null)),
    all<{ id: string; project_id: string; pay_month: string; status: string }>(() => sb.from("payroll_runs").select("id, project_id, pay_month, status")),
    all<any>(() => sb.from("payroll_lines").select("id, run_id, employee_id, project_id, net, held, pay_mode, kind, pf_emp, pf_er, pf_admin, esi_emp, esi_er, pt, snapshot")),
    all<{ line_id: string; amount: number }>(() => sb.from("payroll_payments").select("line_id, amount").is("voided_at", null)),
    all<{ project_id: string; pay_month: string; kind: string; amount: number }>(() => sb.from("statutory_payments").select("project_id, pay_month, kind, amount").is("voided_at", null)),
    sb.from("payee_bank").select("*").then((r: any) => (r.error ? [] : (r.data || []) as any[])),   // not created yet = no bank details yet
  ]);
  const soft = async <T,>(q: () => any): Promise<T[]> => { try { return await all<T>(q); } catch { return []; } };   // tables that exist only after a later migration: nothing there is not an error
  const monthStart = `${thisMonth}-01`; const payDay = (ym: string) => creditWindow(ym).to;   // last month's bills are cleared on the 1st to 4th of the next month
  /** The days from `from` to `to` that no period covers, as ranges (what has not been billed yet). */
  const uncovered = (from: string, to: string, periods: { from: string; to: string }[]): [string, string][] => { const out: [string, string][] = []; let start: string | null = null; for (let d = from, n = 0; d <= to && n < 40; d = addDays(d, 1), n++) { const cov = periods.some((p) => d >= p.from && d <= p.to); if (!cov && start === null) start = d; if (cov && start !== null) { out.push([start, addDays(d, -1)]); start = null; } if (!cov && d === to && start !== null) out.push([start, d]); } return out; };
  const pname = new Map(projects.map((p) => [p.id, p.name]));
  const by = new Map<string, KeyedPayee[]>(); const notIncluded: NotIncluded = [];
  const add = (pid: string | null, p: KeyedPayee) => { const running = (p.items ?? []).filter((i) => i.state === "running").reduce((s, i) => s + i.total, 0); if (running > 0.004) p.running = running; if (!pid || (p.total - p.paid <= 0.004 && p.paid - p.total <= 0.004 && !p.running)) return; (by.get(pid) ?? by.set(pid, []).get(pid)!).push(p); };
  /** Payments are not tied to a bill, so they are applied to the oldest first. */
  const allocate = (items: DueItem[], paid: number) => { let left = paid; items.forEach((i) => { if (i.state === "running") return; const q = Math.min(i.total, left); i.paid = q; left -= q; }); };
  const sumBy = <T extends Record<string, any>>(rows: T[], k: string, id: string, f: string = "amount") => rows.filter((r) => r[k] === id).reduce((s, r) => s + num(r[f]), 0);
  const bankOf = (kind: string, id: string): Bank | null => { const b = bank.find((x: any) => x.kind === kind && x.ref_id === id); if (!b || !(b.account_no || b.upi)) return null; return { holder: b.holder, bank: b.bank, branch: b.branch, accountNo: b.account_no, ifsc: b.ifsc, upi: b.upi }; };

  // Food: approved bills are what is owed (each in the month it covers, due on the 1st to 4th of the next month). What this month's meals have cost so far and no bill covers yet is "running".
  const [mrates, matt] = await Promise.all([soft<any>(() => sb.from("meal_rates").select("*")).then((r) => r.map((x: any) => ({ ...x, price: num(x.price) })) as MealRate[]), soft<any>(() => sb.from("attendance").select("project_id, work_date, breakfast_vendor_id, lunch_vendor_id, dinner_vendor_id").gte("work_date", monthStart).lte("work_date", today))]);
  vendors.forEach((v) => {
    const mine = bills.filter((b) => b.vendor_id === v.id); const ap = mine.filter((b) => b.status === "approved");
    mine.filter((b) => b.status !== "approved").forEach((b) => notIncluded.push({ label: `${pname.get(b.project_id ?? v.project_id ?? "") ?? "—"} · ${v.name} · Bill ${b.bill_no || "(no number)"}, ${span(b.bill_from, b.bill_to)} (received, not approved yet)`, amount: num(b.bill_amount) }));
    const items: DueItem[] = ap.map((b) => ({ month: b.bill_from.slice(0, 7), label: `Bill ${b.bill_no || "–"} · ${span(b.bill_from, b.bill_to)}`, total: num(b.approved_amount ?? b.bill_amount), paid: 0, dueOn: payDay(b.bill_from.slice(0, 7)), state: "billed" as const }));
    const paidAll = sumBy(vpays, "vendor_id", v.id); allocate(items, paidAll);
    const periods = mine.map((b) => ({ from: b.bill_from, to: b.bill_to })); let running = 0;
    (matt as any[]).filter((r) => r.project_id === v.project_id && !periods.some((p) => r.work_date >= p.from && r.work_date <= p.to)).forEach((r) => MEALS.forEach((m) => { if (r[m.col] === v.id) running += rateFor(mrates, v.id, m.key, r.work_date) ?? 0; }));
    if (running > 0) items.push({ month: thisMonth, label: `Meals so far this month, not billed yet`, total: running, paid: 0, dueOn: payDay(thisMonth), state: "running" });
    const billed = items.filter((i) => i.state !== "running"), firstOpen = billed.find((i) => i.total - i.paid > 0.004);
    add(v.project_id, { key: `food:${v.id}`, category: "food", name: v.name, forWhat: ap.length ? `${ap.length} approved bill${ap.length === 1 ? "" : "s"}` : running > 0 ? "This month's meals, not billed yet" : "Paid ahead of any approved bill", total: billed.reduce((s, i) => s + i.total, 0), paid: paidAll, oldestDue: firstOpen?.dueOn ?? null, bank: bankOf("food_vendor", v.id), lines: billed.map((i) => ({ label: i.label, total: i.total, paid: i.paid })), items });
  });

  // Transport: per-trip vehicles bill the trips that showed up; monthly vehicles bill each month that has records; errands are extra. Each month is one amount, due on the 1st to 4th of the next month;
  // the month still running is "running" until it has passed.
  vehicles.forEach((v) => {
    const mine = runsT.filter((r) => r.vehicle_id === v.id); let unpriced = 0; const perMonth = new Map<string, number>(); const addMonth = (m: string, a: number) => perMonth.set(m, (perMonth.get(m) ?? 0) + a);
    if (v.billing === "per_trip") mine.filter((r) => r.status === "showed").forEach((r) => { const pr = tripRate(rates, v.id, r.work_date); if (pr === null) unpriced++; else addMonth(r.work_date.slice(0, 7), pr); });
    else { const first: Record<string, string> = {}; mine.forEach((r) => { const m = r.work_date.slice(0, 7); if (!first[m] || r.work_date < first[m]) first[m] = r.work_date; }); Object.values(first).forEach((d) => { const pr = tripRate(rates, v.id, d); if (pr === null) unpriced++; else addMonth(d.slice(0, 7), pr); }); }
    const er = errands.filter((e) => e.vehicle_id === v.id); er.forEach((e) => addMonth(String((e as any).work_date).slice(0, 7), num(e.amount)));
    if (unpriced) notIncluded.push({ label: `${pname.get(v.project_id ?? "") ?? "—"} · ${v.name}: ${unpriced} ${v.billing === "monthly" ? "month" : "trip"}${unpriced === 1 ? " has" : "s have"} no price set, so ${unpriced === 1 ? "it is" : "they are"} not in the amount` });
    const items: DueItem[] = [...perMonth.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([m, amt]) => ({ month: m, label: m >= thisMonth ? `${monthName(m)} so far, not billed yet` : `${monthName(m)}${v.billing === "monthly" ? " hire" : " trips"}`, total: amt, paid: 0, dueOn: payDay(m), state: m >= thisMonth ? "running" as const : "billed" as const }));
    const paidAll = sumBy(tpays, "vehicle_id", v.id); allocate(items, paidAll); const billed = items.filter((i) => i.state !== "running"), firstOpen = billed.find((i) => i.total - i.paid > 0.004);
    add(v.project_id, { key: `transport:${v.id}`, category: "transport", name: v.operator || v.name, forWhat: `${v.name} · ${v.billing === "monthly" ? "monthly hire" : "per-trip hire"}${er.length ? ` + ${er.length} errand${er.length === 1 ? "" : "s"}` : ""}`, total: billed.reduce((s, i) => s + i.total, 0), paid: paidAll, oldestDue: firstOpen?.dueOn ?? null, bank: bankOf("vehicle", v.id), lines: billed.map((i) => ({ label: i.label, total: i.total, paid: i.paid })), items });
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
    const rid = new Set(g.rooms.map((r) => r.id)); const months = new Set<string>(); g.rooms.forEach((r) => monthsBilled(r, thisMonth).forEach((m) => months.add(m))); rpays.filter((x) => rid.has(x.room_id) && x.for_month).forEach((x) => months.add(monthOf(String(x.for_month))));
    // rent is charged a month in advance and falls due on the 1st: each month is one amount, with the payments recorded for that month
    const items: DueItem[] = [...months].sort().map((m) => ({ month: m, label: `Rent ${monthName(m)}`, total: g.rooms.reduce((s, r) => s + chargeOf(r, rents, adjs, m), 0), paid: rpays.filter((x) => rid.has(x.room_id) && x.for_month && monthOf(String(x.for_month)) === m).reduce((s, x) => s + num(x.amount), 0), dueOn: `${m}-01`, state: "billed" as const })).filter((i) => i.total > 0 || i.paid > 0);
    const paidAll = g.rooms.reduce((s, r) => s + sumBy(rpays, "room_id", r.id), 0), total = items.reduce((s, i) => s + i.total, 0), firstOpen = items.find((i) => i.total - i.paid > 0.004);
    const lines = g.rooms.map((r) => ({ label: `${r.name}`, total: monthsBilled(r, thisMonth).reduce((s, m) => s + chargeOf(r, rents, adjs, m), 0), paid: Math.min(sumBy(rpays, "room_id", r.id), monthsBilled(r, thisMonth).reduce((s, m) => s + chargeOf(r, rents, adjs, m), 0)) }));
    const b = (g.landlordId ? bankOf("landlord", g.landlordId) : null) ?? g.rooms.map((r) => bankOf("room", r.id)).find(Boolean) ?? null; const nMonths = g.rooms.reduce((n, r) => n + monthsBilled(r, thisMonth).length, 0);
    add(g.pid, { key: k.startsWith("room:") ? k : `landlord:${k}`, category: "accommodation", name: g.name, forWhat: g.rooms.length === 1 ? `${g.rooms[0].name} · rent, ${nMonths} month${nMonths === 1 ? "" : "s"} billed` : `${g.rooms.length} rooms · rent`, total, paid: paidAll, oldestDue: firstOpen?.dueOn ?? null, bank: b, lines: g.rooms.length > 1 ? lines : undefined, items });
  });

  // Gas and hired equipment: approved site bills only; payments are applied to the oldest bill first. Not created until the consumables migration is run: then there is simply nothing here.
  // people whose salary goes into another employee's account (the column exists once 2026-11-pay-to-account.sql is run)
  const linked = await soft<{ id: string; pay_to_employee_id: string }>(() => sb.from("employees").select("id, pay_to_employee_id").not("pay_to_employee_id", "is", null));
  const linkTargets = linked.length ? await soft<any>(() => sb.from("employees").select("id, full_name, bank_name, bank_branch, account_no, ifsc").in("id", [...new Set(linked.map((x) => x.pay_to_employee_id))])) : [];
  const linkPool = [...linked.map((x) => ({ id: x.id, full_name: "", pay_to_employee_id: x.pay_to_employee_id })), ...linkTargets];
  const [gvendors, sbills, spayments, gterms] = await Promise.all([
    soft<{ id: string; name: string; kind: string }>(() => sb.from("gas_vendors").select("id, name, kind")),
    soft<any>(() => sb.from("site_bills").select("id, kind, vendor_id, project_id, bill_no, bill_date, period_from, period_to, bill_amount, approved_amount, status").is("voided_at", null).order("bill_date")),
    soft<{ vendor_id: string; project_id: string; kind: string; amount: number }>(() => sb.from("site_payments").select("vendor_id, project_id, kind, amount").is("voided_at", null)),
    soft<any>(() => sb.from("gas_terms").select("*")),
  ]);
  // what this month has delivered or logged and no bill covers yet ("running")
  const [gmoves, gorders, gpricing, grates, gprods, grent, elogs, eitems, erates] = await Promise.all([
    soft<any>(() => sb.from("gas_movements").select("project_id, vendor_id, product_id, order_id, kind, qty, moved_on, challan_no, voided_at").gte("moved_on", monthStart).is("voided_at", null)),
    soft<any>(() => sb.from("gas_orders").select("id, gas_order_lines(id, product_id, qty)")), soft<any>(() => sb.from("gas_order_pricing").select("line_id, rate, gst_pct")), soft<any>(() => sb.from("gas_rates").select("product_id, rate, gst_pct, valid_from")),
    soft<any>(() => sb.from("gas_products").select("id, vendor_id, name")), soft<any>(() => sb.from("gas_rent_billed").select("vendor_id, project_id, period_to, amount").is("voided_at", null)),
    soft<any>(() => sb.from("equipment_logs").select("project_id, vendor_id, item_id, work_date, start_at, end_at, voided_at, verified_at").gte("work_date", monthStart).is("voided_at", null)), soft<any>(() => sb.from("equipment_items").select("id, vendor_id")), soft<any>(() => sb.from("equipment_rates").select("*")),
  ]);
  const gtermsN: GTerms[] = gterms.map((t: any) => ({ vendor_id: t.vendor_id, loss_charge_per_cylinder: num(t.loss_charge_per_cylinder), damage_charge_per_cylinder: num(t.damage_charge_per_cylinder), charges_gst_pct: num(t.charges_gst_pct), transport_per_trip: num(t.transport_per_trip) }));
  const eqRates: EqRate[] = erates.map((r: any) => ({ item_id: r.item_id, unit: r.unit, rate: num(r.rate), min_hours: num(r.min_hours), round_minutes: num(r.round_minutes), overtime_after_hours: r.overtime_after_hours === null ? null : num(r.overtime_after_hours), overtime_rate: r.overtime_rate === null ? null : num(r.overtime_rate), gst_pct: num(r.gst_pct), valid_from: r.valid_from }));
  const runningFor = (vid: string, pid: string, kind: string, periods: { from: string; to: string }[]): number => {
    const ranges = uncovered(monthStart, today, periods.filter((p) => p.to >= monthStart && p.from <= today)); let total = 0;
    ranges.forEach(([from, to]) => {
      if (kind === "gas") total += gasCost({ moves: gmoves.filter((m: any) => m.project_id === pid && m.vendor_id === vid) as GMove[], orders: gorders as GOrder[], pricing: gpricing.map((x: any) => ({ ...x, rate: num(x.rate), gst_pct: num(x.gst_pct) })) as GPricing[], rates: grates.map((x: any) => ({ ...x, rate: num(x.rate), gst_pct: num(x.gst_pct) })) as GRate[], products: gprods as GProduct[], terms: gtermsN, rent: grent.filter((r: any) => r.project_id === pid).map((r: any) => ({ ...r, amount: num(r.amount) })) as GRent[], vendorId: vid, from, to }).total;
      else { const t = chargeFor(elogs.filter((l: any) => l.project_id === pid && l.vendor_id === vid) as EqLog[], eqRates, new Set(eitems.filter((i: any) => i.vendor_id === vid).map((i: any) => i.id)), from, to); total += t.amount + t.gst; }
    });
    return total;
  };
  const gdue = (vid: string, billDate: string) => { const t = gterms.find((x: any) => x.vendor_id === vid); if (!t) return billDate; const [y, m, d] = billDate.split("-").map(Number); const first = d <= 15; const mm = first ? m : m + 1; const yy = mm > 12 ? y + 1 : y; const day = first ? t.due_day_first_half : t.due_day_second_half; return `${yy}-${String(mm > 12 ? 1 : mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`; };
  const sv = new Map<string, any[]>(); sbills.forEach((b) => { const k = `${b.vendor_id}|${b.project_id}|${b.kind}`; (sv.get(k) ?? sv.set(k, []).get(k)!).push(b); });
  const spaid = new Map<string, number>(); spayments.forEach((p) => { const k = `${p.vendor_id}|${p.project_id}|${p.kind}`; spaid.set(k, (spaid.get(k) ?? 0) + num(p.amount)); });
  new Set([...sv.keys(), ...spaid.keys(), ...gmoves.map((m: any) => `${m.vendor_id}|${m.project_id}|gas`), ...elogs.map((l: any) => `${l.vendor_id}|${l.project_id}|equipment`)]).forEach((k) => { const [vid, pid, kind] = k.split("|"); const v = gvendors.find((x) => x.id === vid); const mine = sv.get(k) ?? []; const ap = mine.filter((b) => b.status === "approved");
    mine.filter((b) => b.status !== "approved").forEach((b) => notIncluded.push({ label: `${pname.get(pid) ?? "—"} · ${v?.name ?? "Vendor"} · Bill ${b.bill_no || "(no number)"}, ${span(b.period_from, b.period_to)} (received, not approved yet)`, amount: num(b.bill_amount) }));
    const items: DueItem[] = ap.map((b) => ({ month: String(b.period_from).slice(0, 7), label: `Bill ${b.bill_no || "–"} · ${span(b.period_from, b.period_to)}`, total: num(b.approved_amount ?? b.bill_amount), paid: 0, dueOn: kind === "gas" ? gdue(vid, b.bill_date) : b.bill_date, state: "billed" as const }));
    const paidAll = spaid.get(k) ?? 0; allocate(items, paidAll);
    const running = runningFor(vid, pid, kind, mine.map((b) => ({ from: b.period_from, to: b.period_to }))); if (running > 0.004) items.push({ month: thisMonth, label: kind === "gas" ? "Delivered this month, not billed yet" : "Hours logged this month, not billed yet", total: Math.round(running * 100) / 100, paid: 0, dueOn: null, state: "running" });
    const billed = items.filter((i) => i.state !== "running"), firstOpen = billed.find((i) => i.total - i.paid > 0.004);
    add(pid, { key: `${kind}:${vid}:${pid}`, category: kind === "gas" ? "gas" : "equipment", name: v?.name ?? "Vendor", forWhat: ap.length ? `${ap.length} approved bill${ap.length === 1 ? "" : "s"}` : running > 0.004 ? "Not billed yet" : "Paid ahead of any approved bill", total: billed.reduce((s, i) => s + i.total, 0), paid: paidAll, oldestDue: firstOpen?.dueOn ?? null, bank: bankOf(kind === "gas" ? "gas_vendor" : "equipment_vendor", vid), lines: billed.map((i) => ({ label: i.label, total: i.total, paid: i.paid })), items }); });

  // Salaries: one row per person for the months not yet fully paid. A payroll that is still a draft is included but marked draft (its amounts can change until it is approved).
  // A salary on hold is not due, so it is listed as not included.
  const runOf = new Map(pruns.map((r) => [r.id, r])); const paidOn = new Map<string, number>(); ppays.forEach((p) => paidOn.set(p.line_id, (paidOn.get(p.line_id) ?? 0) + num(p.amount)));
  const person = new Map<string, { pid: string; sn: any; mode: string; total: number; paid: number; months: string[]; draft: boolean; items: DueItem[] }>();
  plines.filter((l) => runOf.has(l.run_id) && num(l.net) > 0).forEach((l) => {
    const run = runOf.get(l.run_id)!, ym = String(run.pay_month).slice(0, 7), paid = paidOn.get(l.id) ?? 0, net = num(l.net); if (paid >= net) return;
    if (l.held) { notIncluded.push({ label: `${pname.get(l.project_id) ?? "—"} · ${l.snapshot?.name ?? "Employee"}: salary ${monthName(ym)} is on hold`, amount: net - paid }); return; }
    const k = `${l.employee_id}:${l.project_id}`; const e = person.get(k) ?? { pid: l.project_id, sn: l.snapshot ?? {}, mode: l.pay_mode, total: 0, paid: 0, months: [] as string[], draft: false, items: [] as DueItem[] }; e.total += net; e.paid += paid; e.months.push(ym); if (run.status !== "approved") e.draft = true; e.items.push({ month: ym, label: `Salary ${monthName(ym)}`, total: net, paid, dueOn: creditWindow(ym).to, state: run.status === "approved" ? "billed" : "draft" }); person.set(k, e);
  });
  person.forEach((e, k) => { const ms = e.months.sort(), sn = e.sn; const via = e.mode === "bank" ? bankFor(k.split(":")[0], sn, linkPool as any) : null; const acct = via && via.via ? via : null;
    const bank: Bank | null = e.mode === "upi" ? (sn.upi_id ? { upi: sn.upi_id } : null) : e.mode === "bank" ? (acct ? (acct.account ? { holder: acct.holder, bank: acct.bank, branch: acct.branch, accountNo: acct.account, ifsc: acct.ifsc } : null) : sn.account_no ? { bank: sn.bank_name, accountNo: sn.account_no, ifsc: sn.ifsc } : null) : null;
    add(e.pid, { key: `salary:${k}`, category: "salary", name: sn.name ?? "Employee", forWhat: `Salary ${ms.map((m) => monthName(m).replace(/ \d{4}$/, "")).join(", ")}${sn.designation ? ` · ${sn.designation}` : ""}${acct ? ` · paid into ${acct.via}'s account` : ""}`, total: e.total, paid: e.paid, oldestDue: creditWindow(ms[0]).to, draft: e.draft, items: e.items, bank, mode: e.mode === "cash" ? "cash" : e.mode === "upi" ? "upi" : "bank" }); });

  // PF, ESI and Professional Tax for approved payroll months, against what has been remitted.
  const KIND = { pf: "Provident fund (EPFO)", esi: "ESI (ESIC)", pt: "Professional tax" } as const;
  const stat = new Map<string, { total: number; paid: number; months: string[]; oldest: string | null; items: DueItem[] }>();
  pruns.filter((r) => r.status === "approved").forEach((run) => { const t = statutoryTotals(plines.filter((l) => l.run_id === run.id)); const ym = String(run.pay_month).slice(0, 7);
    (["pf", "esi", "pt"] as const).forEach((k) => { const total = t[k]; if (total <= 0) return; const paid = spays.filter((s) => s.project_id === run.project_id && String(s.pay_month).slice(0, 7) === ym && s.kind === k).reduce((s, x) => s + num(x.amount), 0);
      if (paid >= total) return; const key = `${run.project_id}:${k}`; const e = stat.get(key) ?? { total: 0, paid: 0, months: [], oldest: null, items: [] as DueItem[] }; e.total += total; e.paid += Math.min(paid, total); e.months.push(ym); const due = statDue(ym, k); e.items.push({ month: ym, label: `${KIND[k]} ${monthName(ym)}`, total, paid: Math.min(paid, total), dueOn: due, state: "billed" }); if (!e.oldest || due < e.oldest) e.oldest = due; stat.set(key, e); }); });
  stat.forEach((e, key) => { const [pid, k] = key.split(":") as [string, keyof typeof KIND]; add(pid, { key: `statutory:${key}`, category: "statutory", name: KIND[k], forWhat: `${e.months.sort().map((m) => monthName(m).replace(/ \d{4}$/, "")).join(", ")}: pay on the government portal`, total: e.total, paid: e.paid, oldestDue: e.oldest, mode: "portal", items: e.items }); });

  const out = projects.filter((p) => by.has(p.id)).map((p) => ({ id: p.id, name: p.name, payees: by.get(p.id)! }));
  return { projects: out, notIncluded };
}
