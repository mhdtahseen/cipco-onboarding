"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { UNITS, byCategory, itemMatches, type ToolItem } from "@/lib/tools";

type Form = { id: string | null; category: string; name: string; spec: string; unit: string; kind: "tool" | "consumable"; note: string; active: boolean };
const BLANK: Form = { id: null, category: "", name: "", spec: "", unit: "Nos", kind: "tool", note: "", active: true };

/** The catalogue: every kind of item the company owns. Adding an item here records no stock; stock comes from opening stock, transfers and so on. */
export default function ItemsTab({ items, canAct, reload }: { items: ToolItem[]; canAct: boolean; reload: () => void }) {
  const [f, setF] = useState<Form | null>(null); const [q, setQ] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const cats = [...new Set(items.map((i) => i.category))].sort();
  async function save() {
    if (!f) return; if (!f.category.trim() || !f.name.trim()) { setErr("Enter the category and the name."); return; }
    setBusy(true); setErr("");
    const row = { category: f.category.trim(), name: f.name.trim(), spec: f.spec.trim(), unit: f.unit, kind: f.kind, note: f.note.trim(), active: f.active };
    const { error } = f.id ? await supabase().from("tool_items").update(row).eq("id", f.id) : await supabase().from("tool_items").insert({ ...row, sort_order: 10000 });
    setBusy(false); if (error) { setErr(/tool_items_unique|duplicate/i.test(error.message) ? "An item with this category, name and size already exists." : error.message); return; } setF(null); reload();
  }
  const groups = byCategory(items.filter((i) => itemMatches(i, q)));
  return (
    <div className="space-y-3" data-tools-items>
      <div className="flex flex-wrap items-center gap-2">
        <input className="inp !w-full sm:!w-72" type="search" placeholder="Search the catalogue…" aria-label="Search the catalogue" value={q} onChange={(e) => setQ(e.target.value)} />
        {canAct && !f && <button type="button" className="btn btn-primary sm:ml-auto" onClick={() => { setF({ ...BLANK }); setErr(""); }}>Add an item</button>}
      </div>
      {f && <div className="card space-y-3">
        <div className="font-semibold">{f.id ? "Edit item" : "Add an item"}</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block text-xs text-slate-500">Category<input className="inp mt-1" list="tool-cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="tool-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></label>
          <label className="block text-xs text-slate-500">Name<input className="inp mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Ring spanner, double end" /></label>
          <label className="block text-xs text-slate-500">Size / spec (optional)<input className="inp mt-1" value={f.spec} onChange={(e) => setF({ ...f, spec: e.target.value })} placeholder="e.g. 20-22, 50 mm, 17 TON" /></label>
          <label className="block text-xs text-slate-500">Unit<select className="inp mt-1" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
          <label className="block text-xs text-slate-500">Kind<select className="inp mt-1" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Form["kind"] })}><option value="tool">Tool / equipment (comes back)</option><option value="consumable">Consumable (gets used up)</option></select></label>
          <label className="block text-xs text-slate-500">Note (optional)<input className="inp mt-1" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          {f.id && <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In use (untick to hide it once none are left)</label>}
        </div>
        <div className="flex items-center gap-2"><button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button><button type="button" className="btn" onClick={() => setF(null)}>Cancel</button>{err && <span className="text-sm text-red-700">{err}</span>}</div>
        {!f.id && <p className="text-xs text-slate-500">This adds the item to the catalogue only. To record that some are at a site, open the item on the Stock tab and choose "Add opening stock".</p>}
      </div>}
      {groups.map(([cat, list]) => <details key={cat} className="card !p-0" open={!!q.trim()}>
        <summary className="cursor-pointer px-4 py-3 font-semibold">{cat} <span className="text-xs font-normal text-slate-500">{list.length}</span></summary>
        <ul className="divide-y divide-slate-100 text-sm">{list.map((i) => <li key={i.id} className={`px-4 py-2 flex flex-wrap items-center gap-2 ${i.active ? "" : "text-slate-400"}`}>
          <span className="flex-1">{i.name}{i.spec && <span className="text-slate-600"> {i.spec}</span>}<span className="text-xs text-slate-400"> · {i.unit} · {i.kind}{i.active ? "" : " · not in use"}</span>{i.note && <span className="block text-xs text-slate-500">{i.note}</span>}</span>
          {canAct && <button type="button" className="tlink text-xs" onClick={() => { setF({ id: i.id, category: i.category, name: i.name, spec: i.spec, unit: i.unit, kind: i.kind, note: i.note, active: i.active }); setErr(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>}</li>)}</ul>
      </details>)}
      {!groups.length && <p className="card text-sm text-slate-500 text-center">{q ? "Nothing matches." : "The catalogue is empty. Load the opening stock to fill it."}</p>}
    </div>
  );
}
