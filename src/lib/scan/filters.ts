// Clean-up looks for a scanned page: "scan" whitens the paper and deepens the ink while keeping colour, "gray" and "bw" (adaptive threshold, for text).
import { ctx2d, newCanvas } from "./image";

export type Look = "original" | "scan" | "gray" | "bw";
export const LOOKS: [Look, string][] = [["original", "Original"], ["scan", "Scan"], ["gray", "Grey"], ["bw", "Black & white"]];

export function applyLook(src: HTMLCanvasElement, look: Look): HTMLCanvasElement {
  if (look === "original") return src;
  const w = src.width, h = src.height; const out = newCanvas(w, h); const oc = ctx2d(out); oc.drawImage(src, 0, 0);
  const img = oc.getImageData(0, 0, w, h); const d = img.data; const n = w * h;
  const lum = new Float32Array(n); for (let i = 0; i < n; i++) lum[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  if (look === "bw") {
    // the average around each point (from an integral image); darker than that by a margin = ink
    const r = Math.max(8, Math.round(Math.min(w, h) / 40)); const ii = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += lum[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row; } }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const mean = (ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const v = lum[y * w + x] < mean - 12 ? 0 : 255; const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v;
    }
  } else {
    // stretch: the paper (a high percentile) becomes white, the darkest ink black
    const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[lum[i] | 0]++;
    const at = (p: number) => { let c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= n * p) return v; } return 255; };
    const lo = at(0.02), hi = Math.max(lo + 30, at(look === "scan" ? 0.8 : 0.98)); const k = 255 / (hi - lo);
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      if (look === "gray") { const v = Math.min(255, Math.max(0, (lum[i] - lo) * k)); d[j] = d[j + 1] = d[j + 2] = v; continue; }
      for (let c = 0; c < 3; c++) { let v = (d[j + c] - lo) * k; v = v < 0 ? 0 : v > 255 ? 255 : v; d[j + c] = 255 * Math.pow(v / 255, 1.25); }   // a touch of gamma keeps ink strong
    }
  }
  oc.putImageData(img, 0, 0); return out;
}

/** Brightness and contrast (−100…100 each). */
export function adjust(src: HTMLCanvasElement, brightness: number, contrast: number): HTMLCanvasElement {
  if (!brightness && !contrast) return src;
  const out = newCanvas(src.width, src.height); const x = ctx2d(out); x.filter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%)`; x.drawImage(src, 0, 0); x.filter = "none"; return out;
}
