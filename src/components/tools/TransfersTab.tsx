"use client";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { TRANSFER_STATUS, byCategory, itemLabel, itemMatches, qtyText, type ToolItem, type Transfer } from "@/lib/tools";

type Site = { id: string; name: string };
type At = (item: string, site: string) => { ok: number; damaged: number };
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** Moving items between sites, in two steps: dispatch (they leave the sending site and are in transit), then receive (the receiving site confirms what arrived). */
export default function TransfersTab({ items, at, sites, site, transfers, canAct, names, reload }: { items: ToolItem[]; at: At; sites: Site[]; site: string; transfers: Transfer[]; canAct: boolean; names: Record<string, string>; reload: () => void }) {
  const [creating, setCreating] = useState(false); const [receiving, setReceiving] = useState<string | null>(null); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const sName = (id: string) => sites.find((s) => s.id === id)?.name ?? "?"; const iOf = (id: string) => items.find((i) => i.id === id);
  const list = transfers.filter((t) => site === "all" || t.from_project === site || t.to_project === site);
  const inTransit = list.filter((t) => t.status === "in_transit");
  async function cancel(t: Transfer) {
    const why = prompt(`Cancel ${t.transfer_no}? Everything goes back to ${sName(t.from_project)}. Reason:`); if (!why?.trim()) return;
    setErr(""); const { error } = await supabase().rpc("tool_transfer_cancel", { p_transfer: t.id, p_reason: why.trim() }); if (error) { setErr(error.message); return; } setMsg(`${t.transfer_no} cancelled ✓`); reload();
  }
  return (
    <div className="space-y-3" data-tools-transfers>
      {canAct && !creating && <button type="button" className="btn btn-primary" onClick={() => { setCreating(true); setMsg(""); }}>Move items to another site</button>}
      {creating && <NewTransfer items={items} at={at} sites={sites} from0={site !== "all" ? site : ""} onClose={() => setCreating(false)} onDone={(no) => { setCreating(false); setMsg(`${no} dispatched ✓ The items are in transit until the receiving site confirms.`); reload(); }} />}
      {msg && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">{msg}</p>}
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
      {inTransit.length > 0 && <p className="text-sm text-amber-800">{inTransit.length} transfer{inTransit.length === 1 ? "" : "s"} in transit, waiting to be received.</p>}
      {!list.length && <p className="card text-sm text-slate-500 text-center">No transfers {site === "all" ? "yet" : "to or from this site yet"}.</p>}
      {list.map((t) => { const [lbl, cls] = TRANSFER_STATUS[t.status]; const short = t.tool_transfer_lines.reduce((s, l) => s + (l.qty_received == null ? 0 : l.qty - l.qty_received), 0); return (
        <div key={t.id} className="card space-y-2">
          <div className="flex flex-wrap items-center gap-2"><b>{t.dc_no || t.transfer_no}</b>{t.dc_no && <span className="text-xs text-slate-400">{t.transfer_no}</span>}<span className="text-sm">{sName(t.from_project)} → {sName(t.to_project)}</span><span className={`text-[11px] rounded-full px-2 py-0.5 ${cls}`}>{lbl}</span>
            <span className="text-xs text-slate-500 sm:ml-auto">sent {dmy(t.dispatched_on)} by {(t.created_by && names[t.created_by]) || "—"}{t.received_on ? ` · received ${dmy(t.received_on)}` : ""}</span></div>
          {(t.vehicle_no || t.carried_by || t.note) && <div className="text-xs text-slate-500">{[t.vehicle_no && `Vehicle ${t.vehicle_no}`, t.carried_by && `Carried by ${t.carried_by}`, t.note].filter(Boolean).join(" · ")}</div>}
          <ul className="text-sm grid gap-x-6 sm:grid-cols-2">{t.tool_transfer_lines.map((l) => <li key={l.id} className="flex gap-2"><span className="flex-1">{itemLabel(iOf(l.item_id))}{l.condition === "damaged" && <span className="text-xs text-rose-700"> (damaged)</span>}</span>
            <span className="tabular-nums">{qtyText(l.qty)} {iOf(l.item_id)?.unit}{l.qty_received != null && l.qty_received < l.qty && <span className="text-xs text-rose-700"> · {qtyText(l.qty - l.qty_received)} missing</span>}</span></li>)}</ul>
          {short > 0 && t.received_note && <p className="text-xs text-rose-700">Missing on arrival: {t.received_note}</p>}
          {t.status === "cancelled" && <p className="text-xs text-slate-500">Cancelled: {t.cancel_reason}</p>}
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-sm" href={`/api/tools/transfer/${t.id}`} target="_blank" rel="noreferrer">Delivery challan PDF</a>
            {canAct && t.status === "in_transit" && receiving !== t.id && <button type="button" className="btn btn-sm btn-primary" onClick={() => setReceiving(t.id)}>Receive at {sName(t.to_project)}</button>}
            {canAct && t.status === "in_transit" && <button type="button" className="btn btn-sm btn-danger" onClick={() => cancel(t)}>Cancel transfer</button>}
          </div>
          {receiving === t.id && <Receive t={t} items={items} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); setMsg(`${t.transfer_no} received ✓`); reload(); }} />}
        </div>); })}
    </div>
  );
}

type Pick = Record<string, string>;   // "itemId|ok" or "itemId|damaged" -> quantity typed
function NewTransfer({ items, at, sites, from0, onClose, onDone }: { items: ToolItem[]; at: At; sites: Site[]; from0: string; onClose: () => void; onDone: (no: string) => void }) {
  const [from, setFrom] = useState(from0); const [to, setTo] = useState(""); const [date, setDate] = useState(istToday()); const [vehicle, setVehicle] = useState(""); const [by, setBy] = useState(""); const [note, setNote] = useState("");
  const [dc, setDc] = useState(""); const [order, setOrder] = useState(""); const [value, setValue] = useState("");
  const [q, setQ] = useState(""); const [pick, setPick] = useState<Pick>({}); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const avail = useMemo(() => items.filter((i) => { const v = from ? at(i.id, from) : { ok: 0, damaged: 0 }; return v.ok + v.damaged > 0 && itemMatches(i, q); }), [items, from, q, at]);
  const lines = Object.entries(pick).map(([k, v]) => { const [item_id, condition] = k.split("|"); return { item_id, condition, qty: parseFloat(v) }; }).filter((l) => l.qty > 0);
  const set = (k: string, v: string) => setPick((p) => ({ ...p, [k]: v.replace(/[^\d.]/g, "") }));
  async function send() {
    if (!from || !to) { setErr("Choose where the items go from and to."); return; } if (from === to) { setErr("Choose two different sites."); return; } if (!lines.length) { setErr("Enter a quantity for at least one item."); return; }
    for (const l of lines) { const v = at(l.item_id, from); const have = l.condition === "ok" ? v.ok : v.damaged; if (l.qty > have) { setErr(`Only ${qtyText(have)} ${l.condition === "ok" ? "good" : "damaged"} ${itemLabel(items.find((i) => i.id === l.item_id))} at this site.`); return; } }
    setBusy(true); setErr("");
    const { data, error } = await supabase().rpc("tool_transfer_dispatch", { p_from: from, p_to: to, p_date: date, p_vehicle: vehicle.trim(), p_carried_by: by.trim(), p_note: note.trim(), p_lines: lines, p_dc_no: dc.trim(), p_order_ref: order.trim(), p_value: value ? parseFloat(value) : null });
    if (error) { setBusy(false); setErr(error.message); return; }
    const { data: t } = await supabase().from("tool_transfers").select("transfer_no").eq("id", data as string).single(); setBusy(false); onDone(t?.transfer_no ?? "Transfer");
  }
  return (
    <div className="card space-y-3" data-new-transfer>
      <div className="font-semibold">Move items to another site</div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-xs text-slate-500">From<select className="inp mt-1" value={from} onChange={(e) => { setFrom(e.target.value); setPick({}); }}><option value="">Choose…</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block text-xs text-slate-500">To<select className="inp mt-1" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{sites.filter((s) => s.id !== from).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block text-xs text-slate-500">Dispatch date<input type="date" className="inp mt-1" max={istToday()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block text-xs text-slate-500">Vehicle no. (optional)<input className="inp mt-1" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} /></label>
        <label className="block text-xs text-slate-500">Carried by (optional)<input className="inp mt-1" value={by} onChange={(e) => setBy(e.target.value)} placeholder="driver / person" /></label>
        <label className="block text-xs text-slate-500">Note (optional)<input className="inp mt-1" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label className="block text-xs text-slate-500">DC no. from the challan book<input className="inp mt-1" value={dc} onChange={(e) => setDc(e.target.value.toUpperCase())} placeholder="e.g. DC-111" /></label>
        <label className="block text-xs text-slate-500">Declared value, ₹ (optional, printed as lumpsum)<input className="inp mt-1" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} /></label>
        <label className="block text-xs text-slate-500">Their order no. (optional)<input className="inp mt-1" value={order} onChange={(e) => setOrder(e.target.value)} /></label>
      </div>
      {from && <>
        <input className="inp !w-full sm:!w-72" type="search" placeholder="Find items at this site…" aria-label="Find items" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-slate-200">
          {!avail.length && <p className="p-4 text-sm text-slate-500">{q ? "Nothing matches." : "Nothing recorded at this site."}</p>}
          {byCategory(avail).map(([cat, list]) => <div key={cat}><div className="sticky top-0 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">{cat}</div>
            {list.map((i) => { const v = at(i.id, from); return <div key={i.id} className="px-3 py-1.5 flex flex-wrap items-center gap-2 border-t border-slate-100 text-sm">
              <span className="flex-1 min-w-40">{itemLabel(i)} <span className="text-xs text-slate-400">({qtyText(v.ok)} good{v.damaged ? `, ${qtyText(v.damaged)} damaged` : ""})</span></span>
              {v.ok > 0 && <input className="inp !w-20 !py-1 text-right" inputMode="decimal" placeholder="good" aria-label={`${itemLabel(i)}: good to send`} value={pick[`${i.id}|ok`] ?? ""} onChange={(e) => set(`${i.id}|ok`, e.target.value)} />}
              {v.damaged > 0 && <input className="inp !w-24 !py-1 text-right" inputMode="decimal" placeholder="damaged" aria-label={`${itemLabel(i)}: damaged to send`} value={pick[`${i.id}|damaged`] ?? ""} onChange={(e) => set(`${i.id}|damaged`, e.target.value)} />}
            </div>; })}</div>)}
        </div>
      </>}
      <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn btn-primary" disabled={busy} onClick={send}>{busy ? "Sending…" : `Dispatch ${lines.length} item${lines.length === 1 ? "" : "s"}`}</button><button type="button" className="btn" onClick={onClose}>Cancel</button>
        {err && <span className="text-sm text-red-700">{err}</span>}</div>
      <p className="text-xs text-slate-500">The items leave {sites.find((s) => s.id === from)?.name ?? "the sending site"} as soon as you dispatch. They count at the other site once it confirms what arrived.</p>
    </div>
  );
}

function Receive({ t, items, onClose, onDone }: { t: Transfer; items: ToolItem[]; onClose: () => void; onDone: () => void }) {
  const [got, setGot] = useState<Record<string, string>>(Object.fromEntries(t.tool_transfer_lines.map((l) => [l.id, String(l.qty)])));
  const [date, setDate] = useState(istToday()); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const short = t.tool_transfer_lines.some((l) => (parseFloat(got[l.id]) || 0) < l.qty);
  async function save() {
    if (short && !note.trim()) { setErr("Some items did not arrive: say what happened."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase().rpc("tool_transfer_receive", { p_transfer: t.id, p_date: date, p_lines: t.tool_transfer_lines.map((l) => ({ line_id: l.id, qty_received: parseFloat(got[l.id]) || 0 })), p_note: note.trim() });
    setBusy(false); if (error) { setErr(error.message); return; } onDone();
  }
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 space-y-2" data-receive>
      <div className="text-sm font-medium">What arrived? Change a number only if something is short.</div>
      {t.tool_transfer_lines.map((l) => { const i = items.find((x) => x.id === l.item_id); return <div key={l.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{itemLabel(i)}{l.condition === "damaged" ? " (damaged)" : ""} <span className="text-xs text-slate-400">sent {qtyText(l.qty)}</span></span>
        <input className="inp !w-24 !py-1 text-right" inputMode="decimal" aria-label={`${itemLabel(i)}: arrived`} value={got[l.id]} onChange={(e) => setGot({ ...got, [l.id]: e.target.value.replace(/[^\d.]/g, "") })} /></div>; })}
      <div className="grid gap-2 sm:grid-cols-[auto_1fr]"><label className="block text-xs text-slate-500">Arrived on<input type="date" className="inp mt-1" min={t.dispatched_on} max={istToday()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block text-xs text-slate-500">{short ? "What happened to the missing items" : "Note (optional)"}<input className="inp mt-1" value={note} onChange={(e) => setNote(e.target.value)} /></label></div>
      <div className="flex items-center gap-2"><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Confirm received"}</button><button type="button" className="btn btn-sm" onClick={onClose}>Not now</button>{err && <span className="text-sm text-red-700">{err}</span>}</div>
    </div>
  );
}
