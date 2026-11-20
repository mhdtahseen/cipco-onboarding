// Finding a document's corners in a photo without AI: the photo is shrunk and smoothed, the background colour is read from its edges, every point is
// marked by how different it is from that colour (Otsu's threshold decides how different is different), and the region around the middle of the photo is
// followed outwards: its four extreme corners are the document's. Works when the document stands out from what it lies on
// (a card on a table, a page on the floor). When it cannot tell, it returns null and the cropper starts from a frame just inside the photo.
import { ctx2d, newCanvas } from "./image";
import { orderQuad, type Quad } from "./warp";

export function detectQuad(src: HTMLCanvasElement): Quad | null {
  const S = 320; const k = Math.min(1, S / Math.max(src.width, src.height)); const w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
  const c = newCanvas(w, h); const x = ctx2d(c); x.filter = "blur(2px)"; x.drawImage(src, 0, 0, w, h); x.filter = "none";
  const d = x.getImageData(0, 0, w, h).data;
  // the background's colour: the average along the photo's edges (what the document lies on)
  let bgr = 0, bgc = 0, bb = 0, nb = 0; const edge = (i: number) => { bgr += d[i * 4]; bgc += d[i * 4 + 1]; bb += d[i * 4 + 2]; nb++; };
  for (let xx = 0; xx < w; xx++) { edge(xx); edge(w + xx); edge((h - 1) * w + xx); edge((h - 2) * w + xx); } for (let yy = 0; yy < h; yy++) { edge(yy * w); edge(yy * w + 1); edge(yy * w + w - 1); edge(yy * w + w - 2); }
  bgr /= nb; bgc /= nb; bb /= nb;
  // how far each point's colour is from the background (a coloured band on a card is far from a brown table, even when it is as dark)
  const g = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) g[i] = Math.min(255, Math.hypot(d[i * 4] - bgr, d[i * 4 + 1] - bgc, d[i * 4 + 2] - bb) * 1.2);
  // the threshold comes from the background itself: how much the edges vary. Anything clearly further from the background colour than that is document.
  let em = 0, ev = 0, en = 0; const eAt = (i: number) => { em += g[i]; ev += g[i] * g[i]; en++; };
  for (let xx = 0; xx < w; xx++) { eAt(xx); eAt((h - 1) * w + xx); } for (let yy = 0; yy < h; yy++) { eAt(yy * w); eAt(yy * w + w - 1); }
  em /= en; const sd = Math.sqrt(Math.max(0, ev / en - em * em)); const th = Math.max(22, em + 3 * sd + 8);
  const total = w * h;
  const mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = g[i] > th ? 1 : 0;
  // small gaps inside the document (dark print, a photo on the card) are closed: a point surrounded by document counts as document
  const closed = new Uint8Array(mask); const R = 2;
  for (let yy = R; yy < h - R; yy++) for (let xx = R; xx < w - R; xx++) { if (mask[yy * w + xx]) continue; let c = 0; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) c += mask[(yy + dy) * w + xx + dx]; if (c >= 15) closed[yy * w + xx] = 1; }
  mask.set(closed);
  // follow the region from the middle
  const seen = new Uint8Array(w * h); let start = -1;
  for (let r = 0; r < Math.min(w, h) / 6 && start < 0; r++) for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const k2 = ((h >> 1) + dy) * w + (w >> 1) + dx; if (mask[k2]) { start = k2; break; } }
  if (start < 0) return null;
  const stack = [start]; seen[start] = 1; let area = 0; let tl = { x: 0, y: 0, v: Infinity }, br = { x: 0, y: 0, v: -Infinity }, tr = { x: 0, y: 0, v: -Infinity }, bl = { x: 0, y: 0, v: Infinity };
  while (stack.length) {
    const i = stack.pop()!; const px = i % w, py = (i / w) | 0; area++;
    const s1 = px + py, s2 = px - py; if (s1 < tl.v) tl = { x: px, y: py, v: s1 }; if (s1 > br.v) br = { x: px, y: py, v: s1 }; if (s2 > tr.v) tr = { x: px, y: py, v: s2 }; if (s2 < bl.v) bl = { x: px, y: py, v: s2 };
    for (const j of [i - 1, i + 1, i - w, i + w]) { if (j < 0 || j >= w * h || seen[j] || !mask[j]) continue; if ((j === i - 1 && px === 0) || (j === i + 1 && px === w - 1)) continue; seen[j] = 1; stack.push(j); }
  }
  const frac = area / total; if (frac < 0.12 || frac > 0.97) return null;   // too small to be the document, or the whole photo
  // corners in full-size pixels (a hair outward, so a card edge is never shaved), kept inside the photo
  const cx = (tl.x + tr.x + br.x + bl.x) / 4, cy = (tl.y + tr.y + br.y + bl.y) / 4;
  const out = (p: { x: number; y: number }) => { const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1; return { x: Math.max(0, Math.min(src.width, (p.x + 0.5 + (dx / len) * 0.3) / k)), y: Math.max(0, Math.min(src.height, (p.y + 0.5 + (dy / len) * 0.3) / k)) }; };
  const q = orderQuad([tl, tr, br, bl].map(out));
  // the four corners must make a reasonable shape
  const area4 = Math.abs((q[0].x * q[1].y - q[1].x * q[0].y) + (q[1].x * q[2].y - q[2].x * q[1].y) + (q[2].x * q[3].y - q[3].x * q[2].y) + (q[3].x * q[0].y - q[0].x * q[3].y)) / 2;
  if (area4 < src.width * src.height * 0.1) return null;
  return q;
}
