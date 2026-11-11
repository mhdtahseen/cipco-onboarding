// Offboarding: what an exit is, its checklist, who may issue which exit letter, and the wording of each letter. Pure (no database), so the screen and the server
// agree. The database (2026-11-offboarding.sql) enforces the exit itself; the letters route enforces the letter rules below.
import { COMPANY } from "./company";
import { fmtDateLong, numToWordsIN } from "./format";
import type { Employee } from "./types";

export type ExitType = "resigned" | "contract_end" | "terminated" | "absconded";
export type PayAction = "pay" | "hold" | "forfeit";
export type Rehire = "yes" | "no" | "conditional";
export type ExitStatus = "open" | "closed" | "cancelled";
export type Exit = {
  id: string; employee_id: string; project_id: string | null; exit_type: ExitType; resigned_on: string | null; last_day: string; reason: string; notes: string;
  rehire: Rehire; rehire_note: string; pay_action: PayAction; pay_reason: string; status: ExitStatus; close_note: string;
  created_by: string | null; created_at: string; closed_at: string | null; cancelled_at: string | null; cancel_reason: string; rehired_at: string | null;
};
export type ItemKey = "assets" | "handover" | "accommodation" | "advances" | "settlement" | "esi" | "pf";
export type ExitItem = { item: ItemKey; state: "done" | "na"; done_on: string | null; note: string; file_path: string | null; done_by: string | null; updated_at: string };

export const EXIT_TYPE: Record<ExitType, string> = { resigned: "Resigned", contract_end: "Contract / project ended", terminated: "Terminated", absconded: "Absconded" };
export const PAY_ACTION: Record<PayAction, { label: string; help: string }> = {
  pay: { label: "Pay the final salary", help: "Paid as usual, up to the last working day." },
  hold: { label: "Hold the salary", help: "Everything still unpaid is put on hold until they settle. Release it from Payroll → Pay." },
  forfeit: { label: "Do not pay (forfeit)", help: "Admin only, with a reason. The final month is left out of payroll and anything else unpaid is held." },
};
export const REHIRE: Record<Rehire, string> = { yes: "Yes", conditional: "With conditions", no: "No" };

export const ITEMS: { key: ItemKey; label: string; hint: string }[] = [
  { key: "assets", label: "Company items returned", hint: "ID card, PPE, tools, SIM, keys." },
  { key: "handover", label: "Work handed over", hint: "To the Site Engineer or whoever takes over." },
  { key: "accommodation", label: "Accommodation vacated", hint: "Bed freed in the Accommodation module." },
  { key: "advances", label: "Advances settled", hint: "Outstanding advances recovered from the final pay or written off." },
  { key: "settlement", label: "Final settlement paid", hint: "The last salary and any dues paid (or recovered)." },
  { key: "esi", label: "Removed from the ESIC portal", hint: "Mark the exit date on the ESIC employer portal. Attach a screenshot if you can." },
  { key: "pf", label: "Exit date marked on the EPFO portal", hint: "Date of exit and reason (e.g. Cessation / short service) on the EPFO unified portal." },
];

export type ExitLetterKind = "relieving" | "experience" | "recommendation" | "settlement" | "absconding_notice";
export const EXIT_LETTER: Record<ExitLetterKind, { label: string; code: string; file: string }> = {
  relieving: { label: "Relieving letter", code: "rl", file: "Relieving Letter" },
  experience: { label: "Experience letter", code: "exp", file: "Experience Letter" },
  recommendation: { label: "Letter of recommendation", code: "lor", file: "Letter of Recommendation" },
  settlement: { label: "Full and final settlement", code: "fnf", file: "Full and Final Settlement" },
  absconding_notice: { label: "Absconding notice", code: "abs", file: "Notice of Absence" },
};
export const isExitLetter = (k: string): k is ExitLetterKind => k in EXIT_LETTER;
export const LETTER_LABEL: Record<string, string> = { offer: "Offer letter", appointment: "Appointment letter", ...Object.fromEntries(Object.entries(EXIT_LETTER).map(([k, v]) => [k, v.label])) };

/** Every checklist item is done or not applicable, and a login linked to the person is disabled (loginOk: no linked login, or it is disabled). */
export const isCleared = (items: ExitItem[], loginOk = true) => loginOk && ITEMS.every((i) => items.some((x) => x.item === i.key));

/** May this letter be issued now? Admin and Operations only. Operations follow the rules; an Admin may override them (the screen asks first).
 *  Returns null when allowed, else the reason it is not. */
export function letterBlock(kind: ExitLetterKind, x: Exit | null, items: ExitItem[], loginOk = true): string | null {
  if (kind === "absconding_notice") return null;
  if (!x || x.status === "cancelled") return "Record the exit first.";
  if (kind === "settlement") return null;
  if (x.exit_type === "absconded") return "They absconded: relieving, experience and recommendation letters are not issued.";
  if (!isCleared(items)) return "Finish the exit checklist first (each item done or not applicable).";
  if (!loginOk) return "Disable their login first (Exit tab).";
  if (kind === "recommendation" && x.exit_type === "terminated") return "A recommendation is not given on termination.";
  if (kind === "recommendation" && x.rehire !== "yes") return "A recommendation is only given when they can be rehired.";
  return null;
}

// ── the wording ──
export type SettlementRow = { label: string; amount: number };   // + payable to them, − recovered from them
export type ExitLetterDraft = { subject: string; to: "person" | "whom"; paragraphs: string[]; rows?: SettlementRow[]; ack?: boolean };
export type NoticeArgs = { notice_no: 1 | 2; absent_since: string; report_by: string; first_notice_on?: string };

const d = (iso: string | null | undefined) => (iso ? fmtDateLong(iso) : "");
export function pronouns(e: Pick<Employee, "gender">) { const f = e.gender === "Female"; return { he: f ? "she" : "he", He: f ? "She" : "He", him: f ? "her" : "him", his: f ? "her" : "his", His: f ? "Her" : "His" }; }
export const rupees = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}/-`;
export const settlementNet = (rows: SettlementRow[]) => Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));

/** The default draft of a letter. Everything in it can be edited on screen before it is issued. */
export function draftLetter(kind: ExitLetterKind, e: Employee, x: Exit | null, extra: { rows?: SettlementRow[]; notice?: NoticeArgs; strengths?: string; settled?: boolean } = {}): ExitLetterDraft {
  const p = pronouns(e); const hon = e.gender === "Female" ? "Ms." : "Mr."; const name = `${hon} ${e.full_name}`;
  const role = e.designation || "a member of our team"; const co = COMPANY.name; const join = d(e.join_date), last = d(x?.last_day ?? e.left_on);
  const no = e.emp_no ? ` (Employee No. ${e.emp_no})` : ""; const dept = e.department ? ` in the ${e.department} Department` : ""; const proj = e.project ? `, working at our ${e.project} project` : "";
  const type = x?.exit_type ?? "resigned";
  if (kind === "relieving") {
    const first = type === "resigned"
      ? `This has reference to your resignation${x?.resigned_on ? ` dated ${d(x.resigned_on)}` : ""}. We wish to inform you that your resignation has been accepted, and you are relieved from your duties as ${role} with ${co} with effect from the close of working hours on ${last}.`
      : type === "contract_end"
        ? `On the completion of your assignment${e.project ? ` at our ${e.project} project` : ""}, you are relieved from your duties as ${role} with ${co} with effect from the close of working hours on ${last}.`
        : `This is to confirm that your services as ${role} with ${co} have come to an end, and you are relieved from your duties with effect from the close of working hours on ${last}.`;
    return { subject: "Relieving Letter", to: "person", paragraphs: [
      first,
      `We confirm that you were employed with us from ${join} to ${last}.${extra.settled ? " Your full and final settlement has been completed, and no dues are pending from either side." : ""}`,
      type === "terminated" ? "We wish you the best for the future." : "We thank you for your contribution to the company and wish you every success in your future endeavours.",
    ] };
  }
  if (kind === "experience") {
    const good = type === "resigned" || type === "contract_end";
    return { subject: "Experience Certificate", to: "whom", paragraphs: [
      `This is to certify that ${name}${no} was employed with ${co} from ${join} to ${last}. At the time of leaving, ${p.he} held the position of ${role}${dept}${proj}.`,
      ...(good ? [`During ${p.his} tenure with us, we found ${p.him} to be sincere and hardworking, and ${p.his} conduct was good.`] : []),
      `We wish ${p.him} all the best in ${p.his} future endeavours.`,
    ] };
  }
  if (kind === "recommendation") {
    return { subject: "Letter of Recommendation", to: "whom", paragraphs: [
      `It is my pleasure to recommend ${name}, who worked with ${co} as ${role} from ${join} to ${last}${e.project ? `, at our ${e.project} project` : ""}.`,
      extra.strengths?.trim() || `[Describe ${p.his} strengths, the work ${p.he} did and what ${p.he} achieved. Edit this paragraph before issuing.]`,
      `${p.He} would be a valuable addition to any organisation, and we recommend ${p.him} without reservation. For any further information, please contact us at ${COMPANY.supportEmail}.`,
    ] };
  }
  if (kind === "settlement") {
    const rows = extra.rows ?? []; const net = settlementNet(rows);
    return { subject: "Full and Final Settlement", to: "person", rows, ack: true, paragraphs: [
      `This statement sets out the full and final settlement of your dues on leaving ${co}, your last working day being ${last}.`,
      net > 0 ? `The net amount of ${rupees(net)} (Rupees ${numToWordsIN(net)} only) is payable to you. With this payment, all your dues with the company stand settled.`
        : net < 0 ? `The net amount of ${rupees(net)} (Rupees ${numToWordsIN(-net)} only) is recoverable from you and is to be paid to the company. On its payment, all dues stand settled.`
          : "Nothing is payable by either side. All your dues with the company stand settled.",
    ] };
  }
  // absconding notice
  const n = extra.notice ?? { notice_no: 1, absent_since: "", report_by: "" };
  return n.notice_no === 1
    ? { subject: "Notice for Unauthorised Absence from Duty", to: "person", paragraphs: [
        `You have been absent from duty without any intimation or approval since ${d(n.absent_since) || "[date]"}. Our attempts to contact you have been unsuccessful.`,
        `You are hereby directed to report for duty on or before ${d(n.report_by) || "[date]"} and to submit a written explanation for your absence.`,
        "If you do not report by that date, it will be presumed that you have voluntarily abandoned your employment, and the company will proceed as per its rules without any further notice.",
      ] }
    : { subject: "Final Notice for Unauthorised Absence from Duty", to: "person", paragraphs: [
        `This is further to our notice${n.first_notice_on ? ` dated ${d(n.first_notice_on)}` : ""}, to which you have not responded. You have remained absent from duty without approval since ${d(n.absent_since) || "[date]"}.`,
        `This is your final opportunity to report for duty, on or before ${d(n.report_by) || "[date]"}, with a written explanation for your absence.`,
        `If you do not report by that date, your name will be removed from the rolls of the company with effect from ${d(n.absent_since) || "[date]"}, on the ground that you have voluntarily abandoned your employment. Any dues will be settled only after you return all company property and complete the exit formalities.`,
      ] };
}

/** The person's postal address for a letter addressed to them: the current address, else the permanent one. */
export const addressLines = (e: Pick<Employee, "current_address" | "permanent_address" | "city" | "district" | "state" | "pin">) => {
  const a = (e.current_address || e.permanent_address || "").split(/\n/).map((s) => s.trim().replace(/,$/, "")).filter(Boolean);
  const tail = [e.city, e.district, e.state].filter(Boolean).filter((x) => !a.join(" ").toLowerCase().includes(String(x).toLowerCase()));
  if (tail.length || e.pin) a.push([tail.join(", "), e.pin && !a.join(" ").includes(e.pin) ? `- ${e.pin}` : ""].filter(Boolean).join(" "));
  return a.filter(Boolean).slice(0, 5);
};
