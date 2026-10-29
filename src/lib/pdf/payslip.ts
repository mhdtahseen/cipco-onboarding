import { rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { embedFonts, newDoc, wrapPlain } from "./common";
import { COMPANY } from "../company";
import { inr, rupeesWords } from "../salary";

export type SlipLine = { kind: string; days_in_month: number; paid_days: number; lop_days: number; gross: number; deductions: number; net: number; pf_er: number; pf_admin: number; esi_er: number; er_total: number; pay_mode: string; items: { kind: "earning" | "deduction"; label: string; amount: number; note?: string }[]; snapshot: Record<string, any> };
export type SlipInput = { projectName: string; payMonth: string; line: SlipLine };

const W = 595.28, H = 841.89, M = 40;
const ink = rgb(0.1, 0.1, 0.12), mute = rgb(0.4, 0.42, 0.48), line = rgb(0.82, 0.84, 0.88), blue = rgb(0.12, 0.31, 0.64), soft = rgb(0.95, 0.96, 0.98);
const monthLabel = (iso: string) => new Date(iso.slice(0, 7) + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const dmy = (iso?: string | null) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const num = (n: unknown) => { const v = Number(n); return Number.isInteger(v) ? String(v) : v.toFixed(1); };

/** One salary slip per page, in the style of the letters: company header, employee and attendance details, earnings and deductions, net pay in words (no seal or signature, and employer contributions are deliberately left off). */
export async function buildPayslips(slips: SlipInput[]): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc);
  for (const s of slips) await slipPage(doc.addPage([W, H]), doc, f, s);
  return doc.save();
}

async function slipPage(page: PDFPage, doc: Awaited<ReturnType<typeof newDoc>>, f: Awaited<ReturnType<typeof embedFonts>>, s0: SlipInput) {
  const L = s0.line; const s: SlipInput = { ...s0, line: { ...L, days_in_month: Number(L.days_in_month), paid_days: Number(L.paid_days), lop_days: Number(L.lop_days), gross: Number(L.gross), deductions: Number(L.deductions), net: Number(L.net), pf_er: Number(L.pf_er), pf_admin: Number(L.pf_admin), esi_er: Number(L.esi_er), er_total: Number(L.er_total), items: (L.items ?? []).map((i) => ({ ...i, amount: Number(i.amount) })) } };   // numbers may arrive as strings
  const sn = s.line.snapshot ?? {}; const c = sn.counts ?? {}; let y = H - M;
  const text = (t: string, x: number, size = 9, font: PDFFont = f.reg, color = ink, right = false) => { if (!t) return; const w = font.widthOfTextAtSize(t, size); page.drawText(t, { x: right ? x - w : x, y, size, font, color }); };
  const rule = (yy: number, x1 = M, x2 = W - M) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.6, color: line });
  // header
  text(COMPANY.name, M, 16, f.bold, blue); y -= 14; text(COMPANY.line1.replace("Office Address : ", ""), M, 8, f.reg, mute); y -= 10; text(`${COMPANY.line2.split("|")[0].trim()} · ${COMPANY.line3.split("|")[0].trim()}`, M, 8, f.reg, mute); y -= 10; rule(y); y -= 22;
  text("SALARY SLIP", M, 13, f.bold); text(monthLabel(s.payMonth), W - M, 13, f.bold, blue, true); y -= 20;
  // employee block (two columns of label: value)
  const info: [string, string][] = [["Employee", sn.name ?? ""], ["Employee no.", sn.emp_no ?? "—"], ["Designation", sn.designation ?? "—"], ["Department", sn.department ?? "—"], ["Project", s.projectName], ["Date of joining", dmy(sn.join_date)], ["PAN", sn.pan ?? "—"], ["UAN", sn.uan ?? "—"], ["Paid by", sn.pay_mode === "upi" ? `UPI · ${sn.upi_id ?? ""}` : sn.pay_mode === "cash" ? "Cash" : `Bank · ${sn.bank_name ?? ""}${sn.account_no ? " · A/c xxxx" + String(sn.account_no).slice(-4) : ""}`.trim()], ["Pay month", monthLabel(s.payMonth)]];
  page.drawRectangle({ x: M, y: y - 5 - Math.ceil(info.length / 2) * 15, width: W - 2 * M, height: 6 + Math.ceil(info.length / 2) * 15, color: soft });
  info.forEach(([k, v], i) => { const col = i % 2, row = Math.floor(i / 2); const x = M + 8 + col * ((W - 2 * M) / 2); const yy = y - 10 - row * 15; page.drawText(k, { x, y: yy, size: 8, font: f.reg, color: mute }); let vs = 9; const maxW = (W - 2 * M) / 2 - 88; while (vs > 6.5 && f.bold.widthOfTextAtSize(v, vs) > maxW) vs -= 0.25; page.drawText(v, { x: x + 78, y: yy, size: vs, font: f.bold, color: ink }); });
  y -= 12 + Math.ceil(info.length / 2) * 15 + 6;
  // attendance
  const att = s.line.kind === "daily" ? [["Days worked", num(Number(c.present ?? 0) + Number(c.half ?? 0) * 0.5)], ["Present", num(c.present ?? 0)], ["Half-days", num(c.half ?? 0)], ["Absent", num(c.absent ?? 0)], ["Weekly offs", num(c.off ?? 0)]] : [["Days in month", num(s.line.days_in_month)], ["Paid days", num(s.line.paid_days)], ["LOP days", num(s.line.lop_days)], ["Present", num(c.present ?? 0)], ["Half-days", num(c.half ?? 0)], ["Weekly offs", num(c.off ?? 0)]];
  const cw = (W - 2 * M) / att.length; att.forEach(([k, v], i) => { const x = M + i * cw; page.drawText(k, { x: x + 6, y, size: 7.5, font: f.reg, color: mute }); page.drawText(v, { x: x + 6, y: y - 13, size: 11, font: f.bold, color: ink }); });
  y -= 24; if (sn.arrears) { text(`Arrears: ${dmy(sn.arrears.from)} to ${dmy(sn.arrears.to)} (${sn.arrears.days} days)`, M + 6, 8, f.ital, mute); y -= 12; }
  rule(y); y -= 18;
  // earnings | deductions
  const earn = s.line.items.filter((i) => i.kind === "earning"), ded = s.line.items.filter((i) => i.kind === "deduction"); const showDed = ded.length > 0 || s.line.kind !== "daily";   // a daily-wage slip with nothing deducted has no Deductions column
  const colW = showDed ? (W - 2 * M - 20) / 2 : W - 2 * M, x2 = M + colW + 20;
  const head = (t: string, x: number) => { page.drawRectangle({ x, y: y - 4, width: colW, height: 16, color: blue }); page.drawText(t, { x: x + 6, y: y + 0.5, size: 8.5, font: f.bold, color: rgb(1, 1, 1) }); page.drawText("Amount", { x: x + colW - 6 - f.bold.widthOfTextAtSize("Amount", 8.5), y: y + 0.5, size: 8.5, font: f.bold, color: rgb(1, 1, 1) }); };
  head("Earnings", M); if (showDed) head("Deductions", x2); y -= 20;
  const rows = Math.max(earn.length, ded.length, 1); let yy = y; const drawCol = (items: typeof earn, x: number) => { let ly = y; items.forEach((it) => { const lines = wrapPlain(f.reg, it.label, 9, colW - 80); lines.forEach((ln, k) => { page.drawText(ln, { x: x + 6, y: ly, size: 9, font: f.reg, color: ink }); if (k === 0) { const a = inr(it.amount); page.drawText(a, { x: x + colW - 6 - f.reg.widthOfTextAtSize(a, 9), y: ly, size: 9, font: f.reg, color: ink }); } ly -= 12; }); }); yy = Math.min(yy, ly); };
  drawCol(earn, M); if (showDed) drawCol(ded, x2); y = Math.min(yy, y - rows * 12) - 2; rule(y + 8, M, M + colW); if (showDed) rule(y + 8, x2, x2 + colW); y -= 4;
  const tot = (t: string, v: number, x: number) => { page.drawText(t, { x: x + 6, y, size: 9, font: f.bold, color: ink }); const a = inr(v); page.drawText(a, { x: x + colW - 6 - f.bold.widthOfTextAtSize(a, 9), y, size: 9, font: f.bold, color: ink }); };
  tot("Gross earnings", s.line.gross, M); if (showDed) tot("Total deductions", s.line.deductions, x2); y -= 22;
  // net pay
  page.drawRectangle({ x: M, y: y - 26, width: W - 2 * M, height: 38, color: soft, borderColor: line, borderWidth: 0.6 });
  page.drawText("NET PAY", { x: M + 10, y: y - 2, size: 9, font: f.bold, color: mute }); const nv = inr(s.line.net); page.drawText(nv, { x: W - M - 10 - f.bold.widthOfTextAtSize(nv, 16), y: y - 5, size: 16, font: f.bold, color: blue });
  page.drawText(rupeesWords(Math.max(0, Math.round(s.line.net))), { x: M + 10, y: y - 19, size: 8.5, font: f.ital, color: ink }); y -= 50;
  // footer
  page.drawText("This is a computer-generated salary slip.", { x: M, y: 70, size: 8, font: f.ital, color: mute });
}
