"use client";
import { useEffect, useRef, useState } from "react";
import PayeeBank from "@/components/PayeeBank";
import { supabase } from "@/lib/supabase/client";
import { uploadBill } from "@/lib/billUpload";
import { ROOM_TYPE, isActive, monthLabel, rentFor, type Landlord, type Room } from "@/lib/accommodation";
import { inr, type Acc } from "./shared";

const BLANK_L = { name: "", phone: "", pan: "", notes: "" };
const BLANK_R = { count: "1", type: "non_ac", rent: "", capacity: "", from: "" };

// Set up who is paid and what is rented. Each landlord is entered once, with their phone, PAN and bank details; their rooms sit under them.
// Adding rooms, changing rents and vacating all happen inside the landlord's card.
export default function LandlordsRooms({ a, focus }: { a: Acc; focus?: string }) {
  const [showNew, setShowNew] = useState(a.landlords.length === 0); const [nl, setNl] = useState(BLANK_L); const [editing, setEditing] = useState<string | null>(null); const [el, setEl] = useState(BLANK_L);
  const [addFor, setAddFor] = useState<string | null>(null); const [nr, setNr] = useState({ ...BLANK_R, from: a.today }); const [rc, setRc] = useState<{ lid: string; sel: Record<string, boolean>; rent: string; from: string } | null>(null);
  const [busy, setBusy] = useState(false); const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus && focusRef.current) focusRef.current.scrollIntoView({ behavior: "smooth", block: "start" }); }, [focus]);
  const sb = () => supabase();
  const unassigned = a.rooms.filter((r) => !r.landlord_id);

  async function addLandlord() {
    if (!nl.name.trim()) { a.fail("Enter the landlord's name."); return; }
    const ok = await a.run(sb().from("accommodation_landlords").insert({ name: nl.name.trim(), phone: nl.phone.trim(), pan: nl.pan.trim().toUpperCase(), notes: nl.notes.trim() }), "Landlord added ✓"); if (ok) { setNl(BLANK_L); setShowNew(false); }
  }
  async function saveLandlord(l: Landlord) {
    if (!el.name.trim()) { a.fail("The landlord needs a name."); return; }
    const ok = await a.run(sb().from("accommodation_landlords").update({ name: el.name.trim(), phone: el.phone.trim(), pan: el.pan.trim().toUpperCase(), notes: el.notes.trim() }).eq("id", l.id), "Saved ✓");
    if (ok) { if (el.name.trim() !== l.name) await sb().from("accommodation_rooms").update({ landlord: el.name.trim() }).eq("landlord_id", l.id); setEditing(null); await a.reload(); }   // the name typed on the rooms follows
  }
  async function agreement(l: Landlord, f: File | null) {
    if (!f) return; setBusy(true); const u = await uploadBill(f, a.pid); if ("error" in u) { a.fail(u.error); setBusy(false); return; }
    await a.run(sb().from("accommodation_landlords").update({ agreement_path: u.path }).eq("id", l.id), "Agreement attached ✓"); setBusy(false);
  }
  async function addRooms(l: Landlord | null) {
    const count = Math.max(1, Math.min(30, parseInt(nr.count) || 1)), rent = parseFloat(nr.rent); if (!(rent >= 0) || nr.rent === "") { a.fail("Enter the monthly rent."); return; }
    let n = a.rooms.length; const base = a.rooms.reduce((m, r) => Math.max(m, r.sort_order), 0); setBusy(true);
    const rows = Array.from({ length: count }, (_, i) => ({ project_id: a.pid, name: `Room ${++n}`, room_type: nr.type, capacity: parseInt(nr.capacity) || 0, landlord: l?.name ?? "", landlord_id: l?.id ?? null, rented_from: nr.from, sort_order: base + 10 * (i + 1) }));
    const { data, error } = await sb().from("accommodation_rooms").insert(rows).select(); if (error || !data) { a.fail(error?.message ?? "Couldn't add the rooms."); setBusy(false); return; }
    const { error: e2 } = await sb().from("accommodation_rents").insert((data as Room[]).map((r) => ({ room_id: r.id, rent, effective_from: nr.from }))); setBusy(false); if (e2) { a.fail(e2.message); return; }
    a.note(`${count} room${count > 1 ? "s" : ""} added${l ? ` under ${l.name}` : ""} ✓`); setAddFor(null); setNr({ ...BLANK_R, from: a.today }); await a.reload();
  }
  const patchRoom = (r: Room, patch: Partial<Room>) => a.run(sb().from("accommodation_rooms").update(patch).eq("id", r.id));
  const assign = (r: Room, lid: string) => { const l = a.landlords.find((x) => x.id === lid); return patchRoom(r, { landlord_id: lid || null, landlord: l?.name ?? "" } as Partial<Room>); };
  function vacate(r: Room) {
    const d = prompt(`${r.name}: the last day it is rented (yyyy-mm-dd). Rent stops after that month (${monthLabel(a.thisMonth)} if today).`, a.today); if (d === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.trim())) { a.fail("Enter the date as yyyy-mm-dd."); return; } patchRoom(r, { vacated_on: d.trim() });
  }
  async function changeRent() {
    if (!rc) return; const ids = Object.keys(rc.sel).filter((k) => rc.sel[k]); const rent = parseFloat(rc.rent); if (!ids.length) { a.fail("Tick the rooms whose rent changes."); return; } if (!(rent >= 0) || rc.rent === "") { a.fail("Enter the new rent."); return; }
    const ok = await a.run(sb().from("accommodation_rents").upsert(ids.map((room_id) => ({ room_id, rent, effective_from: rc.from })), { onConflict: "room_id,effective_from" }), `Rent for ${ids.length} room${ids.length > 1 ? "s" : ""} is now ₹${inr(rent)} from ${rc.from} ✓ (earlier months keep the old rent)`); if (ok) setRc(null);
  }

  const roomTable = (l: Landlord | null, rooms: Room[]) => (
    <div className="overflow-x-auto"><table className="w-full text-sm min-w-[36rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr>{l && <th className="w-6" />}<th className="text-left py-1">Room</th><th className="text-left">Type</th><th className="text-right">Beds</th><th className="text-right">Rent / month</th><th className="text-left pl-3">{l ? "Rented" : "Landlord"}</th><th /></tr></thead>
      <tbody className="divide-y divide-slate-100">{rooms.map((r) => { const act = isActive(r, a.today); const history = a.rents.filter((x) => x.room_id === r.id).sort((x, y) => y.effective_from.localeCompare(x.effective_from)); return (
        <tr key={r.id} className={act ? "" : "opacity-60"}>{l && <td className="py-2 pr-1">{rc?.lid === l.id && act && <input type="checkbox" className="h-4 w-4" aria-label={`Change the rent of ${r.name}`} checked={!!rc.sel[r.id]} onChange={(e) => setRc({ ...rc, sel: { ...rc.sel, [r.id]: e.target.checked } })} />}</td>}
          <td className="py-2 font-medium"><input className="inp !w-28 !py-1" aria-label={`Name of ${r.name}`} defaultValue={r.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.name) patchRoom(r, { name: v }); }} />{!act && <div className="text-xs font-normal text-slate-400">vacated {r.vacated_on}</div>}</td>
          <td>{ROOM_TYPE[r.room_type]}</td>
          <td className="text-right"><input className="inp !w-16 !py-1 text-right" type="number" min="0" aria-label={`Beds in ${r.name}`} defaultValue={r.capacity || ""} placeholder="set" onBlur={(e) => { const v = parseInt(e.target.value) || 0; if (v !== r.capacity) patchRoom(r, { capacity: v }); }} /></td>
          <td className="text-right tabular-nums">₹{inr(rentFor(a.rents, r.id, a.thisMonth))}{history.length > 1 && <details className="text-[11px] text-slate-400"><summary className="cursor-pointer">history</summary>{history.map((h) => <div key={h.id}>₹{inr(h.rent)} from {h.effective_from}</div>)}</details>}</td>
          <td className="pl-3 text-xs text-slate-500">{l ? `from ${r.rented_from}` : <select className="inp !w-40 !py-1" aria-label={`Landlord of ${r.name}`} value="" onChange={(e) => e.target.value && assign(r, e.target.value)}><option value="">Choose landlord…</option>{a.landlords.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</td>
          <td className="text-right pl-2 whitespace-nowrap">{act ? <button className="text-xs text-red-700 underline" onClick={() => vacate(r)}>Vacate</button> : <button className="text-xs text-blue-700 underline" onClick={() => patchRoom(r, { vacated_on: null })}>Reopen</button>}{l && a.landlords.length > 1 && <select className="ml-2 text-xs border border-slate-200 rounded px-1 py-0.5" aria-label={`Move ${r.name} to another landlord`} value="" onChange={(e) => e.target.value && assign(r, e.target.value)}><option value="">Move…</option>{a.landlords.filter((x) => x.id !== l.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</td></tr>); })}</tbody></table></div>
  );
  const addForm = (l: Landlord | null) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2"><div className="text-sm font-medium">Add rooms{l ? ` under ${l.name}` : ""}</div>
      <p className="text-xs text-slate-500">Add one room or several of the same kind at once, for example 4 non-AC rooms at ₹7,000. Rooms are named Room {a.rooms.length + 1}, {a.rooms.length + 2}… and can be renamed above. Rent is a full month in advance from the date rented; a part month can be set on the Rent tab.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="lbl">How many</label><input className="inp !w-20" type="number" min="1" max="30" value={nr.count} onChange={(e) => setNr({ ...nr, count: e.target.value })} /></div>
        <div><label className="lbl">Type</label><select className="inp !w-28" value={nr.type} onChange={(e) => setNr({ ...nr, type: e.target.value })}><option value="non_ac">Non-AC</option><option value="ac">AC</option></select></div>
        <div><label className="lbl">Rent / month (₹)</label><input className="inp !w-32" inputMode="decimal" value={nr.rent} onChange={(e) => setNr({ ...nr, rent: e.target.value })} /></div>
        <div><label className="lbl">Beds each</label><input className="inp !w-24" type="number" min="0" value={nr.capacity} onChange={(e) => setNr({ ...nr, capacity: e.target.value })} placeholder="optional" /></div>
        <div><label className="lbl">Rented from</label><input className="inp !w-40" type="date" value={nr.from} onChange={(e) => setNr({ ...nr, from: e.target.value })} /></div>
        <button className="btn btn-primary" disabled={busy} onClick={() => addRooms(l)}>Add rooms</button><button className="btn" onClick={() => setAddFor(null)}>Cancel</button></div></div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-medium sm:mr-auto">Landlords and their rooms</h2>{!showNew && <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ Add a landlord</button>}</div>
      {showNew && <section className="card space-y-3"><h3 className="font-medium">New landlord</h3><p className="text-xs text-slate-500">Enter each landlord once. Their bank details go on their card afterwards, once, and cover all their rooms.</p>
        <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Name</label><input className="inp !w-52" value={nl.name} onChange={(e) => setNl({ ...nl, name: e.target.value })} placeholder="as on their account" /></div><div><label className="lbl">Phone</label><input className="inp !w-40" inputMode="tel" value={nl.phone} onChange={(e) => setNl({ ...nl, phone: e.target.value })} /></div><div><label className="lbl">PAN</label><input className="inp !w-36" maxLength={10} value={nl.pan} onChange={(e) => setNl({ ...nl, pan: e.target.value.toUpperCase() })} /></div><div className="min-w-48 flex-1"><label className="lbl">Notes (optional)</label><input className="inp" value={nl.notes} onChange={(e) => setNl({ ...nl, notes: e.target.value })} placeholder="e.g. verbal agreement, rent paid on the 1st" /></div></div>
        <div className="flex gap-2 form-actions"><button className="btn btn-primary" onClick={addLandlord}>Save landlord</button>{a.landlords.length > 0 && <button className="btn" onClick={() => setShowNew(false)}>Cancel</button>}</div></section>}

      {a.landlords.map((l) => { const rooms = a.rooms.filter((r) => r.landlord_id === l.id); const act = rooms.filter((r) => isActive(r, a.today)); const monthly = act.reduce((s, r) => s + rentFor(a.rents, r.id, a.thisMonth), 0); const isEd = editing === l.id; return (
        <section key={l.id} ref={focus === l.id ? focusRef : undefined} className={`card space-y-3 ${focus === l.id ? "ring-2 ring-blue-200" : ""}`}>
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1"><div className="min-w-0"><h3 className="font-semibold">{l.name}</h3><div className="text-xs text-slate-500">{[l.phone, l.pan && `PAN ${l.pan}`].filter(Boolean).join(" · ") || <span className="text-amber-700">no phone or PAN yet</span>}</div></div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${a.hasBank[l.id] ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{a.hasBank[l.id] ? "bank details ✓" : "no bank details"}</span>
            <span className="text-xs text-slate-500 sm:ml-auto">{act.length} room{act.length === 1 ? "" : "s"} · ₹{inr(monthly)} a month</span>
            {!isEd && <button className="btn btn-sm" onClick={() => { setEditing(l.id); setEl({ name: l.name, phone: l.phone, pan: l.pan, notes: l.notes }); }}>Edit details</button>}</div>
          {l.notes && !isEd && <p className="text-xs text-slate-500">{l.notes}</p>}
          {isEd && <div className="rounded-xl bg-slate-50 p-3 flex flex-wrap items-end gap-2"><div><label className="lbl">Name</label><input className="inp !w-52" value={el.name} onChange={(e) => setEl({ ...el, name: e.target.value })} /></div><div><label className="lbl">Phone</label><input className="inp !w-40" inputMode="tel" value={el.phone} onChange={(e) => setEl({ ...el, phone: e.target.value })} /></div><div><label className="lbl">PAN</label><input className="inp !w-36" maxLength={10} value={el.pan} onChange={(e) => setEl({ ...el, pan: e.target.value.toUpperCase() })} /></div><div className="min-w-48 flex-1"><label className="lbl">Notes</label><input className="inp" value={el.notes} onChange={(e) => setEl({ ...el, notes: e.target.value })} /></div><button className="btn btn-primary" onClick={() => saveLandlord(l)}>Save</button><button className="btn" onClick={() => setEditing(null)}>Cancel</button></div>}
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2"><PayeeBank kind="landlord" refId={l.id} label="Bank details (once, for all their rooms)" onSaved={a.reload} />
            <div className="text-xs">{l.agreement_path ? <a className="text-blue-700 underline" href={`/api/docs/view?path=${encodeURIComponent(l.agreement_path)}`} target="_blank" rel="noreferrer">View rent agreement</a> : <span className="text-slate-400">No written agreement (optional)</span>}{" · "}<label className="text-blue-700 underline cursor-pointer">{l.agreement_path ? "replace" : "attach one"}<input type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => agreement(l, e.target.files?.[0] ?? null)} /></label></div></div>
          {rooms.length > 0 ? roomTable(l, rooms) : <p className="text-sm text-slate-400">No rooms under {l.name} yet.</p>}
          {rc?.lid === l.id && <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 flex flex-wrap items-end gap-2"><div className="text-sm w-full">Tick the rooms above, then set the new rent.</div><div><label className="lbl">New rent / month (₹)</label><input className="inp !w-36" inputMode="decimal" value={rc.rent} onChange={(e) => setRc({ ...rc, rent: e.target.value })} /></div><div><label className="lbl">Applies from</label><input className="inp !w-40" type="date" value={rc.from} onChange={(e) => setRc({ ...rc, from: e.target.value })} /></div><button className="btn btn-primary" onClick={changeRent}>Change rent</button><button className="btn" onClick={() => setRc(null)}>Cancel</button><span className="text-xs text-slate-500">Earlier months keep the old rent.</span></div>}
          {addFor === l.id ? addForm(l) : <div className="flex flex-wrap gap-2"><button className="btn btn-sm" onClick={() => { setAddFor(l.id); setNr({ ...BLANK_R, from: a.today }); }}>+ Add rooms</button>{rooms.some((r) => isActive(r, a.today)) && !rc && <button className="btn btn-sm" onClick={() => setRc({ lid: l.id, sel: Object.fromEntries(act.map((r) => [r.id, true])), rent: "", from: a.today })}>Change rent…</button>}</div>}
        </section>); })}

      {unassigned.length > 0 && <section className="card space-y-2 border-amber-200"><h3 className="font-medium">Rooms with no landlord</h3><p className="text-xs text-slate-500">Choose a landlord for each so they are paid together and show their bank details in Payments due.</p>{roomTable(null, unassigned)}</section>}
      {!a.landlords.length && !showNew && <p className="text-sm text-slate-400">No landlords yet. Add one to start adding rooms.</p>}
    </div>
  );
}
