// Reading PDFs on the device (pdf.js, loaded only when a PDF is opened): page pictures for thumbnails and editing, and locked PDFs with their password.
import { ctx2d, newCanvas } from "./image";

type PdfJs = typeof import("pdfjs-dist");
export type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;
let lib: Promise<PdfJs> | null = null;
export function pdfjs(): Promise<PdfJs> {
  if (!lib) lib = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    const p = m as unknown as PdfJs; p.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString(); return p;
  });
  return lib;
}

export class PasswordNeeded extends Error { constructor(public wrong: boolean) { super(wrong ? "That password is not right." : "This PDF is locked with a password."); } }

/** Opens a PDF; throws PasswordNeeded when it is locked (wrong = a password was tried and failed). `locked` is true for any encrypted PDF,
 *  which the PDF writer cannot copy pages from, so its pages are redrawn as pictures when saved. */
export async function openPdf(bytes: Uint8Array, password?: string): Promise<{ doc: PdfDoc; locked: boolean }> {
  const p = await pdfjs();
  try {
    const doc = await p.getDocument({ data: bytes.slice(), password }).promise;
    const locked = !!password || (await isEncrypted(bytes)); return { doc, locked };
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err?.name === "PasswordException") throw new PasswordNeeded(err.code === 2 || !!password);
    throw new Error("This PDF could not be opened. It may be damaged.");
  }
}
// an /Encrypt entry in the trailer (cheap check, no PDF writer needed)
async function isEncrypted(bytes: Uint8Array) { const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 4096))); return /\/Encrypt\s/.test(tail) || /\/Encrypt\s/.test(new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 2048)))); }

/** One page as a canvas, `scale` × its size in points (1 point = 1/72 inch; scale 2 ≈ 144 dpi). Rotation set in the PDF is applied. */
export async function renderPage(doc: PdfDoc, index: number, scale = 2): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(index + 1); const vp = page.getViewport({ scale });
  const c = newCanvas(vp.width, vp.height); const x = ctx2d(c); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: x, viewport: vp, canvas: c } as Parameters<typeof page.render>[0]).promise; page.cleanup(); return c;
}
/** A page's size in points (as shown, rotation applied). */
export async function pageSize(doc: PdfDoc, index: number): Promise<{ w: number; h: number }> { const page = await doc.getPage(index + 1); const vp = page.getViewport({ scale: 1 }); return { w: vp.width, h: vp.height }; }
