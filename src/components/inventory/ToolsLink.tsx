"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { UNITS as TOOL_UNITS, itemLabel, qtyText, type ToolItem } from "@/lib/tools";
import { matchTool, normName, quality, type Match, type Quality } from "@/lib/toolMatch";
import type { InvBill, InvItem } from "@/lib/inventory";

// A recorded bill's lines, added to Tools & equipment at the bill's site by choice, one line at a time. Each line is matched to a catalogue item by fuzzy matching
// (names differ from person to person and supplier to supplier); a confirmed match is remembered for next time. Admin and Operations only (2026-11-tools-from-bills.sql).
type Linked = { id: string; bill_item_id: string; item_id: string; d_ok: number };
type Pick = { on: boolean; qty: string; itemId: string | null; mode: "match" | "new"; q: string; nu: { category: string; name: string; spec: string; unit: string; kind: "tool" | "consumable" } };
const QBADGE: Record<Quality, [string, string]> = { learned: ["Matched before", "bg-emerald-50 text-emerald-700"], good: ["Good match", "bg-emerald-50 text-emerald-700"], maybe: ["Check this", "bg-amber-50 text-amber-800"], none: ["No match", "bg-slate-100 text-slate-600"] };
const toolUnit = (u: string) => ({ No: "Nos", Pcs: "Nos", Kg: "Kg", Meter: "Mtr", MT: "Kg" } as Record<string, string>)[u] ?? (TOOL_UNITS.includes(u) ? u : "Nos");

export default function ToolsLink({ bill, items }: { bill: InvBill; items: InvItem[] }) {
  const [catalogue, setCatalogue] = useState<ToolItem[] | null>(null); const [aliases, setAliases] = useState<Record<string, string>>({}); const [linked, setLinked] = useState<Linked[]>([]);
  const [picks, setPicks] = useState<Record<string, Pick>>({}); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [missing, setMissing] = useState(false);

  async function load() {
    const sb = supabase();
    const [c, a, l] = await Promise.all([
      sb.from("tool_items").select("*").order("sort_order"),
      sb.from("tool_item_aliases").select("alias, tool_item_id"),
      items.length ? sb.from("tool_moves").select("id, bill_item_id, item_id, d_ok").in("bill_item_id", items.map((i) => i.id)).is("voided_at", null) : Promise.resolve({ data: [], error: null }),
    ]);
    if (c.error || a.error || l.error) { setMissing(true); return; }
    setCatalogue((c.data || []) as ToolItem[]); setAliases(Object.fromEntries(((a.data || []) as { alias: string; tool_item_id: string }[]).map((x) => [x.alias, x.tool_item_id]))); setLinked((l.data || []) as Linked[]);
  }
  useEffect(() => { load(); }, [bill.id, items.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const best = useMemo(() => { const m: Record<string, Match[]> = {}; if (catalogue) items.forEach((i) => { m[i.id] = matchTool(i.name, catalogue, aliases); }); return m; }, [items, catalogue, aliases]);
  // a fresh choice for each line: the best match if there is a decent one, otherwise a new item named as on the bill
  useEffect(() => {
    if (!catalogue) return;
    setPicks((cur) => Object.fromEntries(items.map((i) => { if (cur[i.id]) return [i.id, cur[i.id]]; const top = best[i.id]?.[0]; const qa = quality(top); const usable = qa !== "none";
      return [i.id, { on: false, qty: qtyText(Number(i.qty)), itemId: usable ? top!.item.id : null, mode: usable ? "match" : "new", q: "", nu: { category: top?.item.category ?? "Purchased", name: i.name.trim(), spec: "", unit: toolUnit(i.unit), kind: "tool" } }]; })));
  }, [catalogue, best, items]);

  if (missing) return null;   // the migration is not run yet: nothing to show
  if (!catalogue) return null;
  const linkedOf = (id: string) => linked.find((l) => l.bill_item_id === id);
  const iOf = (id: string | null) => catalogue.find((x) => x.id === id);
  const open_ = items.filter((i) => !linkedOf(i.id)); const chosen = open_.filter((i) => picks[i.id]?.on);
  const set = (id: string, p: Partial<Pick>) => setPicks((s) => ({ ...s, [id]: { ...s[id], ...p } }));
  const tickGood = () => setPicks((s) => { const n = { ...s }; open_.forEach((i) => { const qa = quality(best[i.id]?.[0]); if (qa === "good" || qa === "learned") n[i.id] = { ...n[i.id], on: true, mode: "match", itemId: best[i.id][0].item.id }; }); return n; });

  async function add() {
    const lines = chosen.map((i) => { const p = picks[i.id]; return { bill_item_id: i.id, qty: parseFloat(p.qty), alias: normName(i.name), ...(p.mode === "match" && p.itemId ? { tool_item_id: p.itemId } : { new_item: { ...p.nu, name: p.nu.name.trim(), spec: p.nu.spec.trim(), category: p.nu.category.trim() } }) }; });
    for (const [n, l] of lines.entries()) { const i = chosen[n]; if (!(l.qty > 0) || l.qty > Number(i.qty)) { setErr(`${i.name}: add between 1 and ${qtyText(Number(i.qty))}.`); return; } if (!("tool_item_id" in l) && (!l.new_item.category || !l.new_item.name)) { setErr(`${i.name}: give the new item a category and a name, or pick a match.`); return; } }
    setBusy(true); setErr("");
    const { data, error } = await supabase().rpc("tool_receive_from_bill", { p_bill: bill.id, p_lines: lines });
    setBusy(false); if (error) { setErr(error.message); return; }
    setMsg(`${data} line${data === 1 ? "" : "s"} added to Tools & equipment ✓`); setPicks({}); load();
  }
  async function undo(l: Linked) {
    const why = prompt("Take this back out of Tools & equipment? It stays in the item's history, marked void. Reason:"); if (!why?.trim()) return;
    const { error } = await supabase().rpc("tool_move_void", { p_move: l.id, p_reason: why.trim() }); if (error) { setErr(error.message); return; } load();
  }

  return (
    <section className="card !p-3 space-y-3" data-tools-link>
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">Tools &amp; equipment</h2>
        <span className="text-xs text-slate-500">{linked.length} of {items.length} line{items.length === 1 ? "" : "s"} added</span>
        <button type="button" className="btn btn-sm ml-auto" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close" : open_.length ? "Add lines to the register" : "Show"}</button></div>
      {!open && <p className="text-xs text-slate-500">Tools, equipment and consumables you want tracked by site can be added from this bill. Materials used straight away can be left out.</p>}
      {open && <>
        {open_.length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs"><button type="button" className="tlink" onClick={tickGood}>Tick every line with a good match</button><span className="text-slate-400">Matches are suggestions: check each one.</span></div>}
        <ul className="divide-y divide-slate-100">
          {items.map((i) => { const l = linkedOf(i.id); const p = picks[i.id]; const ms = best[i.id] ?? []; const qa = quality(ms[0]);
            if (l) return <li key={i.id} className="py-2 text-sm flex flex-wrap items-center gap-2"><span className="text-emerald-700">✓</span><span className="flex-1">{i.name} <span className="text-xs text-slate-500">→ {itemLabel(iOf(l.item_id))}, {qtyText(Number(l.d_ok))} {iOf(l.item_id)?.unit}</span></span><button type="button" className="text-xs text-red-700 underline" onClick={() => undo(l)}>Take back</button></li>;
            if (!p) return null;
            const searched = p.q.trim() ? matchTool(p.q, catalogue, {}, 8) : ms;
            return <li key={i.id} className="py-2.5 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 flex-1 min-w-48"><input type="checkbox" checked={p.on} onChange={(e) => set(i.id, { on: e.target.checked })} /><span><b className="font-medium">{i.name}</b> <span className="text-xs text-slate-500">{qtyText(Number(i.qty))} {i.unit}</span></span></label>
                {p.mode === "match" && p.itemId ? <span className="text-xs">→ <b className="font-medium">{itemLabel(iOf(p.itemId))}</b> <span className="text-slate-400">({iOf(p.itemId)?.category})</span> {ms[0]?.item.id === p.itemId && <span className={`ml-1 rounded-full px-2 py-0.5 ${QBADGE[qa][1]}`}>{QBADGE[qa][0]}</span>}</span>
                  : <span className="text-xs">→ <b className="font-medium">new item</b> <span className={`ml-1 rounded-full px-2 py-0.5 ${QBADGE.none[1]}`}>{qa === "none" ? "No match" : "New"}</span></span>}
              </div>
              {p.on && <div className="ml-6 space-y-2 rounded-xl bg-slate-50 p-2">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block text-xs text-slate-500">How many<input className="inp mt-1 !w-24" inputMode="decimal" value={p.qty} onChange={(e) => set(i.id, { qty: e.target.value.replace(/[^\d.]/g, "") })} /></label>
                  <div className="flex gap-1"><button type="button" className={`chip ${p.mode === "match" ? "chip-on" : ""}`} onClick={() => set(i.id, { mode: "match" })}>Existing item</button><button type="button" className={`chip ${p.mode === "new" ? "chip-on" : ""}`} onClick={() => set(i.id, { mode: "new" })}>New item</button></div>
                </div>
                {p.mode === "match" ? <div className="space-y-1">
                  <input className="inp !w-full sm:!w-80" type="search" placeholder="Search the catalogue (any spelling)…" aria-label="Search the catalogue" value={p.q} onChange={(e) => set(i.id, { q: e.target.value })} />
                  {searched.length ? <ul className="text-xs space-y-0.5">{searched.slice(0, 6).map((m) => <li key={m.item.id}><label className="flex items-center gap-2"><input type="radio" name={`m-${i.id}`} checked={p.itemId === m.item.id} onChange={() => set(i.id, { itemId: m.item.id })} />
                    <span>{itemLabel(m.item)} <span className="text-slate-400">· {m.item.category} · {m.item.unit}</span></span><span className="text-slate-400 ml-auto tabular-nums">{m.learned ? "matched before" : `${Math.round(m.score * 100)}%`}</span></label></li>)}</ul>
                    : <p className="text-xs text-slate-500">Nothing similar in the catalogue. Choose "New item".</p>}
                </div> : <div className="grid gap-2 sm:grid-cols-5">
                  <label className="block text-xs text-slate-500 sm:col-span-2">Category<input className="inp mt-1" list="tl-cats" value={p.nu.category} onChange={(e) => set(i.id, { nu: { ...p.nu, category: e.target.value } })} /></label>
                  <label className="block text-xs text-slate-500 sm:col-span-2">Name<input className="inp mt-1" value={p.nu.name} onChange={(e) => set(i.id, { nu: { ...p.nu, name: e.target.value } })} /></label>
                  <label className="block text-xs text-slate-500">Size / spec<input className="inp mt-1" value={p.nu.spec} onChange={(e) => set(i.id, { nu: { ...p.nu, spec: e.target.value } })} /></label>
                  <label className="block text-xs text-slate-500">Unit<select className="inp mt-1" value={p.nu.unit} onChange={(e) => set(i.id, { nu: { ...p.nu, unit: e.target.value } })}>{TOOL_UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
                  <label className="block text-xs text-slate-500 sm:col-span-2">Kind<select className="inp mt-1" value={p.nu.kind} onChange={(e) => set(i.id, { nu: { ...p.nu, kind: e.target.value as Pick["nu"]["kind"] } })}><option value="tool">Tool / equipment (comes back)</option><option value="consumable">Consumable (gets used up)</option></select></label>
                </div>}
              </div>}
            </li>; })}
        </ul>
        <datalist id="tl-cats">{[...new Set(catalogue.map((x) => x.category))].sort().map((c) => <option key={c} value={c} />)}</datalist>
        {open_.length > 0 && <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn btn-primary" disabled={busy || !chosen.length} onClick={add}>{busy ? "Adding…" : `Add ${chosen.length} line${chosen.length === 1 ? "" : "s"} to this site's stock`}</button>
          <span className="text-xs text-slate-500">They appear in Tools &amp; equipment at this bill's site, dated {bill.bill_date}. The names are remembered for next time.</span></div>}
      </>}
      {msg && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">{msg}</p>}
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
    </section>
  );
}
