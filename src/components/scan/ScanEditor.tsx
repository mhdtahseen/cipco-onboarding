"use client";
import { useEffect, useRef, useState } from "react";
import Cropper from "./Cropper";
import { filesToPages, pageCanvas, withPicture, turned, type Page, type PasswordAsk } from "@/lib/scan/pages";
import { fileFrom, isImageFile, isPdfFile, jpegUnder, baseName, shrink } from "@/lib/scan/image";
import { idCardPdf, idCardJpeg, pagesToPdf } from "@/lib/scan/build";
import { scanStrings, type ScanStrings } from "@/lib/scan/strings";

export type ScanMode = "id" | "photo" | "pages";
export type ScanRequest = { files: File[]; mode: ScanMode; accept: string; name: string; lang?: string; maxBytes?: number };
const MAX = 5 * 1024 * 1024;
const acceptsPdf = (accept: string) => !accept || /pdf|\*\/\*/i.test(accept);
const acceptsImage = (accept: string) => !accept || /image|\*\/\*/i.test(accept);

// The editor that opens when a file is picked in any upload box (see ScanProvider). Three modes:
//  - id: an ID card's front and back → one A4 page (photos, a 2-page PDF, a locked e-Aadhaar, or one picture with both sides)
//  - photo: a passport-size photo, cropped to 35 × 45
//  - pages: any document: crop / straighten / clean each photo, reorder, add pages → one PDF (or one JPEG for a single photo)
// Nothing is forced: "Upload as it is" sends the original. onClose(null) = cancelled (nothing is uploaded).
export default function ScanEditor({ req, onClose }: { req: ScanRequest; onClose: (files: File[] | null) => void }) {
  const t = scanStrings(req.lang); const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  const [pw, setPw] = useState<{ name: string; wrong: boolean; resolve: (v: string | null) => void } | null>(null);
  const askPassword: PasswordAsk = (name, wrong) => new Promise((resolve) => setPw({ name, wrong, resolve }));

  // body scroll stays put while the editor is open
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = o; }; }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={t.prepare}>
      <div className="bg-white w-full sm:max-w-2xl max-h-[100dvh] sm:max-h-[94vh] overflow-y-auto sm:rounded-2xl rounded-t-2xl p-4 pb-[max(16px,env(safe-area-inset-bottom))] space-y-3 shadow-2xl">
        <div className="flex items-center gap-2"><h2 className="font-semibold flex-1 truncate">{req.name}</h2><button type="button" className="btn btn-sm" onClick={() => onClose(null)}>{t.cancel}</button></div>
        {err && <p className="warn" role="alert">{err}</p>}
        {busy && <p className="text-sm text-slate-500" role="status">{busy}</p>}
        {pw ? <PasswordBox t={t} name={pw.name} wrong={pw.wrong} onAnswer={(v) => { pw.resolve(v); setPw(null); }} /> : null}
        <div className={pw ? "hidden" : ""}>
          {req.mode === "id" ? <IdFlow req={req} t={t} ask={askPassword} setErr={setErr} setBusy={setBusy} onClose={onClose} />
            : req.mode === "photo" ? <PhotoFlow req={req} t={t} setErr={setErr} onClose={onClose} />
            : <PagesFlow req={req} t={t} ask={askPassword} setErr={setErr} setBusy={setBusy} onClose={onClose} />}
        </div>
      </div>
    </div>);
}

function PasswordBox({ t, name, wrong, onAnswer }: { t: ScanStrings; name: string; wrong: boolean; onAnswer: (v: string | null) => void }) {
  const [v, setV] = useState(""); const [show, setShow] = useState(false);
  return (
    <form className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (v) onAnswer(v); }}>
      <div className="font-medium">🔒 {t.locked}</div><div className="text-xs text-slate-500 truncate">{name}</div>
      {wrong && <p className="text-sm text-red-700">{t.wrongPw}</p>}
      <div className="flex gap-2"><input className="inp flex-1" type={show ? "text" : "password"} autoFocus autoComplete="off" autoCapitalize="characters" aria-label={t.password} placeholder={t.password} value={v} onChange={(e) => setV(e.target.value)} />
        <button type="button" className="btn btn-sm" onClick={() => setShow(!show)} aria-label="Show password">{show ? "🙈" : "👁"}</button></div>
      <p className="text-xs text-slate-600">{t.aadhaarPw}</p>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={!v}>{t.open}</button><button type="button" className="btn" onClick={() => onAnswer(null)}>{t.skip}</button></div>
    </form>);
}

/** A hidden file picker inside the editor (marked so the scanner does not catch it). */
function Picker({ label, onFiles, multiple, camera, accept = "image/*,application/pdf", primary }: { label: string; onFiles: (f: File[]) => void; multiple?: boolean; camera?: boolean; accept?: string; primary?: boolean }) {
  return <label className={`btn ${primary ? "btn-primary" : ""} cursor-pointer`}>{label}<input type="file" data-scan="off" className="hidden" accept={camera ? "image/*" : accept} multiple={multiple} {...(camera ? { capture: "environment" } : {})}
    onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onFiles(f); }} /></label>;
}

// ---------------- ID card: front and back on one page ----------------
type Step = { kind: "start" } | { kind: "pick"; pages: Page[]; want: "front" | "back" } | { kind: "crop"; canvas: HTMLCanvasElement; side: "front" | "back"; then?: "back-same" } | { kind: "which"; canvas: HTMLCanvasElement } | { kind: "asis"; pages: Page[] };
function IdFlow({ req, t, ask, setErr, setBusy, onClose }: { req: ScanRequest; t: ScanStrings; ask: PasswordAsk; setErr: (s: string) => void; setBusy: (s: string) => void; onClose: (f: File[] | null) => void }) {
  const [front, setFront] = useState<HTMLCanvasElement | null>(null); const [back, setBack] = useState<HTMLCanvasElement | null>(null);
  const [step, setStep] = useState<Step>({ kind: "start" }); const [preview, setPreview] = useState(""); const same = useRef<HTMLCanvasElement | null>(null);
  const started = useRef(false); const rest = useRef<Page[] | null>(null);   // a PDF's other pages, offered for the back once the front is done

  // what was picked: photos go to the front then the back; a PDF shows its pages
  async function take(files: File[], side: "front" | "back" | "auto") {
    setErr(""); setBusy(t.working);
    try {
      const { pages } = await filesToPages(files, ask); setBusy("");
      if (!pages.length) return;
      const pdfPages = pages.filter((p) => p.pdf); const pics = pages.filter((p) => !p.pdf);
      if (side === "auto" && pdfPages.length === 1 && !pics.length) { setStep({ kind: "asis", pages }); return; }
      if (pdfPages.length > 1) { setStep({ kind: "pick", pages, want: side === "back" ? "back" : "front" }); return; }
      const c = await pageCanvas(pages[0], 3);
      if (side === "auto" && pages.length >= 2) { same.current = await pageCanvas(pages[1], 3); setStep({ kind: "crop", canvas: c, side: "front" }); return; }
      if (side === "auto") { setStep({ kind: "which", canvas: c }); return; }
      setStep({ kind: "crop", canvas: c, side });
    } catch (e) { setBusy(""); setErr((e as Error).message || t.cantOpen); }
  }
  useEffect(() => { if (!started.current) { started.current = true; void take(req.files, "auto"); } }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { let live = true; if (front) idCardJpeg(front, back).then((b) => { if (live) setPreview(URL.createObjectURL(b)); }); else setPreview(""); return () => { live = false; }; }, [front, back]);

  const cropped = (side: "front" | "back", c: HTMLCanvasElement) => {
    if (side === "front") setFront(c); else setBack(c);
    if (same.current) { const next = same.current; same.current = null; setStep({ kind: "crop", canvas: next, side: side === "front" ? "back" : "front" }); return; }
    if (side === "front" && rest.current?.length && !back) { const r = rest.current; rest.current = null; setStep({ kind: "pick", pages: r, want: "back" }); return; }
    setStep({ kind: "start" });
  };
  async function finish(onlyFront = false) {
    if (!front) return; setBusy(t.working);
    try {
      const name = baseName(req.name);
      if (acceptsPdf(req.accept)) { const bytes = await idCardPdf(front, onlyFront ? null : back, { title: req.name }); onClose([fileFrom(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${name}.pdf`, "application/pdf")]); }
      else onClose([fileFrom(await idCardJpeg(front, onlyFront ? null : back), `${name}.jpg`, "image/jpeg")]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  if (step.kind === "crop") return <Cropper key={step.side + step.canvas.width} src={step.canvas} aspect={85.6 / 54} t={t} title={step.side === "front" ? t.front : t.backSide} onDone={(c) => cropped(step.side, c)} onCancel={() => { same.current = null; setStep({ kind: "start" }); }} />;
  if (step.kind === "which") return (
    <div className="space-y-3"><img src={shrink(step.canvas, 900).toDataURL("image/jpeg", 0.8)} alt="" className="max-h-72 mx-auto rounded-lg" /><p className="text-sm font-medium">{t.thisShows}</p>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" className="btn justify-center" onClick={() => setStep({ kind: "crop", canvas: step.canvas, side: "front" })}>{t.front}</button>
        <button type="button" className="btn justify-center" onClick={() => setStep({ kind: "crop", canvas: step.canvas, side: "back" })}>{t.backSide}</button>
        <button type="button" className="btn justify-center" onClick={() => { same.current = step.canvas; setStep({ kind: "crop", canvas: step.canvas, side: "front" }); }}>{t.both}</button></div></div>);
  if (step.kind === "pick") return (
    <div className="space-y-2"><p className="font-medium">{step.want === "front" ? t.tapFront : t.tapBack}</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">{step.pages.map((p, i) => <button key={p.id} type="button" className="rounded-lg border border-slate-200 p-1 hover:border-blue-500" onClick={async () => {
        const c = await pageCanvas(p, 3);
        if (step.want === "front") { same.current = null; rest.current = step.pages.filter((x) => x.id !== p.id); setStep({ kind: "crop", canvas: c, side: "front" }); }
        else setStep({ kind: "crop", canvas: c, side: "back" });
      }}><img src={p.thumb} alt="" className="w-full" /><div className="text-xs text-slate-500">{i + 1}</div></button>)}</div>
      <button type="button" className="btn btn-sm" onClick={() => setStep({ kind: "start" })}>{t.back}</button></div>);
  if (step.kind === "asis") return (
    <div className="space-y-3"><img src={step.pages[0].thumb} alt="" className="max-h-80 mx-auto rounded-lg border border-slate-200" />
      <div className="grid gap-2 sm:grid-cols-2">
        {!step.pages[0].pdf?.src.locked && <button type="button" className="btn btn-primary justify-center" onClick={() => onClose(req.files)}>{t.looksRight}</button>}
        <button type="button" className={`btn justify-center ${step.pages[0].pdf?.src.locked ? "btn-primary" : ""}`} onClick={async () => { const c = await pageCanvas(step.pages[0], 3.5); same.current = c; setStep({ kind: "crop", canvas: c, side: "front" }); }}>{t.markBoth}</button></div></div>);

  // start: the two slots and the preview
  return <IdSlots t={t} front={front} back={back} preview={preview} onAdd={(side, f) => take(f, side)} onRedo={(side) => { if (side === "front") setFront(null); else setBack(null); }} onFinish={finish} />;
}

function IdSlots({ t, front, back, preview, onAdd, onRedo, onFinish }: { t: ScanStrings; front: HTMLCanvasElement | null; back: HTMLCanvasElement | null; preview: string; onAdd: (side: "front" | "back", f: File[]) => void; onRedo: (side: "front" | "back") => void; onFinish: (onlyFront?: boolean) => void }) {
  const slot = (side: "front" | "back", c: HTMLCanvasElement | null) => (
    <div className="rounded-xl border border-dashed border-slate-300 p-3 space-y-2 text-center">
      <div className="text-sm font-medium">{side === "front" ? t.front : t.backSide}</div>
      {c ? <><img src={shrink(c, 500).toDataURL("image/jpeg", 0.8)} alt="" className="mx-auto max-h-28 rounded" /><button type="button" className="tlink" onClick={() => onRedo(side)}>{t.remove}</button></>
        : <div className="flex flex-wrap justify-center gap-2"><Picker label={side === "front" ? t.addFront : t.addBack} onFiles={(f) => onAdd(side, f)} primary /><Picker label={`📷 ${t.camera}`} camera onFiles={(f) => onAdd(side, f)} /></div>}
    </div>);
  return (
    <div className="space-y-3"><p className="text-sm text-slate-600">{t.idHint}</p>
      <div className="grid gap-2 sm:grid-cols-2">{slot("front", front)}{slot("back", back)}</div>
      {preview && <img src={preview} alt="" className="mx-auto max-h-96 rounded-lg border border-slate-200 shadow-sm" />}
      <button type="button" className="btn btn-primary w-full justify-center" disabled={!front || !back} onClick={() => onFinish(false)}>{t.useThis}</button>
      {front && !back && <button type="button" className="tlink" onClick={() => onFinish(true)}>{t.onlyFront}</button>}
    </div>);
}

// ---------------- passport photo ----------------
function PhotoFlow({ req, t, setErr, onClose }: { req: ScanRequest; t: ScanStrings; setErr: (s: string) => void; onClose: (f: File[] | null) => void }) {
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => { (async () => { try { const f = req.files[0]; if (!isImageFile(f)) { onClose(req.files); return; } const { pages } = await filesToPages([f], async () => null); setSrc(await pageCanvas(pages[0])); } catch (e) { setErr((e as Error).message || t.cantOpen); } })(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!src) return <p className="text-sm text-slate-500">{t.working}</p>;
  return (
    <div className="space-y-2"><button type="button" className="btn btn-sm" onClick={() => onClose(req.files)}>{t.asIs}</button>
      <Cropper src={src} aspect={35 / 45} t={t} hint={t.photoHint} showLooks={false} onCancel={() => onClose(null)}
        onDone={async (c) => onClose([fileFrom(await jpegUnder(c, 900 * 1024), `${baseName(req.name)}.jpg`, "image/jpeg")])} /></div>);
}

// ---------------- any document: pages ----------------
function PagesFlow({ req, t, ask, setErr, setBusy, onClose }: { req: ScanRequest; t: ScanStrings; ask: PasswordAsk; setErr: (s: string) => void; setBusy: (s: string) => void; onClose: (f: File[] | null) => void }) {
  const [pages, setPages] = useState<Page[]>([]); const [editing, setEditing] = useState<{ id: string; canvas: HTMLCanvasElement } | null>(null); const [touched, setTouched] = useState(false);
  const started = useRef(false);
  async function add(files: File[], first = false) {
    setErr(""); setBusy(t.working);
    try {
      const { pages: more } = await filesToPages(files, ask); setBusy(""); setPages((p) => [...p, ...more]); if (!first) setTouched(true);
      // a single photo opens straight in the cropper
      if (first && more.length === 1 && !more[0].pdf) setEditing({ id: more[0].id, canvas: await pageCanvas(more[0]) });
    } catch (e) { setBusy(""); setErr((e as Error).message || t.cantOpen); }
  }
  useEffect(() => { if (!started.current) { started.current = true; void add(req.files, true); } }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const move = (i: number, d: number) => { setTouched(true); setPages((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; }); };

  async function save() {
    if (!pages.length) return; setBusy(t.working); setErr("");
    try {
      const name = baseName(req.name); const max = req.maxBytes ?? MAX;
      const onePicture = pages.length === 1 && !pages[0].pdf;
      if ((onePicture && acceptsImage(req.accept)) || !acceptsPdf(req.accept)) {
        if (pages.length > 1) { setErr("This upload takes one picture only: keep one page."); return; }
        onClose([fileFrom(await jpegUnder(await pageCanvas(pages[0]), Math.min(max, 1.5 * 1024 * 1024)), `${name}.jpg`, "image/jpeg")]); return;
      }
      let bytes = await pagesToPdf(pages, { quality: "normal" });
      if (bytes.length > max) bytes = await pagesToPdf(pages, { quality: "small", redraw: true });
      if (bytes.length > max) { setErr(t.tooBig); return; }
      onClose([fileFrom(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${name}.pdf`, "application/pdf")]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  if (editing) return <Cropper key={editing.id} src={editing.canvas} t={t} initialLook="scan" onCancel={() => setEditing(null)}
    onDone={(c) => { setTouched(true); setPages((ps) => ps.map((p) => (p.id === editing.id ? withPicture(p, c) : p))); setEditing(null); }} />;
  const original = req.files.length === 1 && !touched;
  const lockedOriginal = pages.some((p) => p.pdf?.src.locked);
  return (
    <div className="space-y-3">
      {original && !lockedOriginal && (isPdfFile(req.files[0]) ? req.files[0].size <= (req.maxBytes ?? MAX) : true) && <button type="button" className="btn w-full justify-center" onClick={() => onClose(req.files)}>{t.asIs}</button>}
      <div className="text-sm font-medium">{t.pages} ({pages.length})</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{pages.map((p, i) => (
        <div key={p.id} className="rounded-xl border border-slate-200 p-1.5 space-y-1">
          <div className="relative bg-slate-50 rounded flex items-center justify-center h-36 overflow-hidden"><img src={p.thumb} alt={`${i + 1}`} className="max-h-36 max-w-full" style={{ transform: `rotate(${p.rotation}deg)` }} /><span className="absolute top-1 left-1 text-[10px] bg-white/90 rounded px-1">{i + 1}</span></div>
          <div className="flex flex-wrap gap-1 justify-center">
            <button type="button" className="btn btn-sm !px-2" onClick={async () => setEditing({ id: p.id, canvas: await pageCanvas(p) })}>{t.crop}</button>
            <button type="button" className="btn btn-sm !px-2" aria-label={t.rotate} onClick={() => { setTouched(true); setPages((ps) => ps.map((x) => (x.id === p.id ? turned(x, 90) : x))); }}>↻</button>
            <button type="button" className="btn btn-sm !px-2" aria-label="Move left" disabled={i === 0} onClick={() => move(i, -1)}>←</button>
            <button type="button" className="btn btn-sm !px-2" aria-label="Move right" disabled={i === pages.length - 1} onClick={() => move(i, 1)}>→</button>
            <button type="button" className="btn btn-sm !px-2 btn-danger" aria-label={t.remove} onClick={() => { setTouched(true); setPages((ps) => ps.filter((x) => x.id !== p.id)); }}>✕</button>
          </div></div>))}</div>
      <div className="flex flex-wrap gap-2"><Picker label={`+ ${t.addPage}`} multiple onFiles={(f) => add(f)} /><Picker label={`📷 ${t.camera}`} camera onFiles={(f) => add(f)} /></div>
      <button type="button" className="btn btn-primary w-full justify-center" disabled={!pages.length} onClick={save}>{t.useThis}</button>
    </div>);
}
