import { rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedFonts, newDoc } from "./common";
import { COMPANY } from "../company";

export type RegisterRow = { name: string; empNo: string; kind: string; paidDays: number; lopDays: number; gross: number; deductions: number; net: number; erTotal: number };
export type RegisterInput = { projectName: string; payMonth: string; approved: boolean; approvedAt?: string | null; rows: RegisterRow[] };

const W = 841.89, H = 595.28, M = 40;
const ink = rgb(0.1, 0.1, 0.12), mute = rgb(0.4, 0.42, 0.48), rule = rgb(0.82, 0.84, 0.88), blue = rgb(0.12, 0.31, 0.64), soft = rgb(0.95, 0.96, 0.98), amber = rgb(0.72, 0.4, 0.05), green = rgb(0.05, 0.5, 0.35);
const monthLabel = (iso: string) => new Date(iso.slice(0, 7) + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const COLS: { h: string; x: number; right?: boolean }[] = [
  { h: "Name", x: M }, { h: "Emp no.", x: 215 }, { h: "Type", x: 285 }, { h: "Paid days", x: 395, right: true }, { h: "LOP days", x: 460, right: true },
  { h: "Gross (₹)", x: 530, right: true }, { h: "Deductions (₹)", x: 625, right: true }, { h: "Net pay (₹)", x: 705, right: true }, { h: "Employer cost (₹)", x: W - M, right: true },
];
const ROW_H = 18, PER_PAGE_FIRST = 20, PER_PAGE = 26;

/** The payroll register: one table for the whole run, landscape A4. A draft says DRAFT in the header; an approved run says Approved with its date. */
export async function buildPayrollRegister(r: RegisterInput): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc);
  const pages: RegisterRow[][] = []; const rest = [...r.rows]; pages.push(rest.splice(0, PER_PAGE_FIRST)); while (rest.length) pages.push(rest.splice(0, PER_PAGE));
  const tot = r.rows.reduce((t, x) => ({ paid: t.paid + x.paidDays, lop: t.lop + x.lopDays, gross: t.gross + x.gross, ded: t.ded + x.deductions, net: t.net + x.net, er: t.er + x.erTotal }), { paid: 0, lop: 0, gross: 0, ded: 0, net: 0, er: 0 });
  pages.forEach((rows, pi) => {
    const p = doc.addPage([W, H]); let y = H - M;
    const text = (t: string, x: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => { const font = o.font ?? f.reg, size = o.size ?? 9; const w = font.widthOfTextAtSize(t, size); p.drawText(t, { x: o.right ? x - w : x, y, size, font, color: o.color ?? ink }); };
    if (pi === 0) {
      text(COMPANY.name, M, { size: 16, font: f.bold, color: blue });
      text(r.approved ? `APPROVED${r.approvedAt ? " · " + dmy(r.approvedAt) : ""}` : "DRAFT · not approved", W - M, { size: 9, font: f.bold, color: r.approved ? green : amber, right: true }); y -= 14;
      text(COMPANY.line1.replace("Office Address : ", ""), M, { size: 8, color: mute }); y -= 8; p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rule }); y -= 24;
      text("Payroll register", M, { size: 13, font: f.bold }); text(monthLabel(r.payMonth), W - M, { size: 13, font: f.bold, color: blue, right: true }); y -= 15;
      text(`Project: ${r.projectName}   ·   ${r.rows.length} ${r.rows.length === 1 ? "person" : "people"}   ·   ${r.approved ? "Figures are final." : "Figures may change until the payroll is approved."}`, M, { size: 9, color: mute }); y -= 26;
    } else { text(`Payroll register · ${r.projectName} · ${monthLabel(r.payMonth)} · ${r.approved ? "Approved" : "DRAFT"}`, M, { size: 9, color: mute }); y -= 24; }
    p.drawRectangle({ x: M - 4, y: y - 6, width: W - 2 * M + 8, height: 20, color: soft });
    COLS.forEach((c) => text(c.h, c.x, { size: 8.5, font: f.bold, right: c.right })); y -= 22;
    rows.forEach((x, i) => {
      if (i % 2) p.drawRectangle({ x: M - 4, y: y - 5, width: W - 2 * M + 8, height: ROW_H, color: rgb(0.985, 0.985, 0.99) });
      const v = [x.name, x.empNo, x.kind === "daily" ? "Daily wage" : "Monthly", days(x.paidDays), days(x.lopDays), inr(x.gross), inr(x.deductions), inr(x.net), inr(x.erTotal)];
      COLS.forEach((c, j) => text(v[j], c.x, { right: c.right, size: j === 0 ? 9 : 9 })); y -= ROW_H;
    });
    if (pi === pages.length - 1) {
      p.drawLine({ start: { x: M - 4, y: y + 10 }, end: { x: W - M + 4, y: y + 10 }, thickness: 0.8, color: mute }); y -= 6;
      const t = ["Total", "", "", days(tot.paid), days(tot.lop), inr(tot.gross), inr(tot.ded), inr(tot.net), inr(tot.er)];
      COLS.forEach((c, j) => t[j] && text(t[j], c.x, { right: c.right, font: f.bold }));
    }
    p.drawText(`Generated ${dmy(new Date().toISOString())}  ·  Page ${pi + 1} of ${pages.length}`, { x: M, y: 24, size: 7.5, font: f.reg, color: mute });
  });
  return doc.save();
}
