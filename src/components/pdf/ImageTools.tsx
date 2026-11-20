"use client";
import { useEffect, useRef, useState } from "react";
import Cropper from "@/components/scan/Cropper";
import { fileToCanvas, ctx2d, newCanvas, coverTo, canvasBlob, jpegUnder, onWhite } from "@/lib/scan/image";
import { inkOnly, keepColour, floodErase, brush, trimTransparent, fillBehind, cloneCanvas } from "@/lib/scan/bg";
import { scanStrings } from "@/lib/scan/strings";
import { PDFDocument } from "pdf-lib";
import { AddFiles, NameBox, Result, kb } from "./common";

const t = scanStrings("en");
export type Tool = "passport" | "portal" | "signature" | "seal" | "background";
const TOOLS: [Tool, string, string][] = [
  ["passport", "Passport photo", "3.5 × 4.5 cm, white background, single or a print sheet"],
  ["portal", "Photo / signature for a portal", "exact size in pixels and under a KB limit (ESIC, EPFO…)"],
  ["signature", "Transparent signature", "from a photo of a signature on paper"],
  ["seal", "Transparent seal or stamp", "keeps the stamp's colour, removes the paper"],
  ["background", "Remove a plain background", "tap the background; brush to touch up"],
];
const checker = { background: "repeating-conic-gradient(#e5e7eb 0 25%, #fff 0 50%) 0 0/16px 16px" };

// Photos and signatures: everything happens on this device, the result is downloaded or shared. With `source` (a page already open in the workspace)
// there is nothing to pick: it starts at the crop.
export default function ImageTools({ source, tool: startTool, onClose }: { source?: HTMLCanvasElement; tool?: Tool; onClose?: () => void } = {}) {
  const [tool, setTool] = useState<Tool>(startTool ?? "passport"); const [src, setSrc] = useState<HTMLCanvasElement | null>(source ?? null); const [stage, setStage] = useState<"pick" | "crop" | "edit">(source ? "crop" : "pick");
  const [cropped, setCropped] = useState<HTMLCanvasElement | null>(null); const [err, setErr] = useState("");
  const reset = (to: Tool) => { setTool(to); setSrc(source ?? null); setCropped(null); setStage(source ? "crop" : "pick"); setErr(""); };
  const open = async (f: File[]) => { setErr(""); try { const c = await fileToCanvas(f[0]); setSrc(c); setStage("crop"); } catch (e) { setErr((e as Error).message); } };
  const aspect = tool === "passport" ? 35 / 45 : undefined;
  return (
    <div className="space-y-3">
      {onClose && <button type="button" className="btn btn-sm" onClick={onClose}>← Back to the pages</button>}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">{TOOLS.map(([k, l, d]) => <button key={k} type="button" onClick={() => reset(k)} className={`rounded-xl border p-2.5 text-left ${tool === k ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-slate-200 bg-white hover:bg-slate-50"}`}><div className="text-sm font-medium">{l}</div><div className="text-xs text-slate-500">{d}</div></button>)}</div>
      {err && <p className="warn">{err}</p>}
      {stage === "pick" && <div className="card !p-4 flex flex-wrap gap-2"><AddFiles primary label="Choose a photo" accept="image/*" multiple={false} onFiles={open} /><AddFiles label="📷 Camera" camera onFiles={open} /></div>}
      {stage === "crop" && src && <div className="card !p-3"><Cropper src={src} aspect={aspect} t={t} showLooks={tool !== "passport" && tool !== "background"} initialLook="original"
        hint={tool === "passport" ? "Frame the face and shoulders: the top of the head near the top, chin about two-thirds down." : tool === "signature" || tool === "seal" ? "Put the corners just around the signature or stamp." : undefined}
        onCancel={() => reset(tool)} onDone={(c) => { setCropped(c); setStage("edit"); }} /></div>}
      {stage === "edit" && cropped && (
        tool === "passport" ? <Passport src={cropped} onBack={() => setStage("crop")} />
        : tool === "portal" ? <Portal src={cropped} onBack={() => setStage("crop")} />
        : tool === "signature" ? <Signature src={cropped} onBack={() => setStage("crop")} />
        : tool === "seal" ? <Seal src={cropped} onBack={() => setStage("crop")} />
        : <Background src={cropped} onBack={() => setStage("crop")} />)}
    </div>);
}

const pngFile = async (c: HTMLCanvasElement, name: string) => new File([await canvasBlob(c, "image/png")], `${name}.png`, { type: "image/png" });
const jpgFile = (b: Blob, name: string) => new File([b], `${name}.jpg`, { type: "image/jpeg" });

function Passport({ src, onBack }: { src: HTMLCanvasElement; onBack: () => void }) {
  const [clean, setClean] = useState<HTMLCanvasElement | null>(null); const [edit, setEdit] = useState(false); const [sheet, setSheet] = useState<"one" | "a4" | "4x6">("one");
  const [name, setName] = useState("passport photo"); const [result, setResult] = useState<File | null>(null);
  const photo = clean ?? src;
  async function make() {
    const p = coverTo(onWhite(photo), 413, 531);   // 35 × 45 mm at 300 dpi
    if (sheet === "one") { setResult(jpgFile(await jpegUnder(p, 250 * 1024), name)); return; }
    // a print sheet: 4 × 6 inch (8 photos) or A4 (30 photos), with a thin cutting gap
    const dpmm = 300 / 25.4; const W = Math.round((sheet === "a4" ? 210 : 152.4) * dpmm), H = Math.round((sheet === "a4" ? 297 : 101.6) * dpmm);
    const c = newCanvas(W, H); const x = ctx2d(c); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); const gap = Math.round(3 * dpmm), cols = Math.floor((W - gap) / (p.width + gap)), rows = Math.floor((H - gap) / (p.height + gap));
    const ox = (W - cols * (p.width + gap) + gap) / 2, oy = (H - rows * (p.height + gap) + gap) / 2;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { x.drawImage(p, ox + k * (p.width + gap), oy + r * (p.height + gap)); x.strokeStyle = "#ddd"; x.strokeRect(ox + k * (p.width + gap) - 0.5, oy + r * (p.height + gap) - 0.5, p.width + 1, p.height + 1); }
    if (sheet === "a4") { const doc = await PDFDocument.create(); const pg = doc.addPage([595.28, 841.89]); const img = await doc.embedJpg(new Uint8Array(await (await canvasBlob(c, "image/jpeg", 0.92)).arrayBuffer())); pg.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 }); setResult(new File([(await doc.save()) as BlobPart], `${name}.pdf`, { type: "application/pdf" })); }
    else setResult(jpgFile(await canvasBlob(c, "image/jpeg", 0.92), name));
  }
  if (edit) return <Background src={photo} white onBack={() => setEdit(false)} onDone={(c) => { setClean(c); setEdit(false); setResult(null); }} />;
  return (
    <div className="card !p-3 space-y-3">
      <div className="flex flex-wrap items-start gap-4"><img src={onWhite(photo).toDataURL("image/jpeg", 0.85)} alt="Passport photo" className="w-32 rounded border border-slate-200" />
        <div className="space-y-2 text-sm"><button type="button" className="btn btn-sm" onClick={() => setEdit(true)}>Make the background white…</button>
          <div className="flex flex-wrap gap-2">{([["one", "One photo (JPEG)"], ["4x6", "8 on a 4×6 in print (JPEG)"], ["a4", "30 on A4 (PDF)"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={sheet === k} className={`btn btn-sm ${sheet === k ? "!bg-blue-50 !text-blue-800 !border-blue-300" : ""}`} onClick={() => { setSheet(k); setResult(null); }}>{l}</button>)}</div></div></div>
      <div className="flex flex-wrap items-center gap-2"><NameBox value={name} onChange={setName} ext={sheet === "a4" ? "pdf" : "jpg"} /><button type="button" className="btn" onClick={onBack}>Crop again</button><button type="button" className="btn btn-primary sm:ml-auto" onClick={make}>Make</button></div>
      <Result file={result} onClear={() => setResult(null)} /></div>);
}

function Portal({ src, onBack }: { src: HTMLCanvasElement; onBack: () => void }) {
  const PRESETS: [string, number, number, number][] = [["Photo 200 × 230 px, under 50 KB", 200, 230, 50], ["Signature 140 × 60 px, under 20 KB", 140, 60, 20], ["Photo 350 × 450 px, under 100 KB", 350, 450, 100]];
  const [w, setW] = useState("200"); const [h, setH] = useState("230"); const [k, setK] = useState("50"); const [fit, setFit] = useState<"cover" | "contain">("cover");
  const [name, setName] = useState("photo"); const [result, setResult] = useState<File | null>(null);
  async function make() {
    const W = Math.max(10, parseInt(w) || 200), H = Math.max(10, parseInt(h) || 200);
    let c: HTMLCanvasElement; if (fit === "cover") c = coverTo(onWhite(src), W, H); else { c = newCanvas(W, H); const x = ctx2d(c); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); const s = Math.min(W / src.width, H / src.height); x.drawImage(src, (W - src.width * s) / 2, (H - src.height * s) / 2, src.width * s, src.height * s); }
    const b = await jpegUnder(c, Math.max(2, parseFloat(k) || 50) * 1024); setResult(jpgFile(b, name));
  }
  return (
    <div className="card !p-3 space-y-3">
      <div className="flex flex-wrap gap-2">{PRESETS.map(([l, a, b, c]) => <button key={l} type="button" className="btn btn-sm" onClick={() => { setW(String(a)); setH(String(b)); setK(String(c)); setResult(null); }}>{l}</button>)}</div>
      <div className="flex flex-wrap items-end gap-2"><label className="text-sm">Width (px)<input className="inp !w-24" inputMode="numeric" value={w} onChange={(e) => setW(e.target.value.replace(/\D/g, ""))} /></label><label className="text-sm">Height (px)<input className="inp !w-24" inputMode="numeric" value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, ""))} /></label>
        <label className="text-sm">Under (KB)<input className="inp !w-24" inputMode="numeric" value={k} onChange={(e) => setK(e.target.value.replace(/[^\d.]/g, ""))} /></label>
        <select className="inp !w-auto" value={fit} onChange={(e) => setFit(e.target.value as "cover" | "contain")}><option value="cover">Fill (trim edges)</option><option value="contain">Fit (white margins)</option></select></div>
      <div className="flex flex-wrap items-center gap-2"><NameBox value={name} onChange={setName} ext="jpg" /><button type="button" className="btn" onClick={onBack}>Crop again</button><button type="button" className="btn btn-primary sm:ml-auto" onClick={make}>Make</button></div>
      {result && <p className="text-xs text-slate-500">{w} × {h} px · {kb(result.size)}{result.size > (parseFloat(k) || 50) * 1024 ? " · could not get under the limit: try a smaller size" : ""}</p>}
      <Result file={result} onClear={() => setResult(null)} /></div>);
}

function Signature({ src, onBack }: { src: HTMLCanvasElement; onBack: () => void }) {
  const [cut, setCut] = useState(170); const [ink, setInk] = useState<"keep" | "black" | "blue">("blue"); const [name, setName] = useState("signature"); const [result, setResult] = useState<File | null>(null);
  const out = trimTransparent(inkOnly(src, cut, ink));
  return (
    <div className="card !p-3 space-y-3">
      <div className="rounded-lg border border-slate-200 p-3" style={checker}><img src={out.toDataURL()} alt="Signature" className="max-h-48 mx-auto" /></div>
      <label className="text-sm flex items-center gap-2">Remove paper<input type="range" min={90} max={245} value={cut} onChange={(e) => { setCut(+e.target.value); setResult(null); }} className="flex-1" /></label>
      <div className="flex flex-wrap gap-2">{([["blue", "Blue ink"], ["black", "Black ink"], ["keep", "As photographed"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={ink === k} className={`btn btn-sm ${ink === k ? "!bg-blue-50 !text-blue-800 !border-blue-300" : ""}`} onClick={() => { setInk(k); setResult(null); }}>{l}</button>)}</div>
      <div className="flex flex-wrap items-center gap-2"><NameBox value={name} onChange={setName} ext="png" /><button type="button" className="btn" onClick={onBack}>Crop again</button><button type="button" className="btn btn-primary sm:ml-auto" onClick={async () => setResult(await pngFile(out, name))}>Make PNG</button></div>
      <Result file={result} onClear={() => setResult(null)} /></div>);
}

function Seal({ src, onBack }: { src: HTMLCanvasElement; onBack: () => void }) {
  const [colour, setColour] = useState<[number, number, number] | null>(null); const [tol, setTol] = useState(35); const [name, setName] = useState("seal"); const [result, setResult] = useState<File | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const out = colour ? trimTransparent(keepColour(src, colour, tol)) : null;
  const pick = (e: React.MouseEvent) => { const r = img.current!.getBoundingClientRect(); const x = Math.round(((e.clientX - r.left) / r.width) * src.width), y = Math.round(((e.clientY - r.top) / r.height) * src.height); const d = ctx2d(src).getImageData(x, y, 1, 1).data; setColour([d[0], d[1], d[2]]); setResult(null); };
  return (
    <div className="card !p-3 space-y-3">
      <p className="text-sm text-slate-600">Tap the stamp&apos;s ink in the picture.</p>
      <div className="grid gap-3 sm:grid-cols-2"><img ref={img} src={src.toDataURL("image/jpeg", 0.85)} alt="Tap the ink" onClick={pick} className="w-full rounded border border-slate-200 cursor-crosshair" />
        <div className="rounded-lg border border-slate-200 p-2 flex items-center justify-center" style={checker}>{out ? <img src={out.toDataURL()} alt="Seal" className="max-h-64" /> : <span className="text-sm text-slate-400">The result shows here</span>}</div></div>
      {colour && <label className="text-sm flex items-center gap-2"><span className="h-5 w-5 rounded" style={{ background: `rgb(${colour.join(",")})` }} />How much to keep<input type="range" min={10} max={80} value={tol} onChange={(e) => { setTol(+e.target.value); setResult(null); }} className="flex-1" /></label>}
      <div className="flex flex-wrap items-center gap-2"><NameBox value={name} onChange={setName} ext="png" /><button type="button" className="btn" onClick={onBack}>Crop again</button><button type="button" className="btn btn-primary sm:ml-auto" disabled={!out} onClick={async () => out && setResult(await pngFile(out, name))}>Make PNG</button></div>
      <Result file={result} onClear={() => setResult(null)} /></div>);
}

/** Tap-to-remove with a brush: transparent PNG, or (white) the background filled white for a passport photo. */
export function Background({ src, white, onBack, onDone }: { src: HTMLCanvasElement; white?: boolean; onBack: () => void; onDone?: (c: HTMLCanvasElement) => void }) {
  const work = useRef<HTMLCanvasElement>(cloneCanvas(src)); const view = useRef<HTMLCanvasElement>(null); const history = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<"tap" | "erase" | "restore">("tap"); const [tol, setTol] = useState(28); const [size, setSize] = useState(24); const [everywhere, setEverywhere] = useState(false);
  const [tick, setTick] = useState(0); const [name, setName] = useState("no background"); const [result, setResult] = useState<File | null>(null); const painting = useRef(false);
  useEffect(() => { const v = view.current; if (!v) return; v.width = work.current.width; v.height = work.current.height; const x = ctx2d(v); x.clearRect(0, 0, v.width, v.height); if (white) { x.fillStyle = "#fff"; x.fillRect(0, 0, v.width, v.height); } x.drawImage(work.current, 0, 0); }, [tick, white]);
  const snap = () => { history.current.push(ctx2d(work.current).getImageData(0, 0, work.current.width, work.current.height)); if (history.current.length > 15) history.current.shift(); };
  const at = (e: React.PointerEvent) => { const r = view.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * work.current.width, y: ((e.clientY - r.top) / r.height) * work.current.height, k: work.current.width / r.width }; };
  const down = (e: React.PointerEvent) => { const p = at(e); snap(); setResult(null); if (tool === "tap") { floodErase(work.current, p.x, p.y, tol, everywhere); setTick((n) => n + 1); return; } painting.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); brush(work.current, src, p.x, p.y, size * p.k, tool); setTick((n) => n + 1); };
  const move = (e: React.PointerEvent) => { if (!painting.current) return; const p = at(e); brush(work.current, src, p.x, p.y, size * p.k, tool === "tap" ? "erase" : tool); setTick((n) => n + 1); };
  const final = () => (white ? fillBehind(work.current) : trimTransparent(work.current, 2));
  return (
    <div className="card !p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">{([["tap", "Tap to remove"], ["erase", "Brush: erase"], ["restore", "Brush: bring back"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={tool === k} className={`btn btn-sm ${tool === k ? "!bg-blue-50 !text-blue-800 !border-blue-300" : ""}`} onClick={() => setTool(k)}>{l}</button>)}
        <button type="button" className="btn btn-sm" disabled={!history.current.length} onClick={() => { const h = history.current.pop(); if (h) { ctx2d(work.current).putImageData(h, 0, 0); setTick((n) => n + 1); } }}>Undo</button></div>
      {tool === "tap" ? <div className="flex flex-wrap items-center gap-3 text-sm"><label className="flex items-center gap-2">How similar<input type="range" min={5} max={70} value={tol} onChange={(e) => setTol(+e.target.value)} /></label><label className="flex items-center gap-1"><input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />Same colour everywhere (not only touching)</label></div>
        : <label className="text-sm flex items-center gap-2">Brush size<input type="range" min={4} max={80} value={size} onChange={(e) => setSize(+e.target.value)} /></label>}
      <div className="rounded-lg border border-slate-200 p-2 flex justify-center" style={white ? undefined : checker}><canvas ref={view} className="max-w-full max-h-[60vh] touch-none cursor-crosshair" onPointerDown={down} onPointerMove={move} onPointerUp={() => (painting.current = false)} onPointerCancel={() => (painting.current = false)} /></div>
      <div className="flex flex-wrap items-center gap-2">
        {!onDone && <NameBox value={name} onChange={setName} ext="png" />}<button type="button" className="btn" onClick={onBack}>Back</button>
        {onDone ? <button type="button" className="btn btn-primary sm:ml-auto" onClick={() => onDone(final())}>Done</button> : <button type="button" className="btn btn-primary sm:ml-auto" onClick={async () => setResult(await pngFile(final(), name))}>Make PNG</button>}</div>
      {!onDone && <Result file={result} onClear={() => setResult(null)} />}
      <span className="hidden">{tick}</span>
    </div>);
}
