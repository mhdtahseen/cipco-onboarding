import { PDFFont, PDFPage, rgb } from "pdf-lib";
import { COMPANY } from "../company";
import { LETTER } from "../letterConfig";
import { fmtDateLong } from "../format";
import type { AnnexureSnapshot, Section } from "../types";
import { wrapPlain } from "./common";
import { Fonts, drawStamp, embedFonts, newDoc, readAsset } from "./common";

const W = 595.28, H = 841.89, ML = 66, MR = 66, TOP_P1 = 160, TOP = 64, BOTTOM = 70;
const INK = rgb(0.12, 0.14, 0.2), BLUE = rgb(0.1, 0.3, 0.62);
type Tok = { t: string; b: boolean };

function tokens(s: string): Tok[] {
  const out: Tok[] = [];
  s.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (!part) return;
    const bold = part.startsWith("**") && part.endsWith("**");
    const txt = bold ? part.slice(2, -2) : part;
    txt.split(/(\s+)/).forEach((w) => { if (w) out.push({ t: w, b: bold }); });
  });
  return out;
}
function wrap(toks: Tok[], width: number, size: number, f: Fonts): Tok[][] {
  const lines: Tok[][] = []; let cur: Tok[] = []; let w = 0;
  for (const tk of toks) {
    const tw = (tk.b ? f.bold : f.reg).widthOfTextAtSize(tk.t, size);
    const isSpace = /^\s+$/.test(tk.t);
    if (!isSpace && w + tw > width && cur.length) { while (cur.length && /^\s+$/.test(cur[cur.length - 1].t)) cur.pop(); lines.push(cur); cur = []; w = 0; }
    if (isSpace && cur.length === 0) continue;
    cur.push(tk); w += tw;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

class Writer {
  page!: PDFPage; y = 0; first = true;
  constructor(public doc: Awaited<ReturnType<typeof newDoc>>, public f: Fonts) {}
  async start() { this.page = this.doc.addPage([W, H]); this.y = TOP_P1; await this.header(); }
  async header() {
    const logo = await this.doc.embedPng(await readAsset("logo.png"));
    const lw = 112, lh = (lw * logo.height) / logo.width;
    this.page.drawImage(logo, { x: 38, y: H - 40 - lh, width: lw, height: lh });
    const c = (t: string, size: number, top: number, font: PDFFont, color = rgb(0, 0, 0)) =>
      this.page.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2 + 22, y: H - top, size, font, color });
    c(COMPANY.headline1, 25, 62, this.f.bold, BLUE);
    c(COMPANY.headline2, 15.5, 82, this.f.bold, BLUE);
    c(COMPANY.line1, 6.6, 97, this.f.bold); c(COMPANY.line2, 6.6, 106, this.f.bold); c(COMPANY.line3, 6.6, 115, this.f.bold);
  }
  async newPage() { this.page = this.doc.addPage([W, H]); this.y = TOP; }
  async ensure(h: number) { if (this.y + h > H - BOTTOM) await this.newPage(); }
  text(t: string, x: number, size: number, font: PDFFont, color = INK) { this.page.drawText(t, { x, y: H - this.y, size, font, color }); }
  rightText(t: string, size: number, font: PDFFont) { this.page.drawText(t, { x: W - MR - font.widthOfTextAtSize(t, size), y: H - this.y, size, font, color: INK }); }
  center(t: string, size: number, font: PDFFont) { this.page.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y: H - this.y, size, font, color: INK }); }
  async para(s: string, opts: { x?: number; width?: number; size?: number; lh?: number; bullet?: boolean; gap?: number } = {}) {
    const size = opts.size ?? 10, lh = opts.lh ?? 14.6, x = opts.x ?? ML, width = opts.width ?? W - ML - MR;
    const lines = wrap(tokens(s), width, size, this.f);
    for (let i = 0; i < lines.length; i++) {
      await this.ensure(lh);
      this.y += lh;
      if (opts.bullet && i === 0) this.page.drawText("•", { x: x - 14, y: H - this.y, size, font: this.f.reg, color: INK });
      let cx = x;
      for (const tk of lines[i]) { const font = tk.b ? this.f.bold : this.f.reg; this.page.drawText(tk.t, { x: cx, y: H - this.y, size, font, color: INK }); cx += font.widthOfTextAtSize(tk.t, size); }
    }
    this.y += opts.gap ?? 4;
  }
  async heading(t: string) { await this.ensure(48); this.y += 17; this.text(t, ML, 11, this.f.bold); this.y += 5; }
}

export async function buildLetterPdf(args: {
  kind: "offer" | "appointment"; sections: Section[]; vars: Record<string, string>; refNo: string; issuedOn: string; withSeal: boolean; annexure?: AnnexureSnapshot | null;
}): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc); const w = new Writer(doc, f); const cfg = LETTER[args.kind];
  await w.start();
  const v = args.vars;
  // To / Ref / Date block
  w.y = TOP_P1 + 4;
  w.text("To,", ML, 10, f.reg); w.rightText(`Ref: ${args.refNo}`, 10, f.bold); w.y += 15;
  w.text(`${v.honorific} ${v.full_name}`, ML, 10, f.reg); w.rightText(`Date: ${fmtDateLong(args.issuedOn)}`, 10, f.reg); w.y += 30;
  w.center(cfg.subject(v), 11.5, f.bold); w.y += 26;
  w.text(`Dear ${v.first_name},`, ML, 10, f.reg); w.y += 8;
  await w.para(cfg.intro(v), { gap: 6 });

  let n = 0;
  for (const s of args.sections) {
    n++;
    await w.heading(`${n}. ${s.title}`);
    const lines = s.body.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    for (const l of lines) {
      if (/^\s*-\s+/.test(l)) await w.para(l.replace(/^\s*-\s+/, ""), { x: ML + 26, width: W - ML - MR - 26, bullet: true, gap: 3 });
      else await w.para(l, { gap: 4 });
    }
  }

  // closing
  const sig = async (label: boolean) => {
    await w.ensure(150);
    const stampTop = w.y + 6;
    if (args.withSeal) await drawStamp(doc, w.page, { x: ML, top: stampTop, signW: 95, sealW: 58, sealDx: 100 });
    w.y += 82;
    if (!label) { w.text("_____________________________", ML, 10, f.reg); w.y += 14; w.text("Authorized Signatory", ML, 10, f.bold); w.y += 14; w.text(COMPANY.signatoryDept, ML, 10, f.reg); }
    else { w.text(COMPANY.signatoryLabel, ML, 10, f.bold); w.y += 14; w.text(COMPANY.signatoryDept, ML, 10, f.reg); }
  };
  const decl = cfg.declaration(v);
  const declBlock = async () => {
    await w.ensure(150); w.text("Declaration & Acceptance", ML, 11, f.bold); w.y += 4;
    await w.para(decl as string, { gap: 20 }); w.y += 6;
    w.text("Signature: ___________________________", ML, 10, f.reg); w.y += 24; w.text("Date: _______________________________", ML, 10, f.reg);
  };
  if (args.kind === "offer") {
    await w.ensure(240); w.y += 22; w.center(cfg.closingTitle, 12, f.bold); w.y += 8;
    for (const t of cfg.closingText(v)) await w.para(t, { gap: 8 });
    w.y += 12; w.text("Yours faithfully,", ML, 10, f.reg); w.y += 14; w.text(`For ${COMPANY.name} (${COMPANY.short})`, ML, 10, f.bold); w.y += 4;
    await sig(true);
    if (decl) { w.y += 26; await declBlock(); }
  } else {
    await w.ensure(170); w.y += 16; w.text(`For ${COMPANY.short},`, ML, 10, f.bold); w.y += 2; await sig(false);
    if (decl) { w.y += 26; await declBlock(); }
  }

  if (args.annexure) await drawAnnexure(w, args.annexure);

  // page numbers
  doc.getPages().forEach((p, i) => { const t = String(i + 1); p.drawText(t, { x: (W - f.reg.widthOfTextAtSize(t, 8.5)) / 2, y: 34, size: 8.5, font: f.reg, color: rgb(0.35, 0.35, 0.4) }); });
  return doc.save();
}

async function drawAnnexure(w: Writer, a: AnnexureSnapshot) {
  const f = w.f; await w.newPage(); w.y = TOP + 8;
  w.center("Annexure A: Salary Structure & Break-Up", 13, f.bold); w.y += 26;
  for (const [k, v] of [["Employee Name", a.name], ["Designation", a.designation], ["Department", a.department]] as const) {
    if (!v) continue; w.text(`${k}: `, ML, 10, f.bold); w.text(v, ML + f.bold.widthOfTextAtSize(`${k}: `, 10), 10, f.reg); w.y += 15;
  }
  w.y += 8;
  const cols = [255, 104, 104], x0 = ML, tw = cols[0] + cols[1] + cols[2], line = rgb(0.72, 0.75, 0.82);
  const row = (cells: string[], opts: { bold?: boolean; fill?: [number, number, number]; head?: boolean }) => {
    const font = opts.bold ? f.bold : f.reg, size = 9;
    const lines = wrapPlain(font, cells[0], size, cols[0] - 14); const h = Math.max(1, lines.length) * 12 + 9;
    return { h, draw: () => {
      const top = w.y, bottom = H - top - h;
      if (opts.fill) w.page.drawRectangle({ x: x0, y: bottom, width: tw, height: h, color: rgb(...opts.fill) });
      let cx = x0; cols.forEach((cw) => { w.page.drawRectangle({ x: cx, y: bottom, width: cw, height: h, borderColor: line, borderWidth: 0.6 }); cx += cw; });
      lines.forEach((ln, i) => w.page.drawText(ln, { x: x0 + 7, y: H - top - 14 - i * 12, size, font, color: INK }));
      [1, 2].forEach((c) => { const t = cells[c] || ""; if (!t) return; const cxr = x0 + cols.slice(0, c + 1).reduce((s2, v) => s2 + v, 0) - 8; w.page.drawText(t, { x: cxr - font.widthOfTextAtSize(t, size), y: H - top - 14, size, font, color: INK }); });
      w.y += h;
    } };
  };
  const header = () => { const r = row(["Components", "Monthly Amount (₹)", "Annual Amount (₹)"], { bold: true, fill: [0.86, 0.9, 0.97] }); r.draw(); };
  header();
  for (const r of a.rows) {
    const spec = r.kind === "head" ? { bold: true, fill: [0.94, 0.95, 0.98] as [number, number, number] } : r.kind === "total" ? { bold: true, fill: [0.97, 0.97, 0.97] as [number, number, number] } : r.kind === "grand" ? { bold: true, fill: [0.86, 0.9, 0.97] as [number, number, number] } : {};
    const rr = row([r.label, r.monthly, r.annual], spec);
    if (w.y + rr.h > H - BOTTOM) { await w.newPage(); w.y = TOP; header(); }
    rr.draw();
  }
  w.y += 14;
  if (a.notes.length) { await w.ensure(40); w.text("Notes:", ML, 10, f.bold); w.y += 4; for (const n of a.notes) await w.para(n, { x: ML + 22, width: W - ML - MR - 22, bullet: true, size: 9.5, lh: 13.5, gap: 3 }); }
}
