"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { MOVE_LABEL, byCategory, itemLabel, itemMatches, qtyText, type ToolItem, type ToolMove } from "@/lib/tools";

type Site = { id: string; name: string };
type At = (item: string, site: string) => { ok: number; damaged: number };
const dmy = (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** Stock at one site (with what can be done to each item there), or at every site side by side. */
export default function StockTab({ items, at, sites, site, canAct, names, reload }: { items: ToolItem[]; at: At; sites: Site[]; site: string; canAct: boolean; names: Record<string, string>; reload: () => void }) {
  const [q, setQ] = useState(""); const [kind, setKind] = useState<"" | "tool" | "consumable">(""); const [zero, setZero] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const all = site === "all";
  const total = (i: ToolItem) => sites.reduce((s, x) => { const v = at(i.id, x.id); return { ok: s.ok + v.ok, damaged: s.damaged + v.damaged }; }, { ok: 0, damaged: 0 });
  const here = (i: ToolItem) => (all ? total(i) : at(i.id, site));
  const shown = useMemo(() => items.filter((i) => (i.active || here(i).ok + here(i).damaged > 0) && (!kind || i.kind === kind) && itemMatches(i, q) && (zero || here(i).ok + here(i).damaged > 0)), [items, q, kind, zero, site, at]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cols = all ? sites.filter((s) => items.some((i) => { const v = at(i.id, s.id); return v.ok + v.damaged > 0; })) : [];
  const groups = byCategory(shown);
  const damagedCount = shown.filter((i) => here(i).damaged > 0).length;

  return (
    <div className="space-y-3" data-tools-stock>
      <div className="flex flex-wrap items-center gap-2">
        <input className="inp !w-full sm:!w-72" type="search" placeholder="Search: spanner 20-22, jack, cable…" aria-label="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
        {(["", "tool", "consumable"] as const).map((k) => <button key={k || "all"} type="button" className={`chip ${kind === k ? "chip-on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "" ? "All" : k === "tool" ? "Tools" : "Consumables"}</button>)}
        <label className="text-sm flex items-center gap-2 sm:ml-auto"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> Show items with none {all ? "anywhere" : "here"}</label>
      </div>
      <p className="text-xs text-slate-500">{shown.length} items{damagedCount ? ` · ${damagedCount} with damaged pieces` : ""}{all ? " · every site" : ""}</p>
      {!groups.length && <p className="card text-sm text-slate-500 text-center">{q ? "Nothing matches your search." : all ? "Nothing recorded at any site yet." : "Nothing recorded at this site yet."}</p>}
      {groups.map(([cat, list]) => (
        <details key={cat} className="card !p-0" open={!!q.trim() || groups.length <= 3}>
          <summary className="cursor-pointer px-4 py-3 flex items-center gap-2 font-semibold">{cat}<span className="text-xs font-normal text-slate-500">{list.length}</span></summary>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 bg-slate-50"><tr><th className="px-4 py-2 font-medium">Item</th>{all ? <>{cols.map((s) => <th key={s.id} className="px-3 py-2 font-medium text-right whitespace-nowrap">{s.name}</th>)}<th className="px-4 py-2 font-medium text-right">Total</th></> : <><th className="px-3 py-2 font-medium text-right">Good</th><th className="px-3 py-2 font-medium text-right">Damaged</th>{canAct && <th className="px-4 py-2" />}</>}</tr></thead>
            <tbody>{list.map((i) => { const v = here(i); return (<Fragment key={i.id}>
              <tr className="border-t border-slate-100">
                <td className="px-4 py-2"><span className="font-medium">{i.name}</span>{i.spec && <span className="text-slate-600"> {i.spec}</span>}<span className="text-xs text-slate-400"> · {i.unit}{i.kind === "consumable" ? " · consumable" : ""}</span>{i.note && <div className="text-xs text-slate-500">{i.note}</div>}</td>
                {all ? <>{cols.map((s) => { const x = at(i.id, s.id); return <td key={s.id} className="px-3 py-2 text-right tabular-nums">{x.ok ? qtyText(x.ok) : <span className="text-slate-300">0</span>}{x.damaged > 0 && <span className="text-xs text-rose-700"> +{qtyText(x.damaged)} dmg</span>}</td>; })}
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{qtyText(v.ok)}{v.damaged > 0 && <span className="text-xs text-rose-700"> +{qtyText(v.damaged)} dmg</span>}</td></>
                  : <><td className="px-3 py-2 text-right tabular-nums font-medium">{qtyText(v.ok)}</td><td className={`px-3 py-2 text-right tabular-nums ${v.damaged ? "text-rose-700" : "text-slate-300"}`}>{qtyText(v.damaged)}</td>
                    {canAct && <td className="px-4 py-2 text-right"><button type="button" className="tlink text-xs" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? "Close" : "Update / history"}</button></td>}</>}
              </tr>
              {!all && open === i.id && <tr><td colSpan={4} className="px-4 pb-3"><ItemPanel item={i} site={site} stock={v} names={names} onDone={reload} /></td></tr>}
            </Fragment>); })}</tbody>
          </table></div>
        </details>))}
    </div>
  );
}

type Act = "used" | "damaged" | "repaired" | "lost" | "written_off" | "count" | "opening";
const ACT: Record<Act, string> = { used: "Used up", damaged: "Found damaged", repaired: "Repaired", lost: "Lost / missing", written_off: "Thrown away (damaged)", count: "Recount", opening: "Add opening stock (found later)" };

/** One item at one site: record what happened to it, and see its history here. */
function ItemPanel({ item, site, stock, names, onDone }: { item: ToolItem; site: string; stock: { ok: number; damaged: number }; names: Record<string, string>; onDone: () => void }) {
  const acts = (Object.keys(ACT) as Act[]).filter((a) => a !== "used" || item.kind === "consumable");
  const [act, setAct] = useState<Act>(item.kind === "consumable" ? "used" : "damaged"); const [qty, setQty] = useState(""); const [cond, setCond] = useState<"ok" | "damaged">("ok");
  const [date, setDate] = useState(istToday()); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [hist, setHist] = useState<ToolMove[] | null>(null);
  const loadHist = async () => { const { data } = await supabase().from("tool_moves").select("*").eq("item_id", item.id).eq("project_id", site).order("moved_on", { ascending: false }).order("created_at", { ascending: false }).limit(50); setHist((data || []) as ToolMove[]); };
  useEffect(() => { loadHist(); }, [item.id, site]);   // eslint-disable-line react-hooks/exhaustive-deps
  const needsCond = act === "lost" || act === "count" || act === "opening"; const needsNote = act === "lost" || act === "written_off" || act === "count";
  async function save() {
    const n = parseFloat(qty); if (!(n >= 0) || (act !== "count" && !(n > 0))) { setErr(act === "count" ? "Enter how many you counted." : "Enter how many."); return; }
    if (needsNote && !note.trim()) { setErr("Give a reason."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase().rpc("tool_move", { p_item: item.id, p_project: site, p_kind: act, p_qty: n, p_condition: needsCond ? cond : "ok", p_date: date, p_note: note.trim() });
    setBusy(false); if (error) { setErr(error.message); return; } setQty(""); setNote(""); loadHist(); onDone();
  }
  async function voidIt(m: ToolMove) {
    const why = prompt(`Void this entry (${MOVE_LABEL[m.kind]}, ${dmy(m.moved_on)})? It stays in the history, marked void. Reason:`); if (!why?.trim()) return;
    const { error } = await supabase().rpc("tool_move_void", { p_move: m.id, p_reason: why.trim() }); if (error) { setErr(error.message); return; } loadHist(); onDone();
  }
  const delta = (m: ToolMove) => [m.d_ok ? `${m.d_ok > 0 ? "+" : ""}${qtyText(Number(m.d_ok))} good` : "", m.d_damaged ? `${m.d_damaged > 0 ? "+" : ""}${qtyText(Number(m.d_damaged))} damaged` : ""].filter(Boolean).join(", ");
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 space-y-3" data-item-panel>
      <div className="text-sm"><b>{itemLabel(item)}</b> here: {qtyText(stock.ok)} good{stock.damaged ? `, ${qtyText(stock.damaged)} damaged` : ""}</div>
      <div className="grid gap-2 sm:grid-cols-[1.4fr_0.6fr_0.8fr_0.8fr] items-end">
        <label className="block text-xs text-slate-500">What happened<select className="inp mt-1" value={act} onChange={(e) => setAct(e.target.value as Act)}>{acts.map((a) => <option key={a} value={a}>{ACT[a]}</option>)}</select></label>
        <label className="block text-xs text-slate-500">{act === "count" ? "Counted" : "How many"}<input className="inp mt-1" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} placeholder={item.unit} /></label>
        {needsCond ? <label className="block text-xs text-slate-500">Which<select className="inp mt-1" value={cond} onChange={(e) => setCond(e.target.value as "ok" | "damaged")}><option value="ok">Good ones</option><option value="damaged">Damaged ones</option></select></label> : <span />}
        <label className="block text-xs text-slate-500">Date<input type="date" className="inp mt-1" max={istToday()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block text-xs text-slate-500 sm:col-span-4">{needsNote ? "Reason" : "Note (optional)"}<input className="inp mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder={act === "count" ? "e.g. monthly stock-take" : act === "lost" ? "what happened" : ""} /></label>
      </div>
      {act === "count" && <p className="text-xs text-slate-500">Enter the number you actually counted of the {cond === "ok" ? "good" : "damaged"} ones. The difference from {qtyText(cond === "ok" ? stock.ok : stock.damaged)} is recorded with your reason.</p>}
      <div className="flex items-center gap-2"><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>{err && <span className="text-sm text-red-700">{err}</span>}</div>
      <div>
        <div className="text-xs font-semibold text-slate-600 mb-1">History at this site</div>
        {!hist ? <div className="skeleton h-8 w-full" /> : !hist.length ? <p className="text-xs text-slate-500">Nothing yet.</p> :
          <ul className="text-xs divide-y divide-slate-100">{hist.map((m) => <li key={m.id} className={`py-1.5 flex flex-wrap gap-x-2 ${m.voided_at ? "text-slate-400 line-through" : ""}`}>
            <span className="tabular-nums">{dmy(m.moved_on)}</span><span className="font-medium">{MOVE_LABEL[m.kind]}</span><span>{delta(m)}</span>{m.note && <span className="text-slate-500">· {m.note}</span>}
            <span className="text-slate-400">· {(m.created_by && names[m.created_by]) || "—"}</span>{m.voided_at && <span className="no-underline">(void: {m.void_reason})</span>}
            {!m.voided_at && !m.transfer_id && <button type="button" className="ml-auto text-red-700 underline" onClick={() => voidIt(m)}>Void</button>}</li>)}</ul>}
      </div>
    </div>
  );
}

