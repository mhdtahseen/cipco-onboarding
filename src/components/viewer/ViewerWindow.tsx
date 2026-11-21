"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isStored, type ViewFile } from "@/lib/viewer";
import { canShareFiles, saveOrShare } from "@/lib/scan/image";
import { pdfjs, type PdfDoc } from "@/lib/scan/pdf";

// The viewer's window (loaded the first time a file is opened, see FileViewer.tsx): images, PDFs drawn with pdf.js, previous / next, zoom, rotate,
// download, share. Its colours are fixed (not the theme's), so it looks the same in light and dark mode.
type Loaded =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "image"; url: string; name: string; blob?: Blob; meta?: Meta }
  | { state: "pdf"; bytes: Uint8Array; name: string; blob: Blob }
  | { state: "other"; name: string; reason: "type" | "big" };
type Meta = { url: string; raw: string; name: string; type: string };

const fileName = (cd: string | null, fallback: string) => { const m = cd && (/filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1]); try { return m ? decodeURIComponent(m) : fallback; } catch { return m || fallback; } };
const guessName = (src: string) => { try { const u = new URL(src, location.href); const p = u.searchParams.get("path"); return (p ? p.split("/").pop()!.replace(/^\d{10,}-/, "") : u.pathname.split("/").filter(Boolean).slice(-2).join(" ")) || "file"; } catch { return "file"; } };

// Read one file: where it is (stored files ask their route), then its bytes when they are needed (PDFs; images only show from the link).
async function resolve(f: ViewFile): Promise<Loaded> {
  if (f.src.startsWith("blob:") || f.src.startsWith("data:")) {
    const blob = await (await fetch(f.src)).blob(); const name = f.name || "document";
    if (f.kind === "pdf" || blob.type === "application/pdf") return { state: "pdf", bytes: new Uint8Array(await blob.arrayBuffer()), name, blob };
    if (blob.type.startsWith("image/") || f.kind === "image") return { state: "image", url: f.src, name, blob };
    return { state: "other", name, reason: "type" };
  }
  const u = new URL(f.src, location.href);
  if (isStored(u)) {
    const mu = new URL(u); mu.searchParams.set("meta", "1");
    const r = await fetch(mu); if (!r.ok) return { state: "error", message: r.status === 403 ? "You do not have access to this file." : r.status === 404 ? "This file could not be found." : (await r.text()).slice(0, 200) || "This file could not be opened." };
    const meta = await r.json() as Meta; const name = f.name ? `${f.name}${/\.[a-z0-9]{2,4}$/i.test(f.name) ? "" : meta.name.match(/\.[a-z0-9]{2,4}$/i)?.[0] ?? ""}` : meta.name;
    if (meta.type.startsWith("image/") && meta.type !== "image/heic") return { state: "image", url: meta.url, name, meta };
    if (meta.type !== "application/pdf") return { state: "other", name, reason: "type" };
    const blob = await getBytes(meta); if (!blob) return { state: "other", name, reason: "big" };
    return { state: "pdf", bytes: new Uint8Array(await blob.arrayBuffer()), name, blob };
  }
  const r = await fetch(u); if (!r.ok) return { state: "error", message: (await r.text()).slice(0, 200) || "This file could not be opened." };
  const type = r.headers.get("content-type") || ""; const name = f.name || fileName(r.headers.get("content-disposition"), guessName(f.src)); const blob = await r.blob();
  if (type.includes("pdf")) return { state: "pdf", bytes: new Uint8Array(await blob.arrayBuffer()), name, blob };
  if (type.startsWith("image/")) return { state: "image", url: URL.createObjectURL(blob), name, blob };
  return { state: "other", name, reason: "type" };
}
// a stored file's bytes: straight from storage (if the bucket allows this site), else through the app (up to about 4.4 MB)
async function getBytes(meta: Meta): Promise<Blob | null> {
  try { const r = await fetch(meta.url); if (r.ok) return await r.blob(); } catch { /* storage refuses this site (no CORS rule): go through the app */ }
  try { const r = await fetch(meta.raw); if (r.ok) return await r.blob(); } catch { /* offline */ }
  return null;
}

export default function Viewer({ files, index, setIndex, onClose }: { files: ViewFile[]; index: number; setIndex: (i: number) => void; onClose: () => void }) {
  const file = files[index]; const many = files.length > 1;
  const [got, setGot] = useState<Loaded>({ state: "loading" }); const [zoom, setZoom] = useState(1); const [rot, setRot] = useState(0); const [note, setNote] = useState("");
  const box = useRef<HTMLDivElement>(null); const closeBtn = useRef<HTMLButtonElement>(null); const touch = useRef<number | null>(null);
  const go = useCallback((d: number) => { if (many) setIndex((index + d + files.length) % files.length); }, [many, index, files.length, setIndex]);

  useEffect(() => {
    let live = true; setGot({ state: "loading" }); setZoom(1); setRot(0);
    resolve(file).then((x) => { if (live) setGot(x); }).catch(() => { if (live) setGot({ state: "error", message: "This file could not be opened. Check your internet and try again." }); });
    return () => { live = false; };
  }, [file]);
  useEffect(() => () => { if (got.state === "image" && got.url.startsWith("blob:") && !file.src.startsWith("blob:")) URL.revokeObjectURL(got.url); }, [got, file.src]);

  // keyboard: Esc, arrows, + / -, focus kept inside; the page behind does not scroll
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null; closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" && many) go(1); else if (e.key === "ArrowLeft" && many) go(-1);
      else if ((e.key === "+" || e.key === "=") && !(e.target instanceof HTMLInputElement)) setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
      else if (e.key === "-" && !(e.target instanceof HTMLInputElement)) setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));
      else if (e.key === "Tab" && box.current) {
        const f = Array.from(box.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input")); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey); const ov = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ov; prev?.focus?.(); };
  }, [go, many, onClose]);

  async function keep(share: boolean) {
    setNote("");
    let blob: Blob | null = got.state === "pdf" ? got.blob : got.state === "image" ? got.blob ?? null : null;
    if (!blob && got.state === "image" && got.meta) { blob = await getBytes(got.meta); if (blob && got.state === "image") got.blob = blob; }
    if (!blob) { window.open(file.src, "_blank", "noopener"); return; }   // the browser could not read it here: let the new tab handle it
    const name = got.state === "pdf" || got.state === "image" ? got.name : "file";
    const r = await saveOrShare(new File([blob], name, { type: blob.type }), share); if (r === "shared") setNote("Shared ✓");
  }
  const name = got.state === "loading" || got.state === "error" ? file.name || guessName(file.src) : got.name;
  const btn = "inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm text-white/90 hover:bg-white/10 disabled:opacity-40";
  const Ico = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label={name} className="fixed inset-0 z-[90] flex flex-col bg-[#0b1220] text-white" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center gap-1 border-b border-white/10 bg-[#0f172a] px-2 py-1.5 sm:px-3">
        <div className="min-w-0 flex-1 px-1"><div className="truncate text-sm font-medium" title={name}>{name}</div>{many && <div className="text-xs text-white/60">{index + 1} of {files.length}</div>}</div>
        <div className="hidden items-center sm:flex">
          <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out" disabled={got.state !== "pdf" && got.state !== "image"}><Ico d="M5 12h14" /></button>
          <button type="button" className={`${btn} w-14 tabular-nums`} onClick={() => setZoom(1)} aria-label="Fit to screen">{Math.round(zoom * 100)}%</button>
          <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} aria-label="Zoom in" disabled={got.state !== "pdf" && got.state !== "image"}><Ico d="M12 5v14M5 12h14" /></button>
        </div>
        <button type="button" className={btn} onClick={() => setRot((r) => (r + 90) % 360)} aria-label="Rotate" title="Rotate" disabled={got.state !== "pdf" && got.state !== "image"}><Ico d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" /></button>
        <button type="button" className={btn} onClick={() => keep(false)} aria-label="Download" title="Download" disabled={got.state === "loading" || got.state === "error"}><Ico d="M12 3v12M7 10l5 5 5-5M5 21h14" /></button>
        {canShareFiles() && <button type="button" className={btn} onClick={() => keep(true)} aria-label="Share" title="Share" disabled={got.state === "loading" || got.state === "error"}><Ico d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v13" /></button>}
        <a className={`${btn} hidden sm:inline-flex`} href={file.src} target="_blank" rel="noopener" data-viewer="off" aria-label="Open in a new tab" title="Open in a new tab"><Ico d="M14 3h7v7M10 14L21 3M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" /></a>
        <button ref={closeBtn} type="button" className={btn} onClick={onClose} aria-label="Close"><Ico d="M18 6L6 18M6 6l12 12" /></button>
      </div>

      <div className="relative min-h-0 flex-1"
        onTouchStart={(e) => { touch.current = e.touches.length === 1 && zoom === 1 ? e.touches[0].clientX : null; }}
        onTouchEnd={(e) => { const x0 = touch.current; touch.current = null; if (x0 === null || !many) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 70 && got.state === "image") go(dx < 0 ? 1 : -1); }}>
        {got.state === "loading" && <div className="absolute inset-0 grid place-items-center" role="status"><div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" /><span className="sr-only">Opening…</span></div>}
        {got.state === "error" && <Center><p className="max-w-sm text-white/90">{got.message}</p></Center>}
        {got.state === "other" && <Center>
          <p className="max-w-sm text-white/90">{got.reason === "big" ? "This file is too large to show here." : "This kind of file can't be shown here."}</p>
          <a className="mt-3 inline-flex h-11 items-center rounded-lg bg-white px-4 font-medium text-[#0f172a]" href={file.src} target="_blank" rel="noopener" data-viewer="off">Open in a new tab</a></Center>}
        {got.state === "image" && <div className="absolute inset-0 overflow-auto" onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}>
          <div className="flex min-h-full min-w-full items-center justify-center p-3" style={{ width: zoom > 1 ? `${zoom * 100}%` : undefined }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={got.url} alt={name} draggable={false} className={zoom > 1 ? "max-w-none" : "max-h-full max-w-full object-contain"}
              style={{ transform: rot ? `rotate(${rot}deg)` : undefined, width: zoom > 1 ? "100%" : undefined, maxHeight: zoom > 1 ? "none" : "calc(100dvh - 7rem)" }}
              onError={() => setGot({ state: "error", message: "This picture could not be opened." })} />
          </div></div>}
        {got.state === "pdf" && <PdfPages key={file.src} bytes={got.bytes} zoom={zoom} rot={rot} />}

        {many && <>
          <button type="button" className="absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 sm:flex" onClick={() => go(-1)} aria-label="Previous file"><Ico d="M15 18l-6-6 6-6" /></button>
          <button type="button" className="absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70 sm:flex" onClick={() => go(1)} aria-label="Next file"><Ico d="M9 18l6-6-6-6" /></button>
        </>}
      </div>

      {/* phone: zoom and previous / next at the bottom, in thumb reach */}
      <div className="flex items-center justify-center gap-1 border-t border-white/10 bg-[#0f172a] px-2 py-1.5 sm:hidden">
        {many && <button type="button" className={btn} onClick={() => go(-1)} aria-label="Previous file"><Ico d="M15 18l-6-6 6-6" /></button>}
        <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out"><Ico d="M5 12h14" /></button>
        <button type="button" className={`${btn} w-14 tabular-nums`} onClick={() => setZoom(1)} aria-label="Fit to screen">{Math.round(zoom * 100)}%</button>
        <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} aria-label="Zoom in"><Ico d="M12 5v14M5 12h14" /></button>
        {many && <button type="button" className={btn} onClick={() => go(1)} aria-label="Next file"><Ico d="M9 18l6-6-6-6" /></button>}
      </div>
      {note && <p className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-sm text-[#0f172a]" role="status">{note}</p>}
    </div>
  );
}
const Center = ({ children }: { children: React.ReactNode }) => <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">{children}</div>;

// ---------- PDF: every page drawn as it comes into view, sized to the window × zoom ----------
function PdfPages({ bytes, zoom, rot }: { bytes: Uint8Array; zoom: number; rot: number }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null); const [err, setErr] = useState(""); const [need, setNeed] = useState<"" | "ask" | "wrong">(""); const [pw, setPw] = useState("");
  const [width, setWidth] = useState(0); const [page, setPage] = useState(1); const scroller = useRef<HTMLDivElement>(null);
  // each opening replaces the one before; only the newest may show (an older one, cancelled, ends quietly)
  const task = useRef<{ destroy: () => Promise<void> } | null>(null); const seq = useRef(0);
  const openDoc = useCallback(async (password?: string) => {
    const my = ++seq.current;
    try {
      const p = await pdfjs(); if (my !== seq.current) return;
      const t = p.getDocument({ data: bytes.slice(), password }); task.current?.destroy().catch(() => {}); task.current = t;
      const d = await t.promise; if (my !== seq.current) return; setDoc(d); setNeed("");
    } catch (e) { if (my !== seq.current) return; const n = (e as { name?: string }).name; if (n === "PasswordException") setNeed(password ? "wrong" : "ask"); else setErr("This PDF could not be read."); }
  }, [bytes]);
  useEffect(() => { openDoc(); return () => { seq.current++; task.current?.destroy().catch(() => {}); task.current = null; }; }, [openDoc]);   // closing frees the PDF, even mid-drawing
  useEffect(() => {
    const el = scroller.current; if (!el) return; const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el); setWidth(el.clientWidth); return () => ro.disconnect();
  }, [doc]);
  // which page is in view, for the counter
  useEffect(() => {
    const el = scroller.current; if (!el || !doc) return;
    const on = () => { const kids = Array.from(el.querySelectorAll<HTMLElement>("[data-page]")); const mid = el.scrollTop + el.clientHeight / 3; let p = 1; for (const k of kids) if (k.offsetTop <= mid) p = Number(k.dataset.page); setPage(p); };
    el.addEventListener("scroll", on, { passive: true }); return () => el.removeEventListener("scroll", on);
  }, [doc]);

  if (err) return <Center><p className="text-white/90">{err}</p></Center>;
  if (need) return <Center><form className="w-full max-w-xs space-y-2 text-left" onSubmit={(e) => { e.preventDefault(); if (pw) openDoc(pw); }}>
    <p className="font-medium">This PDF is locked</p>{need === "wrong" && <p className="text-sm text-rose-300">That password is not right.</p>}
    <input className="h-11 w-full rounded-lg border border-white/20 bg-white/10 px-3 text-white placeholder-white/40" type="text" autoComplete="off" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="PDF password" />
    <button className="h-11 w-full rounded-lg bg-white font-medium text-[#0f172a]" disabled={!pw}>Open</button>
    <p className="text-xs text-white/60">e-Aadhaar: first 4 letters of the name in CAPITALS + year of birth (e.g. RAME1990).</p></form></Center>;
  if (!doc) return <div className="absolute inset-0 grid place-items-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" /></div>;
  const w = Math.max(200, Math.min(width - 24, 880)) * zoom;   // 100% = the window's width, up to a comfortable reading width on big screens
  return <>
    <div ref={scroller} className="absolute inset-0 overflow-auto"><div className="mx-auto space-y-3 py-3" style={{ width: w }}>
      {Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} width={w} rot={rot} root={scroller} />)}</div></div>
    {doc.numPages > 1 && <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs tabular-nums" aria-live="polite">Page {page} of {doc.numPages}</div>}
  </>;
}
function PdfPage({ doc, n, width, rot, root }: { doc: PdfDoc; n: number; width: number; rot: number; root: React.RefObject<HTMLDivElement | null> }) {
  const holder = useRef<HTMLDivElement>(null); const [ratio, setRatio] = useState(1.414); const [seen, setSeen] = useState(n <= 2);
  useEffect(() => { let live = true; doc.getPage(n).then((p) => { const vp = p.getViewport({ scale: 1, rotation: (p.rotate + rot) % 360 }); if (live) setRatio(vp.height / vp.width); }); return () => { live = false; }; }, [doc, n, rot]);
  useEffect(() => {
    if (seen || !holder.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { root: root.current, rootMargin: "600px 0px" });
    io.observe(holder.current); return () => io.disconnect();
  }, [seen, root]);
  useEffect(() => {
    if (!seen || !holder.current) return; let live = true; let task: { cancel: () => void } | null = null;
    (async () => {
      const p = await doc.getPage(n); const base = p.getViewport({ scale: 1, rotation: (p.rotate + rot) % 360 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2); const vp = p.getViewport({ scale: (width / base.width) * dpr, rotation: (p.rotate + rot) % 360 });
      const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height); c.style.width = "100%"; c.style.height = "auto"; c.style.display = "block";
      const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
      const t = p.render({ canvasContext: x, viewport: vp, canvas: c } as Parameters<typeof p.render>[0]); task = t;
      try { await t.promise; } catch { return; }
      if (live && holder.current) holder.current.replaceChildren(c);
    })();
    return () => { live = false; task?.cancel(); };
  }, [seen, doc, n, width, rot]);
  return <div ref={holder} data-page={n} className="overflow-hidden rounded bg-white shadow-lg" style={{ width, minHeight: width * ratio }} aria-label={`Page ${n}`} />;
}
