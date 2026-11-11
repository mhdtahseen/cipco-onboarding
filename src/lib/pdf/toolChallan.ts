import { PDFFont, PDFPage, rgb } from "pdf-lib";
import { embedFonts, newDoc, readAsset, wrapPlain } from "./common";
import { fmtDateLong, numToWordsIN } from "../format";
import { COMPANY, COMPANY_PAN } from "../company";
import { itemLabel, qtyText, type ToolItem, type Transfer } from "../tools";

export type Party = { name: string; address: string[] };

// The company's Delivery Challan, laid out like the printed challan book (DC-110 and on): "on returnable basis", the declared value if one was given,
// PAN and GST, and the two signature boxes. A short list is printed on the challan itself; a long one goes on attached pages ("list attached"), laid out like
// the company's "Complete Inventory List": a heading per category and a two-column table of item and quantity.
const A4: [number, number] = [595.28, 841.89];
const L = 40, R = 555.28, INK = rgb(0, 0, 0), GREY = rgb(0.35, 0.35, 0.4), LINE = 0.8, THIN = 0.5;
const REGD = ["Regd Address : RH 25, Memory Garden, NIBM Road", "Kondhwa Kh. Dist. Pune - 411 048", "Mobile : +91 98504 95483", `Email : ${COMPANY.supportEmail}`];
const COPIES = ["ORIGINAL White", "DUPLICATE Yellow", "TRIPLICATE Pink", "EXTRA COPY Blue"];
const COL = { sr: L, desc: L + 38, qty: 368, unit: 430, amt: 474 };   // left edges; the table ends at R
const INLINE_MAX = 12;   // up to this many lines fit on the challan itself; more go on the attached list
const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function buildToolChallan(tr: Transfer, to: Party, item: (itemId: string) => ToolItem | undefined): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc); const logo = await doc.embedPng(await readAsset("logo.png"));
  let page!: PDFPage; let y = 0;   // y = distance from the top of the page
  const t = (s: string, x: number, top: number, size: number, font: PDFFont = f.reg, color = INK) => page.drawText(s, { x, y: A4[1] - top, size, font, color });
  const rt = (s: string, xRight: number, top: number, size: number, font: PDFFont = f.reg) => t(s, xRight - font.widthOfTextAtSize(s, size), top, size, font);
  const ct = (s: string, x0: number, x1: number, top: number, size: number, font: PDFFont = f.reg) => t(s, (x0 + x1 - font.widthOfTextAtSize(s, size)) / 2, top, size, font);
  const hl = (x0: number, x1: number, top: number, w = THIN) => page.drawLine({ start: { x: x0, y: A4[1] - top }, end: { x: x1, y: A4[1] - top }, thickness: w, color: INK });
  const vl = (x: number, t0: number, t1: number, w = THIN) => page.drawLine({ start: { x, y: A4[1] - t0 }, end: { x, y: A4[1] - t1 }, thickness: w, color: INK });

  const header = (cont: boolean) => {
    page = doc.addPage(A4); const top = 40;
    // company block
    const lw = 92, lh = (lw * logo.height) / logo.width; page.drawImage(logo, { x: L + 18, y: A4[1] - top - 14 - lh, width: lw, height: lh });
    ct("Delivery Challan", 150, 440, top + 18, 15, f.bold); ct(COMPANY.name, 150, 440, top + 34, 11);
    REGD.forEach((s, i) => ct(s, 150, 440, top + 47 + i * 11, 8.5, f.ital));
    COPIES.forEach((s, i) => t(s, 462, top + 30 + i * 13, 7));
    hl(L, R, top, LINE); vl(L, top, top + 98, LINE); vl(R, top, top + 98, LINE); hl(L, R, top + 98, LINE);
    y = top + 98;
    if (cont) { t(`${tr.dc_no || tr.transfer_no} (continued)`, L + 8, y + 16, 9, f.bold); y += 24; hl(L, R, y, LINE); }
  };
  const tableHead = () => {
    const h = 26; hl(L, R, y + h, LINE); vl(L, y, y + h, LINE); vl(R, y, y + h, LINE);
    [COL.desc, COL.qty, COL.unit, COL.amt].forEach((x) => vl(x, y, y + h));
    ct("Sr No", COL.sr, COL.desc, y + 16, 9); ct("Description", COL.desc, COL.qty, y + 16, 9); ct("Qty", COL.qty, COL.unit, y + 16, 9); ct("Unit", COL.unit, COL.amt, y + 16, 9); ct("Total Amount", COL.amt, R, y + 16, 9);
    y += h;
  };
  const FOOT = 200;   // room kept at the bottom of the last page for the total, PAN / GST and the signatures
  const row = (sr: string, desc: string, qty: string, unit: string, amt: string, bold = false) => {
    const lines = wrapPlain(bold ? f.bold : f.reg, desc, 8.5, COL.qty - COL.desc - 8); const h = Math.max(1, lines.length) * 10.5 + 7;
    if (y + h > A4[1] - 60) { vl(L, y, y, LINE); header(true); tableHead(); }
    vl(L, y, y + h, LINE); vl(R, y, y + h, LINE); [COL.desc, COL.qty, COL.unit, COL.amt].forEach((x) => vl(x, y, y + h)); hl(L, R, y + h);
    ct(sr, COL.sr, COL.desc, y + 12, 8.5); lines.forEach((ln, i) => t(ln, COL.desc + 4, y + 12 + i * 10.5, 8.5, bold ? f.bold : f.reg));
    t(qty, COL.qty + 4, y + 12, 8.5); t(unit, COL.unit + 4, y + 12, 8.5); if (amt) rt(amt, R - 4, y + 12, 8.5);
    y += h;
  };

  // ── page one ──
  header(false);
  // To / reference grid
  const g0 = y, gx = 368, gv = 466, rh = 15.5;
  const refs: [string, string][] = [["DC No", tr.dc_no || tr.transfer_no], ["Date", fmtDateLong(tr.dispatched_on)], ["Your Challan No", ""], ["Your Challan Date", ""], ["Your Order No", tr.order_ref], ["Date", tr.order_ref ? fmtDateLong(tr.dispatched_on) : ""], ["Vehicle No", tr.vehicle_no]];
  refs.forEach(([k, v], i) => { const top = g0 + i * rh; t(k, gx + 4, top + 11, 8.5); if (v) rt(v, R - 4, top + 11, 8.5); hl(gx, R, top + rh); });
  vl(gx, g0, g0 + refs.length * rh); vl(gv, g0, g0 + refs.length * rh);
  t("To,", L + 26, g0 + 12, 9); t(to.name, L + 50, g0 + 27, 9.5, f.bold);
  to.address.flatMap((a) => wrapPlain(f.reg, a, 9, gx - L - 60)).slice(0, 5).forEach((a, i) => t(a, L + 50, g0 + 41 + i * 12, 9));
  y = g0 + refs.length * rh; vl(L, g0, y, LINE); vl(R, g0, y, LINE); hl(L, R, y, LINE); y += 4; hl(L, R, y, LINE);
  tableHead();
  row("", "", "", "", "");
  row("", "ON RETURNABLE BASIS", tr.declared_value != null ? "Lumpsum" : "", "", tr.declared_value != null ? money(Number(tr.declared_value)) : "", true);
  const attach = tr.tool_transfer_lines.length > INLINE_MAX;
  row("", `Old Material Tools & Tackles for Project Work on Returnable Basis${tr.note ? ` (${tr.note})` : ""}`, attach ? "(list attached)" : "", "", "");
  if (attach) row("", `Inventory list attached: ${tr.tool_transfer_lines.length} items`, "", "", "");
  else { let n = 0; for (const l of tr.tool_transfer_lines) { const it = item(l.item_id); n++; row(String(n), `${itemLabel(it)}${l.condition === "damaged" ? " (damaged)" : ""}`, qtyText(Number(l.qty)), it?.unit ?? "", ""); } }

  // ── the foot: total, PAN / GST, signatures (on a new page if the list ran too long) ──
  if (y + FOOT > A4[1] - 40) { vl(L, y, y, LINE); header(true); }
  const v = tr.declared_value != null ? Number(tr.declared_value) : null;
  const fh = 22; hl(L, R, y, LINE); vl(L, y, y + fh, LINE); vl(R, y, y + fh, LINE); vl(COL.qty, y, y + fh, LINE); vl(COL.amt, y, y + fh); hl(L, R, y + fh, LINE);
  if (v != null) rt(`Rupees ${numToWordsIN(v)} Only`, COL.qty - 6, y + 14, 8.5);
  ct("Total Amount", COL.qty, COL.amt, y + 14, 9, f.bold); if (v != null) t(money(v), COL.amt + 4, y + 14, 8.5);
  y += fh + 4;
  const s0 = y, sh = 150, sx = COL.qty;
  hl(L, R, s0, LINE); vl(L, s0, s0 + sh, LINE); vl(R, s0, s0 + sh, LINE); vl(sx, s0, s0 + sh); hl(L, R, s0 + sh, LINE);
  t("PAN", L + 30, s0 + 11, 8.5); t(COMPANY_PAN, L + 92, s0 + 11, 8.5); hl(L, sx, s0 + 15); t("GST", L + 30, s0 + 26, 8.5); t(COMPANY.gstin, L + 92, s0 + 26, 8.5); hl(L, sx, s0 + 30); vl(L + 88, s0, s0 + 30);
  ct("Received Signature with Rubber Stamp", L, sx, s0 + 44, 8.5);
  ct("For Chandrika Industrial Projects", sx, R, s0 + 30, 9.5, f.bold); ct("Company", sx, R, s0 + 43, 9.5, f.bold); ct("Authorised Signature", sx, R, s0 + sh - 8, 9);
  if (attach) await attachedList(doc, f, logo, tr, item);
  // a small print line, like the printed book's
  doc.getPages().forEach((p, i, all) => { const s = `${tr.transfer_no}${all.length > 1 ? ` · page ${i + 1} of ${all.length}` : ""}`; p.drawText(s, { x: L, y: 24, size: 7.5, font: f.reg, color: GREY }); });
  return doc.save();
}

// ── the attached list, like the "Complete Inventory List": title, a centred heading per category, a two-column table of item and quantity, the logo faint behind ──
type Doc = Awaited<ReturnType<typeof newDoc>>;
type Fonts = Awaited<ReturnType<typeof embedFonts>>;
const qtyBook = (q: number, unit: string) => { const n = Number.isInteger(q) && q < 10 ? `0${q}` : qtyText(q); return `${n} ${unit === "Nos" && q === 1 ? "No" : unit}`; };   // "02 Nos", "01 No", "40 Mtr"
async function attachedList(doc: Doc, f: Fonts, logo: Awaited<ReturnType<Doc["embedPng"]>>, tr: Transfer, item: (id: string) => ToolItem | undefined) {
  const TL = 100, TR = 495, SPLIT = 345, RH = 24, BOT = A4[1] - 70;
  let page!: PDFPage; let y = 0; let pn = 0;
  const t = (s: string, x: number, top: number, size: number, font: PDFFont = f.reg) => page.drawText(s, { x, y: A4[1] - top, size, font, color: INK });
  const ct = (s: string, x0: number, x1: number, top: number, size: number, font: PDFFont = f.reg) => t(s, (x0 + x1 - font.widthOfTextAtSize(s, size)) / 2, top, size, font);
  const newPage = () => {
    page = doc.addPage(A4); pn++;
    const w = 380, h = (w * logo.height) / logo.width; page.drawImage(logo, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h, opacity: 0.08 });
    page.drawText(String(pn), { x: A4[0] - 60, y: 40, size: 9, font: f.bold, color: INK });
    y = 60;
    if (pn === 1) {
      ct("Inventory List", 0, A4[0], y + 24, 22, f.bold); y += 44;
      ct(`Attached to Delivery Challan ${tr.dc_no || tr.transfer_no} dated ${fmtDateLong(tr.dispatched_on)}`, 0, A4[0], y, 9.5); y += 14;
      ct(`${tr.tool_transfer_lines.length} items · on returnable basis`, 0, A4[0], y, 9.5); y += 10;
    }
  };
  const rowBox = (left: string, right: string) => {
    const lines = wrapPlain(f.reg, left, 9.5, SPLIT - TL - 16); const h = Math.max(RH, lines.length * 12 + 12);
    page.drawRectangle({ x: TL, y: A4[1] - y - h, width: SPLIT - TL, height: h, borderColor: INK, borderWidth: THIN });
    page.drawRectangle({ x: SPLIT, y: A4[1] - y - h, width: TR - SPLIT, height: h, borderColor: INK, borderWidth: THIN });
    lines.forEach((ln, i) => t(ln, TL + 8, y + 16 + i * 12, 9.5)); ct(right, SPLIT, TR, y + 16, 9.5);
    y += h;
  };
  // the lines, grouped by category in catalogue order
  const lines = [...tr.tool_transfer_lines].sort((a, b) => (item(a.item_id)?.sort_order ?? 0) - (item(b.item_id)?.sort_order ?? 0));
  const groups = new Map<string, typeof lines>(); lines.forEach((l) => { const c = item(l.item_id)?.category ?? "Other"; groups.set(c, [...(groups.get(c) ?? []), l]); });
  newPage();
  for (const [cat, ls] of groups) {
    if (y + 46 + RH * Math.min(2, ls.length) > BOT) newPage();   // a heading never sits alone at the foot of a page
    y += 30; ct(cat, 0, A4[0], y, 13.5, f.bold); y += 12;
    for (const l of ls) {
      if (y + RH > BOT) { newPage(); y += 10; }
      const it = item(l.item_id); rowBox(`${itemLabel(it)}${l.condition === "damaged" ? " (damaged)" : ""}`, qtyBook(Number(l.qty), it?.unit ?? ""));
    }
  }
}
