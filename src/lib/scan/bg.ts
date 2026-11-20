// Transparent backgrounds without AI: a signature (everything lighter than the ink goes), a seal or stamp (keep one colour), and tap-to-remove
// (a flood fill of similar colour from where you tap) with a brush to erase or bring back. Results are PNGs with transparency.
import { ctx2d, newCanvas } from "./image";

const lumAt = (d: Uint8ClampedArray, i: number) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

/** Signature or handwriting on paper: pixels lighter than `cut` (0–255) become transparent, with a soft edge; ink can be recoloured. */
export function inkOnly(src: HTMLCanvasElement, cut = 170, ink: "keep" | "black" | "blue" = "keep"): HTMLCanvasElement {
  const out = newCanvas(src.width, src.height); const x = ctx2d(out); x.drawImage(src, 0, 0); const img = x.getImageData(0, 0, out.width, out.height); const d = img.data;
  const col = ink === "black" ? [20, 20, 20] : ink === "blue" ? [16, 42, 140] : null; const soft = 40;
  for (let i = 0; i < d.length; i += 4) {
    const l = lumAt(d, i); const a = l >= cut ? 0 : l <= cut - soft ? 255 : Math.round(((cut - l) / soft) * 255);
    if (col) { d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; } d[i + 3] = Math.min(d[i + 3], a);
  }
  x.putImageData(img, 0, 0); return out;
}

/** A seal or stamp: keep pixels close in colour to `keep` (picked by tapping the stamp), drop the rest. tolerance 0–100. */
export function keepColour(src: HTMLCanvasElement, keep: [number, number, number], tolerance = 35): HTMLCanvasElement {
  const out = newCanvas(src.width, src.height); const x = ctx2d(out); x.drawImage(src, 0, 0); const img = x.getImageData(0, 0, out.width, out.height); const d = img.data;
  const [kr, kg, kb] = keep; const kl = kr * 0.299 + kg * 0.587 + kb * 0.114; const t = tolerance * 2.2;
  for (let i = 0; i < d.length; i += 4) {
    // compare the colour (hue) more than the brightness, so pale and dark parts of the same ink both stay
    const l = lumAt(d, i); const dr = d[i] - l - (kr - kl), dg = d[i + 1] - l - (kg - kl), db = d[i + 2] - l - (kb - kl);
    const dist = Math.sqrt(dr * dr + dg * dg + db * db) + Math.max(0, l - kl - 60) * 0.8;   // much lighter than the ink = paper
    d[i + 3] = dist <= t ? 255 : dist >= t * 1.4 ? 0 : Math.round((1 - (dist - t) / (t * 0.4)) * 255);
  }
  x.putImageData(img, 0, 0); return out;
}

/** Tap-to-remove: makes the connected area of similar colour around (px, py) transparent. Works on the canvas in place. tolerance 0–100. */
export function floodErase(c: HTMLCanvasElement, px: number, py: number, tolerance = 30, everywhere = false): void {
  const w = c.width, h = c.height; const x = ctx2d(c); const img = x.getImageData(0, 0, w, h); const d = img.data;
  const sx = Math.max(0, Math.min(w - 1, Math.round(px))), sy = Math.max(0, Math.min(h - 1, Math.round(py))); const s = (sy * w + sx) * 4;
  const r0 = d[s], g0 = d[s + 1], b0 = d[s + 2]; const t2 = (tolerance * 2.55) ** 2 * 3;
  const near = (i: number) => d[i + 3] > 0 && (d[i] - r0) ** 2 + (d[i + 1] - g0) ** 2 + (d[i + 2] - b0) ** 2 <= t2;
  if (everywhere) { for (let i = 0; i < d.length; i += 4) if (near(i)) d[i + 3] = 0; x.putImageData(img, 0, 0); return; }
  const seen = new Uint8Array(w * h); const stack = [sy * w + sx]; seen[sy * w + sx] = 1;
  while (stack.length) {
    const p = stack.pop()!; const i = p * 4; if (!near(i)) continue; d[i + 3] = 0; const xx = p % w;
    if (xx > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); } if (xx < w - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
    if (p >= w && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); } if (p < w * (h - 1) && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
  }
  // soften the new edge a little: half-transparent where a kept pixel touches a removed one
  x.putImageData(img, 0, 0);
}

/** Brush: erase (make transparent) or restore (copy back from the original) a round spot. */
export function brush(c: HTMLCanvasElement, original: HTMLCanvasElement, px: number, py: number, radius: number, mode: "erase" | "restore"): void {
  const x = ctx2d(c); x.save(); x.beginPath(); x.arc(px, py, radius, 0, Math.PI * 2); x.clip();
  if (mode === "erase") x.clearRect(px - radius, py - radius, radius * 2, radius * 2); else { x.clearRect(px - radius, py - radius, radius * 2, radius * 2); x.drawImage(original, 0, 0); }
  x.restore();
}

/** Trims empty (transparent) margins, leaving `pad` pixels. */
export function trimTransparent(src: HTMLCanvasElement, pad = 8): HTMLCanvasElement {
  const w = src.width, h = src.height; const d = ctx2d(src).getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return src; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = newCanvas(x1 - x0 + 1, y1 - y0 + 1); ctx2d(out).drawImage(src, -x0, -y0); return out;
}
/** Transparent parts filled with a colour (e.g. white behind a passport photo). */
export function fillBehind(src: HTMLCanvasElement, colour = "#ffffff"): HTMLCanvasElement {
  const out = newCanvas(src.width, src.height); const x = ctx2d(out); x.fillStyle = colour; x.fillRect(0, 0, out.width, out.height); x.drawImage(src, 0, 0); return out;
}
export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement { const c = newCanvas(src.width, src.height); ctx2d(c).drawImage(src, 0, 0); return c; }
