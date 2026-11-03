// What a hired machine's logged time comes to. Pure functions, shared by the Hired equipment page and anything else that needs the amount.
export type EqRate = { item_id: string; unit: "hour" | "day"; rate: number; min_hours: number; round_minutes: number; overtime_after_hours: number | null; overtime_rate: number | null; gst_pct: number; valid_from: string };
export type EqLog = { item_id: string; work_date: string; start_at: string; end_at: string | null; voided_at: string | null; verified_at?: string | null };

/** The rate in force on a day: the latest one that started on or before it. */
export const rateOn = (rates: EqRate[], itemId: string, date: string): EqRate | null =>
  rates.filter((r) => r.item_id === itemId && r.valid_from <= date).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0] ?? null;

/** Minutes between start and end (or now, for a machine still running). */
export const minutesOf = (l: Pick<EqLog, "start_at" | "end_at">, now = Date.now()) => Math.max(0, Math.round(((l.end_at ? Date.parse(l.end_at) : now) - Date.parse(l.start_at)) / 60000));
export const hoursText = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} m`;

/** One machine's charge for one day, before GST, from the minutes it worked that day.
 *  Hourly: the day's time is rounded up to the rounding step, raised to the minimum hours, and hours past the overtime threshold use the overtime rate.
 *  Daily: one day's rate for any day with work, plus overtime hours past the threshold at the overtime rate. */
export function dayCharge(r: EqRate, minutes: number): { hours: number; amount: number } {
  if (minutes <= 0) return { hours: 0, amount: 0 };
  let m = minutes; if (r.round_minutes > 0) m = Math.ceil(m / r.round_minutes) * r.round_minutes;
  let hours = m / 60; const ot = r.overtime_after_hours, otRate = r.overtime_rate ?? r.rate;
  if (r.unit === "day") { const extra = ot !== null && hours > ot ? (hours - ot) * otRate : 0; return { hours, amount: r.rate + extra }; }
  hours = Math.max(hours, r.min_hours);
  const normal = ot !== null ? Math.min(hours, ot) : hours, over = ot !== null ? Math.max(0, hours - ot) : 0;
  return { hours, amount: normal * r.rate + over * otRate };
}

export type EqTotals = { amount: number; gst: number; hours: number; days: number; unpriced: number; unverifiedMinutes: number; running: number };
/** What the logs of the given machines between two dates (inclusive) come to, split by day. A running entry is not counted until it is stopped. */
export function chargeFor(logs: EqLog[], rates: EqRate[], itemIds: Set<string>, from: string, to: string): EqTotals {
  const t: EqTotals = { amount: 0, gst: 0, hours: 0, days: 0, unpriced: 0, unverifiedMinutes: 0, running: 0 };
  const perDay = new Map<string, number>();
  logs.forEach((l) => { if (l.voided_at || !itemIds.has(l.item_id) || l.work_date < from || l.work_date > to) return; if (!l.end_at) { t.running++; return; }
    const m = minutesOf(l); if (!l.verified_at) t.unverifiedMinutes += m; const k = `${l.item_id}|${l.work_date}`; perDay.set(k, (perDay.get(k) ?? 0) + m); });
  perDay.forEach((m, k) => { const [item, date] = k.split("|"); const r = rateOn(rates, item, date); if (!r) { t.unpriced++; return; } const c = dayCharge(r, m); t.amount += c.amount; t.gst += c.amount * r.gst_pct / 100; t.hours += c.hours; t.days++; });
  return t;
}
