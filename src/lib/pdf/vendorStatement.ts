import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedFonts, newDoc, wrapPlain } from "./common";
import { COMPANY } from "../company";
import { MEALS } from "../attendance";
import { fmtMoney, spanLabel, type Breakdown } from "../mealStatement";

export type StatementInput = { vendorName: string; projectName: string; b: Breakdown; billNo?: string; billed?: number; verified: Record<string, "ok" | "incomplete">; includeNames: boolean; billFile?: Uint8Array | null };

const W = 595.28, H = 841.89, M = 40, BOTTOM = 54;
const ink = rgb(0.1, 0.1, 0.12), mute = rgb(0.4, 0.42, 0.48), rule = rgb(0.82, 0.84, 0.88), blue = rgb(0.12, 0.31, 0.64), soft = rgb(0.95, 0.96, 0.98), red = rgb(0.7, 0.15, 0.15), green = rgb(0.05, 0.5, 0.35), amber = rgb(0.72, 0.4, 0.05);
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const dayLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

/** The meal statement sent to a vendor as proof of what was recorded for the days of a bill: prices, counts, the total, day by day, and (optionally) who ate. Nothing internal (approvals, notes) is printed. */
export async function buildVendorStatement(s: StatementInput): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc); const { b } = s;
  let page!: PDFPage, y = 0; const pages: PDFPage[] = [];
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - M; };
  const need = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const text = (t: string, x: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => { const font = o.font ?? f.reg, size = o.size ?? 9; const w = font.widthOfTextAtSize(t, size); page.drawText(t, { x: o.right ? x - w : x, y, size, font, color: o.color ?? ink }); };
  const hr = () => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rule });
  const heading = (t: string) => { need(40); y -= 8; text(t, M, { size: 10.5, font: f.bold, color: blue }); y -= 8; hr(); y -= 14; };

  newPage();
  text(COMPANY.name, M, { size: 16, font: f.bold, color: blue }); y -= 13; text(COMPANY.line1.replace("Office Address : ", ""), M, { size: 8, color: mute }); y -= 8; hr(); y -= 24;
  text("Meal statement", M, { size: 14, font: f.bold }); text(`${dmy(b.from)} to ${dmy(b.to)}`, W - M, { size: 12, font: f.bold, color: blue, right: true }); y -= 18;
  text(`Vendor: ${s.vendorName}`, M, { size: 10 }); y -= 13; text(`Project: ${s.projectName}${s.billNo ? `   ·   Your bill no.: ${s.billNo}` : ""}`, M, { size: 10 }); y -= 20;

  // the comparison
  const diff = s.billed !== undefined ? s.billed - b.amount : 0;
  if (s.billed !== undefined) {
    page.drawRectangle({ x: M, y: y - 38, width: W - 2 * M, height: 46, color: soft });
    const col = (label: string, val: string, x: number, color = ink) => { page.drawText(label, { x, y: y - 6, size: 8, font: f.reg, color: mute }); page.drawText(val, { x, y: y - 24, size: 13, font: f.bold, color }); };
    col("Amount on your bill", `₹${fmtMoney(s.billed)}`, M + 12); col("Meals recorded by us", `₹${fmtMoney(b.amount)}`, M + 175);
    col("Difference", Math.abs(diff) < 1 ? "Matches" : `${diff > 0 ? "+" : "−"}₹${fmtMoney(Math.abs(diff))}`, M + 355, Math.abs(diff) < 1 ? green : diff > 0 ? red : green);
    y -= 56;
  }

  // how the amount is worked out
  heading("How the amount is worked out");
  const cx = { meal: M, days: M + 80, price: M + 300, n: M + 380, amt: W - M };
  const th = (t: string, x: number, right = false) => text(t, x, { size: 8, font: f.bold, color: mute, right }); th("Meal", cx.meal); th("Days", cx.days); th("Price", cx.price, true); th("Meals", cx.n, true); th("Amount", cx.amt, true); y -= 14;
  for (const l of b.lines) { need(16); text(l.label, cx.meal); text(spanLabel(l.first, l.last), cx.days, { color: mute }); text(l.price === null ? "no price" : `₹${fmtMoney(l.price)}`, cx.price, { right: true, color: l.price === null ? amber : ink }); text(String(l.count), cx.n, { right: true }); text(`₹${fmtMoney(l.amount)}`, cx.amt, { right: true }); y -= 15; }
  need(24); y += 6; hr(); y -= 14; text("Total", cx.meal, { font: f.bold }); text(String(b.count), cx.n, { right: true, font: f.bold }); text(`₹${fmtMoney(b.amount)}`, cx.amt, { right: true, font: f.bold }); y -= 16;
  if (b.unpriced > 0) { need(14); text(`${b.unpriced} meal${b.unpriced === 1 ? "" : "s"} had no price set and ${b.unpriced === 1 ? "is" : "are"} not included in the amount.`, M, { size: 8.5, color: amber }); y -= 14; }
  text("Each meal is counted once for the vendor recorded for it, at the price in force on that day.", M, { size: 8.5, color: mute }); y -= 8;

  // day by day
  heading("Day by day");
  const dx = { d: M, b: M + 190, l: M + 250, di: M + 310, amt: M + 400, v: W - M };
  const dh = () => { text("Date", dx.d, { size: 8, font: f.bold, color: mute }); MEALS.forEach((m, i) => text(m.label, [dx.b, dx.l, dx.di][i] + 40, { size: 8, font: f.bold, color: mute, right: true })); text("Amount", dx.amt + 35, { size: 8, font: f.bold, color: mute, right: true }); text("Day closed", dx.v, { size: 8, font: f.bold, color: mute, right: true }); y -= 14; };
  dh();
  for (const d of b.days) {
    if (y - 15 < BOTTOM) { newPage(); dh(); }
    text(dayLabel(d.date), dx.d); d.counts.forEach((n, i) => text(n ? String(n) : "—", [dx.b, dx.l, dx.di][i] + 40, { right: true })); text(`₹${fmtMoney(d.amount)}`, dx.amt + 35, { right: true });
    const v = s.verified[d.date]; text(v === "ok" ? "verified" : v === "incomplete" ? "verified (incomplete)" : "not yet verified", dx.v, { right: true, size: 8, color: v === "ok" ? green : v ? amber : mute }); y -= 15;
  }
  need(24); y += 6; hr(); y -= 14; text("Total", dx.d, { font: f.bold }); [0, 1, 2].forEach((i) => text(String(b.days.reduce((t, d) => t + d.counts[i], 0)), [dx.b, dx.l, dx.di][i] + 40, { right: true, font: f.bold })); text(`₹${fmtMoney(b.amount)}`, dx.amt + 35, { right: true, font: f.bold }); y -= 10;

  // who ate
  if (s.includeNames) {
    heading("Who ate, day by day");
    for (const d of b.register) {
      need(26); text(dayLabel(d.date), M, { font: f.bold, size: 9 }); y -= 12;
      for (const m of d.meals) {
        const lines = wrapPlain(f.reg, m.people.map((p) => p.name + (p.emp_no ? ` (${p.emp_no})` : "")).join(", "), 8.5, W - 2 * M - 90);
        lines.forEach((ln, i) => { need(12); if (i === 0) text(`${m.label} (${m.people.length})`, M + 8, { size: 8.5, color: mute }); text(ln, M + 90, { size: 8.5 }); y -= 11.5; });
      }
      y -= 5;
    }
  }
  // footer: the app this statement came from, then the date and page
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.5, color: rule });
    p.drawText("CIPCO Operations", { x: M, y: 27, size: 8, font: f.bold, color: blue });
    const lead = f.bold.widthOfTextAtSize("CIPCO Operations", 8);
    p.drawText("  ·  Attendance, meals, payroll and site records in one place  ·  ops.cipcogroup.com", { x: M + lead, y: 27, size: 8, font: f.reg, color: mute });
    const right = `${dmy(new Date().toISOString().slice(0, 10))}  ·  Page ${i + 1} of ${pages.length}`;
    p.drawText(right, { x: W - M - f.reg.widthOfTextAtSize(right, 7.5), y: 14, size: 7.5, font: f.reg, color: mute });
  });
  if (s.billFile) await appendBill(doc, s.billFile, f);
  return doc.save();
}


/** The vendor's own bill goes in after the statement: its pages if it is a PDF, otherwise the photo on a page of its own. A file that cannot be read is skipped, so the statement still goes out. */
async function appendBill(doc: PDFDocument, bytes: Uint8Array, f: { reg: PDFFont; bold: PDFFont }) {
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50, isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  try {
    if (isPdf) { const src = await PDFDocument.load(bytes, { ignoreEncryption: true }); (await doc.copyPages(src, src.getPageIndices())).forEach((pg) => doc.addPage(pg)); return; }
    const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const page = doc.addPage([W, H]); page.drawText("Vendor's bill", { x: M, y: H - M - 6, size: 12, font: f.bold, color: blue });
    const boxW = W - 2 * M, boxH = H - 2 * M - 30, k = Math.min(boxW / img.width, boxH / img.height, 1), w = img.width * k, h = img.height * k;
    page.drawImage(img, { x: M + (boxW - w) / 2, y: H - M - 30 - h, width: w, height: h });
  } catch { /* unreadable bill file: leave it out */ }
}
