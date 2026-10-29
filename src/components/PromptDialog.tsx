"use client";
import { useEffect, useRef, useState } from "react";

// A small in-page replacement for the browser's prompt(): one text box, optional validation, Escape / Cancel returns null.
export type PromptSpec = { title: string; label: string; initial?: string; hint?: string; type?: "text" | "date"; confirmLabel?: string; validate?: (v: string) => string | null; resolve: (v: string | null) => void };

export default function PromptDialog({ spec }: { spec: PromptSpec | null }) {
  const [val, setVal] = useState(""); const [err, setErr] = useState(""); const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (spec) { setVal(spec.initial ?? ""); setErr(""); setTimeout(() => ref.current?.focus(), 0); } }, [spec]);
  useEffect(() => {
    if (!spec) return; const key = (e: KeyboardEvent) => { if (e.key === "Escape") spec.resolve(null); };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [spec]);
  if (!spec) return null;
  const submit = (e: React.FormEvent) => { e.preventDefault(); const v = val.trim(); const bad = spec.validate?.(v); if (bad) { setErr(bad); return; } spec.resolve(v); };
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={spec.title}>
      <div className="fade absolute inset-0 bg-slate-900/40" onClick={() => spec.resolve(null)} />
      <form onSubmit={submit} className="pop-in !origin-center relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl space-y-3">
        <h2 className="font-semibold">{spec.title}</h2>
        <div><label className="lbl" htmlFor="prompt-input">{spec.label}</label><input id="prompt-input" ref={ref} className="inp" type={spec.type ?? "text"} value={val} onChange={(e) => { setVal(e.target.value); setErr(""); }} />
          {spec.hint && <p className="text-xs text-slate-500 mt-1">{spec.hint}</p>}{err && <p className="warn">{err}</p>}</div>
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => spec.resolve(null)}>Cancel</button><button type="submit" className="btn btn-primary">{spec.confirmLabel ?? "OK"}</button></div>
      </form>
    </div>
  );
}
