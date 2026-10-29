import { degrees, rgb, type PDFPage } from "pdf-lib";
import { drawStamp, embedFonts, newDoc, wrapPlain } from "./common";
import { BANK, COMPANY, COMPANY_PAN } from "../company";
import { rupeesWords } from "../salary";
import { money, qtyText, stateName, type Client, type Invoice, type InvoiceItem, type WorkOrder } from "../invoice";

export type InvoicePdfInput = { inv: Invoice; items: InvoiceItem[]; client: Client; wo: WorkOrder; projectName: string };

const W = 595.28, H = 841.89, M = 36;
const ink = rgb(0.1, 0.1, 0.12), mute = rgb(0.4, 0.42, 0.48), line = rgb(0.82, 0.84, 0.88), blue = rgb(0.12, 0.31, 0.64), soft = rgb(0.95, 0.96, 0.98), white = rgb(1, 1, 1);
const dmy = (iso?: string | null) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
// table columns: Sr | Description | Unit | Rate | Qty to date | Qty earlier | Qty this bill | Amount   (sums to W - 2M = 523.28)
const COLS = [22, 168, 36, 62, 52, 52, 52, 79.28];
const colX = (i: number) => M + COLS.slice(0, i).reduce((a, b) => a + b, 0);

/** A GST tax invoice for one running-account bill: header, parties, bill-wise table, tax, deductions, bank details, seal and signature. */
export async function buildInvoice(d: InvoicePdfInput): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc); const { inv, items, client, wo } = d;
  let page: PDFPage = doc.addPage([W, H]); let y = H - M;
  const text = (t: string, x: number, size = 9, font = f.reg, color = ink, right = false) => { if (!t) return; const w = font.widthOfTextAtSize(t, size); page.drawText(t, { x: right ? x - w : x, y, size, font, color }); };
  const rule = (yy: number, x1 = M, x2 = W - M) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.6, color: line });
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };

  // ── header ──
  text(COMPANY.name, M, 16, f.bold, blue); y -= 14; text(COMPANY.line1.replace("Office Address : ", ""), M, 8, f.reg, mute); y -= 10;
  text(COMPANY.line2, M, 8, f.reg, mute); y -= 10; text(`GSTIN: ${COMPANY.gstin}  ·  PAN: ${COMPANY_PAN}  ·  Udyam: ${COMPANY.udyam}`, M, 8, f.reg, mute); y -= 8; rule(y); y -= 20;
  text("TAX INVOICE", M, 14, f.bold); text(`Running Account Bill No. ${inv.bill_no}`, W - M, 10, f.bold, blue, true); y -= 8; text("Original for recipient", W - M, 7.5, f.ital, mute, true); y -= 14;

  // ── invoice / order details (two columns) and the party billed ──
  const meta: [string, string][][] = [
    [["Invoice no.", inv.invoice_no ?? "DRAFT"], ["Invoice date", dmy(inv.invoice_date)], ["Due date", dmy(inv.due_date)], ["Bill period", inv.period_from || inv.period_to ? `${dmy(inv.period_from)} to ${dmy(inv.period_to)}` : "—"]],
    [["Work order no.", wo.wo_no], ["Work order date", dmy(wo.wo_date)], ["Project", d.projectName || "—"], ["Place of supply", `${stateName(inv.place_of_supply_code)} (${inv.place_of_supply_code})`]],
  ];
  const half = (W - 2 * M) / 2; const top = y; page.drawRectangle({ x: M, y: top - 4 * 14 - 4, width: W - 2 * M, height: 4 * 14 + 8, color: soft });
  meta.forEach((col, c) => col.forEach(([k, v], i) => { const yy = top - 10 - i * 14; const x = M + 8 + c * half; page.drawText(k, { x, y: yy, size: 8, font: f.reg, color: mute }); let sz = 9; while (sz > 6.5 && f.bold.widthOfTextAtSize(v, sz) > half - 100) sz -= 0.25; page.drawText(v, { x: x + 82, y: yy, size: sz, font: f.bold, color: ink }); }));
  y = top - 4 * 14 - 18;
  text("BILL TO", M, 7.5, f.bold, mute); y -= 12; text(client.name, M, 10.5, f.bold); y -= 12;
  for (const ln of wrapPlain(f.reg, client.address ?? "", 9, W - 2 * M)) { text(ln, M, 9); y -= 11; }
  text(`GSTIN: ${client.gstin || "Unregistered"}   ·   State: ${stateName(client.state_code)} (${client.state_code})${client.pan ? `   ·   PAN: ${client.pan}` : ""}`, M, 8.5, f.reg, mute); y -= 16;

  // ── bill table ──
  const header = () => {
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: blue });
    const heads = ["Sr", "Description of work (SAC " + inv.sac + ")", "Unit", "Rate", "To date", "Earlier", "This bill", "Amount (₹)"];
    heads.forEach((h, i) => { const right = i >= 3; const w = f.bold.widthOfTextAtSize(h, 8); page.drawText(h, { x: right ? colX(i) + COLS[i] - 5 - w : colX(i) + 5, y: y + 0.5, size: 8, font: f.bold, color: white }); });
    y -= 20;
  };
  header();
  items.forEach((it, n) => {
    const lines = wrapPlain(f.reg, it.description, 8.5, COLS[1] - 10); const h = Math.max(lines.length, 1) * 11 + 4;
    if (y - h < 80) { newPage(); header(); }
    const num = (v: string, i: number) => { const w = f.reg.widthOfTextAtSize(v, 8.5); page.drawText(v, { x: colX(i) + COLS[i] - 5 - w, y, size: 8.5, font: f.reg, color: ink }); };
    page.drawText(String(n + 1), { x: colX(0) + 5, y, size: 8.5, font: f.reg, color: ink });
    lines.forEach((ln, k) => page.drawText(ln, { x: colX(1) + 5, y: y - k * 11, size: 8.5, font: f.reg, color: ink }));
    page.drawText(it.unit, { x: colX(2) + 5, y, size: 8.5, font: f.reg, color: ink });
    num(money(it.rate), 3); num(qtyText(it.cum_qty), 4); num(qtyText(it.prev_qty), 5); num(qtyText(it.qty), 6); num(money(it.amount), 7);
    y -= h; rule(y + 7);
  });

  // ── totals (right) and bank details / notes (left) ──
  const need = 250; if (y < need) { newPage(); }
  y -= 6; const tx = W - M - 230, tw = 230; let ty = y;
  const row = (label: string, v: string, bold = false, color = ink) => { const font = bold ? f.bold : f.reg; page.drawText(label, { x: tx, y: ty, size: 9, font, color }); const w = font.widthOfTextAtSize(v, 9); page.drawText(v, { x: tx + tw - w, y: ty, size: 9, font, color }); ty -= 14; };
  row("Taxable value", money(inv.taxable));
  if (Number(inv.igst) > 0) row(`IGST @ ${inv.gst_rate}%`, money(inv.igst)); else { row(`CGST @ ${inv.gst_rate / 2}%`, money(inv.cgst)); row(`SGST @ ${inv.gst_rate / 2}%`, money(inv.sgst)); }
  if (Number(inv.round_off) !== 0) row("Round off", money(inv.round_off));
  ty -= 6;
  page.drawLine({ start: { x: tx, y: ty + 10 }, end: { x: tx + tw, y: ty + 10 }, thickness: 0.6, color: line });
  page.drawRectangle({ x: tx - 4, y: ty - 6, width: tw + 8, height: 20, color: soft }); ty -= 2; row("Invoice total (₹)", money(inv.total), true, blue); ty -= 4;
  if (Number(inv.retention) > 0) row(`Less: retention @ ${inv.retention_pct}%`, "- " + money(inv.retention), false, mute);
  if (Number(inv.other_deduction) > 0) row(`Less: ${inv.other_deduction_note || "other deduction"}`.slice(0, 40), "- " + money(inv.other_deduction), false, mute);
  if (Number(inv.retention) > 0 || Number(inv.other_deduction) > 0) row("Net payable on this bill (₹)", money(inv.payable), true);

  // left column: amount in words, bank, notes
  let ly = y; const lw = tx - M - 16; const put = (t: string, size = 9, font = f.reg, color = ink) => { for (const ln of wrapPlain(font, t, size, lw)) { page.drawText(ln, { x: M, y: ly, size, font, color }); ly -= size + 3; } };
  put("Amount in words", 7.5, f.bold, mute); put(rupeesWords(Math.round(Number(inv.total))), 9, f.ital); ly -= 6;
  if (BANK.accountNo) { put("Bank details for payment", 7.5, f.bold, mute); put(`${BANK.accountName || COMPANY.name}`, 9, f.bold); put(`${BANK.bank}${BANK.branch ? ", " + BANK.branch : ""}`); put(`A/c no. ${BANK.accountNo}   ·   IFSC ${BANK.ifsc}`); ly -= 6; }
  put("Terms", 7.5, f.bold, mute);
  put(`Payment is due by ${dmy(inv.due_date)} (${wo.payment_days} days from the invoice date). Reverse charge: No.`, 8.5);
  if (Number(inv.tds_pct) > 0) put(`TDS under section 194C @ ${inv.tds_pct}% is deducted by the client on the taxable value at the time of payment; please issue the TDS certificate.`, 8.5);
  if (inv.notes) { ly -= 4; put(inv.notes, 8.5, f.reg, mute); }
  y = Math.min(ty, ly) - 6;

  // declaration and signature (kept clear of the page bottom)
  if (y < 215) newPage();
  page.drawText("We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.", { x: M, y: 52, size: 7.5, font: f.ital, color: mute });
  await drawStamp(doc, page, { x: W - M - 150, top: H - 168, signW: 70, signMaxH: 34, sealW: 48 });
  const forTxt = `For ${COMPANY.name}`; page.drawText(forTxt, { x: W - M - f.bold.widthOfTextAtSize(forTxt, 8), y: 176, size: 8, font: f.bold, color: ink });
  page.drawText(COMPANY.signatoryLabel, { x: W - M - 150, y: 110, size: 8, font: f.reg, color: mute });
  const pages = doc.getPages(); pages.forEach((p, i) => { p.drawText(`Page ${i + 1} of ${pages.length}${inv.invoice_no ? `  ·  ${inv.invoice_no}` : "  ·  DRAFT"}`, { x: M, y: 30, size: 7.5, font: f.reg, color: mute }); });
  if (inv.status === "cancelled") pages.forEach((p) => p.drawText("CANCELLED", { x: 150, y: 400, size: 80, font: f.bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.18, rotate: degrees(30) }));
  if (inv.status === "draft") pages.forEach((p) => p.drawText("DRAFT", { x: 180, y: 400, size: 90, font: f.bold, color: rgb(0.4, 0.45, 0.55), opacity: 0.15, rotate: degrees(30) }));
  return doc.save();
}
