// Saving: pages to a PDF (pages of unlocked PDFs are copied untouched; pictures are compressed JPEG), an ID card's two sides on one A4 page,
// a smaller copy of a PDF, and pages as pictures.
import { PDFDocument, degrees } from "pdf-lib";
import { canvasBlob, jpegBlob, ctx2d, newCanvas, shrink, onWhite } from "./image";
import { pageCanvas, type Page } from "./pages";

const A4 = { w: 595.28, h: 841.89 };   // points
const MM = 72 / 25.4;
export type Quality = "high" | "normal" | "small" | "tiny";
const Q: Record<Quality, { side: number; q: number; scale: number }> = { high: { side: 2400, q: 0.88, scale: 2.8 }, normal: { side: 1800, q: 0.78, scale: 2.2 }, small: { side: 1300, q: 0.62, scale: 1.6 }, tiny: { side: 1000, q: 0.5, scale: 1.3 } };

async function jpegBytes(c: HTMLCanvasElement, quality: Quality) { const b = await jpegBlob(shrink(c, Q[quality].side), Q[quality].q); return new Uint8Array(await b.arrayBuffer()); }

/** Pages to one PDF. size "a4": every page fitted on A4 (pictures centred with a margin); "fit": each page keeps its own size.
 *  redraw: PDF pages are redrawn as pictures too (to make a PDF smaller, or when a locked PDF is saved unlocked). */
export async function pagesToPdf(pages: Page[], opts: { size?: "fit" | "a4"; quality?: Quality; redraw?: boolean; title?: string } = {}): Promise<Uint8Array> {
  const out = await PDFDocument.create(); const quality = opts.quality ?? "normal"; const loaded = new Map<string, PDFDocument>();
  for (const p of pages) {
    const copyable = p.pdf && !p.pdf.src.locked && !opts.redraw && !p.canvas;
    if (copyable) {
      let src = loaded.get(p.pdf!.src.id);
      if (!src) { try { src = await PDFDocument.load(p.pdf!.src.bytes, { updateMetadata: false }); loaded.set(p.pdf!.src.id, src); } catch { src = undefined; } }
      if (src) { const [pg] = await out.copyPages(src, [p.pdf!.index]); pg.setRotation(degrees((pg.getRotation().angle + p.rotation) % 360)); out.addPage(pg); continue; }
    }
    const c = await pageCanvas(p, Q[quality].scale); const img = await out.embedJpg(await jpegBytes(c, quality));
    if (opts.size === "a4") {
      const land = c.width > c.height; const W = land ? A4.h : A4.w, H = land ? A4.w : A4.h; const m = 24; const s = Math.min((W - 2 * m) / c.width, (H - 2 * m) / c.height);
      const pg = out.addPage([W, H]); pg.drawImage(img, { x: (W - c.width * s) / 2, y: (H - c.height * s) / 2, width: c.width * s, height: c.height * s });
    } else {
      // a picture keeps its shape, at A4 width (or A4 height when it is wider than tall), so it prints at a sensible size
      const k = (c.width >= c.height ? A4.h : A4.w) / c.width; const W = c.width * k, H = c.height * k; const pg = out.addPage([W, H]); pg.drawImage(img, { x: 0, y: 0, width: W, height: H });
    }
  }
  if (opts.title) out.setTitle(opts.title);
  out.setProducer("CIPCO Operations"); out.setCreator("CIPCO Operations");
  return out.save();
}

/** The smallest change that gets the PDF under `maxBytes`: as it is first, then redrawn at lower and lower quality. fits = false when even the
 *  lowest quality is still too big (that smallest version is returned). */
export async function pagesToPdfUnder(pages: Page[], maxBytes: number, opts: { size?: "fit" | "a4" } = {}): Promise<{ bytes: Uint8Array; fits: boolean; redrawn: boolean }> {
  let bytes = await pagesToPdf(pages, opts); if (bytes.length <= maxBytes) return { bytes, fits: true, redrawn: false };
  for (const quality of ["high", "normal", "small", "tiny"] as Quality[]) { bytes = await pagesToPdf(pages, { ...opts, quality, redraw: true }); if (bytes.length <= maxBytes) return { bytes, fits: true, redrawn: true }; }
  return { bytes, fits: false, redrawn: true };
}

/** An ID card's front and back at true size (85.6 × 54 mm), one above the other near the top of an A4 page, like a self-attested photocopy. */
export async function idCardPdf(front: HTMLCanvasElement, back: HTMLCanvasElement | null, opts: { cardMm?: { w: number; h: number }; title?: string } = {}): Promise<Uint8Array> {
  const card = opts.cardMm ?? { w: 85.6, h: 54 }; const out = await PDFDocument.create(); const pg = out.addPage([A4.w, A4.h]);
  const place = async (c: HTMLCanvasElement, i: number) => {
    const portrait = c.height > c.width && card.w > card.h; const w = (portrait ? card.h : card.w) * MM, h = (portrait ? card.w : card.h) * MM;
    const img = await out.embedJpg(await jpegBytes(c, "high")); const top = 25 * MM + i * (Math.max(card.h, portrait ? card.w : card.h) * MM + 12 * MM);
    pg.drawImage(img, { x: (A4.w - w) / 2, y: A4.h - top - h, width: w, height: h });
  };
  await place(front, 0); if (back) await place(back, 1);
  if (opts.title) out.setTitle(opts.title); out.setProducer("CIPCO Operations"); return out.save();
}
/** The same page as a picture (JPEG, 150 dpi), for sending as a photo. */
export async function idCardJpeg(front: HTMLCanvasElement, back: HTMLCanvasElement | null, cardMm = { w: 85.6, h: 54 }): Promise<Blob> {
  const dpmm = 150 / 25.4; const W = Math.round(210 * dpmm), cw = cardMm.w * dpmm, ch = cardMm.h * dpmm, gap = 12 * dpmm, top = 25 * dpmm;
  const H = Math.round(top * 2 + ch * (back ? 2 : 1) + (back ? gap : 0)); const c = newCanvas(W, H); const x = ctx2d(c); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = "high";
  x.drawImage(front, (W - cw) / 2, top, cw, ch); if (back) x.drawImage(back, (W - cw) / 2, top + ch + gap, cw, ch);
  return canvasBlob(c, "image/jpeg", 0.88);
}

/** Each page as a JPEG. */
export async function pagesToJpegs(pages: Page[], quality: Quality = "normal"): Promise<Blob[]> {
  const out: Blob[] = []; for (const p of pages) out.push(await jpegBlob(shrink(await pageCanvas(p, Q[quality].scale), Q[quality].side), Q[quality].q)); return out;
}

/** Several files in one ZIP (split pages, pages as pictures). */
export async function zipOf(files: { name: string; data: Blob | Uint8Array }[]): Promise<Blob> {
  const JSZip = (await import("jszip")).default; const z = new JSZip(); files.forEach((f) => z.file(f.name, f.data)); return z.generateAsync({ type: "blob" });
}

export { onWhite };
