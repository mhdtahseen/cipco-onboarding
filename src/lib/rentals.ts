// Rented items (2026-11-rentals.sql, 2026-11-rentals-vendor.sql): the rent deliveries come to, and when a vendor's next bill is expected. Pure functions, so
// the screen, the vendor-bill comparison, Payments due and the dashboard all use the same numbers.
//  - Days count both ends: delivered on 19 Nov and returned on 19 Nov is 1 day; 19 Nov to 18 Dec is 30 days.
//  - Rent = quantity on site × rate per day, for every day, plus GST. What goes back stops its rent the day after the return (the return day is charged).
//    What did not come back is charged until that return too (the loss itself comes off the deposit).
//  - Returns are per vendor and can be partial, so each item is a set of chunks: so many units until this return, the rest still on site.
//  - The minimum days apply to each chunk: 10 clamps back after 6 days with a 15-day minimum are charged 15 days. The top-up falls in the period holding the return.
//  - How a vendor bills (rental_vendor_terms) only says when a bill is expected: calendar month at month end, calendar month in advance, a fixed number of days
//    in advance (later deliveries join the first delivery's cycle, or have their own), or once on return.
export type Rental = { id: string; project_id: string; vendor_id: string; delivered_on: string; returned_on: string | null; voided_at: string | null };
/** back: what has gone back (or was lost) on each return, from 2026-11-rentals-vendor.sql; missing_qty is the lost part of it. */
export type RentalItem = { id: string; rental_id: string; name: string; qty: number; unit: string; missing_qty: number; back?: { on: string; qty: number }[] };
export type Billing = "month_end" | "month_advance" | "advance" | "on_return";
export type RentalTerms = { rental_id: string; billing: Billing; period_days: number; min_days: number; gst_pct: number; deposit: number;
  deposit_paid_on: string | null; deduction: number; refund_amount: number | null; refund_on: string | null };
export type VendorTerms = { vendor_id: string; billing: Billing; period_days: number; join_cycle: boolean; min_days: number; gst_pct: number };
export type Rates = Record<string, number>;   // rental item id → rate per unit per day
export const BILLING: Record<Billing, string> = { month_end: "Calendar month, at month end", month_advance: "Calendar month, in advance", advance: "Fixed days, in advance", on_return: "Once, on return" };
export const DEFAULT_VENDOR_TERMS = (vendor_id: string): VendorTerms => ({ vendor_id, billing: "month_end", period_days: 30, join_cycle: true, min_days: 0, gst_pct: 0 });

const DAY = 86400000;
const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");
export const addDays = (iso: string, n: number) => new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
/** Days from a to b, counting both ends (0 when b is before a). */
export const daysIncl = (a: string, b: string) => (b < a ? 0 : Math.round((ms(b) - ms(a)) / DAY) + 1);
const monthEnd = (iso: string) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const nextMonth = (iso: string) => addDays(monthEnd(iso), 1);
const min = (a: string, b: string) => (a < b ? a : b), max = (a: string, b: string) => (a > b ? a : b);

/** How many of an item are still on site (not gone back). */
export const onSite = (i: RentalItem) => Math.max(0, i.qty - (i.back ?? []).reduce((s, b) => s + b.qty, 0));
/** The item as chunks: [qty, last day charged or null while on site]. */
function chunks(i: RentalItem): [number, string | null][] {
  const out: [number, string | null][] = (i.back ?? []).filter((b) => b.qty > 0).map((b) => [b.qty, b.on]); const left = onSite(i); if (left > 0) out.push([left, null]); return out;
}
/** Days of one chunk charged inside [from, to], with the minimum-days top-up when it went back inside that window. */
function chunkDays(delivered: string, end: string | null, minDays: number, from: string, to: string): number {
  const a = max(from, delivered), b = min(to, end ?? to); let d = daysIncl(a, b);
  if (end && end >= from && end <= to) d += Math.max(0, minDays - daysIncl(delivered, end));
  return d;
}

/** Rent per day for what is on site now, before GST; null when any item has no rate yet. */
export function perDay(items: RentalItem[], rates: Rates): number | null {
  let s = 0; for (const i of items) { const r = rates[i.id]; if (r === undefined) return null; s += onSite(i) * r; } return s;
}
/** Days since the delivery (to today, or to the day it all went back). */
export const daysUsed = (r: Rental, today: string) => daysIncl(r.delivered_on, r.returned_on ?? today);

/** Days the delivery was (partly) on site inside [from, to], plus the minimum-days top-up when it all went back inside it. For showing; rent is per chunk. */
export function daysIn(r: Rental, t: Pick<RentalTerms, "min_days"> | null, from: string, to: string): number {
  if (r.voided_at) return 0;
  let d = daysIncl(max(from, r.delivered_on), min(to, r.returned_on ?? to));
  if (r.returned_on && r.returned_on >= from && r.returned_on <= to && t) d += Math.max(0, t.min_days - daysIncl(r.delivered_on, r.returned_on));
  return d;
}

/** What a delivery comes to for the days inside [from, to], with GST. `priced` is false when a rate is missing (that item counts as 0). */
export function rentFor(r: Rental, items: RentalItem[], rates: Rates, t: Pick<RentalTerms, "min_days" | "gst_pct"> | null, from: string, to: string): { days: number; base: number; gst: number; total: number; priced: boolean } {
  if (r.voided_at || to < r.delivered_on) return { days: 0, base: 0, gst: 0, total: 0, priced: true };
  let base = 0, priced = true;
  for (const i of items) { const rate = rates[i.id]; if (rate === undefined) priced = false;
    for (const [q, end] of chunks(i)) base += q * (rate ?? 0) * chunkDays(r.delivered_on, end, t?.min_days ?? 0, from, to); }
  base = Math.round(base * 100) / 100; const gst = Math.round(((base * (t?.gst_pct ?? 0)) / 100) * 100) / 100;
  return { days: daysIn(r, t, from, to), base, gst, total: Math.round((base + gst) * 100) / 100, priced };
}

export type ExpectedBill = { from: string; to: string; dueOn: string; label: string; rentalIds: string[] };
/** The bill a vendor should send next, for the screen and the dashboard. Several when deliveries have their own fixed-day cycles. */
export function vendorNextBills(rentals: Rental[], vt: VendorTerms, today: string): ExpectedBill[] {
  const live = rentals.filter((r) => !r.voided_at).sort((a, b) => a.delivered_on.localeCompare(b.delivered_on)); if (!live.length) return [];
  const open = live.filter((r) => !r.returned_on); const lastBack = live.reduce((m, r) => (r.returned_on && r.returned_on > m ? r.returned_on : m), "");
  const ids = (from: string, to: string) => live.filter((r) => r.delivered_on <= to && (!r.returned_on || r.returned_on >= from)).map((r) => r.id);
  const first = live[0].delivered_on;
  if (vt.billing === "on_return") return [{ from: first, to: open.length ? today : lastBack, dueOn: open.length ? "" : lastBack, label: "on return", rentalIds: live.map((r) => r.id) }];
  if (vt.billing === "month_end") {   // the month now running (or the month it all went back), due at its end
    const ref = open.length ? today : lastBack; const from = max(ref.slice(0, 7) + "-01", first), to = open.length ? monthEnd(ref) : lastBack;
    return [{ from, to, dueOn: open.length ? monthEnd(ref) : lastBack, label: "month end", rentalIds: ids(from, to) }];
  }
  if (vt.billing === "month_advance") {   // this month was billed on the 1st (or on delivery); the next one is due on the 1st of next month
    if (!open.length) return [];
    const from = nextMonth(today); return [{ from, to: monthEnd(from), dueOn: from, label: "in advance", rentalIds: open.map((r) => r.id) }];
  }
  // fixed days in advance
  if (!open.length) return [];
  const p = Math.max(1, vt.period_days);
  const nextFor = (anchor: string): { from: string; to: string } => { const idx = Math.max(0, Math.floor((ms(today) - ms(anchor)) / DAY / p)); const from = addDays(anchor, (idx + 1) * p); return { from, to: addDays(from, p - 1) }; };
  if (vt.join_cycle) { const n = nextFor(first); return [{ ...n, dueOn: n.from, label: "in advance", rentalIds: open.map((r) => r.id) }]; }
  return open.map((r) => { const n = nextFor(r.delivered_on); return { ...n, dueOn: n.from, label: "in advance", rentalIds: [r.id] }; });
}

/** The first bill of a delivery that joins a vendor's running cycle: from its delivery to the end of that cycle's current period (null when it is its own cycle). */
export function joinedFirstBill(first: string, delivered: string, vt: VendorTerms): { from: string; to: string } | null {
  if (vt.billing === "month_end" || vt.billing === "month_advance") return { from: delivered, to: monthEnd(delivered) };
  if (vt.billing !== "advance" || !vt.join_cycle || delivered <= first) return null;
  const p = Math.max(1, vt.period_days); const idx = Math.floor((ms(delivered) - ms(first)) / DAY / p);
  return { from: delivered, to: addDays(first, (idx + 1) * p - 1) };
}

/** The deposit: what was paid, what is kept back, what should come back, and whether it is still to collect. */
export function depositState(r: Rental, t: RentalTerms | null) {
  const paid = t && t.deposit > 0 && t.deposit_paid_on ? t.deposit : 0; const due = Math.max(0, paid - (t?.deduction ?? 0));
  const refunded = t?.refund_on ? t.refund_amount ?? 0 : 0;
  return { amount: t?.deposit ?? 0, paid, due, refunded, toCollect: !!r.returned_on && paid > 0 && !t?.refund_on ? due : 0, held: paid > 0 && !t?.refund_on ? due : 0 };
}

/** Return lines (rental_return_lines joined to their live returns) onto the items. */
export function withReturns(items: RentalItem[], lines: { item_id: string; qty: number; missing: number; on: string }[]): RentalItem[] {
  return items.map((i) => ({ ...i, back: lines.filter((l) => l.item_id === i.id).map((l) => ({ on: l.on, qty: l.qty + l.missing })).sort((a, b) => a.on.localeCompare(b.on)) }));
}
