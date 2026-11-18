import { PDFDocument, PDFFont, PDFName, PDFPage, PDFString, rgb } from "pdf-lib";
import { COMPANY } from "../company";
import { fmtDateDMY, todayISO } from "../format";
import type { Employee } from "../types";
import { drawPhotoBox, embedFonts, newDoc, readAsset, type Fonts } from "./common";
import { A4, appendFile, fileKind as imgKind } from "./attach";

// ESIC pack: what the person who makes ESIC cards needs, in one PDF.
// Page 1: the details as real text in boxes (select and copy straight into the ESIC portal), the passport photo (tap it to download the original through a private
// 7-day link, src/lib/photoLink.ts; it is also attached inside the PDF), and a list of the documents that follow with their page numbers.
// Then the Aadhaar, PAN and bank passbook as uploaded in the Documents tab: a PDF upload keeps all its pages, a photo is fitted onto its own page,
// and a missing or unreadable file gets a page that says so.
export type EsicFile = { key: "aadhaar" | "pan" | "bank"; label: string; bytes: Uint8Array | null };
/** The passport photo and the private download link for it (src/lib/photoLink.ts, works for 7 days). */
export type EsicPhoto = { bytes: Uint8Array | null; url: string | null; days: number };
type Placed = { label: string; from: number; to: number; ok: boolean; note?: string };

const INK = rgb(0.1, 0.12, 0.16), GREY = rgb(0.42, 0.45, 0.5), LINE = rgb(0.85, 0.87, 0.9), BRAND = rgb(0.12, 0.31, 0.64), LINK = rgb(0.1, 0.33, 0.75);
const FIELD = rgb(0.965, 0.972, 0.984), WARN = rgb(0.85, 0.55, 0.1), OK = rgb(0.1, 0.5, 0.28), BAD = rgb(0.75, 0.2, 0.15);
const fit = (font: PDFFont, t: string, size: number, maxW: number, min = 8) => { let s = size; while (s > min && font.widthOfTextAtSize(t, s) > maxW) s -= 0.25; return s; };

async function detailsPage(doc: PDFDocument, f: Fonts, e: Employee, photo: EsicPhoto, placed: Placed[]) {
  const p = doc.insertPage(0, A4), W = A4[0], H = A4[1], M = 48, at = (top: number) => H - top;   // "top" = points from the top of the page
  const text = (t: string, x: number, top: number, size: number, font: PDFFont, color = INK) => p.drawText(t, { x, y: at(top), size, font, color });

  // header: logo left, title right, brand rule
  const logo = await doc.embedPng(await readAsset("logo.png")); const lw = 96, lh = (lw * logo.height) / logo.width;
  p.drawImage(logo, { x: M, y: at(36 + lh), width: lw, height: lh });
  const title = "ESIC registration details", sub = `Prepared ${fmtDateDMY(todayISO())}${e.emp_no ? ` · Employee no. ${e.emp_no}` : ""}`;
  text(title, W - M - f.bold.widthOfTextAtSize(title, 18), 56, 18, f.bold);
  text(sub, W - M - f.reg.widthOfTextAtSize(sub, 9), 72, 9, f.reg, GREY);
  p.drawRectangle({ x: M, y: at(88), width: W - 2 * M, height: 2, color: BRAND });

  const section = (t: string, top: number, w: number) => { text(t.toUpperCase(), M, top, 8.5, f.bold, BRAND); p.drawLine({ start: { x: M, y: at(top + 6) }, end: { x: M + w, y: at(top + 6) }, thickness: 0.5, color: LINE }); };
  // one field: small label, then the value in a light box (the value is real text, so it can be selected and copied)
  const field = (label: string, value: string | null | undefined, x: number, top: number, w: number) => {
    text(label, x, top, 8, f.reg, GREY);
    p.drawRectangle({ x, y: at(top + 32), width: w, height: 26, color: FIELD, borderColor: value ? LINE : WARN, borderWidth: value ? 0.6 : 0.9 });
    if (value) text(value, x + 9, top + 23.5, fit(f.bold, value, 12, w - 18), f.bold);
    else text("not given", x + 9, top + 23, 10, f.ital, WARN);
  };
  const ROW = 48, G = 12;

  // photo column on the right, beside the employee and identity sections
  const PW = 112, PH = 140, px = W - M - PW, ptop = 110;
  const leftW = px - M - 20, half = (leftW - G) / 2;
  const usable = !!photo.bytes && imgKind(photo.bytes) !== "other";
  await drawPhotoBox(doc, p, { x: px, top: ptop, w: PW, h: PH }, usable ? photo.bytes : null);
  const centre = (t: string, top: number, size: number, font: PDFFont, color = GREY) => text(t, px + (PW - font.widthOfTextAtSize(t, size)) / 2, top, size, font, color);
  if (!usable) { centre(photo.bytes ? "Photo is not JPEG/PNG" : "Photo not uploaded", ptop + PH + 16, 8.5, f.ital, WARN); }
  else {
    if (photo.url) {
      const cap = "Tap photo to download", cw = f.bold.widthOfTextAtSize(cap, 9), cx = px + (PW - cw) / 2;
      text(cap, cx, ptop + PH + 16, 9, f.bold, LINK);
      p.drawLine({ start: { x: cx, y: at(ptop + PH + 18) }, end: { x: cx + cw, y: at(ptop + PH + 18) }, thickness: 0.6, color: LINK });
      centre(`Link valid till ${fmtDateDMY(new Date(Date.now() + photo.days * 86400000))}`, ptop + PH + 29, 7.5, f.reg);
      link(doc, p, photo.url, [px, at(ptop + PH), px + PW, at(ptop)]);
      link(doc, p, photo.url, [cx, at(ptop + PH + 20), cx + cw, at(ptop + PH + 6)]);
    }
    centre("Also attached in this PDF", ptop + PH + (photo.url ? 40 : 16), 7.5, f.reg);
  }

  let top = 110;
  section("Employee", top, leftW); top += 18;
  field("Full name (as on Aadhaar)", e.full_name, M, top, leftW); top += ROW;
  field("Phone number", e.phone, M, top, half); field("Date of joining", e.join_date ? fmtDateDMY(e.join_date) : null, M + half + G, top, half); top += ROW + 10;
  section("Identity", top, leftW); top += 18;
  field("Aadhaar number", (e.aadhaar || "").replace(/\s/g, ""), M, top, half);   // no spaces, so it pastes cleanly
  field("PAN", (e.pan || "").toUpperCase(), M + half + G, top, half); top += ROW + 10;

  const fullW = W - 2 * M, fhalf = (fullW - G) / 2;
  section("Bank account", top, fullW); top += 18;
  field("Account holder", e.full_name, M, top, fhalf); field("Bank name", e.bank_name, M + fhalf + G, top, fhalf); top += ROW;
  field("Account number", (e.account_no || "").replace(/\s/g, ""), M, top, fhalf); field("IFSC", (e.ifsc || "").toUpperCase(), M + fhalf + G, top, fhalf); top += ROW;
  field("Branch", e.bank_branch, M, top, fhalf); top += ROW + 10;

  // what follows in this PDF, with page numbers
  section("Documents in this PDF", top, fullW); top += 22;
  for (const d of placed) {
    p.drawLine({ start: { x: M, y: at(top + 8) }, end: { x: W - M, y: at(top + 8) }, thickness: 0.4, color: LINE });
    text(d.label, M, top, 10.5, f.reg);
    const pg = d.from === d.to ? `page ${d.from}` : `pages ${d.from}–${d.to}`; text(pg, M + 250, top, 10, f.reg, GREY);
    const st = d.ok ? "Attached" : d.note ?? "Not uploaded"; text(st, W - M - f.bold.widthOfTextAtSize(st, 9.5), top, 9.5, f.bold, d.ok ? OK : BAD);
    top += 24;
  }

  // footer
  p.drawLine({ start: { x: M, y: 52 }, end: { x: W - M, y: 52 }, thickness: 0.5, color: LINE });
  p.drawText(`${COMPANY.name} · Confidential: contains Aadhaar and bank details. Share only for making the ESIC card.`, { x: M, y: 38, size: 7.5, font: f.reg, color: GREY });
  const pn = `Page 1 of ${doc.getPageCount()}`; p.drawText(pn, { x: W - M - f.reg.widthOfTextAtSize(pn, 7.5), y: 38, size: 7.5, font: f.reg, color: GREY });
}

/** A clickable area that opens a web address. rect = [left, bottom, right, top] in points. */
function link(doc: PDFDocument, p: PDFPage, url: string, rect: number[]) {
  const annot = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } }));
  const annots = p.node.Annots(); if (annots) annots.push(annot); else p.node.set(PDFName.of("Annots"), doc.context.obj([annot]));
}

export async function buildEsicPack(e: Employee, files: EsicFile[], photo: EsicPhoto): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc);
  doc.setTitle(`ESIC details - ${e.full_name}`);
  // the documents first, so page 1 (inserted at the front afterwards) can list their page numbers
  const placed: Placed[] = [];
  for (const file of files) {
    const from = doc.getPageCount() + 2;
    const r = await appendFile(doc, f, file.label, file.bytes); const ok = r.ok, note = r.note;
    placed.push({ label: file.label, from, to: doc.getPageCount() + 1, ok, note: ok ? undefined : note });
  }
  await detailsPage(doc, f, e, photo, placed);
  const pk = photo.bytes ? imgKind(photo.bytes) : "other";
  if (photo.bytes && (pk === "jpg" || pk === "png")) await doc.attach(photo.bytes, `${e.full_name.replace(/[^\w .-]/g, "").trim() || "employee"} - photo.${pk}`, { mimeType: pk === "png" ? "image/png" : "image/jpeg", description: "Passport photo" });
  return doc.save();
}
