"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { RENT_GRACE_DAY, ROOM_TYPE, addMonths, billedIn, isActive, monthLabel, monthOf, monthsBilled, rentFor, type Rent, type Room, type RoomPayment } from "@/lib/accommodation";
import type { Project } from "@/lib/types";
import { uploadBill } from "@/lib/billUpload";
import PaymentBill from "@/components/PaymentBill";

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
type Tab = "overview" | "rooms" | "rent";

// Admin: the rooms rented for a project, whether they hold the people there, and the rent (paid a full month in advance).
// A rent payment is recorded once, here; it posts an Accommodation expense on the project, and voiding it removes that expense.
export default function Accommodation() {
  const today = istToday(); const thisMonth = monthOf(today);
  const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState(""); const [allRooms, setRooms] = useState<Room[]>([]); const [allRents, setRents] = useState<Rent[]>([]); const [allPays, setPays] = useState<RoomPayment[]>([]);
  const [people, setPeople] = useState<number | null>(null); const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [tab, setTab] = useState<Tab>("overview"); const [month, setMonth] = useState(thisMonth);
  const [nr, setNr] = useState({ count: "1", type: "non_ac", prefix: "Room", rent: "", capacity: "", landlord: "", from: today }); const [rentIn, setRentIn] = useState<Record<string, string>>({}); const [rentFrom, setRentFrom] = useState(today);
  const [pf, setPf] = useState({ room_id: "", amount: "", paid_on: today, reference: "", note: "" });
  // one payment for several rooms: the rooms ticked, each with the amount to pay (the rent still left by default)
  const [busyBatch, setBusyBatch] = useState(false); const [pfBill, setPfBill] = useState<File | null>(null); const [bpBill, setBpBill] = useState<File | null>(null); const [sel, setSel] = useState<Record<string, string>>({}); const [bp, setBp] = useState({ paid_on: today, reference: "", note: "" }); const [openBatch, setOpenBatch] = useState<string | null>(null);
  useEffect(() => { setSel({}); }, [month, pid]);
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  async function load() {
    const sb = supabase(); const [pr, r, rt, p] = await Promise.all([sb.from("projects").select("*").eq("status", "active").order("name"), sb.from("accommodation_rooms").select("*").order("sort_order").order("name"), sb.from("accommodation_rents").select("*"), sb.from("accommodation_payments").select("*").order("paid_on", { ascending: false })]);
    const x = pr.error || r.error || rt.error || p.error; if (x) { setErr(x.message + " — has the accommodation SQL migration (2026-10-accommodation.sql) been run?"); setLoading(false); return; }
    const pl = (pr.data || []) as Project[]; setProjects(pl); setPid((c) => c || pl[0]?.id || ""); setRooms((r.data || []) as Room[]);
    setRents(((rt.data || []) as Rent[]).map((q) => ({ ...q, rent: Number(q.rent) }))); setPays(((p.data || []) as RoomPayment[]).map((q) => ({ ...q, amount: Number(q.amount) }))); setErr(""); setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!pid) return; (async () => { const { data } = await supabase().rpc("attendance_roster", { p_project: pid, p_from: today, p_to: today }); setPeople(Array.isArray(data) ? data.length : null); })(); }, [pid, today]);

  const rooms = useMemo(() => allRooms.filter((r) => r.project_id === pid), [allRooms, pid]); const ids = useMemo(() => new Set(rooms.map((r) => r.id)), [rooms]);
  const rents = useMemo(() => allRents.filter((r) => ids.has(r.room_id)), [allRents, ids]); const pays = useMemo(() => allPays.filter((x) => ids.has(x.room_id)), [allPays, ids]);
  const active = rooms.filter((r) => isActive(r, today));
  const live = (x: RoomPayment) => !x.voided_at;
  const paidFor = (roomId: string, ym: string) => pays.filter((x) => x.room_id === roomId && live(x) && x.for_month && monthOf(x.for_month) === ym).reduce((s, x) => s + x.amount, 0);
  const rows = useMemo(() => rooms.map((r) => {
    const upto = thisMonth; const billed = monthsBilled(r, upto).reduce((s, m) => s + rentFor(rents, r.id, m), 0); const paid = pays.filter((x) => x.room_id === r.id && live(x)).reduce((s, x) => s + x.amount, 0);
    const rent = billedIn(r, month) ? rentFor(rents, r.id, month) : 0; const pm = paidFor(r.id, month);
    const overdue = rent > pm && (month < thisMonth || (month === thisMonth && Number(today.slice(8)) > RENT_GRACE_DAY));
    return { r, now: rentFor(rents, r.id, thisMonth), rent, pm, left: Math.max(0, rent - pm), status: !rent ? "—" : pm >= rent ? "Paid" : overdue ? "Overdue" : pm > 0 ? "Part paid" : "Due", billed, paid, due: billed - paid };
  }), [rooms, rents, pays, month, thisMonth, today]);
  const tot = rows.reduce((a, o) => ({ rent: a.rent + o.rent, pm: a.pm + o.pm, left: a.left + o.left, due: a.due + o.due }), { rent: 0, pm: 0, left: 0, due: 0 });
  const monthlyNow = active.reduce((s, r) => s + rentFor(rents, r.id, thisMonth), 0); const nextRent = active.reduce((s, r) => s + (billedIn(r, addMonths(thisMonth, 1)) ? rentFor(rents, r.id, addMonths(thisMonth, 1)) : 0), 0);
  const beds = active.reduce((s, r) => s + r.capacity, 0); const unset = active.filter((r) => !r.capacity).length; const avgBeds = active.filter((r) => r.capacity).length ? beds / active.filter((r) => r.capacity).length : 0;
  const short = people !== null && beds > 0 ? Math.max(0, people - beds) : 0; const moreRooms = short && avgBeds ? Math.ceil(short / avgBeds) : 0;
  // payments made together (several rooms in one go) show as one line; single-room payments stay as they were
  const groups = useMemo(() => { const out: { key: string; batch: boolean; rows: RoomPayment[] }[] = []; const at = new Map<string, number>(); for (const x of pays) { if (x.batch_id) { const k = at.get(x.batch_id); if (k === undefined) { at.set(x.batch_id, out.length); out.push({ key: x.batch_id, batch: true, rows: [x] }); } else out[k].rows.push(x); } else out.push({ key: x.id, batch: false, rows: [x] }); } return out; }, [pays]);
  const rName = (id: string) => allRooms.find((r) => r.id === id)?.name ?? "?";

  async function run(p: PromiseLike<{ error: { message: string } | null }>, ok?: string) { setErr(""); const { error } = await p; if (error) { setErr(error.message); return false; } if (ok) note(ok); await load(); return true; }
  const sb = () => supabase();
  async function addRooms() {
    const count = Math.max(1, Math.min(30, parseInt(nr.count) || 1)); const rent = parseFloat(nr.rent); if (!(rent >= 0)) { setErr("Enter the monthly rent."); return; } setErr("");
    let n = rooms.length; const base = rooms.reduce((m, r) => Math.max(m, r.sort_order), 0);
    const rows = Array.from({ length: count }, (_, i) => ({ project_id: pid, name: `${nr.prefix.trim() || "Room"} ${++n}`, room_type: nr.type, capacity: parseInt(nr.capacity) || 0, landlord: nr.landlord.trim(), rented_from: nr.from, sort_order: base + 10 * (i + 1) }));
    const { data, error } = await sb().from("accommodation_rooms").insert(rows).select(); if (error || !data) { setErr(error?.message ?? "Couldn't add the rooms."); return; }
    const { error: e2 } = await sb().from("accommodation_rents").insert((data as Room[]).map((r) => ({ room_id: r.id, rent, effective_from: nr.from }))); if (e2) { setErr(e2.message); return; }
    note(`${count} room${count > 1 ? "s" : ""} added ✓`); setNr({ ...nr, rent: nr.rent }); load();
  }
  const patchRoom = (r: Room, patch: Partial<Room>) => run(sb().from("accommodation_rooms").update(patch).eq("id", r.id));
  const setRent = async (r: Room) => { const v = parseFloat(rentIn[r.id] || ""); if (!(v >= 0)) return; if (await run(sb().from("accommodation_rents").upsert({ room_id: r.id, rent: v, effective_from: rentFrom }, { onConflict: "room_id,effective_from" }), "Rent saved ✓")) setRentIn((s) => ({ ...s, [r.id]: "" })); };
  const vacate = (r: Room) => { if (confirm(`Mark ${r.name} as vacated? Rent stops after this month (${monthLabel(thisMonth)}).`)) patchRoom(r, { vacated_on: today }); };
  async function pay(roomId: string, amount: number, ym: string, ref: string, paidOn: string, noteTxt: string, billPath?: string) {
    return sb().from("accommodation_payments").insert({ room_id: roomId, for_month: monthFirstOf(ym), amount, paid_on: paidOn, reference: ref, note: noteTxt, ...(billPath ? { bill_path: billPath } : {}) });
  }
  const monthFirstOf = (ym: string) => `${ym}-01`;
  async function addPay() { const amount = parseFloat(pf.amount); if (!pf.room_id || !(amount > 0)) { setErr("Choose the room and enter the amount."); return; } setErr(""); let billPath: string | undefined; if (pfBill) { const u = await uploadBill(pfBill, pid); if ("error" in u) { setErr(u.error); return; } billPath = u.path; } const { error } = await pay(pf.room_id, amount, month, pf.reference.trim(), pf.paid_on, pf.note.trim(), billPath); if (error) { setErr(/bill_path|schema cache/i.test(error.message) ? "Attaching bills needs the latest SQL migration (2026-10-accommodation.sql). Run it in Supabase, then try again." : error.message); return; } setPfBill(null); setPf({ ...pf, amount: "", reference: "", note: "" }); note("Rent payment recorded and posted to the project's Accommodation expenses ✓"); load(); }
  const toggleRoom = (id: string, left: number) => setSel((c) => { const n = { ...c }; if (id in n) delete n[id]; else n[id] = String(left); return n; });
  const selectWhere = (pred: (r: Room) => boolean) => setSel(Object.fromEntries(rows.filter((o) => o.left > 0 && pred(o.r)).map((o) => [o.r.id, String(o.left)])));
  const selRows = rows.filter((o) => o.r.id in sel); const selTotal = selRows.reduce((s, o) => s + (parseFloat(sel[o.r.id]) || 0), 0);
  async function payBatch() {
    const lines = selRows.map((o) => ({ o, amount: parseFloat(sel[o.r.id]) })); if (!lines.length) return; if (lines.some((l) => !(l.amount > 0))) { setErr("Every ticked room needs an amount above zero."); return; } setErr(""); setBusyBatch(true);
    let billPath: string | undefined; if (bpBill) { const u = await uploadBill(bpBill, pid); if ("error" in u) { setErr(u.error); setBusyBatch(false); return; } billPath = u.path; }
    const batch = crypto.randomUUID();
    const { error } = await sb().from("accommodation_payments").insert(lines.map((l) => ({ batch_id: batch, room_id: l.o.r.id, for_month: monthFirstOf(month), amount: l.amount, paid_on: bp.paid_on, reference: bp.reference.trim(), note: bp.note.trim(), ...(billPath ? { bill_path: billPath } : {}) }))); setBusyBatch(false);
    if (error) { setErr(/batch_id|schema cache/i.test(error.message) ? "Paying several rooms at once needs the latest SQL migration (2026-10-accommodation.sql). Run it in Supabase, then try again." : error.message); return; }
    setSel({}); setBpBill(null); setBp({ ...bp, reference: "", note: "" }); note(`One payment of ₹${inr(lines.reduce((s, l) => s + l.amount, 0))} recorded for ${lines.length} room${lines.length > 1 ? "s" : ""} and posted to the project's Accommodation expenses ✓`); load();
  }
  const attachBill = (x: RoomPayment, path: string) => run(x.batch_id ? sb().from("accommodation_payments").update({ bill_path: path }).eq("batch_id", x.batch_id) : sb().from("accommodation_payments").update({ bill_path: path }).eq("id", x.id), "Bill attached; it shows on the project's expense ✓");
  const voidBatch = (rows: RoomPayment[]) => { const total = rows.filter((x) => !x.voided_at).reduce((s, x) => s + x.amount, 0); if (confirm(`Void this ₹${inr(total)} payment for ${rows.filter((x) => !x.voided_at).length} rooms? It stays in the list, marked void, and its expense is removed.`)) run(sb().from("accommodation_payments").update({ voided_at: new Date().toISOString() }).eq("batch_id", rows[0].batch_id!).is("voided_at", null), "Voided; the expense was removed ✓"); };
  const voidIt = (x: RoomPayment) => { if (confirm(`Void the ₹${inr(x.amount)} rent payment for ${rName(x.room_id)}? It stays in the list, marked void, and its expense is removed.`)) run(sb().from("accommodation_payments").update({ voided_at: new Date().toISOString() }).eq("id", x.id), "Voided; the expense was removed ✓"); };
  function csv() {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`; const proj = projects.find((p) => p.id === pid)?.name ?? "project";
    const body = [["Room", "Type", "Landlord", `Rent ${month}`, "Paid", "Balance", "Status"], ...rows.filter((o) => o.rent).map((o) => [o.r.name, ROOM_TYPE[o.r.room_type], o.r.landlord, o.rent, o.pm, o.left, o.status])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + body.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" })); a.download = `${proj} - rent ${month}.csv`; a.click();
  }

  const card = (l: string, v: string, sub?: string, tone = "") => <div className="rounded-2xl bg-white border border-slate-200/80 p-3"><div className="text-xs text-slate-400">{l}</div><div className={`text-lg font-medium tabular-nums ${tone}`}>{v}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
  const pill = (s: string) => <span className={`rounded-full px-2 py-0.5 text-[11px] ${s === "Paid" ? "bg-emerald-50 text-emerald-700" : s === "Overdue" ? "bg-rose-50 text-rose-700" : s === "Part paid" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{s}</span>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Accommodation</h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => { setPid(e.target.value); setPf((f) => ({ ...f, room_id: "" })); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}</option>)}</select>}</div>
      <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">{([["overview", "Overview"], ["rooms", "Rooms"], ["rent", "Rent & payments"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab whitespace-nowrap ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}{loading && <p className="text-slate-500">Loading…</p>}

      {!loading && tab === "overview" && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {card("Rooms", String(active.length), `${active.filter((r) => r.room_type === "ac").length} AC · ${active.filter((r) => r.room_type === "non_ac").length} non-AC`)}
          {card("Rent per month", `₹${inr(monthlyNow)}`, nextRent !== monthlyNow ? `₹${inr(nextRent)} next month` : "same next month")}
          {card(`${monthLabel(thisMonth)} rent`, `₹${inr(rows.reduce((s, o) => s + (billedIn(o.r, thisMonth) ? rentFor(rents, o.r.id, thisMonth) : 0), 0))}`, `₹${inr(rows.reduce((s, o) => s + paidFor(o.r.id, thisMonth), 0))} paid`)}
          {card("Outstanding rent", `₹${inr(tot.due)}`, "all months to date", tot.due > 0 ? "text-amber-800" : "")}
        </div>
        <section className="card space-y-2" data-capacity><h2 className="font-medium">Do the rooms hold everyone?</h2>
          <div className="grid grid-cols-3 gap-3 text-center">{[["Beds", beds ? String(beds) : "not set"], ["People on this project", people === null ? "…" : String(people)], [short ? "Short by" : "Spare beds", beds && people !== null ? String(short || Math.max(0, beds - people)) : "—"]].map(([l, v]) => <div key={l} className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">{l}</div><div className={`text-xl font-medium tabular-nums ${l === "Short by" ? "text-rose-700" : ""}`}>{v}</div></div>)}</div>
          {unset > 0 && <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2">{unset} room{unset > 1 ? "s have" : " has"} no bed count yet. Set it on the Rooms tab so this comparison is right.</p>}
          {short > 0 && <p className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">The rooms are short by <b>{short}</b> bed{short > 1 ? "s" : ""}{moreRooms ? <>: roughly <b>{moreRooms} more room{moreRooms > 1 ? "s" : ""}</b> at your current {avgBeds.toFixed(1)} beds per room.</> : "."} <button className="underline" onClick={() => setTab("rooms")}>Add rooms</button></p>}
          {!short && beds > 0 && people !== null && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">The rooms hold everyone, with {beds - people} spare bed{beds - people === 1 ? "" : "s"}.</p>}
          <p className="text-xs text-slate-400">People = everyone on this project with a joining date up to today, from the employee records.</p></section>
        <section className="card space-y-2"><h2 className="font-medium">Rooms</h2><div className="overflow-x-auto"><table className="w-full text-sm min-w-[34rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Room</th><th className="text-left">Type</th><th className="text-right">Beds</th><th className="text-right">Rent / month</th><th className="text-right">{monthLabel(thisMonth)}</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.filter((o) => isActive(o.r, today)).map((o) => <tr key={o.r.id}><td className="py-2 font-medium">{o.r.name}{o.r.landlord && <div className="text-xs font-normal text-slate-400">{o.r.landlord}</div>}</td><td>{ROOM_TYPE[o.r.room_type]}</td><td className="text-right tabular-nums">{o.r.capacity || "—"}</td><td className="text-right tabular-nums">₹{inr(o.now)}</td><td className="text-right">{month === thisMonth ? pill(o.status) : "—"}</td></tr>)}</tbody></table></div>
          {!rooms.length && <p className="text-sm text-slate-400">No rooms for this project yet. Add them on the Rooms tab.</p>}</section>
      </>}

      {!loading && tab === "rooms" && <>
        <section className="card space-y-3"><h2 className="font-medium">Rooms on this project</h2>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[52rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Room</th><th className="text-left">Type</th><th className="text-right">Beds</th><th className="text-left pl-3">Landlord</th><th className="text-right">Rent / month</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rooms.map((r) => <tr key={r.id} className={isActive(r, today) ? "" : "opacity-60"}><td className="py-2 font-medium">{r.name}{!isActive(r, today) && <span className="text-xs text-slate-400 font-normal"> (vacated {r.vacated_on})</span>}<div className="text-xs font-normal text-slate-400">from {r.rented_from}</div></td><td>{ROOM_TYPE[r.room_type]}</td>
              <td className="text-right"><input className="inp !w-16 !py-1 text-right" type="number" min="0" aria-label={`Beds in ${r.name}`} defaultValue={r.capacity || ""} placeholder="set" onBlur={(e) => { const v = parseInt(e.target.value) || 0; if (v !== r.capacity) patchRoom(r, { capacity: v }); }} /></td>
              <td className="pl-3"><input className="inp !w-40 !py-1" aria-label={`Landlord of ${r.name}`} defaultValue={r.landlord} placeholder="who is paid" onBlur={(e) => { if (e.target.value.trim() !== r.landlord) patchRoom(r, { landlord: e.target.value.trim() }); }} /></td>
              <td className="text-right"><div className="flex items-center justify-end gap-1.5"><span className="tabular-nums">₹{inr(rentFor(rents, r.id, thisMonth))}</span><input className="inp !w-20 !py-1" inputMode="decimal" placeholder="new" aria-label={`New rent for ${r.name}`} value={rentIn[r.id] ?? ""} onChange={(e) => setRentIn((s) => ({ ...s, [r.id]: e.target.value }))} /><button className="btn !min-h-8" onClick={() => setRent(r)}>Set</button></div></td>
              <td className="text-right pl-2">{isActive(r, today) ? <button className="text-xs text-red-700 underline" onClick={() => vacate(r)}>Vacate</button> : <button className="text-xs text-blue-700 underline" onClick={() => patchRoom(r, { vacated_on: null })}>Reopen</button>}</td></tr>)}</tbody></table></div>
          {!rooms.length && <p className="text-sm text-slate-400">No rooms yet. Add them below.</p>}
          <label className="text-xs text-slate-500 flex items-center gap-2">A changed rent applies from<input type="date" className="inp !w-40" value={rentFrom} onChange={(e) => setRentFrom(e.target.value)} aria-label="Rent applies from" /> (earlier months keep the old rent)</label></section>
        <section className="card space-y-3"><h2 className="font-medium">Add rooms</h2><p className="text-xs text-slate-400">Add one room or several of the same kind at once, for example 4 non-AC rooms at ₹7,000, then 1 AC room at ₹13,000. Rooms are named Room {rooms.length + 1}, {rooms.length + 2}… and can be renamed later. Rent is paid a full month in advance, for every month from the date rented.</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div><label className="lbl">How many</label><input className="inp !w-20" type="number" min="1" max="30" value={nr.count} onChange={(e) => setNr({ ...nr, count: e.target.value })} aria-label="How many rooms" /></div>
            <div><label className="lbl">Type</label><select className="inp !w-28" value={nr.type} onChange={(e) => setNr({ ...nr, type: e.target.value })} aria-label="Room type"><option value="non_ac">Non-AC</option><option value="ac">AC</option></select></div>
            <div><label className="lbl">Rent / month (₹)</label><input className="inp !w-32" inputMode="decimal" value={nr.rent} onChange={(e) => setNr({ ...nr, rent: e.target.value })} aria-label="Rent per month" /></div>
            <div><label className="lbl">Beds each</label><input className="inp !w-24" type="number" min="0" value={nr.capacity} onChange={(e) => setNr({ ...nr, capacity: e.target.value })} aria-label="Beds each" placeholder="optional" /></div>
            <div><label className="lbl">Landlord</label><input className="inp !w-44" value={nr.landlord} onChange={(e) => setNr({ ...nr, landlord: e.target.value })} aria-label="Landlord" placeholder="who is paid" /></div>
            <div><label className="lbl">Rented from</label><input className="inp !w-40" type="date" value={nr.from} onChange={(e) => setNr({ ...nr, from: e.target.value })} aria-label="Rented from" /></div>
            <button className="btn btn-primary" onClick={addRooms}>Add rooms</button></div></section>
      </>}

      {!loading && tab === "rent" && <>
        <section className="card space-y-3"><div className="flex flex-wrap items-center gap-3"><h2 className="font-medium">Rent for</h2><input type="month" className="inp !w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
          <span className="text-sm text-slate-500">₹{inr(tot.pm)} paid of ₹{inr(tot.rent)}</span><div className="ml-auto flex gap-2"><button className="btn" onClick={csv} disabled={!tot.rent}>⬇ CSV</button><button className="btn" onClick={() => selectWhere((r) => r.room_type === "non_ac")} disabled={!tot.left}>Select Non-AC</button><button className="btn" onClick={() => selectWhere((r) => r.room_type === "ac")} disabled={!tot.left}>Select AC</button><button className="btn" onClick={() => selectWhere(() => true)} disabled={!tot.left}>Select all unpaid</button></div></div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[40rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="w-8"></th><th className="text-left py-1">Room</th><th className="text-left">Landlord</th><th className="text-right">Rent</th><th className="text-right">Paid</th><th className="text-right">Left</th><th className="text-right">Status</th><th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.filter((o) => o.rent).map((o) => <tr key={o.r.id}><td className="py-2 pr-1">{o.left > 0 ? <input type="checkbox" className="h-4 w-4" aria-label={`Select ${o.r.name}`} checked={o.r.id in sel} onChange={() => toggleRoom(o.r.id, o.left)} /> : null}</td><td className="py-2 font-medium">{o.r.name}</td><td className="text-slate-500">{o.r.landlord || "—"}</td><td className="text-right tabular-nums">₹{inr(o.rent)}</td><td className="text-right tabular-nums">₹{inr(o.pm)}</td><td className="text-right tabular-nums">₹{inr(o.left)}</td><td className="text-right">{pill(o.status)}</td><td className="text-right pl-2">{o.left > 0 && <button className="text-xs text-blue-700 underline" onClick={() => setPf({ ...pf, room_id: o.r.id, amount: String(o.left) })}>Pay</button>}</td></tr>)}</tbody></table></div>
          {!tot.rent && <p className="text-sm text-slate-400">No rent is due for {monthLabel(month)}.</p>}
          {selRows.length > 0 && <div className="rounded border border-sky-200 bg-sky-50 p-3 space-y-2" data-batch>
            <div className="flex flex-wrap items-center gap-2"><b className="text-sm">One payment for {selRows.length} room{selRows.length > 1 ? "s" : ""}</b><span className="tabular-nums font-semibold" data-batch-total>₹{inr(selTotal)}</span><button className="text-xs underline ml-auto" onClick={() => setSel({})}>Clear</button></div>
            <div className="grid gap-1 sm:grid-cols-2">{selRows.map((o) => <label key={o.r.id} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{o.r.name}</span><span className="text-xs text-slate-400">left ₹{inr(o.left)}</span><input className="inp !w-28" inputMode="decimal" aria-label={`Amount for ${o.r.name}`} value={sel[o.r.id]} onChange={(e) => setSel({ ...sel, [o.r.id]: e.target.value })} /></label>)}</div>
            <div className="flex flex-wrap gap-2 items-end">
              <input className="inp !w-40" type="date" aria-label="Batch paid on" value={bp.paid_on} onChange={(e) => setBp({ ...bp, paid_on: e.target.value })} />
              <input className="inp !w-44" placeholder="Reference / UTR" aria-label="Batch reference" value={bp.reference} onChange={(e) => setBp({ ...bp, reference: e.target.value })} />
              <input className="inp !w-44" placeholder="Note (optional)" aria-label="Batch note" value={bp.note} onChange={(e) => setBp({ ...bp, note: e.target.value })} />
              <label className="text-xs text-slate-500 flex items-center gap-1">Bill<input type="file" accept="image/*,application/pdf" aria-label="Batch bill" className="max-w-[11rem] text-xs" onChange={(e) => setBpBill(e.target.files?.[0] ?? null)} /></label>
              <button className="btn btn-primary" onClick={payBatch} disabled={busyBatch}>Record payment (₹{inr(selTotal)})</button></div></div>}
          <p className="text-xs text-slate-400">Rent is paid a full month in advance: a month's rent is due on the 1st and shows as overdue after the {RENT_GRACE_DAY}th. A part month is billed in full.</p></section>
        <section className="card space-y-3"><h2 className="font-medium">Record a payment</h2><p className="text-xs text-slate-400">For the month chosen above. Each payment is recorded once, here, and posts an Accommodation expense on the project by itself. Payments are never edited; a wrong one is voided and entered again.</p>
          <div className="flex flex-wrap gap-2 items-end">
            <select className="inp !w-44" aria-label="Room" value={pf.room_id} onChange={(e) => { const o = rows.find((x) => x.r.id === e.target.value); setPf({ ...pf, room_id: e.target.value, amount: o && o.left ? String(o.left) : pf.amount }); }}><option value="">Room…</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            <input className="inp !w-32" inputMode="decimal" placeholder="Amount ₹" aria-label="Amount" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} />
            <input className="inp !w-40" type="date" aria-label="Paid on" value={pf.paid_on} onChange={(e) => setPf({ ...pf, paid_on: e.target.value })} />
            <input className="inp !w-40" placeholder="Reference / UTR" aria-label="Reference" value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} />
            <label className="text-xs text-slate-500 flex items-center gap-1">Bill<input type="file" accept="image/*,application/pdf" aria-label="Payment bill" className="max-w-[11rem] text-xs" onChange={(e) => setPfBill(e.target.files?.[0] ?? null)} /></label>
            <button className="btn btn-primary" onClick={addPay}>Record payment</button></div>
          <ul className="divide-y divide-slate-100 text-sm" data-payments>{groups.map((g) => g.batch ? (
            <li key={g.key} className={`py-2 ${g.rows.every((x) => x.voided_at) ? "text-slate-400 line-through" : ""}`} data-batch-row><div className="flex flex-wrap items-center gap-x-3"><span className="tabular-nums w-24">{g.rows[0].paid_on}</span><button className="w-28 truncate text-left underline decoration-dotted" onClick={() => setOpenBatch(openBatch === g.key ? null : g.key)}>{g.rows.length > 1 ? `${g.rows.length} rooms` : rName(g.rows[0].room_id)}</button><span className="w-20 text-xs text-slate-500">{g.rows[0].for_month ? monthLabel(monthOf(g.rows[0].for_month)) : ""}</span><span className="tabular-nums w-24">₹{inr(g.rows.filter((x) => !x.voided_at).reduce((s, x) => s + x.amount, 0))}</span><span className="text-xs text-slate-400 flex-1 truncate">{g.rows.map((x) => rName(x.room_id)).join(", ")}{g.rows[0].reference ? ` · ${g.rows[0].reference}` : ""}</span><PaymentBill path={g.rows.find((x) => x.bill_path)?.bill_path} projectId={pid} onAttach={(path) => attachBill(g.rows[0], path)} onError={setErr} />{g.rows.every((x) => x.voided_at) ? <span className="text-xs">void</span> : <button className="text-xs text-red-700 underline" onClick={() => voidBatch(g.rows)}>Void all</button>}</div>
              {openBatch === g.key && <ul className="mt-1 ml-6 text-xs text-slate-600">{g.rows.map((x) => <li key={x.id} className={`flex gap-3 ${x.voided_at ? "text-slate-400 line-through" : ""}`}><span className="w-28 truncate">{rName(x.room_id)}</span><span className="tabular-nums">₹{inr(x.amount)}</span>{x.voided_at ? <span>void</span> : <button className="text-red-700 underline" onClick={() => voidIt(x)}>Void</button>}</li>)}</ul>}</li>
          ) : (() => { const x = g.rows[0]; return <li key={x.id} className={`py-2 flex flex-wrap items-center gap-x-3 ${x.voided_at ? "text-slate-400 line-through" : ""}`}><span className="tabular-nums w-24">{x.paid_on}</span><span className="w-28 truncate">{rName(x.room_id)}</span><span className="w-20 text-xs text-slate-500">{x.for_month ? monthLabel(monthOf(x.for_month)) : ""}</span><span className="tabular-nums w-24">₹{inr(x.amount)}</span><span className="text-xs text-slate-400 flex-1 truncate">{x.reference}{x.note ? ` · ${x.note}` : ""}</span><PaymentBill path={x.bill_path} projectId={pid} onAttach={(path) => attachBill(x, path)} onError={setErr} />{x.voided_at ? <span className="text-xs">void</span> : <button className="text-xs text-red-700 underline" onClick={() => voidIt(x)}>Void</button>}</li>; })())}</ul>
          {!pays.length && <p className="text-sm text-slate-400">No payments recorded.</p>}</section>
      </>}
    </div>
  );
}
