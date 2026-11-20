"use client";
import { useEffect, useState } from "react";
import { canShareFiles, saveOrShare } from "@/lib/scan/image";
import { saveToLibrary } from "@/lib/scan/library";

const kept = new WeakSet<File>();   // each finished file is saved once

export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const pdfFile = (bytes: Uint8Array, name: string) => new File([bytes as BlobPart], name.endsWith(".pdf") ? name : `${name}.pdf`, { type: "application/pdf" });

/** A file input that the upload scanner leaves alone (the workspace does its own editing). */
export function AddFiles({ label = "Add files", onFiles, accept = "application/pdf,image/*", multiple = true, camera, primary }: { label?: string; onFiles: (f: File[]) => void; accept?: string; multiple?: boolean; camera?: boolean; primary?: boolean }) {
  return <label className={`btn ${primary ? "btn-primary" : ""} cursor-pointer`}>{label}<input type="file" data-scan="off" className="hidden" accept={camera ? "image/*" : accept} multiple={multiple && !camera} {...(camera ? { capture: "environment" } : {})}
    onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onFiles(f); }} /></label>;
}

/** Drop files anywhere on the box (desktop). */
export function DropZone({ onFiles, children }: { onFiles: (f: File[]) => void; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  return <div onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
    onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); }}
    className={`rounded-2xl border-2 border-dashed p-4 transition-colors ${over ? "border-blue-500 bg-blue-50" : "border-slate-200"}`}>{children}</div>;
}

/** The finished file: its name and size, Download, and Share (on a phone: WhatsApp, mail…). Every finished file is also kept under Saved
 *  (on this device), unless keep is false. */
export function Result({ file, onClear, keep = true }: { file: File | null; onClear?: () => void; keep?: boolean }) {
  const [note, setNote] = useState(""); const [savedOk, setSavedOk] = useState(false);
  useEffect(() => { setSavedOk(false); if (!file || !keep) return; if (kept.has(file)) { setSavedOk(true); return; } kept.add(file); saveToLibrary(file).then(() => setSavedOk(true)).catch(() => { /* storage unavailable: the download still works */ }); }, [file, keep]);
  if (!file) return null;
  const go = async (share: boolean) => { const r = await saveOrShare(file, share); setNote(r === "shared" ? "Shared ✓" : "Downloaded ✓"); setTimeout(() => setNote(""), 3000); };
  return (
    <div className="rounded-xl border border-green-200 bg-green-50/60 p-3 flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1"><div className="font-medium truncate">{file.name}</div><div className="text-xs text-slate-500">{kb(file.size)}{savedOk ? " · kept under Saved" : ""}</div></div>
      <button type="button" className="btn btn-primary" onClick={() => go(false)}>Download</button>
      {canShareFiles() && <button type="button" className="btn" onClick={() => go(true)}>Share</button>}
      {onClear && <button type="button" className="btn btn-sm" onClick={onClear}>✕</button>}
      {note && <span className="text-sm text-green-700 w-full">{note}</span>}
    </div>);
}

export function NameBox({ value, onChange, ext }: { value: string; onChange: (v: string) => void; ext: string }) {
  return <label className="flex items-center gap-1 text-sm"><span className="text-slate-500">File name</span><input className="inp !w-56" value={value} onChange={(e) => onChange(e.target.value.replace(/[\\/:*?"<>|]/g, ""))} /><span className="text-slate-400">.{ext}</span></label>;
}

/** Asks for a PDF's password (the workspace's version of the scanner's prompt). */
export function usePasswordPrompt() {
  const [ask, setAsk] = useState<{ name: string; wrong: boolean; resolve: (v: string | null) => void } | null>(null);
  const prompt = (name: string, wrong: boolean) => new Promise<string | null>((resolve) => setAsk({ name, wrong, resolve }));
  const node = ask ? <PasswordForm key={ask.name + ask.wrong} {...ask} onAnswer={(v) => { ask.resolve(v); setAsk(null); }} /> : null;
  return { prompt, node };
}
function PasswordForm({ name, wrong, onAnswer }: { name: string; wrong: boolean; onAnswer: (v: string | null) => void }) {
  const [v, setV] = useState("");
  return <form className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (v) onAnswer(v); }}>
    <div className="font-medium">🔒 {name} is locked</div>{wrong && <p className="text-sm text-red-700">That password is not right. Try again.</p>}
    <div className="flex flex-wrap gap-2"><input className="inp !w-56" type="text" autoFocus autoComplete="off" placeholder="Password" value={v} onChange={(e) => setV(e.target.value)} /><button className="btn btn-primary" disabled={!v}>Open</button><button type="button" className="btn" onClick={() => onAnswer(null)}>Skip this file</button></div>
    <p className="text-xs text-slate-500">e-Aadhaar: first 4 letters of the name in CAPITALS + year of birth (e.g. RAME1990). Bank statements: often the customer ID or date of birth.</p></form>;
}
