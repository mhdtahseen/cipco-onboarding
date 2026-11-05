"use client";
import { Fragment, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import PaymentBill from "@/components/PaymentBill";
import { monthLabel, monthOf, type RoomPayment } from "@/lib/accommodation";
import { inr, landlordOf, type Acc } from "./shared";

type Group = { key: string; batch: boolean; rows: RoomPayment[] };

// Every rent payment, newest first: who was paid, for which rooms and month, the reference and an optional receipt. A payment for several rooms is one line that opens to show them.
export default function PaymentsTab({ a, landlord }: { a: Acc; landlord?: string }) {
  const [f, setF] = useState({ landlord: landlord ?? "", month: "", show: "active" }); const [openKey, setOpenKey] = useState<string | null>(null); const [all, setAll] = useState(false);
  const roomName = (id: string) => a.rooms.find((r) => r.id === id)?.name ?? "?";
  const groups = useMemo(() => { const out: Group[] = []; const at = new Map<string, number>(); for (const x of a.pays) { if (x.batch_id) { const k = at.get(x.batch_id); if (k === undefined) { at.set(x.batch_id, out.length); out.push({ key: x.batch_id, batch: true, rows: [x] }); } else out[k].rows.push(x); } else out.push({ key: x.id, batch: false, rows: [x] }); } return out.sort((p, q) => q.rows[0].paid_on.localeCompare(p.rows[0].paid_on)); }, [a.pays]);
  const lord = (g: Group) => landlordOf(a, a.rooms.find((r) => r.id === g.rows[0].room_id) ?? a.rooms[0]);
  const shown = groups.filter((g) => (!f.landlord || a.rooms.find((r) => r.id === g.rows[0].room_id)?.landlord_id === f.landlord) && (!f.month || (g.rows[0].for_month && monthOf(g.rows[0].for_month) === f.month)) && (f.show === "all" || (f.show === "void" ? g.rows.every((x) => x.voided_at) : !g.rows.every((x) => x.voided_at))));
  const total = shown.reduce((s, g) => s + g.rows.filter((x) => !x.voided_at).reduce((t, x) => t + x.amount, 0), 0); const rowsShown = all ? shown : shown.slice(0, 40);
  const months = [...new Set(a.pays.map((x) => x.for_month && monthOf(x.for_month)).filter(Boolean) as string[])].sort().reverse();
  const sb = () => supabase();
  const attach = (x: RoomPayment, path: string) => a.run(x.batch_id ? sb().from("accommodation_payments").update({ bill_path: path }).eq("batch_id", x.batch_id) : sb().from("accommodation_payments").update({ bill_path: path }).eq("id", x.id), "Receipt attached; it shows on the project's expense ✓");
  const voidBatch = (rows: RoomPayment[]) => { const live = rows.filter((x) => !x.voided_at); if (confirm(`Void this ₹${inr(live.reduce((s, x) => s + x.amount, 0))} payment for ${live.length} room${live.length > 1 ? "s" : ""}? It stays in the list, marked void, and its expense is removed.`)) a.run(sb().from("accommodation_payments").update({ voided_at: new Date().toISOString() }).eq("batch_id", rows[0].batch_id!).is("voided_at", null), "Voided; the expense was removed ✓"); };
  const voidOne = (x: RoomPayment) => { if (confirm(`Void the ₹${inr(x.amount)} rent payment for ${roomName(x.room_id)}? It stays in the list, marked void, and its expense is removed.`)) a.run(sb().from("accommodation_payments").update({ voided_at: new Date().toISOString() }).eq("id", x.id), "Voided; the expense was removed ✓"); };
  function csv() {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`; const body = [["Paid on", "Landlord", "Rooms", "For month", "Amount", "Reference", "Note", "Status"], ...shown.map((g) => [g.rows[0].paid_on, lord(g)?.name ?? "", g.rows.map((x) => roomName(x.room_id)).join(", "), g.rows[0].for_month ? monthLabel(monthOf(g.rows[0].for_month)) : "", g.rows.filter((x) => !x.voided_at).reduce((s, x) => s + x.amount, 0), g.rows[0].reference, g.rows[0].note, g.rows.every((x) => x.voided_at) ? "void" : "paid"])];
    const el = document.createElement("a"); el.href = URL.createObjectURL(new Blob(["﻿" + body.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" })); el.download = `${a.project} - rent payments.csv`; el.click();
  }

  return (
    <section className="card space-y-3"><div className="flex flex-wrap items-center gap-2"><h2 className="font-medium sm:mr-auto">Payments</h2>
      <select className="inp !w-auto" aria-label="Landlord" value={f.landlord} onChange={(e) => setF({ ...f, landlord: e.target.value })}><option value="">All landlords</option>{a.landlords.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      <select className="inp !w-auto" aria-label="For month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })}><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
      <select className="inp !w-auto" aria-label="Show" value={f.show} onChange={(e) => setF({ ...f, show: e.target.value })}><option value="active">Not void</option><option value="void">Void only</option><option value="all">Everything</option></select>
      <button className="btn btn-sm" onClick={csv} disabled={!shown.length}>⬇ CSV</button></div>
      <p className="text-xs text-slate-400">A rent payment is recorded on the Rent tab, once. It posts an Accommodation expense on the project by itself. Payments are never edited: a wrong one is voided (its expense is removed) and entered again. Receipts are optional.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[40rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="w-6" /><th className="text-left py-1">Paid on</th><th className="text-left">Landlord</th><th className="text-left">Rooms</th><th className="text-left">For month</th><th className="text-right">Amount</th><th className="text-left pl-3">Reference</th><th className="text-left">Receipt</th><th /></tr></thead>
        <tbody className="divide-y divide-slate-100">{rowsShown.map((g) => { const voided = g.rows.every((x) => x.voided_at); const amt = g.rows.filter((x) => !x.voided_at).reduce((s, x) => s + x.amount, 0); const x0 = g.rows[0]; return (
          <Fragment key={g.key}><tr className={voided ? "text-slate-400 line-through" : ""}>
            <td className="py-2 pl-1">{g.rows.length > 1 && <button className="h-6 w-6 rounded text-slate-500 hover:bg-slate-100" aria-expanded={openKey === g.key} aria-label="Show the rooms" onClick={() => setOpenKey(openKey === g.key ? null : g.key)}>{openKey === g.key ? "▾" : "▸"}</button>}</td>
            <td className="tabular-nums whitespace-nowrap">{x0.paid_on}</td><td>{lord(g)?.name ?? <span className="text-slate-400">—</span>}</td><td>{g.rows.length > 1 ? `${g.rows.length} rooms` : roomName(x0.room_id)}</td><td className="whitespace-nowrap">{x0.for_month ? monthLabel(monthOf(x0.for_month)) : ""}</td><td className="text-right tabular-nums">₹{inr(amt)}</td>
            <td className="pl-3 text-xs text-slate-500 max-w-48 truncate">{x0.reference}{x0.note ? ` · ${x0.note}` : ""}</td><td><PaymentBill path={g.rows.find((x) => x.bill_path)?.bill_path} projectId={a.pid} onAttach={(path) => attach(x0, path)} onError={a.fail} /></td>
            <td className="text-right pl-2 whitespace-nowrap">{voided ? <span className="text-xs">void</span> : g.batch ? <button className="text-xs text-red-700 underline" onClick={() => voidBatch(g.rows)}>Void{g.rows.length > 1 ? " all" : ""}</button> : <button className="text-xs text-red-700 underline" onClick={() => voidOne(x0)}>Void</button>}</td></tr>
            {openKey === g.key && g.rows.length > 1 && <tr className="bg-slate-50/60"><td /><td colSpan={8} className="p-2.5"><ul className="text-xs text-slate-600 space-y-1">{g.rows.map((x) => <li key={x.id} className={`flex gap-3 ${x.voided_at ? "text-slate-400 line-through" : ""}`}><span className="w-32 truncate">{roomName(x.room_id)}</span><span className="tabular-nums">₹{inr(x.amount)}</span>{x.voided_at ? <span>void</span> : <button className="text-red-700 underline" onClick={() => voidOne(x)}>Void this room</button>}</li>)}</ul></td></tr>}</Fragment>); })}</tbody>
        {shown.length > 0 && <tfoot className="border-t-2 border-slate-200 bg-slate-50/70 font-medium"><tr><td /><td colSpan={4} className="py-2">Total · {shown.length} payment{shown.length === 1 ? "" : "s"}</td><td className="text-right tabular-nums">₹{inr(total)}</td><td colSpan={3} /></tr></tfoot>}</table></div>
      {!shown.length && <p className="text-sm text-slate-400">{a.pays.length ? "No payments match these filters." : "No payments recorded yet."}</p>}
      {shown.length > 40 && !all && <button className="btn btn-sm" onClick={() => setAll(true)}>Show all {shown.length}</button>}</section>
  );
}
