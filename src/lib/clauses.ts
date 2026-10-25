import type { Clause, Employee, Section } from "./types";
import { COMPANY } from "./company";
import { fmtDateLong, probationText, renderTemplate } from "./format";
import { calcSalary, inrDash, rupeesWords, type Calc } from "./salary";

export function salaryFor(e: Employee): Calc | null {
  const cfg = e.salary && (e.salary as any).amount ? e.salary
    : e.monthly_ctc ? { basis: "ctc" as const, amount: Number(e.monthly_ctc), period: "month" as const, employer_in_ctc: false } : null;
  return cfg ? calcSalary(cfg, e.gender) : null;
}

export type AcceptMode = "email" | "signed";
export function buildVars(e: Employee, opts: { annexure?: boolean; accept_mode?: AcceptMode } = {}): Record<string, string> {
  const mode: AcceptMode = opts.accept_mode ?? "email";
  const first = (e.full_name || "").trim().split(/\s+/)[0] || "";
  const c = salaryFor(e); const basis = c?.cfg.basis ?? "ctc";
  const target = !c ? 0 : basis === "daily" ? c.daily!.rate : basis === "inhand" ? c.monthly.net : basis === "gross" ? c.monthly.gross : c.monthly.ctc;
  const annualCtc = c ? c.annual.ctc : 0;
  return {
    full_name: e.full_name || "", first_name: first,
    honorific: e.gender === "Female" ? "Ms." : "Mr.",
    designation: e.designation || "", department: e.department || "", project: e.project || "",
    site_location: e.site_location || "", base_location: e.base_location || "",
    join_date: fmtDateLong(e.join_date), probation: probationText(e.probation_months),
    // --- compensation wording (follows the basis you chose: CTC / in-hand / gross) ---
    comp_label: basis === "daily" ? "Daily wage" : basis === "inhand" ? "Net In-Hand salary" : basis === "gross" ? "Gross salary" : "Cost to Company (CTC)",
    comp_figure: target ? inrDash(target) : "", comp_words: target ? rupeesWords(target) : "",
    comp_period: basis === "daily" ? "per day" : "per month",
    comp_suffix: !c ? "" : basis === "daily" ? ", for a six-day working week with one weekly off (wages are paid for the days actually worked)" : basis === "inhand" ? ", after applicable statutory deductions (Employee PF and Professional Tax)" : basis === "ctc" ? ` (${inrDash(annualCtc)} per annum)` : "",
    comp_annexure_ref: opts.annexure ? "The detailed salary structure is specified in Annexure A." : "Provident Fund (PF) and Professional Tax (PT) will be deducted as per company policy.",
    comp_heading: opts.annexure ? "Compensation & Compensation Break-Up" : "Compensation",
    ctc_figure: c ? inrDash(c.monthly.ctc) : "", ctc_words: c ? rupeesWords(c.monthly.ctc) : "",
    inhand_figure: c ? inrDash(c.monthly.net) : "", inhand_words: c ? rupeesWords(c.monthly.net) : "",
    gross_figure: c ? inrDash(c.monthly.gross) : "", annual_ctc_figure: c ? inrDash(annualCtc) : "",
    annexure_sentence: opts.annexure ? "The detailed salary structure is specified in Annexure A." : "",
    // --- how the employee accepts: reply on the confidential email thread (default) or return a signed copy ---
    accept_mode: mode,
    acceptance_condition: mode === "email" ? "your written acceptance, by reply to the confidential email in which this letter was sent, is not received" : "written acceptance and a signed copy of this letter are not received",
    appt_accept_instruction: mode === "email" ? "please reply to the confidential email in which this letter was sent, on the same thread, stating \"I accept the position\" on or before the joining date, if not already done." : "please sign and return a duplicate copy of this letter on or before the joining date.",
    company_name: COMPANY.name, company_short: COMPANY.short,
  };
}

const has = (list: string[] | undefined, v: string | null) =>
  !list || list.length === 0 ? null : list.some((x) => (v || "").toLowerCase().includes(x.toLowerCase()));

/** A clause is pre-ticked if it is core/default_on, or if its rules match this employee (all filled-in rule groups must match). */
export function isSuggested(c: Clause, e: Employee): boolean {
  if (c.is_core || c.default_on) return true;
  const r = c.rules || {};
  const checks = [has(r.designations, e.designation), has(r.departments, e.department), has(r.projects, e.project), has(r.employment_types, e.employment_type)]
    .filter((x) => x !== null) as boolean[];
  return checks.length > 0 && checks.every(Boolean);
}

export function renderSections(clauses: Clause[], vars: Record<string, string>, overrides: Record<string, Section> = {}): Section[] {
  return [...clauses].sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => overrides[c.id] ? { title: renderTemplate(overrides[c.id].title, vars), body: renderTemplate(overrides[c.id].body, vars) } : { title: renderTemplate(c.title, vars), body: renderTemplate(c.body, vars) });
}

export function missingPlaceholders(sections: Section[]): string[] {
  const set = new Set<string>();
  for (const s of sections) for (const m of (s.title + "\n" + s.body).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) set.add(m[1]);
  return [...set];
}
// A value that is empty renders as "" (so the placeholder disappears); we flag empties separately.
export function emptyVars(sections: Section[], vars: Record<string, string>): string[] { void sections; return Object.entries(vars).filter(([, v]) => !v).map(([k]) => k); }
