"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ScanMode, ScanRequest } from "./ScanEditor";
// the editor (and the PDF writer it brings) downloads only when a file is first picked, so pages stay light
const ScanEditor = dynamic(() => import("./ScanEditor"), { ssr: false, loading: () => <div className="fixed inset-0 z-[100] bg-black/30 grid place-items-center text-white text-sm">Opening…</div> });
import { isImageFile, isPdfFile } from "@/lib/scan/image";

// The upload scanner for the whole app. Mounted once (app/layout.tsx), it catches a file the moment it is picked in ANY <input type="file">,
// opens the editor (crop, straighten, clean, combine; see ScanEditor), and hands the finished file to the page as if it had been picked.
// So every upload box gets it without changing the box. How a box is treated, by data- attributes on its input:
//   data-scan="id" (ID card: front and back on one page) · "photo" (passport photo) · "pages" (any document) · "off" (never)
//   data-scan-name="Aadhaar - Ramesh" (the file name) · the language is the page's <html lang>
// Without data-scan: photos open the editor; PDFs go straight through unless they are locked or over 5 MB; other files (CSV, Word) are never touched.
const MAX = 5 * 1024 * 1024;
type Pending = ScanRequest & { resolve: (f: File[] | null) => void };
let openRef: ((r: ScanRequest) => Promise<File[] | null>) | null = null;

/** Opens the editor from code (e.g. a "Fix" button on a file already uploaded). null = cancelled. */
export function openScanner(r: ScanRequest): Promise<File[] | null> { return openRef ? openRef(r) : Promise.resolve(r.files); }

async function isLockedPdf(f: File): Promise<boolean> {
  if (f.size > 40 * 1024 * 1024) return false;
  const b = new Uint8Array(await f.arrayBuffer()); const dec = new TextDecoder("latin1");
  return /\/Encrypt\s/.test(dec.decode(b.subarray(Math.max(0, b.length - 4096)))) || /\/Encrypt\s/.test(dec.decode(b.subarray(0, Math.min(b.length, 4096))));
}

export default function ScanProvider() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    openRef = (r) => new Promise((resolve) => setPending({ ...r, resolve }));
    const passing = new WeakSet<Event>();
    const onChange = (ev: Event) => {
      const input = ev.target; if (!(input instanceof HTMLInputElement) || input.type !== "file" || passing.has(ev)) return;
      const mode = (input.dataset.scan ?? "") as ScanMode | "off" | ""; if (mode === "off") return;
      const files = Array.from(input.files ?? []); if (!files.length) return;
      if (input.accept && !/image|pdf|\*/i.test(input.accept)) return;                     // CSV and the like
      if (!files.every((f) => isPdfFile(f) || isImageFile(f))) return;                       // Word files, spreadsheets… go as they are
      ev.stopImmediatePropagation();                                                           // the page sees the change only when the editor is done
      const hand = (out: File[] | null) => {
        if (!out) { input.value = ""; return; }
        const dt = new DataTransfer(); out.forEach((f) => dt.items.add(f)); input.files = dt.files;
        const again = new Event("change", { bubbles: true }); passing.add(again); input.dispatchEvent(again);
      };
      void (async () => {
        let use: ScanMode | null = mode || null;
        if (!use) {
          const needs = files.some((f) => isImageFile(f)) || files.some((f) => f.size > MAX) || (await Promise.all(files.map(isLockedPdf))).some(Boolean);
          if (!needs) { hand(files); return; }
          use = "pages";
        }
        const name = input.dataset.scanName || input.getAttribute("aria-label") || (files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") : "Document");
        const out = await new Promise<File[] | null>((resolve) => setPending({ files, mode: use!, accept: input.accept, name, lang: document.documentElement.lang, resolve }));
        hand(out);
      })();
    };
    window.addEventListener("change", onChange, true);
    return () => { window.removeEventListener("change", onChange, true); openRef = null; };
  }, []);

  if (!pending) return null;
  return <ScanEditor req={pending} onClose={(f) => { const p = pending; setPending(null); p.resolve(f); }} />;
}
