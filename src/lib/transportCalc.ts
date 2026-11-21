import { tripRate, type Run, type TransportRate, type Vehicle } from "./attendance";

export type Approval = "awaiting" | "approved" | "rejected";
type Money = { id: string; vehicle_id: string; amount: number; voided_at: string | null };
export type TPay = Money & { paid_on: string; reference: string; note?: string; bill_path?: string | null };
/** pending: a gas-trip errand whose amount is not entered yet (counted as 0). approval: a vendor's errand waits for an Admin; before the vendor-portal migration it is absent (= approved). */
export type TErrand = Money & { work_date: string; description: string; pending?: boolean; gas_trip_ref?: string | null; approval?: Approval; source?: "staff" | "vendor";
  from_place?: string; to_place?: string;
  quoted_amount?: number | null; asked_by?: string | null; decision_note?: string | null; decided_at?: string | null; created_at?: string };
export type Line = { date: string; label: string; amount: number | null };

export const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const fmtD = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
/** Only an approved errand is billed: a vendor's errand waiting for an Admin, or rejected, never counts. */
export const isCounted = (x: TErrand) => (x.approval ?? "approved") === "approved";

/** One vehicle's month and all-time balance. runs: that project's records (any vehicle); errands and pays: any vehicle. */
export function vehicleSummary(v: Vehicle, runs: Run[], rates: TransportRate[], errands: TErrand[], pays: TPay[], month: string) {
  const mine = runs.filter((r) => r.vehicle_id === v.id); let all = 0, inMonth = 0, unpriced = 0; const monthRates = new Set<number>(); let hireFrom = "";
  const tripLines: Line[] = []; const charges: { d: string; a: number }[] = [];   // tripLines: what makes up this month's trips figure; charges: everything billed, oldest first, to find the oldest unpaid
  if (v.billing === "per_trip") [...mine].filter((r) => r.status === "showed").sort((a, b) => a.work_date.localeCompare(b.work_date) || a.leg.localeCompare(b.leg) * -1).forEach((r) => { const pr = tripRate(rates, v.id, r.work_date); const inM = r.work_date.startsWith(month);
    if (inM) tripLines.push({ date: r.work_date, label: r.leg === "pickup" ? "Pickup" : "Drop", amount: pr });
    if (pr === null) unpriced++; else { all += pr; charges.push({ d: r.work_date, a: pr }); if (inM) { inMonth += pr; monthRates.add(pr); } } });
  else { const first: Record<string, string> = {}; mine.forEach((r) => { const m = r.work_date.slice(0, 7); if (!first[m] || r.work_date < first[m]) first[m] = r.work_date; });   // a monthly vehicle bills each month that has records, at the price in force on its first record
    Object.entries(first).forEach(([m, d]) => { const pr = tripRate(rates, v.id, d); if (m === month) { hireFrom = d; tripLines.push({ date: d, label: `Monthly hire, at the price in force on its first record (${fmtD(d)})`, amount: pr }); }
      if (pr === null) unpriced++; else { all += pr; charges.push({ d, a: pr }); if (m === month) inMonth += pr; } }); }
  const er = errands.filter((x) => x.vehicle_id === v.id && !x.voided_at && isCounted(x)); const erAll = er.reduce((s, x) => s + x.amount, 0); const erM = er.filter((x) => x.work_date.startsWith(month)).sort((a, b) => a.work_date.localeCompare(b.work_date)); const erMonth = erM.reduce((s, x) => s + x.amount, 0);
  er.forEach((x) => charges.push({ d: x.work_date, a: x.amount }));
  const paid = pays.filter((x) => x.vehicle_id === v.id && !x.voided_at).reduce((s, x) => s + x.amount, 0); const mr = mine.filter((r) => r.work_date.startsWith(month));
  const showed = mr.filter((r) => r.status === "showed").length;
  // how the trips figure was reached, shown under it: "26 × ₹450", or "Monthly hire from 3 Nov"
  const how = v.billing === "per_trip" ? (showed === 0 ? "" : monthRates.size === 1 ? `${showed} × ₹${inr([...monthRates][0])}` : `${showed} trips at ${monthRates.size} rates`) : hireFrom ? `monthly hire from ${fmtD(hireFrom)}` : "";
  // payments clear the oldest charges first: the first charge they don't cover is the oldest unpaid
  charges.sort((a, b) => a.d.localeCompare(b.d)); let cum = 0, oldest: string | null = null; for (const c of charges) { cum += c.a; if (cum > paid + 0.005) { oldest = c.d; break; } }
  const noShows = mr.filter((r) => r.status === "no_show").sort((a, b) => a.work_date.localeCompare(b.work_date)).map((r) => `${fmtD(r.work_date)} ${r.leg}`);
  return { v, tripLines, erLines: erM, noShows, oldest, showed, missed: mr.filter((r) => r.status === "no_show").length, tripMonth: inMonth, erMonth, erCount: erM.length, month: inMonth + erMonth, how, tripAll: all, erAll, billed: all + erAll, paid, due: all + erAll - paid, unpriced };
}

/** Where a trip went: "Yard → Block C"; "" for trips entered before From / To existed. */
export const routeText = (x: Pick<TErrand, "from_place" | "to_place">) => (x.from_place || x.to_place ? `${x.from_place || "?"} → ${x.to_place || "?"}` : "");
