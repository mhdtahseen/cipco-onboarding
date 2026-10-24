"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { LibKind, QLib } from "@/lib/quote";

// One section of a quotation made of reusable lines: the lines picked for THIS quote (editable, reorderable)
// plus the library to add from, and a box to write a new line (optionally saved to the library for next time).
export default function LineList({ kind, value, onChange, lib, reload, tag, placeholder }: { kind: LibKind; value: string[]; onChange: (v: string[]) => void; lib: QLib[]; reload: () => void; tag?: string; placeholder: string }) {
  const [draft, setDraft] = useState(""); const [save, setSave] = useState(true); const [msg, setMsg] = useState("");
  const avail = lib.filter((l) => l.kind === kind && (kind !== "scope" || !tag || l.tag === tag) && !value.includes(l.body));
  const set = (i: number, t: string) => onChange(value.map((x, j) => (j === i ? t : x)));
  const move = (i: number, d: number) => { const a = [...value], j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  async function add() {
    const t = draft.trim(); if (!t) return; setMsg("");
    if (save && !lib.some((l) => l.kind === kind && l.body === t)) {
      const max = Math.max(0, ...lib.filter((l) => l.kind === kind).map((l) => l.sort_order));
      const { error } = await supabase().from("quote_library").insert({ kind, tag: kind === "scope" ? tag?.trim() || null : null, body: t, sort_order: max + 10 });
      if (error) { setMsg(error.message + " — has the quotations SQL migration been run?"); return; } reload();
    }
    onChange([...value, t]); setDraft("");
  }
  return (
    <div className="space-y-2">
      {value.map((t, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-xs text-slate-400 w-6 pt-2.5 text-right shrink-0">{i + 1}.</span>
          <textarea className="inp flex-1 min-w-0" rows={Math.max(1, Math.ceil(t.length / 95))} value={t} onChange={(e) => set(i, e.target.value)} />
          <div className="flex flex-col sm:flex-row shrink-0"><button type="button" className="btn !px-2 !py-1" onClick={() => move(i, -1)} aria-label="Move up">↑</button><button type="button" className="btn !px-2 !py-1" onClick={() => move(i, 1)} aria-label="Move down">↓</button><button type="button" className="btn btn-danger !px-2 !py-1" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove">✕</button></div>
        </div>))}
      {!value.length && <p className="text-sm text-slate-400">Nothing added yet.</p>}
      <details className="rounded-lg border border-slate-200">
        <summary className="px-3 py-2 text-sm text-blue-800 cursor-pointer">Add from library ({avail.length} available{kind === "scope" && tag ? ` · ${tag}` : ""})</summary>
        <div className="p-2 space-y-1 max-h-72 overflow-y-auto">
          {avail.length > 1 && <button type="button" className="btn !py-1 !text-xs" onClick={() => onChange([...value, ...avail.map((a) => a.body)])}>Add all {avail.length}</button>}
          {avail.map((a) => <div key={a.id} className="flex items-start gap-2 text-sm"><button type="button" className="btn !py-0.5 !px-2 !text-xs shrink-0" onClick={() => onChange([...value, a.body])}>+ Add</button><span className="pt-0.5">{a.body}</span></div>)}
          {!avail.length && <p className="text-sm text-slate-400 px-1">Everything in the library is already added.</p>}
        </div>
      </details>
      <div className="flex flex-wrap items-start gap-2">
        <textarea className="inp flex-1 min-w-48" rows={1} placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="button" className="btn" disabled={!draft.trim()} onClick={add}>+ Add line</button>
        <label className="flex items-center gap-2 text-xs text-slate-500 w-full"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />Also save to the library for future quotations</label>
        {msg && <p className="warn w-full">{msg}</p>}
      </div>
    </div>
  );
}
