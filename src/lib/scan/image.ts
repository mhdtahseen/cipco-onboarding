// Images on the device: open any photo (iPhone HEIC included) as a canvas, rotate it, make thumbnails, save it as JPEG or PNG.
// Everything here runs in the browser; nothing is uploaded.
export const isPdfFile = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
export const isHeicFile = (f: File) => /image\/hei[cf]/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
export const isImageFile = (f: File) => f.type.startsWith("image/") || isHeicFile(f) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);

const MAX_SIDE = 3200;   // big enough for a sharp A4 page, small enough that cheap phones do not run out of memory

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c;
}
export const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;

/** A photo as a canvas, turned the right way up (the camera's orientation is applied) and no larger than MAX_SIDE. HEIC is converted first. */
export async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  let blob: Blob = file;
  if (isHeicFile(file)) {
    try { const bm = await createImageBitmap(file); return bitmapToCanvas(bm); } catch { /* this browser cannot read HEIC itself: convert it */ }
    const heic2any = (await import("heic2any")).default as (o: { blob: Blob; toType: string; quality: number }) => Promise<Blob | Blob[]>;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 }); blob = Array.isArray(out) ? out[0] : out;
  }
  let bm: ImageBitmap;
  try { bm = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch {   // older browsers: through an <img>
    const url = URL.createObjectURL(blob);
    try { const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("This picture could not be opened.")); i.src = url; });
      const c = fit(img.naturalWidth, img.naturalHeight); ctx2d(c).drawImage(img, 0, 0, c.width, c.height); return c; }
    finally { URL.revokeObjectURL(url); }
  }
  return bitmapToCanvas(bm);
}
function fit(w: number, h: number) { const s = Math.min(1, MAX_SIDE / Math.max(w, h)); return newCanvas(w * s, h * s); }
function bitmapToCanvas(bm: ImageBitmap) { const c = fit(bm.width, bm.height); ctx2d(c).drawImage(bm, 0, 0, c.width, c.height); bm.close?.(); return c; }

/** Turned by a multiple of 90° (clockwise). */
export function rotate(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const d = ((deg % 360) + 360) % 360; if (!d) return src;
  const c = d === 180 ? newCanvas(src.width, src.height) : newCanvas(src.height, src.width); const x = ctx2d(c);
  x.translate(c.width / 2, c.height / 2); x.rotate((d * Math.PI) / 180); x.drawImage(src, -src.width / 2, -src.height / 2); return c;
}

/** Scaled down so the longest side is at most `max` (never up). */
export function shrink(src: HTMLCanvasElement, max: number): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(src.width, src.height)); if (s === 1) return src;
  const c = newCanvas(src.width * s, src.height * s); const x = ctx2d(c); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, c.width, c.height); return c;
}
/** Exactly w × h, stretched (used after straightening, when the shape is already right). */
export function resizeTo(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = newCanvas(w, h); const x = ctx2d(c); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, c.width, c.height); return c;
}
/** Filled to w × h without stretching: the middle is kept, the edges trimmed (cover). */
export function coverTo(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const s = Math.max(w / src.width, h / src.height); const c = newCanvas(w, h); const x = ctx2d(c); x.imageSmoothingQuality = "high";
  x.drawImage(src, (w - src.width * s) / 2, (h - src.height * s) / 2, src.width * s, src.height * s); return c;
}
/** On white (for JPEG: transparent parts would turn black). */
export function onWhite(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = newCanvas(src.width, src.height); const x = ctx2d(c); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0); return c;
}

export const canvasBlob = (c: HTMLCanvasElement, type: "image/jpeg" | "image/png", q = 0.85) =>
  new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("Could not save the picture."))), type, q));
export const jpegBlob = (c: HTMLCanvasElement, q = 0.85) => canvasBlob(onWhite(c), "image/jpeg", q);

/** A JPEG no bigger than `maxBytes` if it can be done: lower quality first, then smaller. */
export async function jpegUnder(c: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  let cur = onWhite(c); let best: Blob | null = null;
  for (let round = 0; round < 6; round++) {
    for (const q of [0.88, 0.78, 0.66, 0.55, 0.45]) { const b = await canvasBlob(cur, "image/jpeg", q); best = b; if (b.size <= maxBytes) return b; }
    cur = shrink(cur, Math.max(200, Math.round(Math.max(cur.width, cur.height) * 0.8)));
  }
  return best!;
}

export function thumb(src: HTMLCanvasElement, max = 240): string { return shrink(src, max).toDataURL("image/jpeg", 0.7); }

export const fileFrom = (b: Blob, name: string, type = b.type) => new File([b], name, { type, lastModified: Date.now() });
export const baseName = (name: string) => name.replace(/\.[^.]+$/, "") || "document";

/** Download a file, or hand it to the phone's share sheet (WhatsApp, mail…) when asked and possible. */
export async function saveOrShare(file: File, share = false): Promise<"shared" | "saved"> {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (share && nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: file.name }); return "shared"; } catch (e) { if ((e as Error).name === "AbortError") return "shared"; } }
  const url = URL.createObjectURL(file); const a = document.createElement("a"); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); return "saved";
}
export const canShareFiles = () => typeof navigator !== "undefined" && !!(navigator as Navigator & { canShare?: unknown }).canShare && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
