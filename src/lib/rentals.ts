// Rented items (2026-11-rentals.sql): the rent a rental comes to, and when the next bill is due. Pure functions, so the screen, the vendor-bill comparison
// and the dashboard all use the same numbers.
//  - Days count both ends: delivered on 19 Nov and returned on 19 Nov is 1 day; 19 Nov to 18 Dec is 30 days.
//  - Rent = quantity × rate per day × days, for every item, plus GST. Missing items are charged rent until the return (the loss itself comes off the deposit).
//  - The minimum days apply to the whole rental: returned after 6 days with a 15-day minimum is charged 15 days. The extra days are counted in the period
//    that holds the return date.
//  - How it is billed only changes when a bill is due: in advance (a full period at its start), at each month end (the days used that month), or once on return.
export type Rental = { id: string; project_id: string; vendor_id: string; delivered_on: string; returned_on: string | null; voided_at: string | null };
export type RentalItem = { id: string; rental_id: string; name: string; qty: number; unit: string; missing_qty: number };
export type RentalTerms = { rental_id: string; billing: "advance" | "month_end" | "on_return"; period_days: number; min_days: number; gst_pct: number; deposit: number;
  deposit_paid_on: string | null; deduction: number; refund_amount: number | null; refund_on: string | null };
export type Rates = Record<string, number>;   // rental item id → rate per unit per day

const DAY = 86400000;
const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");
export const addDays = (iso: string, n: number) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
/** Days from a to b, counting both ends (0 when b is before a). */
export const daysIncl = (a: string, b: string) => (b < a ? 0 : Math.round((ms(b) - ms(a)) / DAY) + 1);
const monthEnd = (iso: string) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/** Rent per day for the whole rental, before GST; null when any item has no rate yet. */
export function perDay(items: RentalItem[], rates: Rates): number | null {
  let s = 0; for (const i of items) { const r = rates[i.id]; if (r === undefined) return null; s += i.qty * r; } return s;
}
/** Days used so far (to today, or to the return). */
export const daysUsed = (r: Rental, today: string) => daysIncl(r.delivered_on, r.returned_on ?? today);

/** Days charged inside [from, to]: the days on site in that window, plus the minimum-days top-up when the return falls in it. */
export function daysIn(r: Rental, t: Pick<RentalTerms, "min_days"> | null, from: string, to: string): number {
  if (r.voided_at) return 0;
  const a = from > r.delivered_on ? from : r.delivered_on, end = r.returned_on ?? to, b = to < end ? to : end;
  let d = daysIncl(a, b);
  if (r.returned_on && r.returned_on >= from && r.returned_on <= to && t) d += Math.max(0, t.min_days - daysIncl(r.delivered_on, r.returned_on));
  return d;
}

/** What the rental comes to for the days inside [from, to], with GST. `priced` is false when a rate is missing (that item counts as 0). */
export function rentFor(r: Rental, items: RentalItem[], rates: Rates, t: RentalTerms | null, from: string, to: string): { days: number; base: number; gst: number; total: number; priced: boolean } {
  const days = daysIn(r, t, from, to); const pd = perDay(items, rates); const base = (pd ?? items.reduce((s, i) => s + i.qty * (rates[i.id] ?? 0), 0)) * days;
  const gst = (base * (t?.gst_pct ?? 0)) / 100; return { days, base, gst, total: Math.round((base + gst) * 100) / 100, priced: pd !== null };
}

/** The bill that is due now or next, for the screen and the dashboard: the dates it should cover and when it falls due. */
export function nextBill(r: Rental, t: RentalTerms | null, today: string): { from: string; to: string; dueOn: string; label: string } | null {
  if (r.voided_at || !t) return null;
  if (t.billing === "on_return") return r.returned_on ? { from: r.delivered_on, to: r.returned_on, dueOn: r.returned_on, label: "on return" } : { from: r.delivered_on, to: today, dueOn: "", label: "on return" };
  if (t.billing === "month_end") {
    const ref = r.returned_on && r.returned_on < today ? r.returned_on : today; const end = monthEnd(ref); const first = ref.slice(0, 7) + "-01";
    const from = first > r.delivered_on ? first : r.delivered_on, to = r.returned_on && r.returned_on < end ? r.returned_on : end;
    return { from, to, dueOn: to, label: "month end" };
  }
  // in advance: periods of period_days from the delivery; the current period was billed at its start, the next one starts after it
  const p = Math.max(1, t.period_days); const ref = r.returned_on ?? today; const idx = Math.max(0, Math.floor((ms(ref) - ms(r.delivered_on)) / DAY / p));
  const start = addDays(r.delivered_on, idx * p), end = addDays(start, p - 1);
  if (r.returned_on) return { from: start, to: r.returned_on < end ? r.returned_on : end, dueOn: start, label: "in advance" };
  const nextStart = addDays(start, p);
  return { from: nextStart, to: addDays(nextStart, p - 1), dueOn: nextStart, label: "in advance" };
}

/** The deposit: what was paid, what is kept back, what should come back, and whether it is still to collect. */
export function depositState(r: Rental, t: RentalTerms | null) {
  const paid = t && t.deposit > 0 && t.deposit_paid_on ? t.deposit : 0; const due = Math.max(0, paid - (t?.deduction ?? 0));
  const refunded = t?.refund_on ? t.refund_amount ?? 0 : 0;
  return { amount: t?.deposit ?? 0, paid, due, refunded, toCollect: !!r.returned_on && paid > 0 && !t?.refund_on ? due : 0, held: paid > 0 && !t?.refund_on ? due : 0 };
}
