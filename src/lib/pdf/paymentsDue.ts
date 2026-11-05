import { rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedFonts, newDoc, wrapPlain } from "./common";
import { COMPANY } from "../company";
import { istToday } from "../attendance";
import { fmtMoney } from "../mealStatement";

import { CATEGORY_LABEL, type Category, type DueItem } from "../paymentsDueLabels";
export { CATEGORY_LABEL, type Category };
const ORDER: Category[] = ["food", "transport", "accommodation", "gas", "equipment", "salary", "statutory"];
export type Bank = { holder?: string; bank?: string; branch?: string; accountNo?: string; ifsc?: string; upi?: string };
/** One person or business to pay, on one project. total = everything billed/approved so far, paid = everything paid (advances included). */
export type Payee = {
  category: Category; name: string; forWhat: string; total: number; paid: number; bank?: Bank | null;
  oldestDue?: string | null;   // date the oldest unpaid part fell due (YYYY-MM-DD); drives the "overdue" note
  mode?: "bank" | "upi" | "cash" | "portal";   // portal = PF / ESI / tax paid on a government site, so no bank details are expected
  held?: boolean; draft?: boolean;   // draft = from a payroll that is not approved yet, so the amount can still change
  lines?: { label: string; total: number; paid: number }[];
  items?: DueItem[];   // every amount behind the totals, month by month (the report page picks which to show)
  running?: number;    // what is still building this month and not billed yet: shown beside the payee, not counted as owed
};
export type ProjectDues = { name: string; payees: Payee[] };
export type NotIncluded = { label: string; amount?: number }[];
export type PaymentsDueInput = { projects: ProjectDues[]; asOf?: string; preparedBy?: string; notIncluded?: NotIncluded; leftOut?: number; title?: string };

const W = 595.28, H = 841.89, M = 40, BOTTOM = 56, CW = W - 2 * M;
const ink = rgb(0.1, 0.1, 0.12), mute = rgb(0.4, 0.42, 0.48), rule = rgb(0.82, 0.84, 0.88), blue = rgb(0.12, 0.31, 0.64), soft = rgb(0.95, 0.96, 0.98), red = rgb(0.7, 0.15, 0.15), green = rgb(0.05, 0.5, 0.35), amber = rgb(0.72, 0.42, 0.02), amberSoft = rgb(1, 0.97, 0.88);
const dmy = (iso: string) => new Date(iso + "T00:00:00+05:30").toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const rs = (n: number) => "₹" + fmtMoney(n);
const days = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
const pend = (p: Payee) => Math.max(0, p.total - p.paid), adv = (p: Payee) => Math.max(0, p.paid - p.total);
const sum = (ps: Payee[]) => ps.reduce((a, p) => ({ total: a.total + p.total, paid: a.paid + Math.min(p.paid, p.total), pending: a.pending + pend(p), advance: a.advance + adv(p) }), { total: 0, paid: 0, pending: 0, advance: 0 });
const bankLines = (p: Payee): string[] => {
  if (p.mode === "portal") return ["Pay on the government portal", "(challan)"];
  if (p.mode === "cash") return ["Cash"];
  const b = p.bank; const out: string[] = [];
  if (b?.accountNo) { if (b.holder) out.push(b.holder); out.push([b.bank, b.branch].filter(Boolean).join(", ")); out.push(`A/c ${b.accountNo}`); if (b.ifsc) out.push(`IFSC ${b.ifsc}`); }
  if (b?.upi) out.push(`UPI ${b.upi}`);
  return out.filter(Boolean);
};

/** The payments-due report: for each project, who is owed what, how much of it is already paid (advances included), and what is still pending. */
export async function buildPaymentsDue(s: PaymentsDueInput): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc); const today = s.asOf ?? istToday();
  let page!: PDFPage, y = 0; const pages: PDFPage[] = []; let running = "";
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - M; if (running) { page.drawText(running, { x: M, y, size: 8, font: f.bold, color: mute }); page.drawText("Payments due report", { x: W - M - f.bold.widthOfTextAtSize("Payments due report", 8), y, size: 8, font: f.bold, color: mute }); y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rule }); y -= 18; } };
  const need = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const text = (t: string, x: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean; yy?: number } = {}) => { const font = o.font ?? f.reg, size = o.size ?? 9; const w = font.widthOfTextAtSize(t, size); page.drawText(t, { x: o.right ? x - w : x, y: o.yy ?? y, size, font, color: o.color ?? ink }); };
  const hr = (c = rule) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: c });
  const box = (x: number, top: number, w: number, h: number, fill = soft) => page.drawRectangle({ x, y: top - h, width: w, height: h, color: fill });

  // ---- page 1: the whole picture
  newPage();
  text(COMPANY.name, M, { size: 16, font: f.bold, color: blue }); text("PAYMENTS DUE REPORT", W - M, { size: 12, font: f.bold, right: true }); y -= 13;
  text(COMPANY.line1.replace("Office Address : ", ""), M, { size: 8, color: mute }); text(`${s.title ? `${s.title}  ·  ` : ""}As of ${dmy(today)}`, W - M, { size: s.title ? 8.5 : 9, font: s.title ? f.bold : f.reg, color: s.title ? blue : mute, right: true }); y -= 8; hr(); y -= 22;

  const all = s.projects.flatMap((p) => p.payees); const tot = sum(all);
  const kpi = (x: number, w: number, label: string, v: number, c: ReturnType<typeof rgb>, sub?: string) => { box(x, y, w, 58); text(label.toUpperCase(), x + 12, { size: 7.5, font: f.bold, color: mute, yy: y - 16 }); text(rs(v), x + 12, { size: 17, font: f.bold, color: c, yy: y - 38 }); if (sub) text(sub, x + 12, { size: 7.5, color: mute, yy: y - 51 }); };
  const kw = (CW - 20) / 3; kpi(M, kw, "Total billed", tot.total, ink, "approved and due so far"); kpi(M + kw + 10, kw, "Paid so far", tot.paid, green, tot.advance ? `plus ${rs(tot.advance)} advance (credit)` : "against the bills so far"); kpi(M + 2 * (kw + 10), kw, "Still to pay", tot.pending, tot.pending ? red : green, `${all.filter((p) => pend(p) > 0).length} payees waiting`);
  y -= 78;

  // reading guide, for people who do not live in the app
  const guide = wrapPlain(f.reg, "Billed = the total we owe. Paid = what has been paid against it. Pending = what is still to be paid. Advance = money paid beyond what was billed so far; it is a credit that covers the next bill." + (s.projects.some((p) => p.payees.some((x) => x.running)) ? " Running = what this month has cost so far and is not billed yet: shown for information, not counted as owed." : ""), 7.5, CW - 20);
  box(M, y, CW, 26 + guide.length * 10, amberSoft); text("How to read this report", M + 10, { size: 8, font: f.bold, color: amber, yy: y - 14 }); guide.forEach((l, i) => text(l, M + 10, { size: 7.5, color: ink, yy: y - 26 - i * 10 }));
  y -= 46 + guide.length * 10;

  const tableHead = (cols: [string, number, boolean][]) => { box(M, y + 4, CW, 18); cols.forEach(([l, x, r]) => text(l.toUpperCase(), x, { size: 7, font: f.bold, color: mute, right: r, yy: y - 8 })); y -= 24; };
  const figRow = (label: string, v: { total: number; paid: number; pending: number; advance: number }, bold = false, sub?: string) => {
    need(30); const font = bold ? f.bold : f.reg; text(label, M + 6, { size: 9, font }); if (sub) text(sub, M + 6, { size: 7, color: mute, yy: y - 11 });
    text(rs(v.total), 330, { size: 9, font, right: true }); text(rs(v.paid), 420, { size: 9, font, color: green, right: true }); text(rs(v.pending), W - M - 6, { size: 9, font: f.bold, color: v.pending ? red : green, right: true });
    if (v.advance) text(`advance ${rs(v.advance)}`, 420, { size: 6.5, color: green, right: true, yy: y - 11 });
    y -= sub || v.advance ? 26 : 18; page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.3, color: rule }); };

  text("By project", M, { size: 10.5, font: f.bold, color: blue }); y -= 16;
  tableHead([["Project", M + 6, false], ["Billed", 330, true], ["Paid", 420, true], ["Pending", W - M - 6, true]]);
  s.projects.forEach((p) => figRow(p.name, sum(p.payees), false, `${new Set(p.payees.map((x) => x.name)).size} payees`)); figRow("All projects", tot, true); y -= 14;

  need(150); text("By kind of payment", M, { size: 10.5, font: f.bold, color: blue }); y -= 16;
  tableHead([["Kind", M + 6, false], ["Billed", 330, true], ["Paid", 420, true], ["Pending", W - M - 6, true]]);
  ORDER.forEach((c) => { const r = all.filter((p) => p.category === c); if (r.length) figRow(CATEGORY_LABEL[c], sum(r)); });
  y -= 10;

  const missing = all.filter((p) => pend(p) > 0 && p.mode !== "portal" && p.mode !== "cash" && !bankLines(p).length).length, held = all.filter((p) => p.held).length, drafts = all.filter((p) => p.draft).length;
  const flags = [missing && `${missing} payee${missing === 1 ? " has" : "s have"} money pending but no bank details yet`, drafts && `${drafts} salar${drafts === 1 ? "y is" : "ies are"} from a payroll that is still a draft: the amounts can change until it is approved`, held && `${held} salary payment${held === 1 ? " is" : "s are"} on hold`, s.leftOut && `${s.leftOut} payee${s.leftOut === 1 ? " was" : "s were"} left out of this report by choice`, s.notIncluded?.length && "Items waiting for approval are on the last page and are not in these totals"].filter(Boolean) as string[];
  if (flags.length) { need(30 + flags.length * 13); text("Please note", M, { size: 10.5, font: f.bold, color: blue }); y -= 14; flags.forEach((t) => { text("•", M + 4, { size: 9, color: amber }); text(t, M + 16, { size: 8.5 }); y -= 13; }); }

  // ---- one section per project
  const COLS = { name: M + 6, total: 292, paid: 346, pend: 400, bank: 410, tick: W - M - 12 };
  s.projects.forEach((proj) => {
    running = proj.name; newPage(); const t = sum(proj.payees);
    box(M, y + 8, CW, 64, blue); page.drawText(proj.name, { x: M + 12, y: y - 14, size: 14, font: f.bold, color: rgb(1, 1, 1) });
    const stat = (x: number, l: string, v: number) => { page.drawText(l.toUpperCase(), { x, y: y - 34, size: 6.5, font: f.bold, color: rgb(0.8, 0.86, 0.96) }); page.drawText(rs(v), { x, y: y - 50, size: 11, font: f.bold, color: rgb(1, 1, 1) }); };
    stat(M + 12, "Billed", t.total); stat(M + 140, "Paid", t.paid); stat(M + 268, "Pending", t.pending); stat(M + 396, "Advance paid (credit)", t.advance);
    y -= 88;
    ORDER.forEach((c) => {
      const rows = proj.payees.filter((p) => p.category === c); if (!rows.length) return;
      const st = sum(rows);
      const catHead = (cont: boolean) => { text(CATEGORY_LABEL[c] + (cont ? " (continued)" : ""), M, { size: 10.5, font: f.bold, color: blue }); if (!cont) text(`Pending ${rs(st.pending)}`, W - M, { size: 9, font: f.bold, color: st.pending ? red : green, right: true }); y -= 8; hr(); y -= 12;
        box(M, y + 4, CW, 16); text("PAY TO / FOR", COLS.name, { size: 6.5, font: f.bold, color: mute, yy: y - 7 }); text("BILLED", COLS.total, { size: 6.5, font: f.bold, color: mute, right: true, yy: y - 7 }); text("PAID", COLS.paid, { size: 6.5, font: f.bold, color: mute, right: true, yy: y - 7 }); text("PENDING", COLS.pend, { size: 6.5, font: f.bold, color: mute, right: true, yy: y - 7 }); text("BANK DETAILS", COLS.bank + 8, { size: 6.5, font: f.bold, color: mute, yy: y - 7 }); text("PAID?", COLS.tick - 8, { size: 6.5, font: f.bold, color: mute, yy: y - 7 }); y -= 22; };
      need(100); catHead(false);
      rows.forEach((p) => {
        const forLines = wrapPlain(f.reg, p.forWhat, 7.5, COLS.total - 80 - COLS.name), bl = bankLines(p), noBank = pend(p) > 0 && p.mode !== "portal" && p.mode !== "cash" && !bl.length;
        const lineCount = p.lines?.length ?? 0, h = Math.max(16 + forLines.length * 9.5 + lineCount * 9.5, 8 + (noBank ? 1 : bl.length) * 9.5, p.running ? 32 : 0) + 6; if (y - h < BOTTOM) { newPage(); catHead(true); }
        const top = y; text(p.name, COLS.name, { size: 8.5, font: f.bold }); let ly = top - 11; forLines.forEach((l) => { text(l, COLS.name, { size: 7.5, color: mute, yy: ly }); ly -= 9.5; });
        (p.lines ?? []).forEach((l) => { text(`${l.label}`, COLS.name + 8, { size: 7, color: mute, yy: ly }); text(`${rs(l.total)} · paid ${rs(Math.min(l.paid, l.total))}`, COLS.total, { size: 7, color: mute, right: true, yy: ly }); ly -= 9.5; });
        text(rs(p.total), COLS.total, { size: 8.5, right: true }); text(rs(Math.min(p.paid, p.total)), COLS.paid, { size: 8.5, color: green, right: true });
        text(rs(pend(p)), COLS.pend, { size: 8.5, font: f.bold, color: pend(p) ? red : green, right: true });
        if (adv(p)) text(`advance ${rs(adv(p))}`, COLS.pend, { size: 6.5, color: green, right: true, yy: top - 11 });
        else if (pend(p) > 0 && p.oldestDue && p.oldestDue < today) text(`${days(p.oldestDue, today)} day${days(p.oldestDue, today) === 1 ? "" : "s"} overdue`, COLS.pend, { size: 6.5, color: red, right: true, yy: top - 11 });
        else if (p.draft) text("draft payroll", COLS.pend, { size: 6.5, color: amber, right: true, yy: top - 11 });
        else if (p.held) text("on hold", COLS.pend, { size: 6.5, color: amber, right: true, yy: top - 11 });
        if (p.running) text(`+ ${rs(p.running)} running`, COLS.pend, { size: 6.5, color: blue, right: true, yy: top - 21 });
        if (noBank) text("⚠ Bank details missing", COLS.bank + 8, { size: 7, font: f.bold, color: amber }); else bl.forEach((l, i) => text(l, COLS.bank + 8, { size: 7, color: i ? mute : ink, yy: top - i * 9.5 }));
        page.drawRectangle({ x: COLS.tick - 8, y: top - 8, width: 9, height: 9, borderColor: mute, borderWidth: 0.7 });
        y = top - h; page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.3, color: rule }); y -= 10;
      });
      y -= 12;
    });
  });

  // ---- last page: what is not in the totals, and sign-off
  running = ""; newPage();
  text("Not in these totals", M, { size: 12, font: f.bold, color: blue }); y -= 8; hr(); y -= 16;
  if (s.notIncluded?.length) s.notIncluded.forEach((n) => { need(16); text("•", M + 4, { size: 9, color: amber }); const lines = wrapPlain(f.reg, n.label, 8.5, CW - 110); lines.forEach((l, i) => { text(l, M + 16, { size: 8.5, yy: y - i * 11 }); }); if (n.amount !== undefined) text(rs(n.amount), W - M, { size: 8.5, right: true }); y -= lines.length * 11 + 4; });
  else { text("Nothing is waiting for approval.", M + 4, { size: 8.5, color: mute }); y -= 16; }
  y -= 16; need(150); text("Sign-off", M, { size: 12, font: f.bold, color: blue }); y -= 8; hr(); y -= 40;
  [["Prepared by", s.preparedBy ?? ""], ["Checked by", ""], ["Approved by", ""]].forEach(([l, v], i) => { const x = M + i * (CW / 3); page.drawLine({ start: { x, y }, end: { x: x + CW / 3 - 20, y }, thickness: 0.6, color: mute }); text(l, x, { size: 8, color: mute, yy: y - 11 }); if (v) text(v, x, { size: 8.5, yy: y + 4 }); });
  y -= 40; text("Date: ____ / ____ / ________", M, { size: 8.5, color: mute });

  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.5, color: rule });
    p.drawText("CIPCO Operations", { x: M, y: 27, size: 8, font: f.bold, color: blue });
    p.drawText("  ·  Confidential: contains bank details. Do not forward.", { x: M + f.bold.widthOfTextAtSize("CIPCO Operations", 8), y: 27, size: 8, font: f.reg, color: mute });
    const right = `${dmy(today)}  ·  Page ${i + 1} of ${pages.length}`; p.drawText(right, { x: W - M - f.reg.widthOfTextAtSize(right, 7.5), y: 14, size: 7.5, font: f.reg, color: mute });
  });
  return doc.save();
}
