import { PDFDocument, PDFFont, PDFImage, rgb } from "pdf-lib";
import { COMPANY } from "../company";
import { fmtDateLong } from "../format";
import { fillClient, inr, itemAmount, money, totals, type Quote, type QItem } from "../quote";
import { Fonts, embedFonts, newDoc, readAsset, wrapPlain } from "./common";
import { BOTTOM, H, INK, ML, MR, TOP, TOP_P1, W, Writer } from "./letters";

// Quotation layout: cover letter, quotation table + notes + terms, optional scope of work, then the two supply lists.
class QWriter extends Writer {
  mark?: PDFImage;
  constructor(doc: PDFDocument, f: Fonts) { super(doc, f); this.line3 = COMPANY.quoteLine3; }
  async watermark() {
    this.mark ??= await this.doc.embedPng(await readAsset("logo.png"));
    const w = 380, h = (w * this.mark.height) / this.mark.width;
    this.page.drawImage(this.mark, { x: (W - w) / 2, y: (H - h) / 2 - 20, width: w, height: h, opacity: 0.07 });
  }
  async start() { this.page = this.doc.addPage([W, H]); await this.watermark(); this.y = TOP_P1; await this.header(); }
  async newPage() { await super.newPage(); await this.watermark(); }
}

const BLUEFILL = rgb(0.64, 0.77, 0.95), LINE = rgb(0, 0, 0);
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

async function list(w: QWriter, items: string[], o: { font: PDFFont; numbered?: boolean; size?: number }) {
  const size = o.size ?? 10, lh = size * 1.55, x0 = ML + 26, width = W - MR - x0;
  for (let i = 0; i < items.length; i++) {
    const ls = wrapPlain(o.font, items[i], size, width);
    await w.ensure(lh * Math.min(ls.length, 2));
    for (let j = 0; j < ls.length; j++) {
      await w.ensure(lh); w.y += lh;
      if (j === 0) w.page.drawText(o.numbered ? `${i + 1}.` : "•", { x: o.numbered ? x0 - 22 : x0 - 12, y: H - w.y, size, font: o.font, color: INK });
      w.page.drawText(ls[j], { x: x0, y: H - w.y, size, font: o.font, color: INK });
    }
    w.y += size * 0.6;
  }
}

function itemCells(i: QItem, n: number, f: Fonts) {
  const qty = i.lump ? ["01"] : [`${i.qty}${i.unit}`, ...lines(i.note)];
  const rate = i.lump ? "LUMSUM" : `₹${i.rate}/${i.unit}`;
  return { sl: String(n), desc: lines(i.desc).join(" "), qty, rate, amount: money(itemAmount(i)) };
}

export async function buildQuotationPdf(q: Quote, refNo: string): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc); const w = new QWriter(doc, f);
  const fill = (t: string) => fillClient(t, q);
  await w.start();

  // ── Cover letter ──
  w.y = TOP_P1 + 4;
  const labelled = (label: string, value: string, bold = false) => {
    const lw = f.bold.widthOfTextAtSize(label + " ", 10), vf = bold ? f.bold : f.reg, vw = vf.widthOfTextAtSize(value, 10);
    w.page.drawText(label + " ", { x: W - MR - lw - vw, y: H - w.y, size: 10, font: f.bold, color: INK });
    w.page.drawText(value, { x: W - MR - vw, y: H - w.y, size: 10, font: vf, color: INK });
  };
  w.text("To,", ML, 10, f.reg); labelled("Ref:", refNo); w.y += 15;
  w.text(q.client_name, ML, 10, f.bold); labelled("Date:", fmtDateLong(q.quote_date)); w.y += 15;
  for (const l of lines(q.client_address)) { w.text(l, ML, 10, f.reg); w.y += 15; }
  w.y += 22;
  for (const l of wrapPlain(f.bold, `Subject: ${q.subject}`, 11, W - ML - MR - 30)) { w.center(l, 11, f.bold); w.y += 15; }
  w.y += 12;
  if (q.kind_attn.trim()) { w.text("Kind Attention: ", ML, 10, f.reg); w.text(q.kind_attn, ML + f.reg.widthOfTextAtSize("Kind Attention: ", 10), 10, f.bold); w.y += 24; }
  w.text("Dear Sir,", ML, 10, f.reg); w.y += 8;
  for (const p of q.intro.split(/\n\s*\n/).filter((x) => x.trim())) await w.para(p.trim(), { gap: 10 });
  w.y += 4; await w.para("Thanking you", { gap: 12 });
  await w.ensure(90); w.y += 12;
  w.text("Yours faithfully,", ML, 10, f.reg); w.y += 14;
  w.text(`For ${COMPANY.name}.`, ML, 10, f.bold); w.y += 14;
  if (q.signatory.trim()) w.text(q.signatory.trim(), ML, 10, f.bold);

  // ── Quotation table, notes, terms ──
  await w.newPage(); w.y = TOP + 24;
  w.center("Quotation", 13, f.bold); w.y += 26;
  const cols = [36, 180, 80, 62, 105], x0 = ML, tw = cols.reduce((a, b) => a + b, 0), size = 9.5, lh = 12.5;
  const rowH = (cells: string[][]) => Math.max(...cells.map((c) => c.length)) * lh + 10;
  const drawRow = async (cells: string[][], o: { bold?: boolean; fill?: boolean; center?: boolean[] } = {}) => {
    const h = rowH(cells); await w.ensure(h);
    const top = w.y, bottom = H - top - h, font = o.bold ? f.bold : f.reg;
    if (o.fill) w.page.drawRectangle({ x: x0, y: bottom, width: tw, height: h, color: BLUEFILL });
    let cx = x0;
    cols.forEach((cw, c) => {
      w.page.drawRectangle({ x: cx, y: bottom, width: cw, height: h, borderColor: LINE, borderWidth: 0.8 });
      (cells[c] || []).forEach((ln, i) => {
        const tx = o.center?.[c] ? cx + (cw - font.widthOfTextAtSize(ln, size)) / 2 : cx + 6;
        w.page.drawText(ln, { x: tx, y: H - top - 14 - i * lh, size, font, color: INK });
      });
      cx += cw;
    });
    w.y += h;
  };
  const wrapCell = (t: string, c: number, font = f.reg) => (t ? wrapPlain(font, t, size, cols[c] - 12) : []);
  await drawRow([["SL No"], ["Description"], ["Qty"], ["Unit Rate"], ["Amount"]], { bold: true, fill: true, center: [true, true, true, true, true] });
  for (let n = 0; n < q.items.length; n++) {
    const c = itemCells(q.items[n], n + 1, f);
    await drawRow([[c.sl], wrapCell(c.desc.toUpperCase(), 1), c.qty.flatMap((t) => wrapCell(t, 2)), wrapCell(c.rate, 3), wrapCell(c.amount, 4)]);
  }
  const t = totals(q.items);
  const sumRow = (label: string, v: number, bold = true) => drawRow([[], [label], [], [], wrapCell(money(v), 4, bold ? f.bold : f.reg)], { bold });
  if (q.show_total || q.show_gst) await sumRow("Total", t.total);
  if (q.show_gst) { await sumRow("GST @ 18%", t.gst, false); await sumRow("Grand Total (incl. GST)", t.grand); }

  const notes = q.notes.map((n) => fill(n).trim()).filter(Boolean);
  if (notes.length) { await w.ensure(70); w.y += 26; w.text("NOTE :", ML - 12, 10, f.ital); w.y += 6; await list(w, notes, { font: f.ital, size: 9.5 }); }

  const terms = q.terms.filter((x) => x.label.trim() && x.value.trim());
  if (terms.length) {
    await w.ensure(80); w.y += 30; w.text("TERMS AND CONDITIONS", ML, 10.5, f.bold); w.y += 8;
    for (const tm of terms) {
      const vl = lines(fill(tm.value)).flatMap((l) => wrapPlain(f.reg, l, 10, W - MR - (ML + 160)));
      await w.ensure(lh * vl.length + 8); w.y += 16;
      w.text(tm.label, ML + 8, 10, f.reg);
      vl.forEach((l, i) => { w.page.drawText(l, { x: ML + 160, y: H - w.y - i * 13.5, size: 10, font: f.reg, color: INK }); });
      w.y += (vl.length - 1) * 13.5 + 4;
    }
  }

  // ── Optional scope of work ──
  const scope = q.include_scope ? q.scope.map((x) => fill(x).trim()).filter(Boolean) : [];
  if (scope.length) {
    await w.newPage(); w.y = TOP + 24;
    w.center("Scope of Work", 13, f.bold); w.y += 8; w.page.drawLine({ start: { x: W / 2 - 52, y: H - w.y }, end: { x: W / 2 + 52, y: H - w.y }, thickness: 0.8, color: INK }); w.y += 10;
    await list(w, scope, { font: f.reg, numbered: true });
  }

  // ── Supply lists ──
  const cs = q.client_supply.map((x) => fill(x).trim()).filter(Boolean), os = q.our_supply.map((x) => fill(x).trim()).filter(Boolean);
  if (cs.length || os.length) {
    await w.newPage(); w.y = TOP + 24;
    if (cs.length) { w.center("Client to supply the following free of cost:", 11.5, f.bold); w.y += 8; await list(w, cs, { font: f.reg, numbered: true }); }
    if (os.length) { if (cs.length) { await w.ensure(120); w.y += 34; } w.center("Chandrika will provide the following at the Site:", 11.5, f.bold); w.y += 8; await list(w, os, { font: f.reg, numbered: true }); }
  }

  doc.getPages().forEach((p, i) => { const s = String(i + 1); p.drawText(s, { x: W - MR - f.reg.widthOfTextAtSize(s, 9), y: 34, size: 9, font: f.reg, color: rgb(0.35, 0.35, 0.4) }); });
  return doc.save();
}
