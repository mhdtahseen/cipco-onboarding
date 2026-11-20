"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rotate, resizeTo, ctx2d } from "@/lib/scan/image";
import { warp, fullQuad, orderQuad, type Quad, type Pt } from "@/lib/scan/warp";
import { detectQuad } from "@/lib/scan/detect";
import { applyLook, type Look } from "@/lib/scan/filters";
import type { ScanStrings } from "@/lib/scan/strings";

// The cropper and straightener: drag the 4 corners onto the document's corners (a magnifier shows the corner while dragging), rotate, pick a look,
// Done. The result is the document flattened into a rectangle. `aspect` (width ÷ height) fixes the result's shape: an ID card, a passport photo.
export default function Cropper({ src, aspect, t, title, hint, onDone, onCancel, initialLook = "original", showLooks = true }: {
  src: HTMLCanvasElement; aspect?: number; t: ScanStrings; title?: string; hint?: string; onDone: (c: HTMLCanvasElement) => void; onCancel: () => void; initialLook?: Look; showLooks?: boolean;
}) {
  const [img, setImg] = useState(src); const [quad, setQuad] = useState<Quad>(() => detectQuad(src) ?? fullQuad(src.width, src.height, Math.min(src.width, src.height) * 0.04));
  const [look, setLook] = useState<Look>(initialLook); const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null); const view = useRef<HTMLCanvasElement>(null); const loupe = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(1); const [drag, setDrag] = useState<number | null>(null);

  // fit the picture to the space available
  useLayoutEffect(() => {
    const fitIt = () => { const el = box.current; if (!el) return; const maxW = el.clientWidth, maxH = Math.max(240, window.innerHeight * 0.58); setScale(Math.min(maxW / img.width, maxH / img.height)); };
    fitIt(); window.addEventListener("resize", fitIt); return () => window.removeEventListener("resize", fitIt);
  }, [img]);
  useEffect(() => { const c = view.current; if (!c) return; c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale); const x = ctx2d(c); x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, c.width, c.height); }, [img, scale]);

  const turn = (d: number) => { const r = rotate(img, d); setImg(r); setQuad(detectQuad(r) ?? fullQuad(r.width, r.height, Math.min(r.width, r.height) * 0.04)); };
  const toImg = (e: React.PointerEvent): Pt => { const r = view.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(img.width, (e.clientX - r.left) / scale)), y: Math.max(0, Math.min(img.height, (e.clientY - r.top) / scale)) }; };
  const drawLoupe = (p: Pt) => {
    const l = loupe.current; if (!l) return; const x = ctx2d(l); const z = 3, S = l.width, sw = S / (z * scale);   // the square of the picture shown, in picture pixels: 3× what is on screen
    x.clearRect(0, 0, S, S); x.save(); x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); x.clip();
    x.fillStyle = "#fff"; x.fillRect(0, 0, S, S); x.drawImage(img, p.x - sw / 2, p.y - sw / 2, sw, sw, 0, 0, S, S); x.restore();
    x.strokeStyle = "#2563eb"; x.lineWidth = 2; x.beginPath(); x.moveTo(S / 2 - 10, S / 2); x.lineTo(S / 2 + 10, S / 2); x.moveTo(S / 2, S / 2 - 10); x.lineTo(S / 2, S / 2 + 10); x.stroke();
    x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); x.stroke();
  };
  const onMove = (e: React.PointerEvent) => { if (drag === null) return; const p = toImg(e); setQuad((q) => { const n = [...q] as Quad; n[drag] = p; return n; }); drawLoupe(p); };
  const onDown = (i: number) => (e: React.PointerEvent) => { e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i); drawLoupe(quad[i]); };
  const onUp = () => { if (drag !== null) setQuad((q) => orderQuad(q)); setDrag(null); };

  async function finish() {
    setBusy(true); await new Promise((r) => setTimeout(r, 20));   // let the button show "Working…"
    try {
      let out = warp(img, quad, { maxSide: aspect ? 1600 : 2400 });
      if (aspect) {
        if ((out.width >= out.height) !== (aspect >= 1)) out = rotate(out, 90);   // a card photographed upright is laid flat
        const W = aspect >= 1 ? 1200 : Math.round(1200 * aspect), H = Math.round(W / aspect); out = resizeTo(out, W, H);
      }
      onDone(applyLook(out, look));
    } finally { setBusy(false); }
  }

  const pts = quad.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const looks: [Look, string][] = [["original", t.original], ["scan", t.scan], ["gray", t.gray], ["bw", t.bw]];
  const loupeAt = drag !== null ? pts[drag] : null; const loupeLeft = loupeAt && loupeAt.x < (view.current?.width ?? 0) / 2;
  return (
    <div className="space-y-3">
      {title && <div className="font-semibold">{title}</div>}
      <p className="text-xs text-slate-500">{hint ?? t.dragCorners}</p>
      <div ref={box} className="w-full flex justify-center">
        <div className="relative touch-none select-none" style={{ width: Math.round(img.width * scale), height: Math.round(img.height * scale) }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <canvas ref={view} className="block rounded-lg" />
          <svg className="absolute inset-0 w-full h-full overflow-visible" aria-hidden>
            <defs><mask id="crop-mask"><rect width="100%" height="100%" fill="white" /><polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="black" /></mask></defs>
            <rect width="100%" height="100%" fill="rgba(15,23,42,.45)" mask="url(#crop-mask)" />
            <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#3b82f6" strokeWidth="2" />
          </svg>
          {pts.map((p, i) => <button key={i} type="button" aria-label={`Corner ${i + 1}`} onPointerDown={onDown(i)}
            className="absolute -translate-x-1/2 -translate-y-1/2 h-9 w-9 rounded-full border-[3px] border-blue-600 bg-white/70 shadow touch-none cursor-grab" style={{ left: p.x, top: p.y }} />)}
          <canvas ref={loupe} width={120} height={120} className={`pointer-events-none absolute top-2 rounded-full shadow-lg ${drag === null ? "hidden" : ""}`} style={loupeLeft ? { right: 8 } : { left: 8 }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => turn(-90)} aria-label={`${t.rotate} left`}>↺</button>
        <button type="button" className="btn btn-sm" onClick={() => turn(90)} aria-label={`${t.rotate} right`}>↻</button>
        <button type="button" className="btn btn-sm" onClick={() => setQuad(detectQuad(img) ?? fullQuad(img.width, img.height, Math.min(img.width, img.height) * 0.04))}>{t.auto}</button>
        <button type="button" className="btn btn-sm" onClick={() => setQuad(fullQuad(img.width, img.height))}>{t.whole}</button>
        {showLooks && <div role="group" aria-label={t.look} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 sm:ml-auto">{looks.map(([k, l]) => <button key={k} type="button" aria-pressed={look === k} className={`px-2.5 py-1 text-xs rounded-md ${look === k ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-600"}`} onClick={() => setLook(k)}>{l}</button>)}</div>}
      </div>
      <div className="flex gap-2"><button type="button" className="btn btn-primary flex-1 justify-center" disabled={busy} onClick={finish}>{busy ? t.working : t.done}</button><button type="button" className="btn" onClick={onCancel}>{t.cancel}</button></div>
    </div>);
}
