"use client";
import { useEffect, useRef, useState } from "react";
import { pageCanvas, withPicture, type Page } from "@/lib/scan/pages";
import { ctx2d, fileToCanvas, newCanvas } from "@/lib/scan/image";
import { inkOnly, trimTransparent, cloneCanvas } from "@/lib/scan/bg";
import { AddFiles } from "./common";

type Item = { id: string; kind: "text"; x: number; y: number; text: string; size: number; color: string } | { id: string; kind: "image"; x: number; y: number; w: number; img: HTMLCanvasElement };
type Box = { x: number; y: number; w: number; h: number };
let n = 0; const iid = () => `m${n++}`;
const SIG_KEY = "cipco_pdf_signature";   // the last signature used, kept on this device only

// Fill & sign (text, today's date, a signature, a seal or picture: drag to place, drag the corner handle to resize) and Black out (drag boxes over
// what must not be seen). Opened from the PDF workspace on its pages. Changes are put on the page when you move to another page or press Done:
// the page is redrawn with them, so blacked-out text is really gone, not just covered.
export default function MarkupTool({ mode, pages, setPages, startId, onClose }: { mode: "sign" | "redact"; pages: Page[]; setPages: (f: (p: Page[]) => Page[]) => void; startId?: string; onClose: () => void }) {
  const [pid, setPid] = useState<string>(startId ?? pages[0]?.id ?? ""); const [base, setBase] = useState<HTMLCanvasElement | null>(null); const [scale, setScale] = useState(1);
  const [items, setItems] = useState<Item[]>([]); const [boxes, setBoxes] = useState<Box[]>([]); const [cur, setCur] = useState<string | null>(null);
  const [draw, setDraw] = useState<Box | null>(null); const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; resize?: boolean } | null>(null);
  const [sig, setSig] = useState(false); const [saved, setSaved] = useState<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement>(null); const view = useRef<HTMLCanvasElement>(null); const textBox = useRef<HTMLInputElement>(null);
  const page = pages.find((p) => p.id === pid);

  useEffect(() => { try { const d = localStorage.getItem(SIG_KEY); if (!d) return; const i = new Image(); i.onload = () => { const c = newCanvas(i.naturalWidth, i.naturalHeight); ctx2d(c).drawImage(i, 0, 0); setSaved(c); }; i.src = d; } catch { /* storage unavailable */ } }, []);
  useEffect(() => { let live = true; setItems([]); setBoxes([]); setCur(null); if (!page) { setBase(null); return; } pageCanvas(page, 2.5).then((c) => { if (live) setBase(c); }); return () => { live = false; }; }, [pid, page?.thumb, page?.rotation]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!base || !wrap.current) return; setScale(Math.min(1, wrap.current.clientWidth / base.width, (window.innerHeight * 0.68) / base.height)); }, [base]);
  useEffect(() => {
    const c = view.current; if (!c || !base) return; c.width = Math.round(base.width * scale); c.height = Math.round(base.height * scale);
    const x = ctx2d(c); x.drawImage(base, 0, 0, c.width, c.height); x.save(); x.scale(scale, scale); paint(x, items, boxes, cur, 16 / scale); if (draw) { x.fillStyle = "rgba(0,0,0,.5)"; x.fillRect(draw.x, draw.y, draw.w, draw.h); } x.restore();
  }, [base, scale, items, boxes, draw, cur]);

  const pending = items.length + boxes.length;
  /** Puts what was added onto the page. */
  function commit() {
    if (!base || !page || !pending) return; const out = cloneCanvas(base); paint(ctx2d(out), items, boxes, null, 0);
    setPages((ps) => ps.map((p) => (p.id === page.id ? withPicture(p, out) : p))); setItems([]); setBoxes([]); setCur(null);
  }
  const go = (id: string) => { commit(); setPid(id); };

  const at = (e: React.PointerEvent) => { const r = view.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };
  const hit = (p: { x: number; y: number }) => [...items].reverse().find((it) => { const b = bounds(it); return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; });
  const down = (e: React.PointerEvent) => {
    const p = at(e); (e.target as Element).setPointerCapture?.(e.pointerId);
    if (mode === "redact") { setDraw({ x: p.x, y: p.y, w: 0, h: 0 }); return; }
    const sel = items.find((i) => i.id === cur);
    if (sel) { const b = bounds(sel); if (Math.hypot(p.x - (b.x + b.w), p.y - (b.y + b.h)) < 26 / scale) { setDrag({ id: sel.id, dx: 0, dy: 0, resize: true }); return; } }
    const h = hit(p); if (h) { setCur(h.id); setDrag({ id: h.id, dx: p.x - h.x, dy: p.y - h.y }); } else setCur(null);
  };
  const moveP = (e: React.PointerEvent) => {
    const p = at(e);
    if (draw) { setDraw({ ...draw, w: p.x - draw.x, h: p.y - draw.y }); return; }
    if (!drag) return;
    setItems((its) => its.map((it) => {
      if (it.id !== drag.id) return it;
      if (!drag.resize) return { ...it, x: p.x - drag.dx, y: p.y - drag.dy };
      if (it.kind === "image") return { ...it, w: Math.max(30, p.x - it.x) };
      const w0 = bounds(it).w || 1; return { ...it, size: Math.max(8, Math.min(400, it.size * (Math.max(20, p.x - it.x) / w0))) };
    }));
  };
  const up = () => { if (draw) { const b = norm(draw); if (b.w > 4 && b.h > 4) setBoxes((bs) => [...bs, b]); setDraw(null); } setDrag(null); };

  const addText = (text: string, edit = false) => { if (!base) return; const it: Item = { id: iid(), kind: "text", x: base.width * 0.12, y: base.height * 0.15, text, size: Math.round(base.width / 45), color: "#0b1f66" }; setItems((x) => [...x, it]); setCur(it.id); if (edit) setTimeout(() => { textBox.current?.focus(); textBox.current?.select(); }, 50); };
  const addImage = (img: HTMLCanvasElement, widthFrac = 0.28) => { if (!base) return; const it: Item = { id: iid(), kind: "image", x: base.width * 0.55, y: base.height * 0.72, w: base.width * widthFrac, img }; setItems((x) => [...x, it]); setCur(it.id); };
  const newSignature = (c: HTMLCanvasElement) => { setSaved(c); try { localStorage.setItem(SIG_KEY, c.toDataURL("image/png")); } catch { /* too big or unavailable: just not remembered */ } addImage(c); };
  const selected = items.find((i) => i.id === cur);
  const idx = pages.findIndex((p) => p.id === pid);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold sm:mr-auto">{mode === "sign" ? "Fill & sign" : "Black out"} · page {idx + 1} of {pages.length}</h2>
        <button type="button" className="btn btn-primary" onClick={() => { commit(); onClose(); }}>Done</button></div>
      {pages.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1">{pages.map((p, i) => <button key={p.id} type="button" onClick={() => go(p.id)} aria-label={`Page ${i + 1}`} className={`shrink-0 rounded-lg border p-1 ${p.id === pid ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-200"}`}><img src={p.thumb} alt="" className="h-16" style={{ transform: `rotate(${p.rotation}deg)` }} /><div className="text-[10px] text-slate-500">{i + 1}</div></button>)}</div>}
      <div className="card !p-3 space-y-2">
        {mode === "sign" ? <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={() => addText("Text", true)}>＋ Text</button>
          <button type="button" className="btn btn-sm" onClick={() => addText(new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }))}>＋ Today&apos;s date</button>
          {saved && <button type="button" className="btn btn-sm" onClick={() => addImage(saved)} title="The signature you used last on this device"><img src={saved.toDataURL()} alt="" className="h-5 max-w-16" /> My signature</button>}
          <button type="button" className="btn btn-sm" onClick={() => setSig(true)}>＋ {saved ? "New signature" : "Signature"}</button>
          <AddFiles label="＋ Seal / picture" accept="image/*" multiple={false} onFiles={async (f) => addImage(await fileToCanvas(f[0]), 0.22)} />
          {selected && <div className="flex flex-wrap items-center gap-2 sm:ml-auto text-sm">
            {selected.kind === "text" && <><input ref={textBox} className="inp !w-48 !py-1" aria-label="Text" value={selected.text} onChange={(e) => setItems((its) => its.map((i) => (i.id === selected.id && i.kind === "text" ? { ...i, text: e.target.value } : i)))} />
              <input type="color" aria-label="Colour" value={selected.color} onChange={(e) => setItems((its) => its.map((i) => (i.id === selected.id && i.kind === "text" ? { ...i, color: e.target.value } : i)))} /></>}
            <button type="button" className="btn btn-sm btn-danger" onClick={() => { setItems((its) => its.filter((i) => i.id !== selected.id)); setCur(null); }}>Remove</button></div>}
        </div> : <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-slate-600">Drag over anything to hide: account numbers, phone numbers, the first 8 digits of an Aadhaar…</span>{boxes.length > 0 && <button type="button" className="btn btn-sm" onClick={() => setBoxes((b) => b.slice(0, -1))}>Undo last box</button>}</div>}
        <div ref={wrap} className="w-full flex justify-center"><canvas ref={view} className="rounded border border-slate-200 touch-none shadow-sm" style={{ cursor: mode === "redact" ? "crosshair" : drag ? "grabbing" : "default" }} onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} /></div>
        <p className="text-xs text-slate-400">{mode === "sign" ? "Drag a thing to move it; drag its blue corner to resize. It is put on the page when you press Done or open another page." : "The boxes are put on the page when you press Done or open another page. What is under them is then gone for good."}</p>
      </div>
      {sig && <SignaturePad onCancel={() => setSig(false)} onDone={(c) => { setSig(false); newSignature(c); }} />}
    </div>);
}

const norm = (b: Box): Box => ({ x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) });
let meas: CanvasRenderingContext2D | null = null;
const font = (size: number) => `${size}px Helvetica, Arial, sans-serif`;
function bounds(it: Item): Box {
  if (it.kind === "image") return { x: it.x, y: it.y, w: it.w, h: it.w * (it.img.height / it.img.width) };
  if (!meas && typeof document !== "undefined") meas = document.createElement("canvas").getContext("2d"); let w = it.text.length * it.size * 0.55; if (meas) { meas.font = font(it.size); w = meas.measureText(it.text || " ").width; }
  return { x: it.x, y: it.y - it.size * 0.85, w, h: it.size * 1.1 };
}
/** Draws the boxes and items; `handle` > 0 also outlines the selected one with its resize corner (the editing view, not the saved page). */
function paint(x: CanvasRenderingContext2D, items: Item[], boxes: Box[], cur: string | null, handle: number) {
  boxes.forEach((b) => { x.fillStyle = "#000"; x.fillRect(b.x, b.y, b.w, b.h); });
  items.forEach((it) => {
    if (it.kind === "text") { x.fillStyle = it.color; x.font = font(it.size); x.textBaseline = "alphabetic"; x.fillText(it.text, it.x, it.y); }
    else x.drawImage(it.img, it.x, it.y, it.w, it.w * (it.img.height / it.img.width));
    if (handle > 0 && it.id === cur) { const b = bounds(it); x.strokeStyle = "#2563eb"; x.lineWidth = handle / 6; x.setLineDash([handle / 1.6, handle / 2.6]); x.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); x.setLineDash([]); x.fillStyle = "#2563eb"; x.fillRect(b.x + b.w - handle / 2, b.y + b.h - handle / 2, handle, handle); }
  });
}

/** Draw a signature with a finger or mouse, or take it from a photo of a signature on paper (the paper is removed). */
export function SignaturePad({ onDone, onCancel }: { onDone: (c: HTMLCanvasElement) => void; onCancel: () => void }) {
  const c = useRef<HTMLCanvasElement>(null); const last = useRef<{ x: number; y: number } | null>(null); const [ink, setInk] = useState("#0b1f66"); const [any, setAny] = useState(false);
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null); const [cut, setCut] = useState(170);
  const pt = (e: React.PointerEvent) => { const r = c.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * c.current!.width, y: ((e.clientY - r.top) / r.height) * c.current!.height }; };
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => { const x = ctx2d(c.current!); x.strokeStyle = ink; x.lineWidth = 5; x.lineCap = "round"; x.lineJoin = "round"; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); setAny(true); };
  const fromPhoto = photo ? trimTransparent(inkOnly(photo, cut, ink === "#111111" ? "black" : "blue")) : null;
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Signature">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2"><b className="flex-1">Signature</b>{(["#0b1f66", "#111111"] as const).map((k) => <button key={k} type="button" aria-label={k === "#111111" ? "Black ink" : "Blue ink"} onClick={() => setInk(k)} className={`h-7 w-7 rounded-full border-2 ${ink === k ? "border-blue-500" : "border-slate-200"}`} style={{ background: k }} />)}</div>
        {!photo ? <>
          <canvas ref={c} width={900} height={320} className="w-full rounded-lg border border-slate-300 bg-white touch-none" onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); last.current = pt(e); }} onPointerMove={(e) => { if (!last.current) return; const p = pt(e); line(last.current, p); last.current = p; }} onPointerUp={() => (last.current = null)} />
          <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-sm" onClick={() => { ctx2d(c.current!).clearRect(0, 0, 900, 320); setAny(false); }}>Clear</button><AddFiles label="Use a photo of a signature" accept="image/*" multiple={false} onFiles={async (f) => setPhoto(await fileToCanvas(f[0]))} /></div>
          <div className="flex gap-2"><button type="button" className="btn btn-primary flex-1 justify-center" disabled={!any} onClick={() => onDone(trimTransparent(c.current!))}>Use signature</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
        </> : <>
          <div className="rounded-lg border border-slate-200 p-2" style={{ background: "repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0/16px 16px" }}>{fromPhoto && <img src={fromPhoto.toDataURL()} alt="Signature" className="max-h-40 mx-auto" />}</div>
          <label className="text-sm flex items-center gap-2">Remove paper<input type="range" min={90} max={240} value={cut} onChange={(e) => setCut(+e.target.value)} className="flex-1" /></label>
          <div className="flex gap-2"><button type="button" className="btn btn-primary flex-1 justify-center" onClick={() => fromPhoto && onDone(fromPhoto)}>Use signature</button><button type="button" className="btn" onClick={() => setPhoto(null)}>Back</button></div>
        </>}
        <p className="text-xs text-slate-400">The signature is remembered on this device only, for next time.</p>
      </div>
    </div>);
}
