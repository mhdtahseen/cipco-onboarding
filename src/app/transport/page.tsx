"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday, tripRate, type TransportRate, type Trip, type Vehicle } from "@/lib/attendance";

type Pay = { id: string; vehicle_id: string; paid_on: string; amount: number; reference: string; note: string; voided_at: string | null };
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Admin: vehicles, the price per trip, trips run and what has been paid. Payments are never edited; a wrong one is voided and re-entered.
export default function TransportPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]); const [rates, setRates] = useState<TransportRate[]>([]); const [trips, setTrips] = useState<Trip[]>([]); const [pays, setPays] = useState<Pay[]>([]);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [name, setName] = useState(""); const [operator, setOperator] = useState(""); const [month, setMonth] = useState(istToday().slice(0, 7));
  const [pf, setPf] = useState({ vehicle_id: "", amount: "", paid_on: istToday(), reference: "", note: "" }); const [rateIn, setRateIn] = useState<Record<string, string>>({});
  async function load() {
    const sb = supabase(); const [v, r, t, p] = await Promise.all([sb.from("transport_vehicles").select("*").order("sort_order").order("name"), sb.from("transport_rates").select("*"), sb.from("transport_trips").select("*"), sb.from("transport_payments").select("*").order("paid_on", { ascending: false })]);
    const e = v.error || r.error || t.error || p.error; if (e) { setErr(e.message + " — has the accountability migration been run?"); setLoading(false); return; }
    setVehicles((v.data || []) as Vehicle[]); setRates(((r.data || []) as TransportRate[]).map((x) => ({ ...x, price: Number(x.price) }))); setTrips((t.data || []) as Trip[]); setPays(((p.data || []) as Pay[]).map((x) => ({ ...x, amount: Number(x.amount) }))); setLoading(false);
  }
  useEffect(() => { load(); }, []);
  const owed = useMemo(() => vehicles.map((v) => {
    const mine = trips.filter((t) => t.vehicle_id === v.id); let cost = 0, unpriced = 0, inMonth = 0, monthCost = 0;
    mine.forEach((t) => { const pr = tripRate(rates, v.id, t.work_date); if (pr === null) unpriced++; else { cost += pr; if (t.work_date.startsWith(month)) { monthCost += pr; } } if (t.work_date.startsWith(month)) inMonth++; });
    const paid = pays.filter((x) => x.vehicle_id === v.id && !x.voided_at).reduce((s, x) => s + x.amount, 0);
    return { v, trips: mine.length, inMonth, monthCost, cost, paid, due: cost - paid, unpriced };
  }), [vehicles, rates, trips, pays, month]);
  const vName = (id: string) => vehicles.find((v) => v.id === id)?.name ?? "?";
  async function run(p: PromiseLike<{ error: { message: string } | null }>) { setErr(""); const { error } = await p; if (error) { setErr(error.message); return false; } await load(); return true; }
  const addVehicle = async () => { if (!name.trim()) return; if (await run(supabase().from("transport_vehicles").insert({ name: name.trim(), operator: operator.trim() }))) { setName(""); setOperator(""); } };
  const setRate = async (id: string) => { const price = parseFloat(rateIn[id] || ""); if (!(price >= 0)) return; if (await run(supabase().from("transport_rates").upsert({ vehicle_id: id, price, effective_from: istToday() }, { onConflict: "vehicle_id,effective_from" }))) setRateIn((s) => ({ ...s, [id]: "" })); };
  const addPay = async () => { const amount = parseFloat(pf.amount); if (!pf.vehicle_id || !(amount > 0)) { setErr("Choose the vehicle and enter the amount."); return; } if (await run(supabase().from("transport_payments").insert({ vehicle_id: pf.vehicle_id, amount, paid_on: pf.paid_on, reference: pf.reference.trim(), note: pf.note.trim() }))) setPf({ ...pf, amount: "", reference: "", note: "" }); };
  const voidPay = (x: Pay) => { if (confirm(`Void the ₹${inr(x.amount)} payment to ${vName(x.vehicle_id)}? It stays in the list, marked void.`)) run(supabase().from("transport_payments").update({ voided_at: new Date().toISOString() }).eq("id", x.id)); };
  const totals = owed.reduce((a, o) => ({ cost: a.cost + o.cost, paid: a.paid + o.paid }), { cost: 0, paid: 0 });

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Transport</h1>
      {err && <p className="warn">{err}</p>}{loading && <p className="text-slate-500">Loading…</p>}
      {!loading && <>
        <div className="grid grid-cols-3 gap-3 text-center">{[["Trips cost", totals.cost], ["Paid", totals.paid], ["Balance due", totals.cost - totals.paid]].map(([l, n]) => <div key={l as string} className="rounded-2xl bg-white border border-slate-200/80 p-3"><div className="text-xs text-slate-400">{l}</div><div className="text-lg font-medium tabular-nums">₹{inr(n as number)}</div></div>)}</div>

        <section className="card space-y-3"><div className="flex items-center gap-3"><h2 className="font-medium">Vehicles</h2><label className="ml-auto text-xs text-slate-500 flex items-center gap-2">Month<input type="month" className="inp !w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label></div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[40rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Vehicle</th><th className="text-right">Price / trip</th><th className="text-right">Trips (month)</th><th className="text-right">This month</th><th className="text-right">Paid (all)</th><th className="text-right">Due (all)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{owed.map((o) => { const cur = tripRate(rates, o.v.id, istToday()); return (
              <tr key={o.v.id}><td className="py-2"><div className="font-medium">{o.v.name}{!o.v.active && <span className="text-xs text-slate-400"> (inactive)</span>}</div><div className="text-xs text-slate-400">{o.v.operator || "—"}</div></td>
                <td className="text-right"><div className="flex items-center justify-end gap-1.5"><span className="tabular-nums">{cur === null ? "not set" : `₹${inr(cur)}`}</span><input className="inp !w-20 !py-1" inputMode="decimal" placeholder="new" aria-label={`New price for ${o.v.name}`} value={rateIn[o.v.id] ?? ""} onChange={(e) => setRateIn((s) => ({ ...s, [o.v.id]: e.target.value }))} /><button className="btn !min-h-8" onClick={() => setRate(o.v.id)}>Set</button></div></td>
                <td className="text-right tabular-nums">{o.inMonth}</td><td className="text-right tabular-nums">₹{inr(o.monthCost)}</td><td className="text-right tabular-nums">₹{inr(o.paid)}</td><td className={`text-right tabular-nums ${o.due > 0 ? "text-amber-800 font-medium" : ""}`}>₹{inr(o.due)}{o.unpriced > 0 && <div className="text-[11px] text-slate-400">{o.unpriced} trips unpriced</div>}</td></tr>); })}</tbody></table></div>
          {!vehicles.length && <p className="text-sm text-slate-400">No vehicles yet.</p>}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3"><input className="inp !w-48" placeholder="Vehicle name" value={name} onChange={(e) => setName(e.target.value)} /><input className="inp !w-48" placeholder="Operator (who is paid)" value={operator} onChange={(e) => setOperator(e.target.value)} /><button className="btn btn-primary" onClick={addVehicle}>Add vehicle</button></div>
          <p className="text-xs text-slate-400">A new price applies from today; earlier trips keep the price that was in force.</p></section>

        <section className="card space-y-3"><h2 className="font-medium">Payments</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <select className="inp !w-44" aria-label="Vehicle" value={pf.vehicle_id} onChange={(e) => setPf({ ...pf, vehicle_id: e.target.value })}><option value="">Vehicle…</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <input className="inp !w-32" inputMode="decimal" placeholder="Amount ₹" aria-label="Amount" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} />
            <input className="inp !w-40" type="date" aria-label="Paid on" value={pf.paid_on} onChange={(e) => setPf({ ...pf, paid_on: e.target.value })} />
            <input className="inp !w-40" placeholder="Reference / UTR" aria-label="Reference" value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} />
            <button className="btn btn-primary" onClick={addPay}>Record payment</button></div>
          <ul className="divide-y divide-slate-100 text-sm">{pays.map((x) => <li key={x.id} className={`py-2 flex flex-wrap items-center gap-x-3 ${x.voided_at ? "text-slate-400 line-through" : ""}`}><span className="tabular-nums w-24">{x.paid_on}</span><span className="w-32 truncate">{vName(x.vehicle_id)}</span><span className="tabular-nums w-28">₹{inr(x.amount)}</span><span className="text-xs text-slate-400 flex-1 truncate">{x.reference}{x.note ? ` · ${x.note}` : ""}</span>{x.voided_at ? <span className="text-xs">void</span> : <button className="text-xs text-red-700 underline" onClick={() => voidPay(x)}>Void</button>}</li>)}</ul>
          {!pays.length && <p className="text-sm text-slate-400">No payments recorded.</p>}</section>
      </>}
    </div>
  );
}
