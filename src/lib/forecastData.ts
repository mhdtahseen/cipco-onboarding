import type { SupabaseClient } from "@supabase/supabase-js";
import { MEALS, addDays, istToday, rateFor, tripRate, type MealRate, type TransportRate } from "./attendance";
import { addMonths, chargeOf, daysInMonth, monthOf, type Adjustment, type Rent, type Room } from "./accommodation";
import { calcSalary } from "./salary";
import { loadPaymentsDue } from "./paymentsDueData";
import { viewOf, type PayeeView } from "./paymentsDueView";
import type { ForecastInput, OtherEntry } from "./forecast";

const num = (v: unknown) => Number(v ?? 0);
const WEEKS = 3, WINDOW = WEEKS * 7;
async function all<T>(q: () => any): Promise<T[]> { const out: T[] = []; for (let off = 0; ; off += 1000) { const { data, error } = await q().range(off, off + 999); if (error) throw new Error(error.message); out.push(...((data || []) as T[])); if (!data || data.length < 1000) break; } return out; }
const soft = async <T,>(q: () => any): Promise<T[]> => { try { return await all<T>(q); } catch { return []; } };
const between = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
// Payments for meals, transport, rent and salaries are already forecast by their own lines. What is left (entered by hand, gas, equipment) is "other".
const RECURRING = new Set(["vendor_payment", "transport_payment", "room_payment", "payroll", "statutory_payment"]);

/** The measured starting point of the forecast for an active project (or every active one). Reads only. Admin only (reads salaries and payments). */
export async function loadForecast(sb: SupabaseClient, projectId?: string): Promise<ForecastInput[]> {
  const today = istToday(), yesterday = addDays(today, -1), from = addDays(today, -WINDOW), month = addMonths(monthOf(today), 1), days = daysInMonth(month);
  const [projects, employees, attendance, mealRates, rooms, rents, adjs, vehicles, tRates, tRuns, expenses, cats, deposits, due] = await Promise.all([
    all<{ id: string; name: string }>(() => sb.from("projects").select("id, name").eq("status", "active").order("name")),
    all<any>(() => sb.from("employees").select("id, project_id, gender, join_date, left_on, outcome, salary").neq("outcome", "rejected")),
    all<any>(() => sb.from("attendance").select("employee_id, project_id, work_date, status, breakfast_vendor_id, lunch_vendor_id, dinner_vendor_id").gte("work_date", from).lte("work_date", yesterday)),
    all<any>(() => sb.from("meal_rates").select("*")),
    all<Room>(() => sb.from("accommodation_rooms").select("*")), all<any>(() => sb.from("accommodation_rents").select("*")), soft<any>(() => sb.from("accommodation_adjustments").select("*")),
    all<any>(() => sb.from("transport_vehicles").select("*")), all<any>(() => sb.from("transport_rates").select("*")), all<any>(() => sb.from("transport_runs").select("vehicle_id, work_date, status").gte("work_date", from).lte("work_date", yesterday)),
    all<any>(() => sb.from("project_expenses").select("project_id, category_id, expense_date, amount, description, source")), all<any>(() => sb.from("expense_categories").select("id, name")),
    soft<any>(() => sb.from("gas_deposits").select("project_id, kind, amount").is("voided_at", null)), loadPaymentsDue(sb),
  ]);
  const mr = mealRates.map((r) => ({ ...r, price: num(r.price) })) as MealRate[], rent = rents.map((r) => ({ ...r, rent: num(r.rent) })) as Rent[], adj = adjs.map((a) => ({ ...a, amount: num(a.amount) })) as Adjustment[], tr = tRates.map((r) => ({ ...r, price: num(r.price) })) as TransportRate[];
  const catName = new Map(cats.map((c) => [c.id, c.name as string]));
  const nowView = { scope: "now" as const, month: monthOf(today), lens: "due" as const, running: false, includePaid: false, today };
  // the last WEEKS full weeks, newest first, each as [from, to]
  const weeks: [string, string][] = Array.from({ length: WEEKS }, (_, i) => [addDays(yesterday, -(7 * i + 6)), addDays(yesterday, -7 * i)]);

  return projects.filter((p) => !projectId || p.id === projectId).map((p) => {
    const att = attendance.filter((a) => a.project_id === p.id); const firstAtt = att.map((a) => a.work_date as string).sort()[0] ?? null;
    const fullWeeks = weeks.filter(([a]) => firstAtt && a >= firstAtt); const windowDays = firstAtt ? Math.min(WINDOW, between(firstAtt, yesterday) + 1) : 0; const inWeek = (d: string, w: [string, string]) => d >= w[0] && d <= w[1];
    /** The lowest and highest week, as a share of the average week, to scale a monthly figure by (1 and 1 without two full weeks). */
    const spread = (perWeek: number[]) => { if (perWeek.length < 2) return { low: 1, high: 1 }; const avg = perWeek.reduce((s, n) => s + n, 0) / perWeek.length; return avg > 0 ? { low: Math.min(...perWeek) / avg, high: Math.max(...perWeek) / avg } : { low: 1, high: 1 }; };

    // people
    const people = employees.filter((e) => e.project_id === p.id && e.join_date && e.join_date <= today && (!e.left_on || e.left_on >= today)).map((e) => ({ e, c: calcSalary((e.salary ?? {}) as any, e.gender) as any }));
    const sal = people.filter((x) => x.c && !x.c.daily), dw = people.filter((x) => x.c?.daily);
    const worked = (id: string, w?: [string, string]) => att.filter((a) => a.employee_id === id && (!w || inWeek(a.work_date, w))).reduce((s, a) => s + (a.status === "present" ? 1 : a.status === "half" ? 0.5 : 0), 0);
    // daily wage: each person's rate × their share of days worked since the later of the window start and their joining date, over the whole month
    const dailyMonthly = windowDays ? dw.reduce((s, x) => { const start = x.e.join_date > from ? x.e.join_date : from; const span = Math.max(1, Math.min(windowDays, between(start, yesterday) + 1)); return s + num(x.e.salary?.amount) * (worked(x.e.id) / span) * days; }, 0) : 0;
    const dailySpread = spread(fullWeeks.map((w) => dw.reduce((s, x) => s + num(x.e.salary?.amount) * worked(x.e.id, w), 0)));

    // meals
    const mealCost = (rows: any[]) => rows.reduce((s, a) => s + MEALS.reduce((t, m) => t + (a[m.col] ? rateFor(mr, a[m.col], m.key, a.work_date) ?? 0 : 0), 0), 0);
    const perDay = windowDays ? mealCost(att) / windowDays : 0; const mealWeeks = fullWeeks.map((w) => mealCost(att.filter((a) => inWeek(a.work_date, w))) / 7);

    // rooms
    const mine = rooms.filter((r) => r.project_id === p.id && (!r.vacated_on || monthOf(r.vacated_on) >= month));

    // transport: a monthly vehicle costs its fixed price; a per-trip vehicle its recent trips × rate. One-off errands are not counted here.
    const lines = vehicles.filter((v) => v.project_id === p.id && v.active !== false).map((v) => { const runs = tRuns.filter((r) => r.vehicle_id === v.id && r.status === "showed"); const rate = tripRate(tr, v.id, today) ?? 0; const monthly = v.billing === "monthly" ? rate : windowDays ? (runs.length / windowDays) * days * rate : 0; return { id: v.id as string, name: v.name as string, billing: v.billing as string, trips: runs.length, rate, monthly, runs }; });
    const perTrip = lines.filter((l) => l.billing !== "monthly"), fixed = lines.filter((l) => l.billing === "monthly").reduce((s, l) => s + l.monthly, 0), tripsMonthly = perTrip.reduce((s, l) => s + l.monthly, 0);
    const tSpread = spread(fullWeeks.map((w) => perTrip.reduce((s, l) => s + l.runs.filter((r) => inWeek(r.work_date, w)).length * l.rate, 0)));

    // other costs: the average since the project's first cost; "low" is the same without the largest single entry, which is often a one-time cost
    const exps = expenses.filter((e) => e.project_id === p.id); const others = exps.filter((e) => !RECURRING.has(e.source ?? "")); const firstCost = [...exps.map((e) => e.expense_date as string), ...(firstAtt ? [firstAtt] : [])].sort()[0] ?? today; const sinceDays = Math.max(1, between(firstCost, today) + 1);
    const otherTotal = others.reduce((s, e) => s + num(e.amount), 0); const grouped = new Map<string, OtherEntry>(); others.forEach((e) => { const label = catName.get(e.category_id) ?? "Other"; const k = `${label}|${String(e.expense_date).slice(0, 7)}`; const g = grouped.get(k) ?? { label, amount: 0, date: String(e.expense_date).slice(0, 7) }; g.amount += num(e.amount); grouped.set(k, g); });
    const top = [...grouped.values()].sort((a, b) => b.amount - a.amount).slice(0, 3); const largest = top[0]?.amount ?? 0;

    const dep = deposits.filter((d) => d.project_id === p.id).reduce((s, d) => s + (d.kind === "paid" ? num(d.amount) : -num(d.amount)), 0);
    const owed = (due.projects.find((x) => x.id === p.id)?.payees ?? []).map((x) => viewOf(x, nowView)).filter(Boolean).reduce((s, v) => s + (v as PayeeView).pending, 0);
    return {
      projectId: p.id, projectName: p.name, month, days, asOf: today, windowDays,
      salaried: { n: sal.length, monthly: sal.reduce((s, x) => s + num(x.c.monthly.ctc), 0) }, noSalary: people.filter((x) => !x.c).length,
      daily: { n: dw.length, monthly: dailyMonthly, low: dailyMonthly * dailySpread.low, high: dailyMonthly * dailySpread.high },
      meals: { perDay, low: mealWeeks.length > 1 ? Math.min(...mealWeeks) : perDay, high: mealWeeks.length > 1 ? Math.max(...mealWeeks) : perDay, people: people.length },
      rooms: { n: mine.length, beds: mine.reduce((s, r) => s + num(r.capacity), 0), rent: mine.reduce((s, r) => s + chargeOf(r, rent, adj, month), 0) },
      transport: { lines: lines.map(({ name, billing, trips, rate, monthly }) => ({ name, billing, trips, rate, monthly })), monthly: fixed + tripsMonthly, low: fixed + tripsMonthly * tSpread.low, high: fixed + tripsMonthly * tSpread.high },
      other: { monthly: (otherTotal / sinceDays) * days, low: ((otherTotal - largest) / sinceDays) * days, total: otherTotal, sinceDays, top },
      spent: exps.reduce((s, e) => s + num(e.amount), 0), deposits: dep, owedNow: owed,
    } as ForecastInput;
  });
}
