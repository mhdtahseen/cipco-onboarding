// The page model shared by the upload scanner and the /pdf workspace. A page is either a page of a PDF that was opened (kept exactly as it is
// when saved, unless it was edited or the PDF was locked), or a picture (a photo, or a PDF page that was cropped, cleaned or marked).
import { fileToCanvas, isPdfFile, isImageFile, thumb, rotate as rot } from "./image";
import { openPdf, renderPage, pageSize, PasswordNeeded, type PdfDoc } from "./pdf";

export type PdfSource = { id: string; name: string; bytes: Uint8Array; doc: PdfDoc; locked: boolean };
export type Page = {
  id: string; name: string;             // name: the file it came from
  pdf?: { src: PdfSource; index: number };
  canvas?: HTMLCanvasElement;           // a picture page (or an edited PDF page)
  rotation: number;                     // extra turn, in degrees, applied when saved
  thumb: string; w: number; h: number;  // thumbnail, and size (points for PDF pages, pixels for pictures) before rotation
};
let n = 0; export const uid = () => `p${Date.now().toString(36)}${(n++).toString(36)}`;

export type PasswordAsk = (fileName: string, wrong: boolean) => Promise<string | null>;

/** Every page of the files, in order. Locked PDFs ask for their password (null = skip that file). Unknown files throw. */
export async function filesToPages(files: File[], askPassword: PasswordAsk): Promise<{ pages: Page[]; skipped: string[] }> {
  const pages: Page[] = []; const skipped: string[] = [];
  for (const f of files) {
    if (isPdfFile(f)) {
      const bytes = new Uint8Array(await f.arrayBuffer()); let pw: string | undefined; let wrong = false; let opened: Awaited<ReturnType<typeof openPdf>> | null = null;
      for (let tries = 0; tries < 6 && !opened; tries++) {
        try { opened = await openPdf(bytes, pw); }
        catch (e) { if (!(e instanceof PasswordNeeded)) throw new Error(`${f.name}: ${(e as Error).message}`); const p = await askPassword(f.name, wrong); if (p === null) break; pw = p; wrong = true; }
      }
      if (!opened) { skipped.push(f.name); continue; }
      const src: PdfSource = { id: uid(), name: f.name, bytes, doc: opened.doc, locked: opened.locked };
      for (let i = 0; i < opened.doc.numPages; i++) {
        const size = await pageSize(opened.doc, i); const t = await renderPage(opened.doc, i, Math.min(1, 240 / Math.max(size.w, size.h)) * 1.5);
        pages.push({ id: uid(), name: f.name, pdf: { src, index: i }, rotation: 0, thumb: t.toDataURL("image/jpeg", 0.7), w: size.w, h: size.h });
      }
    } else if (isImageFile(f)) {
      const c = await fileToCanvas(f); pages.push(pictureOf(c, f.name));
    } else throw new Error(`${f.name}: only PDFs and pictures can be opened here.`);
  }
  return { pages, skipped };
}

export const pictureOf = (c: HTMLCanvasElement, name: string): Page => ({ id: uid(), name, canvas: c, rotation: 0, thumb: thumb(c), w: c.width, h: c.height });

/** The page as a picture, rotation applied: PDF pages are drawn at `scale` (2 ≈ 144 dpi, enough to crop a card from). */
export async function pageCanvas(p: Page, scale = 2.5): Promise<HTMLCanvasElement> {
  const base = p.canvas ?? (await renderPage(p.pdf!.src.doc, p.pdf!.index, scale)); return rot(base, p.rotation);
}
/** A page replaced by an edited picture (the result of the cropper, black-out, signing…). */
export const withPicture = (p: Page, c: HTMLCanvasElement): Page => ({ ...p, pdf: undefined, canvas: c, rotation: 0, thumb: thumb(c), w: c.width, h: c.height });
export const turned = (p: Page, by: number): Page => ({ ...p, rotation: (((p.rotation + by) % 360) + 360) % 360 });
