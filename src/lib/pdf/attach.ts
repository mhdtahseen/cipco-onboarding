import { PDFDocument, rgb } from "pdf-lib";
import type { Fonts } from "./common";

// Putting an uploaded file (a PDF or a photo) into a PDF being built: used by the ESIC details pack and the Bills download.
// A PDF keeps all its pages, a JPEG or PNG is fitted onto its own A4 page under a title, anything else (or a file that cannot be read) gets a page that says so.
export const A4: [number, number] = [595.28, 841.89];
const INK = rgb(0.1, 0.12, 0.16), GREY = rgb(0.42, 0.45, 0.5);
export const fileKind = (b: Uint8Array) => (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 ? "pdf" : b[0] === 0x89 && b[1] === 0x50 ? "png" : b[0] === 0xff && b[1] === 0xd8 ? "jpg" : "other");

export function notePage(doc: PDFDocument, f: Fonts, title: string, note: string) {
  const p = doc.addPage(A4);
  p.drawText(title, { x: 56, y: A4[1] - 64, size: 16, font: f.bold, color: INK, maxWidth: A4[0] - 112 });
  p.drawText(note, { x: 56, y: A4[1] - 92, size: 11, font: f.ital, color: GREY, maxWidth: A4[0] - 112 });
}

export async function imagePage(doc: PDFDocument, f: Fonts, title: string, bytes: Uint8Array, png: boolean) {
  const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const p = doc.addPage(A4), M = 36, top = A4[1] - 40;
  let size = 11; while (size > 7 && f.bold.widthOfTextAtSize(title, size) > A4[0] - 2 * M) size -= 0.5;
  p.drawText(title, { x: M, y: top, size, font: f.bold, color: GREY });
  const boxW = A4[0] - 2 * M, boxH = top - 16 - M, k = Math.min(boxW / img.width, boxH / img.height), w = img.width * k, h = img.height * k;
  p.drawImage(img, { x: (A4[0] - w) / 2, y: top - 16 - h, width: w, height: h });
}

/** Adds the file's pages. ok is false when it could not be added (a note page is added instead), with the short reason. */
export async function appendFile(doc: PDFDocument, f: Fonts, title: string, bytes: Uint8Array | null): Promise<{ ok: boolean; note?: string }> {
  if (!bytes) { notePage(doc, f, title, "Not uploaded."); return { ok: false, note: "Not uploaded" }; }
  const t = fileKind(bytes);
  try {
    if (t === "pdf") {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      if (src.isEncrypted) { notePage(doc, f, title, "The uploaded PDF is password-protected. Upload a scan or photo instead."); return { ok: false, note: "Password-protected" }; }
      (await doc.copyPages(src, src.getPageIndices())).forEach((pg) => doc.addPage(pg)); return { ok: true };
    }
    if (t === "png" || t === "jpg") { await imagePage(doc, f, title, bytes, t === "png"); return { ok: true }; }
    notePage(doc, f, title, "The uploaded file is not a PDF, JPEG or PNG, so it cannot be shown here."); return { ok: false, note: "Unreadable format" };
  } catch { notePage(doc, f, title, "The uploaded file could not be read."); return { ok: false, note: "Could not be read" }; }
}
