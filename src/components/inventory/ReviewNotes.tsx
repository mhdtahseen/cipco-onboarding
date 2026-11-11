"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { NOTE_FIELDS, noteTitle, type InvItem, type NoteField, type ReviewNote } from "@/lib/inventory";

// Corrections marked on an entry. The reviewer marks them (an item, a part of the entry, or the whole thing). The person it is sent back to ticks each one off as they fix it.
// target: "" is the whole entry, "f:vendor" a part of it, "i:<id>" an item. The page sets it too, from the Flag button on an item row.
const HEAD_FIELDS: Record<"bill" | "no_bill", Exclude<NoteField, "">[]> = { bill: ["vendor", "gstin", "bill_no", "date", "total", "other_charges", "photo"], no_bill: ["vendor", "date", "reason", "amount", "photo"] };

export default function ReviewNotes({ billId, kind, notes, items, mode, target, setTarget, onChanged }: { billId: string; kind: "bill" | "no_bill"; notes: ReviewNote[]; items: InvItem[]; mode: "review" | "rework" | "read"; target: string; setTarget: (t: string) => void; onChanged: () => Promise<void> }) {
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [ticked, setTicked] = useState<Record<string, boolean>>({});   // a tick shows at once, and is undone if it could not be saved
  const isDone = (n: ReviewNote) => ticked[n.id] ?? n.state === "done"; const open = notes.filter((n) => !isDone(n)).length;
  if (mode === "read" && !notes.length) return null;

  async function rpc(fn: string, args: Record<string, unknown>) { setBusy(true); setErr(""); const { error } = await supabase().rpc(fn, args); if (error) { setBusy(false); setErr(error.message); return false; } await onChanged(); setBusy(false); return true; }
  async function tick(n: ReviewNote, done: boolean) { setTicked((t) => ({ ...t, [n.id]: done })); const ok = await rpc("inventory_note_set_done", { p_note: n.id, p_done: done }); setTicked((t) => { const { [n.id]: _x, ...rest } = t; return rest; }); void ok; }
  async function add() {
    if (!text.trim()) return setErr("Write what is wrong.");
    const item = target.startsWith("i:") ? target.slice(2) : null; const field = target.startsWith("f:") ? target.slice(2) : "";
    if (await rpc("inventory_note_add", { p_bill: billId, p_item: item, p_field: field, p_note: text.trim() })) { setText(""); setTarget(""); }
  }
  const label = (f: Exclude<NoteField, "">) => (kind === "no_bill" && f === "vendor" ? "From" : NOTE_FIELDS[f]);

  return (
    <section className="card !p-3 space-y-3" id="review-notes">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h2 className="text-sm font-semibold">Corrections</h2>{notes.length > 0 && <span className={`text-[11px] rounded-full px-2 py-0.5 ${open ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800"}`}>{open ? `${open} to fix` : "all done"}</span>}</div>
      {err && <p className="warn" role="alert">{err}</p>}
      {notes.length === 0 ? <p className="text-sm text-slate-500">{mode === "review" ? "Nothing marked yet. Mark what is wrong, correct it yourself above, or send the entry back." : "No corrections."}</p> :
        <ul className="space-y-2">{notes.map((n) => (
          <li key={n.id} className={`rounded-xl border p-2 text-sm flex items-start gap-2 ${isDone(n) ? "border-green-200 bg-green-50/50" : "border-amber-200 bg-amber-50/60"}`}>
            {mode === "rework" && <input type="checkbox" className="mt-1" aria-label={`Done: ${noteTitle(n)}`} checked={isDone(n)} onChange={(e) => void tick(n, e.target.checked)} />}
            <div className="min-w-0 flex-1"><div className="font-medium break-words">{noteTitle({ ...n, field: n.field })}</div><div className="text-slate-700 break-words">{n.note}</div>{isDone(n) && mode !== "rework" && <div className="text-xs text-green-700">Fixed</div>}</div>
            {mode === "review" && <button className="btn btn-sm btn-danger shrink-0" aria-label="Remove this correction" disabled={busy} onClick={() => void rpc("inventory_note_remove", { p_note: n.id })}>✕</button>}
          </li>))}</ul>}
      {mode === "review" && <div className="space-y-2 border-t border-slate-100 pt-3">
        <label className="lbl" htmlFor="note-target">Mark a correction</label>
        <select id="note-target" className="inp" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">The entry as a whole</option>
          <optgroup label="A part of the entry">{HEAD_FIELDS[kind].map((f) => <option key={f} value={`f:${f}`}>{label(f)}</option>)}</optgroup>
          {items.length > 0 && <optgroup label="An item">{items.map((i, n) => <option key={i.id} value={`i:${i.id}`}>{n + 1}. {i.name}</option>)}</optgroup>}
        </select>
        <input className="inp" placeholder="What is wrong, for example: rate should be 480" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} />
        <button className="btn" disabled={busy || !text.trim()} onClick={add}>Add correction</button>
      </div>}
    </section>
  );
}
