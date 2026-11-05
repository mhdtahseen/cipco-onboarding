"use client";
import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { uploadBill } from "@/lib/billUpload";
import { RENT_GRACE_DAY, addMonths, chargeOf, daysInMonth, monthLabel, monthOf, rentByDays, rentFor, type Landlord, type Room } from "@/lib/accommodation";
import { inr, live, pill, rentRows, type Acc, type RentRow } from "./shared";

type Bank = { holder: string; bank: string; branch: string; account_no: string; ifsc: string; upi: string };
type Adj = { roomId: string; mode: "full" | "days" | "custom" | "none"; from: string; to: string; amount: string; reason: string };

const copy = async (t: string, done: () => void) => { try { await navigator.clipboard.writeText(t); done(); } catch { /* clipboard unavailable */ } };

// The landlord's bank details, right where the money is sent from, with a copy button for each part.
function BankInfo({ landlord }: { landlord: Landlord }) {
  const [b, setB] = useState<Bank | null | undefined>(undefined); const [c, setC] = useState("");
  useEffect(() => { let on = true; (async () => { const { data } = await supabase().from("payee_bank").select("holder, bank, branch, account_no, ifsc, upi").eq("kind", "landlord").eq("ref_id", landlord.id).maybeSingle(); if (on) setB((data as Bank | null) ?? null); })(); return () => { on = false; }; }, [landlord.id]);
  if (b === undefined) return <div className="text-xs text-slate-400">Loading bank details…</div>;
  if (!b || !(b.account_no || b.upi)) return <div className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2">No bank details for {landlord.name} yet. Add them under Landlords &amp; rooms, then pay.</div>;
  const item = (k: string, label: string, v: string) => v ? <div key={k} className="flex items-center gap-2 text-sm"><span className="w-20 text-xs text-slate-400">{label}</span><span className="flex-1 min-w-0 break-all tabular-nums">{v}</span><button className="text-xs text-blue-700 underline" onClick={() => copy(v, () => { setC(k); setTimeout(() => setC(""), 1500); })}>{c === k ? "Copied ✓" : "Copy"}</button></div> : null;
  return <div className="rounded-xl bg-slate-50 p-3 space-y-1">{item("h", "Account name", b.holder || landlord.name)}{item("b", "Bank", [b.bank, b.branch].filter(Boolean).join(" · "))}{item("a", "Account no.", b.account_no)}{item("i", "IFSC", b.ifsc)}{item("u", "UPI", b.upi)}</div>;
}

// Rent for a month, by landlord: what is charged, what has been paid and what is still to pay, one Pay button per landlord, and a way to say that a month was charged in part or not at all.
export default function RentTab({ a, openFor }: { a: Acc; openFor?: string }) {
  const [month, setMonth] = useState(a.thisMonth); const [payFor, setPayFor] = useState<string | null>(openFor ?? null); const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [pf, setPf] = useState({ paid_on: a.today, reference: "", note: "" }); const [bill, setBill] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const [adj, setAdj] = useState<Adj | null>(null); const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = rentRows(a, month); const totals = rows.reduce((t, o) => ({ charge: t.charge + o.charge, paid: t.paid + o.paid, left: t.left + o.left }), { charge: 0, paid: 0, left: 0 });
  const groupsKeys = [...a.landlords.map((l) => l.id), "none"]; const rowsOf = (key: string) => rows.filter((o) => (key === "none" ? !o.room.landlord_id : o.room.landlord_id === key) && (o.charge > 0 || o.adj));
  const sb = () => supabase(); useEffect(() => { setAdj(null); }, [month]);
  const startPay = (key: string) => { setPayFor(key); setPf({ paid_on: a.today, reference: "", note: "" }); setBill(null); setAmounts(Object.fromEntries(rowsOf(key).filter((o) => o.left > 0).map((o) => [o.room.id, String(o.left)]))); setAdj(null); };
  useEffect(() => { if (openFor) startPay(openFor); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [openFor]);

  async function recordPay() {
    const lines = Object.entries(amounts).map(([room_id, v]) => ({ room_id, amount: parseFloat(v) })).filter((l) => l.amount > 0); if (!lines.length) { a.fail("Enter an amount for at least one room."); return; } setBusy(true);
    let bill_path: string | undefined; if (bill) { const u = await uploadBill(bill, a.pid); if ("error" in u) { a.fail(u.error); setBusy(false); return; } bill_path = u.path; }
    const batch = crypto.randomUUID(); const { error } = await sb().from("accommodation_payments").insert(lines.map((l) => ({ batch_id: batch, room_id: l.room_id, for_month: `${month}-01`, amount: l.amount, paid_on: pf.paid_on, reference: pf.reference.trim(), note: pf.note.trim(), ...(bill_path ? { bill_path } : {}) }))); setBusy(false);
    if (error) { a.fail(error.message); return; } a.note(`One payment of ₹${inr(lines.reduce((s, l) => s + l.amount, 0))} recorded for ${lines.length} room${lines.length > 1 ? "s" : ""} and posted to the project's Accommodation expenses ✓`); setPayFor(null); setAmounts({}); await a.reload();
  }
  const startAdjust = (o: RentRow) => { const full = rentFor(a.rents, o.room.id, month); setAdj({ roomId: o.room.id, mode: !o.adj ? "full" : o.adj.amount === 0 ? "none" : o.adj.amount === full ? "full" : "custom", from: "1", to: String(daysInMonth(month)), amount: o.adj ? String(o.adj.amount) : String(full), reason: o.adj?.reason ?? "" }); setPayFor(null); };
  async function saveAdjust(o: RentRow) {
    if (!adj) return; const full = rentFor(a.rents, o.room.id, month); const fromD = parseInt(adj.from) || 1, toD = parseInt(adj.to) || daysInMonth(month);
    const amount = adj.mode === "full" ? full : adj.mode === "none" ? 0 : adj.mode === "days" ? rentByDays(full, month, fromD, toD) : parseFloat(adj.amount);
    if (!(amount >= 0)) { a.fail("Enter the amount charged."); return; }
    const reason = adj.reason.trim() || (adj.mode === "none" ? "Not charged" : adj.mode === "days" ? `Charged for days ${fromD}–${toD}` : "");
    const ok = adj.mode === "full" && !o.adj ? true : await a.run(adj.mode === "full" ? sb().from("accommodation_adjustments").delete().eq("room_id", o.room.id).eq("for_month", `${month}-01`) : sb().from("accommodation_adjustments").upsert({ room_id: o.room.id, for_month: `${month}-01`, amount, reason }, { onConflict: "room_id,for_month" }),
      adj.mode === "full" ? `${o.room.name}: full rent for ${monthLabel(month)} ✓` : `${o.room.name}: ${monthLabel(month)} is charged ₹${inr(amount)} ✓`);
    if (ok) { setAdj(null); if (o.paid > amount && amount >= 0) a.note(`${o.room.name}: ₹${inr(o.paid)} was already paid for ${monthLabel(month)}, which is more than the ₹${inr(amount)} now charged. Check the payments.`); }
  }
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const statement = (key: string, rooms: Room[]) => {
    if (!rooms.length) return null; const first = rooms.reduce((m, r) => (monthOf(r.rented_from) < m ? monthOf(r.rented_from) : m), a.thisMonth); const months: string[] = []; for (let m = first; m <= addMonths(a.thisMonth, 1) && months.length < 120; m = addMonths(m, 1)) months.push(m);
    let run = 0; const lines = months.map((m) => { const due = rooms.reduce((s, r) => s + chargeOf(r, a.rents, a.adjs, m), 0); const paid = a.pays.filter((x) => live(x) && rooms.some((r) => r.id === x.room_id) && x.for_month && monthOf(x.for_month) === m).reduce((s, x) => s + x.amount, 0); run += due - paid; const notes = rooms.map((r) => a.adjs.find((x) => x.room_id === r.id && monthOf(x.for_month) === m)).filter(Boolean).map((x) => `${rooms.find((r) => r.id === x!.room_id)?.name}: ${x!.reason || `₹${inr(x!.amount)}`}`); return { m, due, paid, run, notes, advance: m > a.thisMonth }; }).filter((l) => l.due || l.paid);
    return <div className="rounded-xl border border-slate-200 p-3 space-y-1"><div className="text-sm font-medium">Statement</div><div className="overflow-x-auto"><table className="w-full text-sm min-w-[28rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Month</th><th className="text-right">Rent charged</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th className="text-left pl-3">Note</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{lines.map((l) => <tr key={l.m} className={l.advance ? "text-slate-400" : ""}><td className="py-1.5">{monthLabel(l.m)}{l.advance && <span className="text-[11px]"> (advance)</span>}</td><td className="text-right tabular-nums">₹{inr(l.due)}</td><td className="text-right tabular-nums">₹{inr(l.paid)}</td><td className={`text-right tabular-nums ${l.run > 0 && !l.advance ? "text-rose-700 font-medium" : ""}`}>{l.run > 0 ? `₹${inr(l.run)} owed` : l.run < 0 ? `₹${inr(-l.run)} ahead` : "Clear"}</td><td className="pl-3 text-xs text-slate-500">{l.notes.join("; ")}</td></tr>)}</tbody></table></div>
      <p className="text-[11px] text-slate-400">Rent is due on the 1st of each month and late after the {RENT_GRACE_DAY}th. The balance after a month is what is owed once that month's rent and payments are counted. Mostly verbal arrangements: a month can be charged in part or not at all (see Adjust).</p></div>;
  };

  return (
    <div className="space-y-4">
      <section className="card space-y-3"><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">Rent for</h2>
        <button className="btn btn-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹</button><input type="month" className="inp !w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" /><button className="btn btn-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">›</button>
        {month !== a.thisMonth && <button className="text-xs text-blue-700 underline" onClick={() => setMonth(a.thisMonth)}>this month</button>}
        <div className="sm:ml-auto grid grid-cols-3 gap-2 text-center text-sm w-full sm:w-auto">{[["Charged", totals.charge, ""], ["Paid", totals.paid, ""], ["Still to pay", totals.left, totals.left > 0 ? "text-amber-800" : "text-emerald-700"]].map(([l, v, t]) => <div key={l as string} className="rounded-xl bg-slate-50 px-3 py-1.5"><div className="text-[11px] text-slate-400">{l}</div><div className={`font-medium tabular-nums ${t}`}>₹{inr(v as number)}</div></div>)}</div></div>
        <p className="text-xs text-slate-400">Rent is paid a month in advance: due on the 1st, late after the 5th. Pay a landlord once for all their rooms. If a room was charged only part of a month, or nothing, use <b>Adjust</b> on its row.</p></section>

      {groupsKeys.map((key) => { const rr = rowsOf(key); if (!rr.length) return null; const l = a.landlords.find((x) => x.id === key); const name = l?.name ?? "No landlord set"; const left = rr.reduce((s, o) => s + o.left, 0); const rooms = a.rooms.filter((r) => (key === "none" ? !r.landlord_id : r.landlord_id === key)); const paying = payFor === key; return (
        <section key={key} className="card space-y-3" data-landlord={name}>
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{name}</h3>{l && !a.hasBank[l.id] && <span className="text-[11px] text-amber-700">no bank details</span>}<span className="text-sm text-slate-500">{left > 0 ? <>₹{inr(left)} still to pay</> : <span className="text-emerald-700">nothing to pay for {monthLabel(month)}</span>}</span>
            <div className="sm:ml-auto flex gap-2"><button className="btn btn-sm" onClick={() => toggle(key)}>{open.has(key) ? "Hide statement" : "Statement"}</button>{l && <button className="btn btn-sm btn-primary" disabled={left <= 0} onClick={() => (paying ? setPayFor(null) : startPay(key))}>{paying ? "Close" : `Pay ${name.split(" ")[0]}`}</button>}</div></div>

          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[34rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Room</th><th className="text-right">Rent charged</th><th className="text-right">Paid</th><th className="text-right">Still to pay</th><th className="text-left pl-3">Status</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">{rr.map((o) => { const full = rentFor(a.rents, o.room.id, month); return (<Fragment key={o.room.id}>
              <tr key={o.room.id}><td className="py-2 font-medium">{o.room.name}<div className="text-xs font-normal text-slate-400">{o.room.room_type === "ac" ? "AC" : "Non-AC"}</div></td>
                <td className="text-right tabular-nums">₹{inr(o.charge)}{o.adj && <div className="text-[11px] text-sky-700" title={o.adj.reason}>adjusted from ₹{inr(full)}</div>}</td><td className="text-right tabular-nums">₹{inr(o.paid)}</td><td className="text-right tabular-nums">{o.left > 0 ? <b className="text-amber-800">₹{inr(o.left)}</b> : "—"}</td>
                <td className="pl-3"><span className={pill(o.status)}>{o.status}</span>{o.adj?.reason && <div className="text-[11px] text-slate-400 max-w-40 truncate" title={o.adj.reason}>{o.adj.reason}</div>}</td>
                <td className="text-right pl-2 whitespace-nowrap"><button className="text-xs text-blue-700 underline" onClick={() => (adj?.roomId === o.room.id ? setAdj(null) : startAdjust(o))}>{adj?.roomId === o.room.id ? "Close" : "Adjust"}</button></td></tr>
              {adj?.roomId === o.room.id && <tr key={o.room.id + "a"} className="bg-sky-50/50"><td colSpan={6} className="p-3 space-y-2">
                <div className="text-sm font-medium">What was charged for {o.room.name} in {monthLabel(month)}?</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">{([["full", `Full rent (₹${inr(full)})`], ["days", "Part of the month, by days"], ["custom", "Another amount"], ["none", "Nothing (not charged)"]] as const).map(([m, t]) => <label key={m} className="flex items-center gap-1.5"><input type="radio" name={`adj-${o.room.id}`} checked={adj.mode === m} onChange={() => setAdj({ ...adj, mode: m })} />{t}</label>)}</div>
                {adj.mode === "days" && <div className="flex flex-wrap items-end gap-2 text-sm"><div><label className="lbl">From day</label><input className="inp !w-20" type="number" min="1" max={daysInMonth(month)} value={adj.from} onChange={(e) => setAdj({ ...adj, from: e.target.value })} /></div><div><label className="lbl">To day</label><input className="inp !w-20" type="number" min="1" max={daysInMonth(month)} value={adj.to} onChange={(e) => setAdj({ ...adj, to: e.target.value })} /></div><div className="pb-2">= <b>₹{inr(rentByDays(full, month, parseInt(adj.from) || 1, parseInt(adj.to) || daysInMonth(month)))}</b> ({Math.max(0, (parseInt(adj.to) || daysInMonth(month)) - (parseInt(adj.from) || 1) + 1)} of {daysInMonth(month)} days)</div></div>}
                {adj.mode === "custom" && <div><label className="lbl">Amount charged (₹)</label><input className="inp !w-40" inputMode="decimal" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></div>}
                {adj.mode !== "full" && <div><label className="lbl">Why (optional)</label><input className="inp" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="e.g. verbal agreement: room taken on the 27th, not charged for October" /></div>}
                <div className="flex gap-2"><button className="btn btn-primary" onClick={() => saveAdjust(o)}>{adj.mode === "full" && o.adj ? "Back to full rent" : "Save"}</button><button className="btn" onClick={() => setAdj(null)}>Cancel</button></div></td></tr>}</Fragment>); })}</tbody></table></div>

          {paying && l && <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 space-y-3" data-pay>
            <div className="text-sm font-medium">Pay {l.name} for {monthLabel(month)}</div><BankInfo landlord={l} />
            <div className="grid gap-1.5 sm:grid-cols-2">{rr.filter((o) => o.left > 0).map((o) => <label key={o.room.id} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{o.room.name}</span><span className="text-xs text-slate-400">left ₹{inr(o.left)}</span><input className="inp !w-28" inputMode="decimal" aria-label={`Amount for ${o.room.name}`} value={amounts[o.room.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [o.room.id]: e.target.value })} /></label>)}</div>
            <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Paid on</label><input className="inp !w-40" type="date" max={a.today} value={pf.paid_on} onChange={(e) => setPf({ ...pf, paid_on: e.target.value })} /></div><div><label className="lbl">Reference / UTR</label><input className="inp !w-44" value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} placeholder="optional" /></div><div><label className="lbl">Note</label><input className="inp !w-44" value={pf.note} onChange={(e) => setPf({ ...pf, note: e.target.value })} placeholder="optional" /></div>
              <label className="text-xs text-slate-500 flex items-center gap-1">Receipt (optional)<input type="file" accept="image/*,application/pdf" className="max-w-[11rem] text-xs" onChange={(e) => setBill(e.target.files?.[0] ?? null)} /></label>
              <button className="btn btn-primary" disabled={busy} onClick={recordPay}>{busy ? "Saving…" : `Record payment (₹${inr(Object.values(amounts).reduce((s, v) => s + (parseFloat(v) || 0), 0))})`}</button></div>
            <p className="text-xs text-slate-500">One payment for all the rooms ticked here: it posts one Accommodation expense on the project. Most of this is paid by a single transfer, so there is rarely a bill: a receipt is optional.</p></div>}
          {open.has(key) && statement(key, rooms)}
        </section>); })}
      {!rows.some((o) => o.charge > 0 || o.adj) && <p className="text-sm text-slate-400">No rent is charged for {monthLabel(month)}.</p>}
    </div>
  );
}
