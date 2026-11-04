import { rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { drawStamp, embedFonts, newDoc, wrapPlain } from "./common";
import { COMPANY } from "../company";
import { fmtMoney } from "../mealStatement";

export type GasOrderPdf = {
  orderNo: string; orderedOn: string; neededBy: string | null; projectName: string; projectLocation: string;
  vendor: { name: string; contact: string; phone: string; gstin: string; address?: string };
  lines: { product: string; capacity: string; qty: number; rate: number; gst: number }[];
  terms: { deposits: { product: string; amount: number }[]; rent: number; postRent: number; graceDays: number; loss: number; damage: number; chargesGst: number; transport: number; dueFirst: number; dueSecond: number; note: string; noticeHours: number; freeMin: number } | null;
};

const W = 595.28, H = 841.89, M = 40, BOTTOM = 60;
const ink = rgb(0.1, 0.1, 0.12), mute = rgb(0.4, 0.42, 0.48), rule = rgb(0.82, 0.84, 0.88), blue = rgb(0.12, 0.31, 0.64), soft = rgb(0.95, 0.96, 0.98);
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** The purchase order sent to the gas vendor: what is ordered, for which project, the rates locked when it was approved, and the terms it is supplied on. Built here so it cannot be edited. */
export async function buildGasOrder(o: GasOrderPdf): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc);
  let page!: PDFPage, y = 0;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const need = (h: number) => { if (y - h < BOTTOM) newPage(); };
  const text = (t: string, x: number, op: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => { const font = op.font ?? f.reg, size = op.size ?? 9.5; const w = font.widthOfTextAtSize(t, size); page.drawText(t, { x: op.right ? x - w : x, y, size, font, color: op.color ?? ink }); };
  const hr = () => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rule });
  const para = (t: string, size = 9, color = ink) => { for (const l of wrapPlain(f.reg, t, size, W - 2 * M - 10)) { need(size + 5); text(l, M + 10, { size, color }); y -= size + 4; } };

  newPage();
  text(COMPANY.name, M, { size: 16, font: f.bold, color: blue }); y -= 13; text(COMPANY.line1.replace("Office Address : ", ""), M, { size: 8, color: mute }); y -= 11; text(`${COMPANY.line3.split("|")[0].trim()}`, M, { size: 8, color: mute }); y -= 9; hr(); y -= 26;
  text("Purchase order: gas cylinders", M, { size: 14, font: f.bold }); text(o.orderNo, W - M, { size: 13, font: f.bold, color: blue, right: true }); y -= 20;
  text("To", M, { size: 8, color: mute }); text("Date", M + 330, { size: 8, color: mute }); y -= 12;
  text(o.vendor.name, M, { size: 11, font: f.bold }); text(dmy(o.orderedOn), M + 330, { size: 10 }); y -= 13;
  const contact = [o.vendor.contact, o.vendor.phone].filter(Boolean).join("  ·  "); if (contact) { text(contact, M, { size: 9, color: mute }); y -= 12; }
  if (o.vendor.address) { text(o.vendor.address, M, { size: 9, color: mute }); y -= 12; }
  if (o.vendor.gstin) { text(`GSTIN ${o.vendor.gstin}`, M, { size: 9, color: mute }); y -= 12; }
  y -= 6; text("Deliver to", M, { size: 8, color: mute }); text("Needed by", M + 330, { size: 8, color: mute }); y -= 12;
  text(o.projectName, M, { size: 10, font: f.bold }); text(o.neededBy ? dmy(o.neededBy) : "As soon as possible", M + 330, { size: 10 }); y -= 12;
  if (o.projectLocation) { text(o.projectLocation, M, { size: 9, color: mute }); y -= 12; }
  y -= 12;

  // lines
  const cx = { no: M, prod: M + 22, qty: M + 290, rate: M + 360, gst: M + 410, amt: W - M };
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: soft });
  const th = (t: string, x: number, right = false) => text(t, x, { size: 8, font: f.bold, color: mute, right }); th("#", cx.no); th("Product", cx.prod); th("Qty", cx.qty, true); th("Rate", cx.rate, true); th("GST", cx.gst, true); th("Amount (before GST)", cx.amt, true); y -= 20;
  let sub = 0, gst = 0, cyl = 0;
  o.lines.forEach((l, i) => {
    need(26); const amt = l.qty * l.rate; sub += amt; gst += amt * l.gst / 100; cyl += l.qty;
    text(String(i + 1), cx.no); text(l.product, cx.prod, { font: f.bold }); if (l.capacity) { y -= 11; text(l.capacity, cx.prod, { size: 8.5, color: mute }); y += 11; }
    text(String(l.qty), cx.qty, { right: true }); text(`₹${fmtMoney(l.rate)}`, cx.rate, { right: true }); text(`${l.gst}%`, cx.gst, { right: true }); text(`₹${fmtMoney(amt)}`, cx.amt, { right: true }); y -= 26;
  });
  y += 8; hr(); y -= 16;
  const sum = (label: string, v: string, bold = false) => { need(16); text(label, cx.gst + 20, { right: true, font: bold ? f.bold : f.reg, color: bold ? ink : mute }); text(v, cx.amt, { right: true, font: bold ? f.bold : f.reg }); y -= 15; };
  const m2 = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  sum(`Cylinders ordered: ${cyl}   ·   Amount before GST`, `₹${m2(sub)}`); sum("GST", `₹${m2(gst)}`); sum("Order total", `₹${m2(sub + gst)}`, true);
  if (o.terms && o.terms.transport > 0) {   // not part of the cylinder total: it is charged for each delivery trip, so the vendor and the site both see it before the first delivery
    const tg = o.terms.transport * (1 + o.terms.chargesGst / 100); need(16);
    text(`Plus transport: ₹${m2(o.terms.transport)} per delivery trip${o.terms.chargesGst > 0 ? ` + ${o.terms.chargesGst}% GST = ₹${m2(tg)}` : ""}, charged on delivery`, cx.amt, { right: true, size: 8.5, color: mute }); y -= 14;
  }
  y -= 8;

  const t = o.terms;
  if (t) {
    need(40); text("Terms of supply", M, { size: 10.5, font: f.bold, color: blue }); y -= 8; hr(); y -= 14;
    const rows: string[] = [];
    if (t.deposits.length) rows.push(`Cylinder deposit (refundable when the cylinders are returned in the same condition): ${t.deposits.map((d) => `${d.product} ₹${fmtMoney(d.amount)}`).join(", ")} per cylinder.`);
    if (t.noticeHours > 0 || t.freeMin > 0) rows.push(`${t.noticeHours > 0 ? `Please give us at least ${t.noticeHours} hours' notice before cylinders are needed. ` : ""}${t.freeMin > 0 ? `Delivery is free from ${t.freeMin} cylinders in one order.` : ""}`.trim());
    if (t.transport > 0) rows.push(`Transportation is charged at ₹${fmtMoney(t.transport)} per trip${t.chargesGst > 0 ? `, plus ${t.chargesGst}% GST` : ""}.`);
    if (t.rent > 0) rows.push(`Cylinder rent of ₹${fmtMoney(t.rent)} per cylinder per day applies to a cylinder not rotated often enough in a month, as per your quotation.`);
    if (t.postRent > 0) rows.push(`When the project is over, cylinders are returned within ${t.graceDays} days; after that ₹${fmtMoney(t.postRent)} per cylinder per day is payable as rent.`);
    if (t.loss > 0) rows.push(`A cylinder lost on site is charged at ₹${fmtMoney(t.loss)}${t.chargesGst > 0 ? ` + ${t.chargesGst}% GST` : ""}.`);
    if (t.damage > 0) rows.push(`A cylinder whose valve and cap are damaged on site is charged at ₹${fmtMoney(t.damage)}${t.chargesGst > 0 ? ` + ${t.chargesGst}% GST` : ""}.`);
    rows.push("The rates above are those in force when this order was approved. Please quote this order number on every challan and invoice.");
    for (const r of rows) { need(14); text("•", M + 2); const ls = wrapPlain(f.reg, r, 9, W - 2 * M - 14); ls.forEach((l, i) => { need(13); text(l, M + 12, { size: 9 }); y -= 12.5; if (i === ls.length - 1) y -= 2; }); }
    if (t.note.trim()) { y -= 4; para(t.note.trim(), 9, mute); }
  }
  need(110); y -= 18; text("For " + COMPANY.name, M, { size: 9.5, font: f.bold }); y -= 4;
  await drawStamp(doc, page, { x: M, top: H - y + 2, signW: 90, sealW: 60 }); y -= 78; text("Authorised signatory", M, { size: 8.5, color: mute });
  return doc.save();
}
