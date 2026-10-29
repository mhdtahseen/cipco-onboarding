import { DEFAULT_CFG, ESI_CEILING, PF_WAGE_CEILING, calcSalary, ptSlab, type SalaryCfg } from "./salary";

// Payroll: calendar-month pay, calculated on the last day of the month and credited between the 1st and 4th of the next month.
// Joined on or before the 20th: paid for the month. Joined after the 20th: paid in the next run (the full next month plus the days from joining
// to the previous month end). All maths here is pure so it can be tested; the page only gathers the data and saves the result.
export const JOIN_CUTOFF_DAY = 20, CREDIT_FROM = 1, CREDIT_TO = 4;
const PF_EE = 0.12, PF_ER = 0.12, ADMIN_EDLI = 0.01, ESI_EE = 0.0075, ESI_ER = 0.0325;

export type DayStatus = "present" | "half" | "absent" | "off" | null;
export type PayEmp = { id: string; full_name: string; emp_no: string | null; designation: string | null; department: string | null; gender: string | null; join_date: string | null; left_on: string | null; week_off: string | null; salary: Partial<SalaryCfg> | null; pan: string | null; uan: string | null; bank_name: string | null; account_no: string | null; ifsc: string | null; upi_id: string | null; pay_mode: string | null };
export type Revision = { effective_from: string; salary: Partial<SalaryCfg> };
export type Adjustment = { id: string; kind: "earning" | "deduction" | "lop_waiver"; label: string; amount: number; days: number | null; reason: string };
export type OwedAdvance = { id: string; instalment: number; owed: number; note?: string };
export type Item = { kind: "earning" | "deduction"; label: string; amount: number; advance_id?: string; note?: string };

// ── dates (all plain "YYYY-MM-DD" strings, no time zones) ──
const p2 = (n: number) => String(n).padStart(2, "0");
export const ymOf = (iso: string) => iso.slice(0, 7);
export const daysIn = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
export const monthStart = (ym: string) => `${ym}-01`; export const monthEnd = (ym: string) => `${ym}-${p2(daysIn(ym))}`;
export const addMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; };
export const cutoffOf = (ym: string) => `${ym}-${p2(JOIN_CUTOFF_DAY)}`;
export const eachDay = (from: string, to: string) => { const out: string[] = []; let d = new Date(from + "T00:00:00"); const end = new Date(to + "T00:00:00"); while (d <= end && out.length < 400) { out.push(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); } return out; };
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dowOf = (iso: string) => DOW[new Date(iso + "T00:00:00").getDay()];
const fmtShort = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
/** The window the salary credit falls in for a pay month: the 1st to the 4th of the next month. */
export const creditWindow = (ym: string) => { const n = addMonth(ym, 1); return { from: `${n}-${p2(CREDIT_FROM)}`, to: `${n}-${p2(CREDIT_TO)}` }; };

export type Treatment = "in_run" | "next_run" | "not_joined" | "left" | "no_joining_date";
/** Is this person in the run for `ym`? */
export function treatment(e: Pick<PayEmp, "join_date" | "left_on">, ym: string): Treatment {
  if (!e.join_date) return "no_joining_date";
  if (e.left_on && e.left_on < monthStart(ym)) return "left";
  if (e.join_date > monthEnd(ym)) return "not_joined";
  if (e.join_date > cutoffOf(ym)) return "next_run";
  return "in_run";
}
/** Days from joining to the previous month end that this run pays as arrears (joined after the 20th of the previous month). */
export function arrearsWindow(e: Pick<PayEmp, "join_date" | "left_on">, ym: string): { from: string; to: string } | null {
  if (!e.join_date) return null; const prev = addMonth(ym, -1);
  if (e.join_date <= cutoffOf(prev) || e.join_date > monthEnd(prev)) return null;
  const to = e.left_on && e.left_on < monthEnd(prev) ? e.left_on : monthEnd(prev); return to < e.join_date ? null : { from: e.join_date, to };
}

// ── attendance over a window ──
export type Counts = { days: number; present: number; half: number; absent: number; off: number; unmarked: string[]; status: Record<string, DayStatus> };
export function countWindow(from: string, to: string, att: Record<string, DayStatus>, weekOff: string | null): Counts {
  const c: Counts = { days: 0, present: 0, half: 0, absent: 0, off: 0, unmarked: [], status: {} };
  for (const d of eachDay(from, to)) {
    const st: DayStatus = att[d] ?? (weekOff && dowOf(d) === weekOff ? "off" : null); c.days++; c.status[d] = st;
    if (st === "present") c.present++; else if (st === "half") c.half++; else if (st === "absent") c.absent++; else if (st === "off") c.off++; else c.unmarked.push(d);
  }
  return c;
}

const R = Math.round;
export const cfgOn = (e: Pick<PayEmp, "salary">, revs: Revision[], date: string): Partial<SalaryCfg> | null => {
  const sorted = [...revs].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const hit = [...sorted].reverse().find((r) => r.effective_from <= date) ?? sorted[0];
  return hit ? hit.salary : e.salary;
};

type Part = { label: string; from: string; to: string; n: number; paid: number; lop: number; gross: number; basic: number; hra: number; special: number; pf: number; erPF: number; erAdmin: number; esi: number; erESI: number; rateOrGross: number };
/** One wage month's worth of pay for a window of days, split wherever the salary changed inside it. */
function wagePart(e: PayEmp, revs: Revision[], ym: string, from: string, to: string, counts: Counts, label: string): { part: Part; kind: "salaried" | "daily"; cfg: SalaryCfg; perDay: number; blockers: string[] } | { blockers: string[] } {
  const n = daysIn(ym); const segs: { cfg: Partial<SalaryCfg> | null; dates: string[] }[] = [];
  for (const d of eachDay(from, to)) { const c = cfgOn(e, revs, d); const last = segs[segs.length - 1]; if (last && JSON.stringify(last.cfg) === JSON.stringify(c)) last.dates.push(d); else segs.push({ cfg: c, dates: [d] }); }
  let gross = 0, basic = 0, hra = 0, paid = 0, lop = 0, kind: "salaried" | "daily" = "salaried"; let cfgLast: SalaryCfg = DEFAULT_CFG, perDay = 0, calcLast: ReturnType<typeof calcSalary> = null;
  for (const s of segs) {
    const cfg = { ...DEFAULT_CFG, ...(s.cfg || {}) } as SalaryCfg; const calc = calcSalary(cfg, e.gender); if (!calc) return { blockers: [`${e.full_name}: no salary set`] };
    cfgLast = cfg; calcLast = calc; kind = cfg.basis === "daily" ? "daily" : "salaried";
    if (kind === "daily") { const rate = Number(cfg.amount); let w = 0; for (const d of s.dates) { const st = counts.status[d]; w += st === "present" ? 1 : st === "half" ? 0.5 : 0; } paid += w; gross += rate * w; basic += rate * w; perDay = rate; }
    else { const m = calc.monthly; let pd = 0, lp = 0; for (const d of s.dates) { const st = counts.status[d]; if (st === "present" || st === "off") pd += 1; else if (st === "half") { pd += 0.5; lp += 0.5; } else if (st === "absent") lp += 1; else lp += 1; } paid += pd; lop += lp; const ratio = pd / n; gross += m.gross * ratio; basic += m.basic * ratio; hra += m.hra * ratio; perDay = m.gross / n; }
  }
  const G = R(gross), B = R(basic), H = R(hra), S = G - B - H; const cfg = cfgLast; const wage = cfg.pf_cap ? Math.min(B, PF_WAGE_CEILING) : B;
  const daily = kind === "daily";   // daily-wage workers: ESI is the only automatic deduction, so no PF (and no employer PF / EDLI) and no Professional Tax
  const pf = cfg.pf_applicable && !daily ? R(wage * PF_EE) : 0; const eligible = !!calcLast && calcLast.monthly.gross <= ESI_CEILING && calcLast.monthly.gross > 0; const esi = eligible ? Math.ceil(G * ESI_EE) : 0;
  const erPF = cfg.employer_in_ctc && cfg.pf_applicable && !daily ? R(wage * PF_ER) : 0, erAdmin = cfg.employer_in_ctc && cfg.pf_applicable && !daily ? R(wage * ADMIN_EDLI) : 0, erESI = cfg.employer_in_ctc && eligible ? Math.ceil(G * ESI_ER) : 0;
  return { part: { label, from, to, n, paid, lop, gross: G, basic: B, hra: H, special: S, pf, erPF, erAdmin, esi, erESI, rateOrGross: kind === "daily" ? Number(cfg.amount) : calcLast!.monthly.gross }, kind, cfg, perDay, blockers: [] };
}

export type LineResult = {
  treatment: Treatment; blockers: string[]; warnings: string[]; flags: string[];
  line?: { kind: "salaried" | "daily"; days_in_month: number; paid_days: number; lop_days: number; gross: number; deductions: number; net: number; pf_emp: number; pf_er: number; pf_admin: number; esi_emp: number; esi_er: number; pt: number; er_total: number; pay_mode: string; items: Item[]; snapshot: Record<string, any> };
};

/** Work out one person's pay for the month `ym` from their attendance, salary and adjustments. */
export function computeLine(e: PayEmp, ym: string, att: Record<string, DayStatus>, revs: Revision[], adjs: Adjustment[], advances: OwedAdvance[]): LineResult {
  const tr = treatment(e, ym); const out: LineResult = { treatment: tr, blockers: [], warnings: [], flags: [] };
  if (tr === "no_joining_date") { out.blockers.push(`${e.full_name}: no joining date`); return out; }
  if (tr !== "in_run") return out;
  const from = e.join_date! > monthStart(ym) ? e.join_date! : monthStart(ym); const to = e.left_on && e.left_on < monthEnd(ym) ? e.left_on : monthEnd(ym);
  const counts = countWindow(from, to, att, e.week_off);
  const cur = wagePart(e, revs, ym, from, to, counts, "Wages");
  if (!("part" in cur)) { out.blockers.push(...cur.blockers); return out; }
  const aw = arrearsWindow(e, ym); let arr: ReturnType<typeof wagePart> | null = null; let aCounts: Counts | null = null;
  if (aw) { aCounts = countWindow(aw.from, aw.to, att, e.week_off); arr = wagePart(e, revs, addMonth(ym, -1), aw.from, aw.to, aCounts, "Arrears"); if (!("part" in arr)) { out.blockers.push(...arr.blockers); return out; } }
  if (counts.unmarked.length) out.blockers.push(`${e.full_name}: ${counts.unmarked.length} day${counts.unmarked.length > 1 ? "s" : ""} not marked (${counts.unmarked.slice(0, 4).map(fmtShort).join(", ")}${counts.unmarked.length > 4 ? "…" : ""})`);
  if (aCounts?.unmarked.length) out.blockers.push(`${e.full_name}: ${aCounts.unmarked.length} day${aCounts.unmarked.length > 1 ? "s" : ""} not marked in ${monthName(addMonth(ym, -1))} (${aCounts.unmarked.slice(0, 4).map(fmtShort).join(", ")})`);
  const mode = e.pay_mode || "bank";
  if (mode === "bank" && !(e.account_no && e.ifsc)) out.warnings.push(`${e.full_name}: bank account or IFSC missing`);
  if (mode === "upi" && !e.upi_id) out.warnings.push(`${e.full_name}: UPI ID missing`);
  const { part, kind, cfg, perDay } = cur; const items: Item[] = [];
  if (kind === "daily") items.push({ kind: "earning", label: `Daily wages (₹${R(part.rateOrGross).toLocaleString("en-IN")} × ${part.paid} days)`, amount: part.gross });
  else { items.push({ kind: "earning", label: "Basic salary", amount: part.basic }); if (part.hra) items.push({ kind: "earning", label: "House rent allowance", amount: part.hra }); if (part.special) items.push({ kind: "earning", label: "Special allowance", amount: part.special }); }
  let earnings = part.gross, pf = part.pf, esi = part.esi, erPF = part.erPF, erAdmin = part.erAdmin, erESI = part.erESI;
  if (arr && "part" in arr) { const a = arr.part; items.push({ kind: "earning", label: `Arrears ${fmtShort(a.from)} to ${fmtShort(a.to)} (${a.paid} days)`, amount: a.gross }); earnings += a.gross; pf += a.pf; esi += a.esi; erPF += a.erPF; erAdmin += a.erAdmin; erESI += a.erESI; }
  // Professional Tax is on the month's earnings (Maharashtra slab, ₹300 in February; an override on the salary is a fixed monthly amount)
  const monthGross = part.gross; let pt = cfg.pt_monthly != null && ("" + cfg.pt_monthly) !== "" ? Number(cfg.pt_monthly) : ptSlab(monthGross, e.gender); if (monthGross <= 0 || kind === "daily") pt = 0; if (pt === 200 && ym.endsWith("-02") && !(cfg.pt_monthly != null && ("" + cfg.pt_monthly) !== "")) pt = 300;
  let additions = 0, otherDed = 0, waived = 0;
  for (const a of adjs) {
    if (a.kind === "earning") { items.push({ kind: "earning", label: a.label, amount: a.amount, note: a.reason }); additions += a.amount; }
    else if (a.kind === "lop_waiver") { const amt = R(perDay * (a.days || 0)); items.push({ kind: "earning", label: `${a.label || "LOP waived"} (${a.days} day${(a.days || 0) === 1 ? "" : "s"})`, amount: amt, note: a.reason }); additions += amt; waived += Number(a.days) || 0; }
    else { items.push({ kind: "deduction", label: a.label, amount: a.amount, note: a.reason }); otherDed += a.amount; }
  }
  if (pf) items.push({ kind: "deduction", label: "Provident fund (employee)", amount: pf }); if (esi && kind !== "daily") items.push({ kind: "deduction", label: "ESI (employee)", amount: esi }); if (pt) items.push({ kind: "deduction", label: "Professional tax", amount: pt });
  const esiDed = kind === "daily" ? 0 : esi;   // daily wage: the company pays the employee's ESI share too, so nothing comes off their pay
  let available = earnings + additions - pf - esiDed - pt - otherDed, recovery = 0;
  for (const adv of advances) { const amt = Math.max(0, Math.min(adv.instalment, adv.owed, available)); if (amt > 0) { items.push({ kind: "deduction", label: `Advance recovery${adv.note ? ` (${adv.note})` : ""}`, amount: amt, advance_id: adv.id }); available -= amt; recovery += amt; } }
  const gross = earnings + additions, deductions = pf + esiDed + pt + otherDed + recovery, net = gross - deductions;
  const worked = counts.present + counts.half * 0.5;
  if (kind === "salaried" && part.lop >= 10) out.flags.push(`${part.lop} LOP days`); if (kind === "daily" && worked < 10 && counts.days >= 20) out.flags.push(`only ${worked} days worked`);
  if (arr) out.flags.push("arrears (joined after the 20th last month)"); if (e.join_date! >= monthStart(ym)) out.flags.push("joined this month"); if (e.left_on && e.left_on <= monthEnd(ym)) out.flags.push("leaves this month");
  if (new Set(revs.map((r) => r.effective_from).filter((d) => d > monthStart(ym) && d <= monthEnd(ym))).size) out.flags.push("salary revised this month"); if (net <= 0) out.flags.push("nothing to pay"); if (recovery) out.flags.push("advance recovery");
  // a waived LOP day is paid, so the day counts shown on the slip follow it (never below zero LOP)
  const waivedDays = kind === "salaried" ? Math.min(waived, part.lop) : 0;
  if (kind === "salaried" && waived > part.lop) out.warnings.push(`${e.full_name}: ${waived} LOP days waived but only ${part.lop} were lost, so the waiver pays for ${waived - part.lop} extra`);
  out.line = { kind, days_in_month: part.n, paid_days: part.paid + waivedDays, lop_days: part.lop - waivedDays, gross, deductions, net, pf_emp: pf, pf_er: erPF, pf_admin: erAdmin, esi_emp: esi, esi_er: erESI, pt, er_total: erPF + erAdmin + erESI + (kind === "daily" ? esi : 0), pay_mode: mode, items,
    snapshot: { name: e.full_name, emp_no: e.emp_no, designation: e.designation, department: e.department, join_date: e.join_date, left_on: e.left_on, pan: e.pan, uan: e.uan, bank_name: e.bank_name, account_no: e.account_no, ifsc: e.ifsc, upi_id: e.upi_id, pay_mode: mode, window: { from, to }, counts: { days: counts.days, present: counts.present, half: counts.half, absent: counts.absent, off: counts.off }, arrears: aw && aCounts ? { ...aw, days: aCounts.days, present: aCounts.present, half: aCounts.half, absent: aCounts.absent } : null, rate: kind === "daily" ? part.rateOrGross : null, monthly_gross: kind === "salaried" ? part.rateOrGross : null, month: ym } };
  return out;
}

// ── statutory ──
export type StatLine = { pf_emp: number; pf_er: number; pf_admin: number; esi_emp: number; esi_er: number; pt: number };
export const statutoryTotals = (lines: StatLine[]) => { const t = { pf: 0, esi: 0, pt: 0, pfEmp: 0, pfEr: 0, pfAdmin: 0, esiEmp: 0, esiEr: 0 }; lines.forEach((l) => { t.pfEmp += Number(l.pf_emp); t.pfEr += Number(l.pf_er); t.pfAdmin += Number(l.pf_admin); t.esiEmp += Number(l.esi_emp); t.esiEr += Number(l.esi_er); t.pt += Number(l.pt); }); t.pf = t.pfEmp + t.pfEr + t.pfAdmin; t.esi = t.esiEmp + t.esiEr; return t; };
/** Statutory due dates for a payroll month: PF and ESI by the 15th of the next month; Professional Tax by the last day of the payroll month. */
export const statDue = (ym: string, kind: "pf" | "esi" | "pt") => (kind === "pt" ? monthEnd(ym) : `${addMonth(ym, 1)}-15`);
