import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import { COMPANY } from "../company";
import { fmtDateDMY, todayISO } from "../format";
import type { Employee } from "../types";
import { embedFonts, newDoc, type Fonts } from "./common";

// ESIC pack: what the person who makes ESIC cards needs, in one PDF.
// Page 1: the details as real text (select and copy straight into the ESIC portal). Then the Aadhaar, PAN and bank passbook as uploaded in the Documents tab:
// a PDF upload keeps all its pages, a photo is fitted onto its own page, and a missing or unreadable file gets a page that says so.
export type EsicFile = { key: "aadhaar" | "pan" | "bank"; label: string; bytes: Uint8Array | null };

const A4: [number, number] = [595.28, 841.89];
const INK = rgb(0.1, 0.12, 0.16), GREY = rgb(0.42, 0.45, 0.5), LINE = rgb(0.85, 0.87, 0.9);
const kind = (b: Uint8Array) => (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 ? "pdf" : b[0] === 0x89 && b[1] === 0x50 ? "png" : b[0] === 0xff && b[1] === 0xd8 ? "jpg" : "other");

function detailsPage(doc: PDFDocument, f: Fonts, e: Employee) {
  const p = doc.addPage(A4), W = A4[0], M = 56; let y = A4[1] - 64;
  p.drawText("ESIC registration details", { x: M, y, size: 18, font: f.bold, color: INK }); y -= 20;
  p.drawText(`${COMPANY.name} · ${fmtDateDMY(todayISO())}`, { x: M, y, size: 9.5, font: f.reg, color: GREY }); y -= 30;
  const rows: [string, string | null | undefined][] = [
    ["Full name", e.full_name],
    ["Phone number", e.phone],
    ["Date of joining", e.join_date ? fmtDateDMY(e.join_date) : null],
    ["Aadhaar number", (e.aadhaar || "").replace(/\s/g, "")],   // no spaces, so it pastes cleanly
    ["PAN", (e.pan || "").toUpperCase()],
    ["Bank name", e.bank_name],
    ["Branch", e.bank_branch],
    ["Account number", (e.account_no || "").replace(/\s/g, "")],
    ["IFSC", (e.ifsc || "").toUpperCase()],
    ["Account holder", e.full_name],
  ];
  for (const [label, value] of rows) {
    p.drawLine({ start: { x: M, y: y + 14 }, end: { x: W - M, y: y + 14 }, thickness: 0.6, color: LINE });
    p.drawText(label, { x: M, y: y - 4, size: 10, font: f.reg, color: GREY });
    p.drawText(value || "not given", { x: M + 150, y: y - 4, size: value ? 13 : 11, font: value ? f.bold : f.ital, color: value ? INK : GREY });
    y -= 38;
  }
  p.drawLine({ start: { x: M, y: y + 14 }, end: { x: W - M, y: y + 14 }, thickness: 0.6, color: LINE });
  p.drawText("Attached: Aadhaar card, PAN card, bank passbook / cancelled cheque (following pages).", { x: M, y: y - 8, size: 9.5, font: f.reg, color: GREY });
}

function notePage(doc: PDFDocument, f: Fonts, title: string, note: string) {
  const p = doc.addPage(A4);
  p.drawText(title, { x: 56, y: A4[1] - 64, size: 16, font: f.bold, color: INK });
  p.drawText(note, { x: 56, y: A4[1] - 92, size: 11, font: f.ital, color: GREY });
}

async function imagePage(doc: PDFDocument, f: Fonts, title: string, bytes: Uint8Array, png: boolean) {
  const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const p: PDFPage = doc.addPage(A4), M = 36, top = A4[1] - 40;
  p.drawText(title, { x: M, y: top, size: 11, font: f.bold, color: GREY });
  const boxW = A4[0] - 2 * M, boxH = top - 16 - M, k = Math.min(boxW / img.width, boxH / img.height), w = img.width * k, h = img.height * k;
  p.drawImage(img, { x: (A4[0] - w) / 2, y: top - 16 - h, width: w, height: h });
}

export async function buildEsicPack(e: Employee, files: EsicFile[]): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc);
  doc.setTitle(`ESIC details - ${e.full_name}`);
  detailsPage(doc, f, e);
  for (const file of files) {
    if (!file.bytes) { notePage(doc, f, file.label, "Not uploaded in the Documents tab."); continue; }
    const t = kind(file.bytes);
    try {
      if (t === "pdf") {
        const src = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
        if (src.isEncrypted) { notePage(doc, f, file.label, "The uploaded PDF is password-protected (e-Aadhaar?). Upload a scan or photo instead."); continue; }
        (await doc.copyPages(src, src.getPageIndices())).forEach((pg) => doc.addPage(pg));
      } else if (t === "png" || t === "jpg") await imagePage(doc, f, file.label, file.bytes, t === "png");
      else notePage(doc, f, file.label, "The uploaded file is not a PDF, JPEG or PNG. Upload it again as one of these.");
    } catch { notePage(doc, f, file.label, "The uploaded file could not be read. Upload it again."); }
  }
  return doc.save();
}
