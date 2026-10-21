import { numToWordsIN } from "./format";

/** How the salary is entered and how it is split. Stored per employee (employees.salary jsonb). */
export type SalaryCfg = {
  basis: "ctc" | "inhand" | "gross";          // which number YOU fix; everything else is calculated
  amount: number;                              // the number for that basis
  period: "month" | "year";                    // only meaningful for ctc / gross
  basic_mode: "pct_gross" | "pct_ctc" | "fixed";
  basic_value: number;                         // % (pct modes) or ₹ per month (fixed)
  hra_pct: number;                             // HRA as % of basic
  pf_applicable: boolean;
  pf_cap: boolean;                             // PF on max ₹15,000 wage
  employer_in_ctc: boolean;                    // CTC = gross + employer PF/admin/ESI  (false: CTC = gross)
  pt_monthly?: number | null;                  // override Professional Tax per month (blank = Maharashtra slab)
};

export const PF_WAGE_CEILING = 15000, ESI_CEILING = 21000;
const PF_EE = 0.12, PF_ER = 0.12, ADMIN_EDLI = 0.01, ESI_EE = 0.0075, ESI_ER = 0.0325;

export const DEFAULT_CFG: SalaryCfg = { basis: "inhand", amount: 0, period: "month", basic_mode: "pct_gross", basic_value: 50, hra_pct: 40, pf_applicable: true, pf_cap: true, employer_in_ctc: true, pt_monthly: null };

/** One-click structures that mirror the letters you already issue. */
export const PRESETS: { key: string; label: string; cfg: Partial<SalaryCfg> }[] = [
  { key: "pct_gross", label: "Basic = 50% of gross (trainee / entry level)", cfg: { basic_mode: "pct_gross", basic_value: 50, hra_pct: 40, pf_cap: true, employer_in_ctc: true } },
  { key: "fixed15", label: "Basic fixed at ₹15,000 (fitter / skilled worker)", cfg: { basic_mode: "fixed", basic_value: 15000, hra_pct: 40, pf_cap: true, employer_in_ctc: false } },
  { key: "pct_ctc", label: "Basic = 50% of CTC (engineer, CTC package)", cfg: { basic_mode: "pct_ctc", basic_value: 50, hra_pct: 40, pf_cap: true, employer_in_ctc: true } },
];

export type Month = { basic: number; hra: number; special: number; gross: number; pf: number; esi: number; pt: number; ded: number; net: number; erPF: number; erAdmin: number; erESI: number; erTotal: number; ctc: number };
export type Calc = {
  cfg: SalaryCfg; monthly: Month; annual: Month; ptAnnual: number; exact: boolean; diff: number; warnings: string[];
  labels: { basic: string; hra: string; pf: string; esi: string; pt: string; special: string };
};

/** Maharashtra Professional Tax slab (men / women). Verify with your CA — slabs change. */
export function ptSlab(gross: number, gender?: string | null): number {
  if (gender === "Female") return gross > 25000 ? 200 : 0;
  if (gross <= 7500) return 0; if (gross <= 10000) return 175; return 200;
}
const ptYear = (pt: number) => (pt === 200 ? 2500 : pt * 12);   // ₹200 × 11 months + ₹300 in February

function build(cfg: SalaryCfg, gender: string | null | undefined, x: number): { m: Month; neg: boolean } {
  const R = Math.round, pfW = (b: number) => (cfg.pf_cap ? Math.min(b, PF_WAGE_CEILING) : b);
  let basic: number, gross: number, erPF = 0, erAdmin = 0, erESI = 0;
  if (cfg.basic_mode === "pct_ctc") {
    const C = x; basic = R((C * cfg.basic_value) / 100);
    if (cfg.pf_applicable) { erPF = R(pfW(basic) * PF_ER); erAdmin = R(pfW(basic) * ADMIN_EDLI); }
    if (cfg.employer_in_ctc) {
      let g = C - erPF - erAdmin; for (let i = 0; i < 4; i++) { erESI = g <= ESI_CEILING ? Math.ceil(g * ESI_ER) : 0; g = C - erPF - erAdmin - erESI; }
      gross = C - erPF - erAdmin - erESI;
    } else { erPF = erAdmin = erESI = 0; gross = C; }
  } else {
    gross = x; basic = cfg.basic_mode === "fixed" ? Math.min(cfg.basic_value, gross) : R((gross * cfg.basic_value) / 100);
    if (cfg.employer_in_ctc) {
      if (cfg.pf_applicable) { erPF = R(pfW(basic) * PF_ER); erAdmin = R(pfW(basic) * ADMIN_EDLI); }
      erESI = gross <= ESI_CEILING ? Math.ceil(gross * ESI_ER) : 0;
    }
  }
  const hra = Math.min(R((basic * cfg.hra_pct) / 100), Math.max(gross - basic, 0));
  const special = gross - basic - hra;
  const pf = cfg.pf_applicable ? R(pfW(basic) * PF_EE) : 0;
  const esi = gross <= ESI_CEILING ? Math.ceil(gross * ESI_EE) : 0;
  const pt = cfg.pt_monthly != null && cfg.pt_monthly !== ("" as any) ? Number(cfg.pt_monthly) : ptSlab(gross, gender);
  const ded = pf + esi + pt, net = gross - ded, erTotal = erPF + erAdmin + erESI;
  return { m: { basic, hra, special, gross, pf, esi, pt, ded, net, erPF, erAdmin, erESI, erTotal, ctc: gross + erTotal }, neg: special < 0 || net < 0 };
}

const pick = (m: Month, basis: SalaryCfg["basis"]) => (basis === "inhand" ? m.net : basis === "gross" ? m.gross : m.ctc);

export function calcSalary(cfg0: Partial<SalaryCfg>, gender?: string | null): Calc | null {
  const cfg = { ...DEFAULT_CFG, ...cfg0 } as SalaryCfg;
  const amt = Number(cfg.amount); if (!amt || amt <= 0) return null;
  const target = cfg.period === "year" && cfg.basis !== "inhand" ? Math.round(amt / 12) : Math.round(amt);
  const warnings: string[] = [];
  const direct = cfg.basis === "gross" && cfg.basic_mode !== "pct_ctc" || cfg.basis === "ctc" && cfg.basic_mode === "pct_ctc";
  let x = target, best = build(cfg, gender, x), exact = pick(best.m, cfg.basis) === target;
  if (!direct) {
    const f = (v: number) => pick(build(cfg, gender, v).m, cfg.basis);
    const seg = (lo: number, hi: number) => {            // smallest x in [lo,hi] with f(x) >= target (f is increasing inside a segment)
      if (f(hi) < target) return null; let a = lo, b = hi;
      while (a < b) { const mid = (a + b) >> 1; f(mid) >= target ? (b = mid) : (a = mid + 1); }
      let bx = a, bd = Math.abs(f(a) - target);
      for (let v = Math.max(lo, a - 6); v <= Math.min(hi, a + 6); v++) { const d = Math.abs(f(v) - target); if (d < bd || (d === bd && v > bx)) { bd = d; bx = v; } }
      return { x: bx, d: bd };
    };
    const hi = Math.ceil(target * 2) + 5000;
    const c = [cfg.basic_mode === "pct_ctc" ? null : seg(1, ESI_CEILING), seg(cfg.basic_mode === "pct_ctc" ? 1 : ESI_CEILING + 1, hi)].filter(Boolean) as { x: number; d: number }[];
    if (!c.length) { x = hi; } else {
      c.sort((p, q) => p.d - q.d || q.x - p.x); x = c[0].x;
      if (c.length === 2 && c[0].d === 0 && c[1].d === 0) warnings.push("Two structures give this amount: one with ESI (gross ≤ ₹21,000) and one without. Showing the higher gross, without ESI.");
    }
    best = build(cfg, gender, x); exact = pick(best.m, cfg.basis) === target;
  }
  const m = best.m; const diff = pick(m, cfg.basis) - target;
  if (!exact) warnings.push(`Rounding: the ${cfg.basis === "inhand" ? "net in-hand" : cfg.basis === "ctc" ? "CTC" : "gross"} works out to ₹${pick(m, cfg.basis).toLocaleString("en-IN")} (₹${Math.abs(diff)} ${diff > 0 ? "above" : "below"} the target) because PF/ESI are rounded to whole rupees.`);
  if (best.neg) warnings.push("This amount is too low for the chosen structure (special allowance or net goes negative). Adjust the basic % or HRA %.");
  if (m.gross <= ESI_CEILING && m.gross > 0) warnings.push("Gross is ₹21,000 or below, so ESI (0.75% employee, 3.25% employer) is applied automatically.");
  if (cfg.pf_applicable && cfg.basic_mode !== "fixed" && !cfg.pf_cap && m.basic > PF_WAGE_CEILING) warnings.push("PF is on the full basic (above the ₹15,000 ceiling). Tick ‘cap PF wage at ₹15,000’ if that is not intended.");
  const ptA = m.pt === 0 ? 0 : cfg.pt_monthly != null && ("" + cfg.pt_monthly) !== "" ? ptYear(m.pt) : ptYear(m.pt);
  const A = (k: keyof Month) => m[k] * 12;
  const annual: Month = { basic: A("basic"), hra: A("hra"), special: A("special"), gross: A("gross"), pf: A("pf"), esi: A("esi"), pt: ptA, ded: 0, net: 0, erPF: A("erPF"), erAdmin: A("erAdmin"), erESI: A("erESI"), erTotal: A("erTotal"), ctc: 0 };
  annual.ded = annual.pf + annual.esi + annual.pt; annual.net = annual.gross - annual.ded; annual.ctc = annual.gross + annual.erTotal;
  if (cfg.basis === "ctc" && cfg.period === "year") annual.ctc = Math.round(amt);
  const pct = cfg.basic_value;
  const labels = {
    basic: cfg.basic_mode === "fixed" ? (cfg.basic_value === PF_WAGE_CEILING ? "Basic Salary (Capped at statutory limit)" : "Basic Salary (Fixed)") : `Basic Salary (${pct}% of ${cfg.basic_mode === "pct_ctc" ? "CTC" : "Gross"})`,
    hra: `House Rent Allowance (HRA - ${cfg.hra_pct}% of Basic)`, special: "Special Allowance",
    pf: `Employee PF Contribution (12% of Basic${cfg.pf_cap && m.basic > PF_WAGE_CEILING ? ", capped at ₹15k statutory ceiling" : ""})`,
    esi: "Employee ESI Contribution (Gross > ₹21,000 = nil)", pt: "Professional Tax (PT - Maharashtra Standard)",
  };
  return { cfg, monthly: m, annual, ptAnnual: ptA, exact, diff, warnings, labels };
}

// ---------- display helpers ----------
export function inr(n: number): string {
  const neg = n < 0; let s = String(Math.abs(Math.round(n)));
  if (s.length > 3) { const last3 = s.slice(-3); let rest = s.slice(0, -3); rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ","); s = rest + "," + last3; }
  return (neg ? "-" : "") + "₹" + s;
}
export const inrDash = (n: number) => inr(n) + "/-";
export const rupeesWords = (n: number) => `Rupees ${numToWordsIN(n)} Only`;

export type AnnexureRow = { label: string; monthly: string; annual: string; kind?: "head" | "total" | "grand" | "row" };
/** Rows exactly as printed in Annexure A (same order/wording as your existing letters). */
export function annexureRows(c: Calc): AnnexureRow[] {
  const m = c.monthly, a = c.annual, L = c.labels, r = (label: string, mv: number, av: number, kind: AnnexureRow["kind"] = "row"): AnnexureRow => ({ label, monthly: inr(mv), annual: inr(av), kind });
  const showEr = c.cfg.employer_in_ctc;
  const rows: AnnexureRow[] = [{ label: "A. Earnings", monthly: "", annual: "", kind: "head" },
    r(L.basic, m.basic, a.basic), r(L.hra, m.hra, a.hra), r(L.special, m.special, a.special),
    r(showEr ? "Gross Salary (A)" : "Gross Salary / Total Cost to Company (A)", m.gross, a.gross, "total"),
    { label: "B. Employee Deductions", monthly: "", annual: "", kind: "head" },
    ...(c.cfg.pf_applicable ? [r(L.pf, m.pf, a.pf)] : []), r(L.esi, m.esi, a.esi), r(L.pt, m.pt, a.pt),
    r("Total Deductions (B)", m.ded, a.ded, "total"), r("C. Net In-Hand Salary (A - B)", m.net, a.net, "total")];
  if (showEr) rows.push({ label: "D. Employer Contributions", monthly: "", annual: "", kind: "head" },
    ...(c.cfg.pf_applicable ? [r("Employer PF Contribution (12% of Basic" + (c.cfg.pf_cap && m.basic > PF_WAGE_CEILING ? ", capped" : "") + ")", m.erPF, a.erPF), r("PF Admin & EDLI Charges (~1% of PF wage)", m.erAdmin, a.erAdmin)] : []),
    r("Employer ESI Contribution", m.erESI, a.erESI), r("Total Employer Contributions (D)", m.erTotal, a.erTotal, "total"),
    r("Total Cost to Company - CTC (A + D)", m.ctc, a.ctc, "grand"));
  return rows;
}
export function annexureNotes(c: Calc, tfa = true): string[] {
  const n = ["Professional Tax is calculated per Maharashtra rules (₹200/month for 11 months, ₹300 for February)."];
  if (tfa) n.push(`All Site Travel, Food, Lodging, and Local Transportation costs are borne directly by the company and are over and above the ${c.cfg.basis === "inhand" ? "monthly salary" : "CTC"} listed above.`);
  return n;
}
