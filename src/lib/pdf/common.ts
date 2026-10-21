import { promises as fs } from "fs";
import path from "path";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const root = process.cwd();
export const readAsset = (...p: string[]) => fs.readFile(path.join(root, "assets", ...p));
export const readPublic = (...p: string[]) => fs.readFile(path.join(root, "public", ...p));

export async function newDoc() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  return doc;
}
export type Fonts = { reg: PDFFont; bold: PDFFont; ital: PDFFont };
export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  const [r, b, i] = await Promise.all([readAsset("fonts", "Inter-Regular.ttf"), readAsset("fonts", "Inter-Bold.ttf"), readAsset("fonts", "Inter-Italic.ttf")]);
  return { reg: await doc.embedFont(r, { subset: true }), bold: await doc.embedFont(b, { subset: true }), ital: await doc.embedFont(i, { subset: true }) };
}

/** Company seal + authorised signature (placeholders in /public/branding — replace the PNGs to go live). */
export async function loadBranding() {
  const [seal, sign] = await Promise.all([readPublic("branding", "seal.png"), readPublic("branding", "signature.png")]);
  return { seal, sign };
}
export type Stamp = { x: number; top: number; signW?: number; sealW?: number; sealDx?: number; sealDy?: number };
/** Draw signature (left) and seal (overlapping right). x = left edge, top = top edge in "from top" coordinates. */
export async function drawStamp(doc: PDFDocument, page: PDFPage, s: Stamp) {
  const { seal, sign } = await loadBranding();
  const H = page.getHeight();
  const signImg = await doc.embedPng(sign), sealImg = await doc.embedPng(seal);
  const sw = s.signW ?? 90, sh = (sw * signImg.height) / signImg.width;
  const dw = s.sealW ?? 62, dh = (dw * sealImg.height) / sealImg.width;
  page.drawImage(sealImg, { x: s.x + (s.sealDx ?? sw * 0.55), y: H - s.top - dh - (s.sealDy ?? 0), width: dw, height: dh, opacity: 0.88 });
  page.drawImage(signImg, { x: s.x, y: H - s.top - sh - 8, width: sw, height: sh });
}

/** Write text so that its BASELINE is `baseTop` points from the top of the page. Shrinks to fit maxWidth. */
export function put(page: PDFPage, font: PDFFont, text: string | null | undefined, x: number, baseTop: number, size = 9, maxWidth?: number, minSize = 5.5) {
  if (!text) return;
  let s = size;
  if (maxWidth) while (s > minSize && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.25;
  page.drawText(text, { x, y: page.getHeight() - baseTop, size: s, font, color: rgb(0.04, 0.1, 0.45) });
}
/** Mark a tick box with an X, box top-left given in from-top coordinates. */
export function tick(page: PDFPage, font: PDFFont, x: number, topOfBox: number, boxH = 7) {
  page.drawText("X", { x: x, y: page.getHeight() - topOfBox - boxH + 0.8, size: boxH + 0.5, font, color: rgb(0.04, 0.1, 0.45) });
}
export function circle(page: PDFPage, cx: number, cyTop: number, rx: number, ry: number) {
  page.drawEllipse({ x: cx, y: page.getHeight() - cyTop, xScale: rx, yScale: ry, borderColor: rgb(0.04, 0.1, 0.45), borderWidth: 1 });
}
export function wrapPlain(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const out: string[] = []; let line = "";
  for (const w of text.split(/\s+/)) {
    const t = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** Cover pre-printed placeholder dots with white before writing over them. Coordinates from top. */
export function blank(page: PDFPage, x: number, top: number, w: number, h: number) {
  page.drawRectangle({ x, y: page.getHeight() - top - h, width: w, height: h, color: rgb(1, 1, 1) });
}
