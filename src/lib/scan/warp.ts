// Straightening: the four corners of a document in a photo are mapped onto a flat rectangle (a perspective transform), like a scanner app.
import { ctx2d, newCanvas } from "./image";

export type Pt = { x: number; y: number };
export type Quad = [Pt, Pt, Pt, Pt];   // top-left, top-right, bottom-right, bottom-left

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const fullQuad = (w: number, h: number, inset = 0): Quad => [{ x: inset, y: inset }, { x: w - inset, y: inset }, { x: w - inset, y: h - inset }, { x: inset, y: h - inset }];

/** Puts four points in order: top-left, top-right, bottom-right, bottom-left. */
export function orderQuad(p: Pt[]): Quad {
  const c = { x: p.reduce((s, q) => s + q.x, 0) / 4, y: p.reduce((s, q) => s + q.y, 0) / 4 };
  const s = [...p].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));   // clockwise from the left
  let start = 0; let best = Infinity; s.forEach((q, i) => { const v = q.x + q.y; if (v < best) { best = v; start = i; } });
  return [0, 1, 2, 3].map((i) => s[(start + i) % 4]) as Quad;
}

/** The size the flattened document should have: the longer of each pair of opposite edges. */
export function quadSize(q: Quad): { w: number; h: number } {
  return { w: Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h: Math.max(dist(q[0], q[3]), dist(q[1], q[2])) };
}

// the 3×3 matrix taking the unit square to the quad (Heckbert's square-to-quad)
function squareToQuad(q: Quad): number[] {
  const [p0, p1, p2, p3] = q; const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return [p1.x - p0.x, p2.x - p1.x, p0.x, p1.y - p0.y, p2.y - p1.y, p0.y, 0, 0, 1];
  const den = dx1 * dy2 - dx2 * dy1; const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

/** The document inside `q`, flattened to w × h (default: its natural size, at most maxSide on the long side). Bilinear sampling. */
export function warp(src: HTMLCanvasElement, q: Quad, opts: { w?: number; h?: number; maxSide?: number } = {}): HTMLCanvasElement {
  const nat = quadSize(q); let w = opts.w ?? nat.w, h = opts.h ?? nat.h;
  const max = opts.maxSide ?? 2400; const s = Math.min(1, max / Math.max(w, h)); w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  const sw = src.width, sh = src.height; const sd = ctx2d(src).getImageData(0, 0, sw, sh).data;
  const out = newCanvas(w, h); const oc = ctx2d(out); const od = oc.createImageData(w, h); const o = od.data;
  const [a, b, c, d, e, f, g, hh] = squareToQuad(q);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w; const den = g * u + hh * v + 1; let px = (a * u + b * v + c) / den - 0.5, py = (d * u + e * v + f) / den - 0.5;
      if (px < 0) px = 0; else if (px > sw - 1) px = sw - 1; if (py < 0) py = 0; else if (py > sh - 1) py = sh - 1;
      const x0 = px | 0, y0 = py | 0, x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1), fx = px - x0, fy = py - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4, oi = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) { const top = sd[i00 + k] + (sd[i10 + k] - sd[i00 + k]) * fx, bot = sd[i01 + k] + (sd[i11 + k] - sd[i01 + k]) * fx; o[oi + k] = top + (bot - top) * fy; }
    }
  }
  oc.putImageData(od, 0, 0); return out;
}
