import { rgb } from "pdf-lib";
import { COMPANY } from "../company";
import { fmtDateLong } from "../format";
import { rupees, settlementNet, type SettlementRow } from "../offboarding";
import { drawStamp, embedFonts, newDoc, wrapPlain } from "./common";
import { BOTTOM, H, INK, ML, MR, TOP_P1, W, Writer } from "./letters";

// Exit letters (relieving, experience, recommendation, full and final settlement, absconding notice) on the same letterhead, seal and signature as the
// offer and appointment letters. The wording comes from the issued snapshot (letters.sections), so a reprint is always what was issued.
export async function buildExitLetterPdf(a: {
  subject: string; to: "person" | "whom"; name: string; address: string[]; paragraphs: string[]; rows?: SettlementRow[] | null; ack?: boolean;
  refNo: string; issuedOn: string; withSeal: boolean; empNo?: string; designation?: string;
}): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc); const w = new Writer(doc, f);
  await w.start(); w.y = TOP_P1 + 4;
  // Ref / Date, then who it is for
  w.rightText(`Ref: ${a.refNo}`, 10, f.bold); w.y += 15; w.rightText(`Date: ${fmtDateLong(a.issuedOn)}`, 10, f.reg);
  if (a.to === "person") {
    w.y -= 15; w.text("To,", ML, 10, f.reg); w.y += 15; w.text(a.name, ML, 10, f.bold);
    for (const l of [a.designation && a.empNo ? `${a.designation} (Employee No. ${a.empNo})` : a.designation || (a.empNo ? `Employee No. ${a.empNo}` : ""), ...a.address].filter(Boolean).flatMap((l) => wrapPlain(f.reg, String(l), 9.5, 300)).slice(0, 8)) { w.y += 13; w.text(l, ML, 9.5, f.reg); }
    w.y += 30;
  } else w.y += 34;
  w.center(a.subject, 12, f.bold); w.y += 8;
  const sw = f.bold.widthOfTextAtSize(a.subject, 12); w.page.drawLine({ start: { x: (W - sw) / 2, y: H - w.y }, end: { x: (W + sw) / 2, y: H - w.y }, thickness: 0.7, color: INK }); w.y += 22;
  w.text(a.to === "person" ? `Dear ${a.name.replace(/^(Mr\.|Ms\.)\s+/, "").split(/\s+/)[0]},` : "To Whom It May Concern", ML, 10, a.to === "person" ? f.reg : f.bold); w.y += 8;

  const paras = a.paragraphs.map((p) => p.trim()).filter(Boolean);
  const rows = a.rows ?? null;
  // settlement: the first paragraph, then the table, then the rest
  for (let i = 0; i < paras.length; i++) {
    await w.para(paras[i], { gap: 9 });
    if (i === 0 && rows) await table(w, rows);
  }
  if (rows && !paras.length) await table(w, rows);

  // sign-off
  await w.ensure(150); w.y += 14; w.text("Yours faithfully,", ML, 10, f.reg); w.y += 14; w.text(`For ${COMPANY.name} (${COMPANY.short})`, ML, 10, f.bold);
  const top = w.y + 6; if (a.withSeal) await drawStamp(doc, w.page, { x: ML, top, signW: 95, sealW: 58, sealDx: 100 });
  w.y += 82; w.text(COMPANY.signatoryLabel, ML, 10, f.bold); w.y += 14; w.text(COMPANY.signatoryDept, ML, 10, f.reg);

  if (a.ack) {
    await w.ensure(120); w.y += 34; w.text("Acknowledgement", ML, 11, f.bold); w.y += 4;
    await w.para(`I, ${a.name.replace(/^(Mr\.|Ms\.)\s+/, "")}, confirm that I have received the above amount in full and final settlement of all my dues, and that I have no further claim against the company.`, { gap: 22 });
    w.text("Signature: ___________________________", ML, 10, f.reg); w.y += 22; w.text("Date: _______________________________", ML, 10, f.reg);
  }
  doc.getPages().forEach((p, i, all) => { if (all.length < 2) return; const t = String(i + 1); p.drawText(t, { x: (W - f.reg.widthOfTextAtSize(t, 8.5)) / 2, y: 34, size: 8.5, font: f.reg, color: rgb(0.35, 0.35, 0.4) }); });
  return doc.save();
}

async function table(w: Writer, rows: SettlementRow[]) {
  const f = w.f, x0 = ML, cw = [W - ML - MR - 130, 130], line = rgb(0.72, 0.75, 0.82), size = 9.5, h = 21;
  const draw = (label: string, amount: string, opts: { bold?: boolean; fill?: [number, number, number] } = {}) => {
    const top = w.y, bottom = H - top - h, font = opts.bold ? f.bold : f.reg;
    if (opts.fill) w.page.drawRectangle({ x: x0, y: bottom, width: cw[0] + cw[1], height: h, color: rgb(...opts.fill) });
    w.page.drawRectangle({ x: x0, y: bottom, width: cw[0], height: h, borderColor: line, borderWidth: 0.6 });
    w.page.drawRectangle({ x: x0 + cw[0], y: bottom, width: cw[1], height: h, borderColor: line, borderWidth: 0.6 });
    w.page.drawText(label.length > 80 ? label.slice(0, 79) + "…" : label, { x: x0 + 7, y: H - top - 14, size, font, color: INK });
    w.page.drawText(amount, { x: x0 + cw[0] + cw[1] - 8 - font.widthOfTextAtSize(amount, size), y: H - top - 14, size, font, color: INK });
    w.y += h;
  };
  await w.ensure(h * (rows.length + 2) + 20); w.y += 4;
  draw("Particulars", "Amount", { bold: true, fill: [0.86, 0.9, 0.97] });
  for (const r of rows) { if (w.y + h > H - BOTTOM) await w.newPage(); const n = Number(r.amount) || 0; draw(r.label, n < 0 ? `(-) ${rupees(n)}` : rupees(n)); }
  const net = settlementNet(rows);
  draw(net >= 0 ? "Net payable to the employee" : "Net recoverable from the employee", rupees(net), { bold: true, fill: [0.94, 0.95, 0.98] });
  w.y += 12;
}
