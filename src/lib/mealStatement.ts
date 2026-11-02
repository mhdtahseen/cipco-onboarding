import { MEALS, rateFor, type Meal, type MealRate } from "./attendance";

// How a vendor's meal amount is worked out, for any stretch of days. The Bills screen and the PDF for the vendor both use this, so they cannot disagree.
// A meal is counted for a vendor when that vendor is the one recorded for it; it costs the price in force on that day (rateFor). A meal with no price in
// force is counted but not charged, and is reported as "unpriced" so it is never quietly treated as free.
export type MealRowLite = { employee_id: string; work_date: string; breakfast_vendor_id: string | null; lunch_vendor_id: string | null; dinner_vendor_id: string | null };
export type Who = { name: string; emp_no: string | null };
export type PriceLine = { meal: Meal; label: string; price: number | null; count: number; amount: number; first: string; last: string };
export type DayLine = { date: string; counts: number[]; amount: number };
export type RegisterDay = { date: string; meals: { label: string; people: Who[] }[] };
export type Breakdown = { vendorId: string; from: string; to: string; lines: PriceLine[]; days: DayLine[]; register: RegisterDay[]; count: number; amount: number; unpriced: number };

export function buildBreakdown(a: { vendorId: string; from: string; to: string; rows: MealRowLite[]; rates: MealRate[]; people: Map<string, Who> }): Breakdown {
  const lines = new Map<string, PriceLine>(); const days = new Map<string, DayLine>(); const reg = new Map<string, Who[][]>();
  let count = 0, amount = 0, unpriced = 0;
  for (const r of a.rows) {
    if (r.work_date < a.from || r.work_date > a.to) continue;
    MEALS.forEach((m, i) => {
      if (r[m.col] !== a.vendorId) return;
      const price = rateFor(a.rates, a.vendorId, m.key, r.work_date); count++;
      if (price === null) unpriced++; else amount += price;
      const key = `${i}|${price ?? "none"}`; const l = lines.get(key) ?? { meal: m.key, label: m.label, price, count: 0, amount: 0, first: r.work_date, last: r.work_date };
      l.count++; l.amount += price ?? 0; if (r.work_date < l.first) l.first = r.work_date; if (r.work_date > l.last) l.last = r.work_date; lines.set(key, l);
      const d = days.get(r.work_date) ?? { date: r.work_date, counts: [0, 0, 0], amount: 0 }; d.counts[i]++; d.amount += price ?? 0; days.set(r.work_date, d);
      const g = reg.get(r.work_date) ?? [[], [], []]; g[i].push(a.people.get(r.employee_id) ?? { name: "Former employee", emp_no: null }); reg.set(r.work_date, g);
    });
  }
  const byName = (x: Who, y: Who) => x.name.localeCompare(y.name);
  return {
    vendorId: a.vendorId, from: a.from, to: a.to, count, amount, unpriced,
    lines: [...lines.values()].sort((x, y) => MEALS.findIndex((m) => m.key === x.meal) - MEALS.findIndex((m) => m.key === y.meal) || x.first.localeCompare(y.first)),
    days: [...days.values()].sort((x, y) => x.date.localeCompare(y.date)),
    register: [...reg.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([date, g]) => ({ date, meals: MEALS.map((m, i) => ({ label: m.label, people: g[i].sort(byName) })).filter((x) => x.people.length) })),
  };
}
export const fmtMoney = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const dm = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
/** "17 Oct" or "17 Oct – 20 Oct" */
export const spanLabel = (a: string, b: string) => (a === b ? dm(a) : `${dm(a)} – ${dm(b)}`);
