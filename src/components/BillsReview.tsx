"use client";
import { useEffect, useState } from "react";
import { billFileName, type BillRow } from "@/lib/billsData";

// Review mode for Expenses → Bills: one bill at a time, full screen, next to its details. Next / Previous with the buttons or the ← → keys, Esc closes.
// rows are the bills on show (with a file), in the order the list shows them.
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
export const billUrl = (r: BillRow, dl = false) => `/api/bills/file?src=${r.src}&id=${r.id}${dl ? `&dl=1&name=${encodeURIComponent(billFileName(r))}` : ""}`;
export const isImage = (ext: string) => ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
const svg = (d: React.ReactNode) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;

export default function BillsReview({ rows, start, onClose, dupNote }: { rows: BillRow[]; start: number; onClose: () => void; dupNote: (r: BillRow) => string }) {
  const [i, setI] = useState(Math.min(Math.max(0, start), rows.length - 1));
  const r = rows[i]; const prev = () => setI((n) => Math.max(0, n - 1)), next = () => setI((n) => Math.min(rows.length - 1, n + 1));
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowLeft") prev(); if (e.key === "ArrowRight") next(); };
    window.addEventListener("keydown", key); const o = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = o; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const n = rows[i + 1]; if (n && isImage(n.ext)) { const im = new Image(); im.src = billUrl(n); } }, [i, rows]);   // the next photo loads while this one is looked at
  if (!r) return null;
  const dup = dupNote(r);
  const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20 disabled:opacity-40";
  return (
    <div role="dialog" aria-modal="true" aria-label={`Bill ${i + 1} of ${rows.length}`} className="fixed inset-0 z-[60] flex flex-col bg-slate-950/95 text-white">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3 border-b border-white/10">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-white/60">{i + 1} of {rows.length}</div>
          <div className="font-semibold truncate">{r.payee || r.section}{r.ref && <span className="font-normal text-white/70"> · #{r.ref}</span>} <span className="tabular-nums">· {inr(r.amount)}</span></div>
          <div className="text-xs text-white/70 truncate">{dmy(r.date)} · {r.section} · {r.kind}{r.project ? ` · ${r.project}` : ""}{r.covers.length ? ` · covers ${r.covers.join(", ")}` : ""}{r.note ? ` · ${r.note}` : ""}</div>
          {dup && <div className="text-xs text-amber-300 mt-0.5">Possible duplicate: {dup}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <a className={btn} href={billUrl(r, true)} title="Download this bill" aria-label="Download this bill">{svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>)}</a>
          <a className={btn} href={billUrl(r)} target="_blank" rel="noreferrer" data-viewer="off" title="Open in a new tab" aria-label="Open in a new tab">{svg(<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></>)}</a>
          <a className={btn} href={r.go} title={`Go to the entry in ${r.section.split(" · ")[0]}`} aria-label="Go to the entry">{svg(<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>)}</a>
          <button className={btn} onClick={onClose} title="Close (Esc)" aria-label="Close">{svg(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>)}</button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center p-2 sm:p-4">
        {isImage(r.ext) ? <img key={r.key} src={billUrl(r)} alt={`Bill from ${r.payee}`} className="max-h-full max-w-full object-contain rounded" />
          : r.ext === "pdf" ? <iframe key={r.key} src={billUrl(r)} title={`Bill from ${r.payee}`} className="w-full h-full rounded bg-white" />
          : <p className="text-white/70 text-sm">This file cannot be shown here. Use Download or Open.</p>}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-white/10">
        <button className={btn} onClick={prev} disabled={i === 0} aria-label="Previous bill">{svg(<path d="m15 18-6-6 6-6" />)} Previous</button>
        <span className="hidden sm:block text-xs text-white/50">← → to move, Esc to close</span>
        <button className={btn} onClick={next} disabled={i === rows.length - 1} aria-label="Next bill">Next {svg(<path d="m9 18 6-6-6-6" />)}</button>
      </div>
    </div>
  );
}
