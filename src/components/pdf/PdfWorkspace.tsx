"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Cropper from "@/components/scan/Cropper";
import MarkupTool from "./MarkupTool";
import ImageTools, { type Tool as PhotoTool } from "./ImageTools";
import { DropZone, NameBox, Result, kb, pdfFile, usePasswordPrompt } from "./common";
import { filesToPages, pageCanvas, pictureOf, turned, withPicture, uid, type Page } from "@/lib/scan/pages";
import { pagesToJpegs, pagesToPdf, pagesToPdfUnder, zipOf, type Quality } from "@/lib/scan/build";
import { baseName, canShareFiles, ctx2d, isImageFile, isPdfFile, newCanvas, saveOrShare } from "@/lib/scan/image";
import { asFile, clearLibrary, deleteSaved, listLibrary, onLibraryChange, renameSaved, type SavedFile } from "@/lib/scan/library";
import { scanStrings } from "@/lib/scan/strings";
import { openScanner } from "@/components/scan/ScanProvider";

const t = scanStrings("en");
type Intent = "merge" | "id" | "compress" | "sign" | "redact" | "scan" | "unlock" | PhotoTool;
type Mode = null | { kind: "crop"; id: string; canvas: HTMLCanvasElement } | { kind: "sign" | "redact"; startId?: string } | { kind: "photo"; tool: PhotoTool; canvas: HTMLCanvasElement };
type Form = "pdf" | "each" | "images";
type Size = "orig" | "target" | Quality;

// What you can come here to do, in plain words. A tile opens the file picker and then takes you straight to that job; the same jobs are on the
// toolbar once files are open, so you can also just add files first and decide afterwards.
const TILES: [Intent, string, string, string][] = [
  ["id", "🪪", "ID card on one page", "Aadhaar, PAN, licence: front and back together"],
  ["merge", "🗂", "Merge or organise", "Join PDFs and photos, reorder, delete pages"],
  ["compress", "🗜", "Make it smaller", "Under a size limit for a portal or WhatsApp"],
  ["sign", "✍️", "Fill & sign", "Text, date, signature, seal"],
  ["redact", "⬛", "Black out details", "Hide numbers for good"],
  ["scan", "📄", "Scan to PDF", "Photos of papers, cropped and cleaned"],
  ["unlock", "🔓", "Unlock a PDF", "Save a copy without the password"],
  ["passport", "🧑", "Passport photo", "3.5 × 4.5 cm, single or a print sheet"],
  ["signature", "🖊", "Transparent signature or seal", "From a photo, paper removed"],
];

// PDF & scan (/pdf, Admin): the office's own iLovePDF. You add files once; their pages stay on screen and every job works on them, one after
// another (merge, then sign, then make smaller…), with one Save at the end. Files are opened and saved on this device only. What is made is
// also kept under Saved (this device) for later.
export default function PdfWorkspace() {
  const [tab, setTab] = useState<"work" | "saved">("work"); const [savedCount, setSavedCount] = useState(0);
  const [pages, setPagesRaw] = useState<Page[]>([]); const history = useRef<Page[][]>([]); const [, bump] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set()); const [mode, setMode] = useState<Mode>(null); const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const [pv, setPv] = useState<number | null>(null); const [dragId, setDragId] = useState<string | null>(null);
  const [result, setResult] = useState<File | null>(null); const [resultNote, setResultNote] = useState("");
  const [name, setName] = useState("document"); const named = useRef(false);
  const [form, setForm] = useState<Form>("pdf"); const [only, setOnly] = useState(false); const [size, setSize] = useState<Size>("orig"); const [target, setTarget] = useState("500"); const [a4, setA4] = useState(false);
  const pw = usePasswordPrompt(); const picker = useRef<HTMLInputElement>(null); const camera = useRef<HTMLInputElement>(null); const intent = useRef<Intent | null>(null); const saveRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const load = () => listLibrary().then((l) => setSavedCount(l.length)).catch(() => {}); load(); return onLibraryChange(load); }, []);

  /** Every change to the pages goes through here, so Undo can take it back. */
  const live = useRef<Page[]>([]); live.current = pages;
  const setPages = (f: (p: Page[]) => Page[]) => { const p = live.current, next = f(p); if (next === p) return; history.current.push(p); if (history.current.length > 40) history.current.shift(); live.current = next; setPagesRaw(next); setResult(null); };
  const undo = () => { const prev = history.current.pop(); if (!prev) return; live.current = prev; setPagesRaw(prev); setSel(new Set()); setResult(null); bump((n) => n + 1); };

  async function add(files: File[], why: Intent | null = null) {
    const ok = files.filter((f) => isPdfFile(f) || isImageFile(f)); if (!ok.length) { setErr("Only PDFs and pictures can be opened here."); return; }
    setErr(""); setBusy(`Opening ${ok.length} file${ok.length === 1 ? "" : "s"}…`);
    try {
      const { pages: more, skipped } = await filesToPages(ok, pw.prompt); if (skipped.length) setErr(`Skipped (no password): ${skipped.join(", ")}`);
      if (!more.length) return;
      if (!named.current) setName(ok.length === 1 ? baseName(ok[0].name) : why === "id" ? "ID card" : "merged");
      setPages((p) => [...p, ...more]); setTab("work");
      // a tile was tapped first: go straight to that job
      if (why === "id") void idCard(more.slice(0, 2));
      else if (why === "sign" || why === "redact") setMode({ kind: why, startId: more[0].id });
      else if (why === "compress") { setSize("target"); setTimeout(() => saveRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }
      else if (why === "scan" && more.length === 1 && !more[0].pdf) setMode({ kind: "crop", id: more[0].id, canvas: await pageCanvas(more[0]) });
      else if (why === "passport" || why === "signature" || why === "seal" || why === "background" || why === "portal") setMode({ kind: "photo", tool: why, canvas: await pageCanvas(more[0], 3) });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  const pick = (why: Intent | null, cam = false) => { intent.current = why; (cam ? camera : picker).current?.click(); };
  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void add(f, intent.current); intent.current = null; };

  // paste a screenshot; Ctrl+Z; Delete; Esc
  useEffect(() => {
    const paste = (e: ClipboardEvent) => { const f = Array.from(e.clipboardData?.files ?? []); if (f.length && tab === "work" && !mode) { e.preventDefault(); void add(f); } };
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement; if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || mode || tab !== "work") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel.size) { e.preventDefault(); remove(); }
      else if (e.key === "Escape") { if (pv !== null) setPv(null); else setSel(new Set()); }
    };
    window.addEventListener("paste", paste); window.addEventListener("keydown", key); return () => { window.removeEventListener("paste", paste); window.removeEventListener("keydown", key); };
  });

  // ---------- what the toolbar acts on: the ticked pages, or all of them when none is ticked ----------
  const picked = pages.filter((p) => sel.has(p.id)); const targets = picked.length ? picked : pages; const one = picked.length === 1 ? picked[0] : pages.length === 1 ? pages[0] : null;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const rotate = () => { const ids = new Set(targets.map((p) => p.id)); setPages((ps) => ps.map((p) => (ids.has(p.id) ? turned(p, 90) : p))); };
  const remove = () => { if (!picked.length) return; setPages((ps) => ps.filter((p) => !sel.has(p.id))); setSel(new Set()); };
  const duplicate = () => { if (!picked.length) return; setPages((ps) => ps.flatMap((p) => (sel.has(p.id) ? [p, { ...p, id: uid() }] : [p]))); };
  const move = (d: number) => { if (!one) return; setPages((ps) => { const i = ps.findIndex((p) => p.id === one.id), j = i + d; if (j < 0 || j >= ps.length) return ps; const n = [...ps]; [n[i], n[j]] = [n[j], n[i]]; return n; }); };
  const dropOn = (targetId: string) => { if (!dragId || dragId === targetId) return; setPages((p) => { const from = p.findIndex((x) => x.id === dragId), to = p.findIndex((x) => x.id === targetId); const n = [...p]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; }); setDragId(null); };
  const blank = () => { const c = newCanvas(1240, 1754); const x = ctx2d(c); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); setPages((p) => [...p, pictureOf(c, "Blank page")]); };
  const crop = async () => { if (one) setMode({ kind: "crop", id: one.id, canvas: await pageCanvas(one) }); };
  const photo = async (tool: PhotoTool) => { if (one) setMode({ kind: "photo", tool, canvas: await pageCanvas(one, 3) }); };

  /** Front and back (the two ticked pages, or a one- or two-page document) onto one A4 page, which replaces them. */
  async function idCard(use?: Page[]) {
    const src = use ?? (picked.length ? picked : pages); if (!src.length || src.length > 2) { setErr("Tick the front and the back (one or two pages) first."); return; }
    setErr(""); setBusy("Preparing…");
    try {
      const blobs = await pagesToJpegs(src, "high"); setBusy("");
      const out = await openScanner({ files: blobs.map((b, i) => new File([b], `side-${i + 1}.jpg`, { type: "image/jpeg" })), mode: "id", accept: "application/pdf", name: named.current ? name : "ID card", lang: "en", maxBytes: 50 * 1024 * 1024 });
      if (!out?.[0]) return;
      const { pages: made } = await filesToPages([out[0]], pw.prompt); const ids = new Set(src.map((p) => p.id));
      setPages((ps) => { const at = Math.max(0, ps.findIndex((p) => ids.has(p.id))); const rest = ps.filter((p) => !ids.has(p.id)); rest.splice(Math.min(at, rest.length), 0, ...made); return rest; }); setSel(new Set()); if (!named.current) setName("ID card");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  // ---------- save ----------
  async function make() {
    const list = only && picked.length ? picked : pages; if (!list.length) return; setErr(""); setResult(null); setResultNote(""); setBusy("Making the file…");
    try {
      const base = name.trim() || "document"; const fit = a4 ? "a4" as const : "fit" as const;
      if (form === "pdf") {
        if (size === "target") { const max = Math.max(20, parseFloat(target) || 500) * 1024; const r = await pagesToPdfUnder(list, max, { size: fit }); setResult(pdfFile(r.bytes, base)); setResultNote(!r.fits ? "Could not get under that size even at the lowest quality: remove pages or raise the limit." : r.redrawn ? "Pages were redrawn as pictures to fit: text in it can no longer be selected." : "Already under that size: nothing was changed."); }
        else if (size === "orig") setResult(pdfFile(await pagesToPdf(list, { size: fit }), base));
        else { setResult(pdfFile(await pagesToPdf(list, { size: fit, quality: size, redraw: true }), base)); setResultNote("Pages were redrawn as pictures to make them smaller: text in it can no longer be selected."); }
      } else if (form === "each") { const files = []; for (let i = 0; i < list.length; i++) files.push({ name: `${base} - page ${i + 1}.pdf`, data: await pagesToPdf([list[i]], { size: fit }) }); setResult(new File([await zipOf(files)], `${base} - pages.zip`, { type: "application/zip" })); }
      else { const jpgs = await pagesToJpegs(list, size === "orig" || size === "target" ? "normal" : size); setResult(jpgs.length === 1 ? new File([jpgs[0]], `${base}.jpg`, { type: "image/jpeg" }) : new File([await zipOf(jpgs.map((b, i) => ({ name: `${base} - page ${i + 1}.jpg`, data: b })))], `${base} - pictures.zip`, { type: "application/zip" })); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  // ---------- suggestions: what fits these files ----------
  const hints = useMemo(() => {
    const h: { text: string; go?: () => void; label?: string }[] = [];
    const locked = pages.some((p) => p.pdf?.src.locked), sources = new Set(pages.map((p) => p.name)).size;
    if (locked) h.push({ text: "🔓 This PDF was locked. Saving makes an unlocked copy." });
    if (pages.length === 2 && pages.every((p) => !p.pdf)) h.push({ text: "Two photos: the front and back of a card?", label: "Put them on one page", go: () => void idCard(pages) });
    if (pages.length === 1 && !pages[0].pdf) h.push({ text: "One photo.", label: "Crop & straighten", go: () => void crop() });
    if (sources > 1) h.push({ text: `${sources} files will be joined in this order. Drag pages to reorder.` });
    return h;
  }, [pages]);   // eslint-disable-line react-hooks/exhaustive-deps

  const B = ({ icon, label, onClick, disabled, title, danger }: { icon: string; label: string; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean }) =>
    <button type="button" className={`btn btn-sm ${danger ? "btn-danger" : ""}`} onClick={onClick} disabled={disabled} title={title}><span aria-hidden>{icon}</span> {label}</button>;
  const head = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="mr-auto"><h1 className="text-xl font-bold">PDF &amp; scan</h1><p className="text-sm text-slate-500">Opened and saved on this device only: nothing is uploaded.</p></div>
      <div role="tablist" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">{([["work", "Workspace"], ["saved", `Saved${savedCount ? ` (${savedCount})` : ""}`]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`px-3 py-1.5 text-sm rounded-md ${tab === k ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    </div>);
  const inputs = <><input ref={picker} type="file" data-scan="off" className="hidden" accept="application/pdf,image/*" multiple onChange={onPicked} /><input ref={camera} type="file" data-scan="off" className="hidden" accept="image/*" capture="environment" onChange={onPicked} /></>;

  if (tab === "saved") return <div className="space-y-4">{head}<SavedTab onOpen={(f) => void add([f])} /></div>;

  // a focused job replaces the page list until it is done
  if (mode?.kind === "crop") return <div className="space-y-4">{head}<div className="card !p-3"><Cropper key={mode.id} src={mode.canvas} t={t} initialLook="scan" onCancel={() => setMode(null)} onDone={(c) => { setPages((ps) => ps.map((p) => (p.id === mode.id ? withPicture(p, c) : p))); setMode(null); }} /></div></div>;
  if (mode?.kind === "sign" || mode?.kind === "redact") return <div className="space-y-4">{head}<MarkupTool key={mode.kind} mode={mode.kind} pages={pages} setPages={setPages} startId={mode.startId} onClose={() => setMode(null)} /></div>;
  if (mode?.kind === "photo") return <div className="space-y-4">{head}<ImageTools source={mode.canvas} tool={mode.tool} onClose={() => setMode(null)} /></div>;

  return (
    <div className="space-y-4">{head}{inputs}{pw.node}
      {err && <p className="warn" role="alert">{err}</p>}{busy && <p className="text-sm text-slate-500" role="status">{busy}</p>}

      {!pages.length ? (
        <DropZone onFiles={(f) => void add(f)}>
          <div className="text-center py-6 space-y-3">
            <div className="text-lg font-semibold">Drop files here, or choose them</div>
            <div className="flex flex-wrap justify-center gap-2"><button type="button" className="btn btn-primary" onClick={() => pick(null)}>Choose PDFs or photos</button><button type="button" className="btn" onClick={() => pick("scan", true)}>📷 Camera</button></div>
            <p className="text-xs text-slate-400">You can also paste a screenshot (Ctrl+V). Add everything once, then decide what to do with it.</p>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Or start from what you want to do</div>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">{TILES.map(([k, icon, l, d]) => <button key={k} type="button" onClick={() => pick(k)} className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-400 hover:bg-blue-50/40"><div className="text-xl" aria-hidden>{icon}</div><div className="text-sm font-semibold">{l}</div><div className="text-xs text-slate-500">{d}</div></button>)}</div>
        </DropZone>
      ) : (<>
        <DropZone onFiles={(f) => void add(f)}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={() => pick(null)}>＋ Add more</button><button type="button" className="btn" onClick={() => pick(null, true)}>📷 Camera</button><button type="button" className="btn" onClick={blank}>＋ Blank page</button>
            <span className="text-sm sm:ml-auto"><b>{pages.length}</b> page{pages.length === 1 ? "" : "s"}{picked.length ? ` · ${picked.length} ticked` : ""}</span>
            <B icon="↶" label="Undo" onClick={undo} disabled={!history.current.length} title="Undo (Ctrl+Z)" />
            <button type="button" className="btn btn-sm" onClick={() => { if (confirm("Remove all the pages and start again?")) { setPages(() => []); setSel(new Set()); named.current = false; setName("document"); } }}>Start again</button>
          </div>
          {hints.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{hints.map((h, i) => <div key={i} className="rounded-lg bg-blue-50 text-blue-900 text-sm px-3 py-1.5 flex items-center gap-2">{h.text}{h.go && <button type="button" className="font-semibold underline" onClick={h.go}>{h.label}</button>}</div>)}</div>}
        </DropZone>

        <div className="card !p-3 space-y-2 sticky top-0 z-20">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 w-full sm:w-auto">{picked.length ? `${picked.length} ticked page${picked.length === 1 ? "" : "s"}:` : "All pages:"}</span>
            <B icon="↻" label="Rotate" onClick={rotate} />
            <B icon="✂" label="Crop & straighten" onClick={crop} disabled={!one} title={one ? "" : "Tick one page"} />
            <B icon="←" label="Earlier" onClick={() => move(-1)} disabled={!one || pages.length < 2} title={one ? "" : "Tick one page"} />
            <B icon="→" label="Later" onClick={() => move(1)} disabled={!one || pages.length < 2} title={one ? "" : "Tick one page"} />
            <B icon="⧉" label="Duplicate" onClick={duplicate} disabled={!picked.length} title="Tick pages first" />
            <B icon="✕" label="Delete" danger onClick={remove} disabled={!picked.length} title="Tick pages first (or press Delete)" />
            {pages.length > 1 && <button type="button" className="text-sm text-blue-700 hover:underline sm:ml-auto" onClick={() => setSel(picked.length === pages.length ? new Set() : new Set(pages.map((p) => p.id)))}>{picked.length === pages.length ? "Untick all" : "Tick all"}</button>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
            <B icon="✍️" label="Fill & sign" onClick={() => setMode({ kind: "sign", startId: one?.id ?? picked[0]?.id })} />
            <B icon="⬛" label="Black out" onClick={() => setMode({ kind: "redact", startId: one?.id ?? picked[0]?.id })} />
            <B icon="🪪" label="ID card on one page" onClick={() => void idCard()} disabled={targets.length > 2} title={targets.length > 2 ? "Tick the front and the back (one or two pages)" : "Front above back, true card size, on one A4 page"} />
            <span className="text-xs text-slate-400 sm:ml-2">From {one ? "this page" : "one ticked page"}:</span>
            <B icon="🧑" label="Passport photo" onClick={() => void photo("passport")} disabled={!one} />
            <B icon="📐" label="Portal size" onClick={() => void photo("portal")} disabled={!one} />
            <B icon="🖊" label="Signature" onClick={() => void photo("signature")} disabled={!one} />
            <B icon="🔵" label="Seal" onClick={() => void photo("seal")} disabled={!one} />
            <B icon="🪄" label="Remove background" onClick={() => void photo("background")} disabled={!one} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{pages.map((p, i) => { const on = sel.has(p.id); return (
          <div key={p.id} draggable onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)} onDragOver={(e) => { if (dragId) e.preventDefault(); }} onDrop={() => dropOn(p.id)}
            className={`group rounded-xl border-2 p-1.5 bg-white ${on ? "border-blue-500 shadow" : "border-slate-200"} ${dragId === p.id ? "opacity-40" : ""}`}>
            <button type="button" aria-pressed={on} aria-label={`Page ${i + 1}${on ? ", ticked" : ""}`} onClick={() => toggle(p.id)} onDoubleClick={() => setPv(i)} className="relative block w-full bg-slate-50 rounded-lg h-44 overflow-hidden cursor-pointer">
              <img src={p.thumb} alt="" draggable={false} className="absolute inset-0 m-auto max-h-full max-w-full" style={{ transform: `rotate(${p.rotation}deg)` }} />
              <span className="absolute top-1.5 left-1.5 text-[11px] font-semibold bg-white/95 rounded px-1.5 py-0.5 shadow-sm">{i + 1}</span>
              <span className={`absolute top-1.5 right-1.5 h-6 w-6 rounded-full grid place-items-center text-xs border-2 ${on ? "bg-blue-600 border-blue-600 text-white" : "bg-white/90 border-slate-300 text-transparent"}`}>✓</span>
              {p.pdf?.src.locked && <span className="absolute bottom-1.5 left-1.5 text-[11px] bg-white/95 rounded px-1">🔓</span>}
            </button>
            <div className="flex items-center gap-1 pt-1"><span className="text-[11px] text-slate-400 truncate flex-1" title={p.name}>{p.name}</span><button type="button" className="text-[11px] text-blue-700 hover:underline shrink-0" onClick={() => setPv(i)}>View</button></div>
          </div>); })}</div>
        <p className="text-xs text-slate-400">Tap a page to tick it; the buttons above then work on the ticked pages. Drag pages to reorder. Double-tap, or View, shows a page full size.</p>

        <div ref={saveRef} className="card !p-3 space-y-3 border-blue-200">
          <div className="font-semibold">Save</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500 w-16">As</span>
            {([["pdf", "One PDF"], ["each", "Each page separately (ZIP)"], ["images", "Pictures (JPEG)"]] as [Form, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={form === k} className={`btn btn-sm ${form === k ? "!bg-blue-50 !text-blue-800 !border-blue-300" : ""}`} onClick={() => { setForm(k); setResult(null); }}>{l}</button>)}
            {picked.length > 0 && <label className="text-sm flex items-center gap-2 sm:ml-2"><input type="checkbox" checked={only} onChange={(e) => { setOnly(e.target.checked); setResult(null); }} />Only the {picked.length} ticked page{picked.length === 1 ? "" : "s"}</label>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500 w-16">Size</span>
            {([["orig", "Best quality"], ["target", "Under a limit"], ["high", "A little smaller"], ["normal", "Smaller"], ["small", "Smallest"]] as [Size, string][]).filter(([k]) => form === "pdf" || k !== "target").map(([k, l]) => <button key={k} type="button" aria-pressed={size === k} className={`btn btn-sm ${size === k ? "!bg-blue-50 !text-blue-800 !border-blue-300" : ""}`} onClick={() => { setSize(k); setResult(null); }}>{l}</button>)}
            {size === "target" && form === "pdf" && <label className="text-sm flex items-center gap-1">under<input className="inp !w-24 !py-1" inputMode="numeric" value={target} onChange={(e) => { setTarget(e.target.value.replace(/[^\d.]/g, "")); setResult(null); }} />KB{[200, 500, 1024, 2048].map((k) => <button key={k} type="button" className="text-xs text-blue-700 hover:underline" onClick={() => { setTarget(String(k)); setResult(null); }}>{k >= 1024 ? `${k / 1024} MB` : `${k} KB`}</button>)}</label>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <NameBox value={name} onChange={(v) => { named.current = true; setName(v); setResult(null); }} ext={form === "pdf" ? "pdf" : form === "each" ? "zip" : (only && picked.length ? picked.length : pages.length) === 1 ? "jpg" : "zip"} />
            {form !== "images" && <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={a4} onChange={(e) => { setA4(e.target.checked); setResult(null); }} />Fit every page on A4</label>}
            <button type="button" className="btn btn-primary sm:ml-auto !px-6" disabled={!!busy} onClick={make}>{busy ? "Working…" : "Make the file"}</button>
          </div>
          <Result file={result} onClear={() => setResult(null)} />
          {result && resultNote && <p className="text-xs text-slate-500">{resultNote}</p>}
        </div>
      </>)}
      {pv !== null && pages[pv] && <Preview pages={pages} index={pv} onIndex={setPv} onClose={() => setPv(null)} />}
    </div>);
}

/** A page at full size, with previous / next. */
function Preview({ pages, index, onIndex, onClose }: { pages: Page[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => { let live = true; setUrl(""); pageCanvas(pages[index], 2).then((c) => { if (live) setUrl(c.toDataURL("image/jpeg", 0.85)); }); return () => { live = false; }; }, [pages, index]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1); if (e.key === "ArrowRight" && index < pages.length - 1) onIndex(index + 1); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); });
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex flex-col" role="dialog" aria-modal="true" aria-label={`Page ${index + 1}`} onClick={onClose}>
      <div className="flex items-center gap-2 p-3 text-white" onClick={(e) => e.stopPropagation()}><span className="flex-1 text-sm truncate">Page {index + 1} of {pages.length} · {pages[index].name}</span>
        <button type="button" className="btn btn-sm" disabled={index === 0} onClick={() => onIndex(index - 1)}>← Previous</button><button type="button" className="btn btn-sm" disabled={index === pages.length - 1} onClick={() => onIndex(index + 1)}>Next →</button><button type="button" className="btn btn-sm" onClick={onClose}>Close</button></div>
      <div className="flex-1 min-h-0 overflow-auto p-3 grid place-items-center">{url ? <img src={url} alt="" className="max-w-full shadow-2xl bg-white" onClick={(e) => e.stopPropagation()} /> : <span className="text-white text-sm">Opening…</span>}</div>
    </div>);
}

/** Everything the tool has made, kept on this device: download or share again, open it in the workspace, rename, delete. */
function SavedTab({ onOpen }: { onOpen: (f: File) => void }) {
  const [list, setList] = useState<SavedFile[] | null>(null); const [q, setQ] = useState(""); const [err, setErr] = useState(""); const [note, setNote] = useState("");
  useEffect(() => { const load = () => listLibrary().then(setList).catch((e) => { setList([]); setErr((e as Error).message || "Saved files are not available in this browser."); }); load(); return onLibraryChange(load); }, []);
  if (!list) return <p className="text-sm text-slate-500">Loading…</p>;
  const shown = list.filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase())); const total = list.reduce((s, f) => s + f.size, 0);
  const when = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const icon = (f: SavedFile) => (f.type === "application/pdf" ? "📄" : f.type.startsWith("image/") ? "🖼" : "🗜");
  const say = (m: string) => { setNote(m); setTimeout(() => setNote(""), 3000); };
  return (
    <div className="space-y-3">
      {err && <p className="warn">{err}</p>}
      <div className="flex flex-wrap items-center gap-2"><input type="search" className="inp !w-64" placeholder="Search saved files" aria-label="Search saved files" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-slate-500 sm:mr-auto">{list.length} file{list.length === 1 ? "" : "s"} · {kb(total)}</span>{note && <span className="text-sm text-green-700">{note}</span>}
        {list.length > 0 && <button type="button" className="btn btn-sm btn-danger" onClick={() => { if (confirm(`Delete all ${list.length} saved files from this device?`)) void clearLibrary(); }}>Delete all</button>}</div>
      <p className="text-xs text-slate-400">Every file made here is kept on this device only (not on other devices, and not in the app). Clearing this browser&apos;s site data removes them.</p>
      {!list.length ? <div className="card !p-6 text-center text-sm text-slate-500">Nothing saved yet. Files you make in the Workspace appear here.</div>
        : !shown.length ? <p className="text-sm text-slate-500">Nothing matches “{q.trim()}”.</p>
        : <div className="card !p-0 divide-y divide-slate-100">{shown.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-2 p-3">
            <span className="text-xl" aria-hidden>{icon(f)}</span>
            <div className="min-w-0 flex-1 basis-48"><div className="font-medium truncate">{f.name}</div><div className="text-xs text-slate-500">{kb(f.size)} · {when(f.created)}</div></div>
            <button type="button" className="btn btn-sm btn-primary" onClick={async () => { await saveOrShare(asFile(f)); say("Downloaded ✓"); }}>Download</button>
            {canShareFiles() && <button type="button" className="btn btn-sm" onClick={() => void saveOrShare(asFile(f), true)}>Share</button>}
            {(f.type === "application/pdf" || f.type.startsWith("image/")) && <button type="button" className="btn btn-sm" onClick={() => onOpen(asFile(f))}>Open in workspace</button>}
            <button type="button" className="btn btn-sm" onClick={() => { const dot = f.name.lastIndexOf("."); const ext = dot > 0 ? f.name.slice(dot) : ""; const v = prompt("New name:", dot > 0 ? f.name.slice(0, dot) : f.name); if (v?.trim()) void renameSaved(f, v.trim().replace(/[\\/:*?"<>|]/g, "") + ext); }}>Rename</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => { if (confirm(`Delete “${f.name}” from this device?`)) void deleteSaved(f.id); }}>Delete</button>
          </div>))}</div>}
    </div>);
}
