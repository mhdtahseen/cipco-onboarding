"use client";
import { useEffect, useMemo, useState } from "react";
import { uploadBill } from "@/lib/billUpload";
import PaymentBill from "@/components/PaymentBill";
import { supabase } from "@/lib/supabase/client";
import { istToday, tripRate, type Billing, type Run, type TransportRate, type Vehicle } from "@/lib/attendance";
import type { Project } from "@/lib/types";

type Money = { id: string; vehicle_id: string; amount: number; voided_at: string | null };
type Pay = Money & { paid_on: string; reference: string; note: string; bill_path?: string | null };
type Errand = Money & { work_date: string; description: string };
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const BILL: Record<Billing, string> = { per_trip: "per trip", monthly: "per month" };

// Admin: per project, the locally hired vehicles, how each is paid, whether they showed up, extra errand charges and what has been paid.
// Per-trip vehicles bill only the trips that showed up; monthly vehicles bill a fixed amount for each month that has records (no-show days are shown so a deduction can be negotiated).
export default function TransportPage() {
  const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState(""); const [allVehicles, setVehicles] = useState<Vehicle[]>([]); const [allRates, setRates] = useState<TransportRate[]>([]); const [allRuns, setRuns] = useState<Run[]>([]); const [allPays, setPays] = useState<Pay[]>([]); const [allErr, setErrands] = useState<Errand[]>([]);
  const [tab, setTab] = useState<"overview" | "daily" | "vehicles" | "errands" | "payments">("overview"); const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [month, setMonth] = useState(istToday().slice(0, 7));
  const [nv, setNv] = useState<{ name: string; operator: string; billing: Billing }>({ name: "", operator: "", billing: "per_trip" }); const [rateIn, setRateIn] = useState<Record<string, string>>({}); const [rateFrom, setRateFrom] = useState(istToday());
  const [pfBill, setPfBill] = useState<File | null>(null); const [pf, setPf] = useState({ vehicle_id: "", amount: "", paid_on: istToday(), reference: "", note: "" }); const [ef, setEf] = useState({ vehicle_id: "", amount: "", work_date: istToday(), description: "" });
  async function load() {
    const sb = supabase(); const [pr, v, r, t, p, e] = await Promise.all([sb.from("projects").select("*").eq("status", "active").order("name"), sb.from("transport_vehicles").select("*").order("sort_order").order("name"), sb.from("transport_rates").select("*"), sb.from("transport_runs").select("*"), sb.from("transport_payments").select("*").order("paid_on", { ascending: false }), sb.from("transport_errands").select("*").order("work_date", { ascending: false })]);
    const x = pr.error || v.error || r.error || t.error || p.error || e.error; if (x) { setErr(x.message + " — has the accountability migration been run?"); setLoading(false); return; }
    const pl = (pr.data || []) as Project[]; setProjects(pl); setPid((c) => c || pl[0]?.id || ""); setVehicles((v.data || []) as Vehicle[]);
    setRates(((r.data || []) as TransportRate[]).map((q) => ({ ...q, price: Number(q.price) }))); setRuns((t.data || []) as Run[]);
    setPays(((p.data || []) as Pay[]).map((q) => ({ ...q, amount: Number(q.amount) }))); setErrands(((e.data || []) as Errand[]).map((q) => ({ ...q, amount: Number(q.amount) }))); setLoading(false);
  }
  useEffect(() => { load(); }, []);
  const vehicles = useMemo(() => allVehicles.filter((v) => v.project_id === pid), [allVehicles, pid]); const ids = useMemo(() => new Set(vehicles.map((v) => v.id)), [vehicles]);
  const rates = useMemo(() => allRates.filter((r) => ids.has(r.vehicle_id)), [allRates, ids]); const runs = useMemo(() => allRuns.filter((r) => r.project_id === pid), [allRuns, pid]);
  const pays = useMemo(() => allPays.filter((x) => ids.has(x.vehicle_id)), [allPays, ids]); const errands = useMemo(() => allErr.filter((x) => ids.has(x.vehicle_id)), [allErr, ids]);

  const rows = useMemo(() => vehicles.map((v) => {
    const mine = runs.filter((r) => r.vehicle_id === v.id); let all = 0, inMonth = 0, unpriced = 0;
    if (v.billing === "per_trip") mine.filter((r) => r.status === "showed").forEach((r) => { const pr = tripRate(rates, v.id, r.work_date); if (pr === null) unpriced++; else { all += pr; if (r.work_date.startsWith(month)) inMonth += pr; } });
    else { const first: Record<string, string> = {}; mine.forEach((r) => { const m = r.work_date.slice(0, 7); if (!first[m] || r.work_date < first[m]) first[m] = r.work_date; });   // a monthly vehicle bills each month that has records, at the price in force on its first record
      Object.entries(first).forEach(([m, d]) => { const pr = tripRate(rates, v.id, d); if (pr === null) unpriced++; else { all += pr; if (m === month) inMonth += pr; } }); }
    const er = errands.filter((x) => x.vehicle_id === v.id && !x.voided_at); const erAll = er.reduce((s, x) => s + x.amount, 0), erMonth = er.filter((x) => x.work_date.startsWith(month)).reduce((s, x) => s + x.amount, 0);
    const paid = pays.filter((x) => x.vehicle_id === v.id && !x.voided_at).reduce((s, x) => s + x.amount, 0); const mr = mine.filter((r) => r.work_date.startsWith(month));
    return { v, showed: mr.filter((r) => r.status === "showed").length, missed: mr.filter((r) => r.status === "no_show").length, month: inMonth + erMonth, erMonth, billed: all + erAll, paid, due: all + erAll - paid, unpriced };
  }), [vehicles, runs, rates, errands, pays, month]);
  const today = istToday(); const daysOfMonth = useMemo(() => { const [y, m] = month.split("-").map(Number); return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`).filter((d) => d <= today); }, [month, today]);
  const unrecorded = useMemo(() => !vehicles.some((v) => v.active) ? [] : daysOfMonth.filter((d) => d < today && vehicles.filter((v) => v.active).some((v) => (["pickup", "drop"] as const).some((leg) => !runs.some((r) => r.vehicle_id === v.id && r.work_date === d && r.leg === leg)))), [daysOfMonth, vehicles, runs, today]);
  const vName = (id: string) => allVehicles.find((v) => v.id === id)?.name ?? "?";
  const tot = rows.reduce((a, r) => ({ month: a.month + r.month, billed: a.billed + r.billed, paid: a.paid + r.paid }), { month: 0, billed: 0, paid: 0 });

  async function run(p: PromiseLike<{ error: { message: string } | null }>) { setErr(""); const { error } = await p; if (error) { setErr(error.message); return false; } await load(); return true; }
  const sb = () => supabase();
  const addVehicle = async () => { if (!nv.name.trim()) return; if (await run(sb().from("transport_vehicles").insert({ project_id: pid, name: nv.name.trim(), operator: nv.operator.trim(), billing: nv.billing }))) setNv({ name: "", operator: "", billing: nv.billing }); };
  const setBilling = (v: Vehicle, b: Billing) => { if (b !== v.billing && confirm(`Switch ${v.name} to ${BILL[b]}? Its price now means an amount ${BILL[b]}, and past days are re-priced the same way. Set the new price afterwards.`)) run(sb().from("transport_vehicles").update({ billing: b }).eq("id", v.id)); };
  const setRate = async (id: string) => { const price = parseFloat(rateIn[id] || ""); if (!(price >= 0)) return; if (await run(sb().from("transport_rates").upsert({ vehicle_id: id, price, effective_from: rateFrom || istToday() }, { onConflict: "vehicle_id,effective_from" }))) setRateIn((s) => ({ ...s, [id]: "" })); };
  const addPay = async () => { const amount = parseFloat(pf.amount); if (!pf.vehicle_id || !(amount > 0)) { setErr("Choose the vehicle and enter the amount."); return; } let bill_path: string | undefined; if (pfBill) { const u = await uploadBill(pfBill, pid); if ("error" in u) { setErr(u.error); return; } bill_path = u.path; } if (await run(sb().from("transport_payments").insert({ vehicle_id: pf.vehicle_id, amount, paid_on: pf.paid_on, reference: pf.reference.trim(), note: pf.note.trim(), ...(bill_path ? { bill_path } : {}) }))) { setPfBill(null); setPf({ ...pf, amount: "", reference: "", note: "" }); } };
  const attachBill = (x: Pay, path: string) => run(sb().from("transport_payments").update({ bill_path: path }).eq("id", x.id));
  const addErrand = async () => { const amount = parseFloat(ef.amount); if (!ef.vehicle_id || !(amount > 0) || !ef.description.trim()) { setErr("Choose the vehicle, describe the errand and enter the quoted amount."); return; } if (await run(sb().from("transport_errands").insert({ vehicle_id: ef.vehicle_id, amount, work_date: ef.work_date, description: ef.description.trim() }))) setEf({ ...ef, amount: "", description: "" }); };
  const assign = async (v: Vehicle) => { await run(sb().from("transport_vehicles").update({ project_id: pid }).eq("id", v.id)); };
  const voidIt = (table: "transport_payments" | "transport_errands", x: Money, what: string) => { if (confirm(`Void this ₹${inr(x.amount)} ${what} for ${vName(x.vehicle_id)}? It stays in the list, marked void.`)) run(sb().from(table).update({ voided_at: new Date().toISOString() }).eq("id", x.id)); };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Transport</h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => { setPid(e.target.value); setPf((f) => ({ ...f, vehicle_id: "" })); setEf((f) => ({ ...f, vehicle_id: "" })); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}</option>)}</select>}</div>
      {err && <p className="warn">{err}</p>}{loading && <p className="text-slate-500">Loading…</p>}
      {!loading && <>
        <div className="grid grid-cols-3 gap-3 text-center">{[["This month", tot.month], ["Paid (all time)", tot.paid], ["Balance due", tot.billed - tot.paid]].map(([l, n]) => <div key={l as string} className="rounded-2xl bg-white border border-slate-200/80 p-3"><div className="text-xs text-slate-400">{l}</div><div className="text-lg font-medium tabular-nums">₹{inr(n as number)}</div></div>)}</div>
        <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">{([["overview", "Overview"], ["daily", "Daily log"], ["vehicles", "Vehicles & prices"], ["errands", "Errands"], ["payments", "Payments"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab whitespace-nowrap ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
        {tab === "overview" && <section className="card space-y-2"><div className="flex items-center gap-3"><h2 className="font-medium">This month by vehicle</h2><label className="ml-auto text-xs text-slate-500 flex items-center gap-2">Month<input type="month" className="inp !w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" /></label></div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[36rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Vehicle</th><th className="text-right">Showed</th><th className="text-right">No-show</th><th className="text-right">No-show rate</th><th className="text-right">This month</th><th className="text-right">Due (all)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((o) => <tr key={o.v.id}><td className="py-2 font-medium">{o.v.name}<div className="text-xs font-normal text-slate-400">{o.v.operator || "—"} · {o.v.billing === "monthly" ? "monthly" : "per trip"}</div></td><td className="text-right tabular-nums">{o.showed}</td><td className={`text-right tabular-nums ${o.missed ? "text-rose-700 font-medium" : ""}`}>{o.missed}</td><td className="text-right tabular-nums">{o.showed + o.missed ? `${Math.round((o.missed / (o.showed + o.missed)) * 100)}%` : "—"}</td><td className="text-right tabular-nums">₹{inr(o.month)}</td><td className={`text-right tabular-nums ${o.due > 0 ? "text-amber-800 font-medium" : ""}`}>₹{inr(o.due)}</td></tr>)}</tbody></table></div>
          {!vehicles.length && <p className="text-sm text-slate-400">No vehicles for this project yet. Add the first one on the Vehicles &amp; prices tab.</p>}
          {unrecorded.length > 0 && <p className="text-sm text-amber-900 bg-amber-50 rounded-xl px-3 py-2" data-alerts><b>{unrecorded.length}</b> past day{unrecorded.length > 1 ? "s have" : " has"} vehicle show-ups not recorded: {unrecorded.slice(0, 6).map((d) => d.slice(8)).join(", ")}{unrecorded.length > 6 ? "…" : ""}. <button className="underline" onClick={() => setTab("daily")}>See the daily log</button></p>}
          <p className="text-xs text-slate-400">Show-ups are marked on the <a className="underline" href="/attendance">Attendance</a> page by the Supervisor or Site Engineer.</p></section>}
        {tab === "daily" && <section className="card space-y-2"><div className="flex items-center gap-3"><h2 className="font-medium">Daily log</h2><label className="ml-auto text-xs text-slate-500 flex items-center gap-2">Month<input type="month" className="inp !w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" /></label></div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[32rem]" data-daily><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Date</th>{vehicles.map((v) => <th key={v.id} className="text-center">{v.name} <span className="normal-case">pickup · drop</span></th>)}<th></th></tr></thead>
            <tbody className="divide-y divide-slate-100">{daysOfMonth.map((d) => <tr key={d}><td className="py-1.5 tabular-nums whitespace-nowrap">{new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}</td>{vehicles.map((v) => <td key={v.id} className="text-center">{(["pickup", "drop"] as const).map((leg) => { const r = runs.find((x) => x.vehicle_id === v.id && x.work_date === d && x.leg === leg); return <span key={leg} className={`inline-block w-14 ${r ? (r.status === "showed" ? "text-emerald-700" : "text-rose-700 font-medium") : "text-slate-300"}`}>{r ? (r.status === "showed" ? "✓" : "✗ no show") : "–"}</span>; })}</td>)}<td className="text-right pl-2"><a className="text-xs text-blue-700 underline" href={`/attendance?p=${pid}&d=${d}`}>Open</a></td></tr>)}</tbody></table></div>
          <p className="text-xs text-slate-400">✓ showed up · ✗ did not show · – not recorded. Open takes you to that day on the attendance sheet, where show-ups are corrected.</p></section>}
        {tab === "vehicles" && <>
        <section className="card space-y-3"><div className="flex items-center gap-3"><h2 className="font-medium">Vehicles on this project</h2><label className="ml-auto text-xs text-slate-500 flex items-center gap-2">Month<input type="month" className="inp !w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label></div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[52rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Vehicle</th><th className="text-left">Billing</th><th className="text-right">Price</th><th className="text-right">Showed</th><th className="text-right">No-show</th><th className="text-right">This month</th><th className="text-right">Due (all)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((o) => { const cur = tripRate(rates, o.v.id, istToday()); return (
              <tr key={o.v.id}><td className="py-2"><div className="font-medium">{o.v.name}{!o.v.active && <span className="text-xs text-slate-400"> (inactive)</span>}</div><div className="text-xs text-slate-400">{o.v.operator || "—"}</div></td>
                <td><select className="inp !w-28 !py-1" aria-label={`Billing for ${o.v.name}`} value={o.v.billing} onChange={(e) => setBilling(o.v, e.target.value as Billing)}><option value="per_trip">Per trip</option><option value="monthly">Monthly</option></select></td>
                <td className="text-right"><div className="flex items-center justify-end gap-1.5"><span className="tabular-nums">{cur === null ? "not set" : `₹${inr(cur)}`}</span><span className="text-xs text-slate-400">{BILL[o.v.billing]}</span><input className="inp !w-20 !py-1" inputMode="decimal" placeholder="new" aria-label={`New price for ${o.v.name}`} value={rateIn[o.v.id] ?? ""} onChange={(e) => setRateIn((s) => ({ ...s, [o.v.id]: e.target.value }))} /><button className="btn !min-h-8" onClick={() => setRate(o.v.id)}>Set</button></div></td>
                <td className="text-right tabular-nums">{o.showed}</td><td className={`text-right tabular-nums ${o.missed ? "text-rose-700 font-medium" : ""}`}>{o.missed}</td>
                <td className="text-right tabular-nums">₹{inr(o.month)}{o.erMonth > 0 && <div className="text-[11px] text-slate-400">incl. ₹{inr(o.erMonth)} errands</div>}</td>
                <td className={`text-right tabular-nums ${o.due > 0 ? "text-amber-800 font-medium" : ""}`}>₹{inr(o.due)}{o.unpriced > 0 && <div className="text-[11px] text-slate-400">{o.unpriced} unpriced</div>}</td></tr>); })}</tbody></table></div>
          {!vehicles.length && <p className="text-sm text-slate-400">No vehicles for this project yet. Add the first one below.</p>}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3"><input className="inp !w-44" placeholder="Vehicle (e.g. Auto 1)" aria-label="Vehicle name" value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} /><input className="inp !w-44" placeholder="Operator (who is paid)" aria-label="Operator" value={nv.operator} onChange={(e) => setNv({ ...nv, operator: e.target.value })} />
            <select className="inp !w-32" aria-label="Billing" value={nv.billing} onChange={(e) => setNv({ ...nv, billing: e.target.value as Billing })}><option value="per_trip">Per trip</option><option value="monthly">Monthly</option></select><button className="btn btn-primary" onClick={addVehicle}>Add vehicle</button></div>
          <p className="text-xs text-slate-400">Per-trip vehicles are billed only for trips that showed up. Monthly vehicles are billed the fixed amount for each month with records; the no-show column shows what to raise with the operator. The first price you set also applies to earlier days. A later change applies from the date below; earlier days keep the price in force.</p>
          <label className="text-xs text-slate-500 flex items-center gap-2">New prices apply from<input type="date" className="inp !w-40" value={rateFrom} onChange={(e) => setRateFrom(e.target.value)} aria-label="Prices apply from" /></label></section>

        {allVehicles.some((v) => !v.project_id) && <section className="card space-y-2 !p-3"><h3 className="font-semibold text-sm">Vehicles not assigned to a project yet</h3><p className="text-xs text-slate-500">These were added before vehicles belonged to a project, so they don't appear above. Assign each to the project it serves (the one selected at the top) to use it for show-ups, errands and payments.</p>
          {allVehicles.filter((v) => !v.project_id).map((v) => <div key={v.id} className="flex items-center gap-2 text-sm"><span>{v.name}{v.operator ? <span className="text-xs text-slate-400"> · {v.operator}</span> : null}</span><button className="btn !py-1 ml-auto" onClick={() => assign(v)}>Assign to this project</button></div>)}</section>}

        </>}
        {tab === "errands" && <>
        <section className="card space-y-3"><h2 className="font-medium">Errands</h2><p className="text-xs text-slate-400">Extra jobs a vehicle ran that the operator quoted separately. They add to that vehicle's balance.</p>
          <div className="flex flex-wrap gap-2 items-end">
            <select className="inp !w-44" aria-label="Errand vehicle" value={ef.vehicle_id} onChange={(e) => setEf({ ...ef, vehicle_id: e.target.value })}><option value="">Vehicle…</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <input className="inp !w-40" type="date" aria-label="Errand date" value={ef.work_date} onChange={(e) => setEf({ ...ef, work_date: e.target.value })} />
            <input className="inp flex-1 min-w-48" placeholder="What was it for?" aria-label="Errand description" value={ef.description} onChange={(e) => setEf({ ...ef, description: e.target.value })} />
            <input className="inp !w-32" inputMode="decimal" placeholder="Quoted ₹" aria-label="Errand amount" value={ef.amount} onChange={(e) => setEf({ ...ef, amount: e.target.value })} />
            <button className="btn btn-primary" onClick={addErrand}>Add errand</button></div>
          <ul className="divide-y divide-slate-100 text-sm" data-errands>{errands.map((x) => <li key={x.id} className={`py-2 flex flex-wrap items-center gap-x-3 ${x.voided_at ? "text-slate-400 line-through" : ""}`}><span className="tabular-nums w-24">{x.work_date}</span><span className="w-32 truncate">{vName(x.vehicle_id)}</span><span className="tabular-nums w-28">₹{inr(x.amount)}</span><span className="text-xs text-slate-500 flex-1 truncate">{x.description}</span>{x.voided_at ? <span className="text-xs">void</span> : <button className="text-xs text-red-700 underline" onClick={() => voidIt("transport_errands", x, "errand")}>Void</button>}</li>)}</ul>
          {!errands.length && <p className="text-sm text-slate-400">No errands recorded.</p>}</section>

        </>}
        {tab === "payments" && <>
        <section className="card space-y-3"><h2 className="font-medium">Payments</h2><p className="text-xs text-slate-400">Each payment also posts a Transport / freight expense on the project by itself; voiding a payment removes that expense.</p>
          <div className="flex flex-wrap gap-2 items-end">
            <select className="inp !w-44" aria-label="Vehicle" value={pf.vehicle_id} onChange={(e) => setPf({ ...pf, vehicle_id: e.target.value })}><option value="">Vehicle…</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <input className="inp !w-32" inputMode="decimal" placeholder="Amount ₹" aria-label="Amount" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} />
            <input className="inp !w-40" type="date" aria-label="Paid on" value={pf.paid_on} onChange={(e) => setPf({ ...pf, paid_on: e.target.value })} />
            <input className="inp !w-40" placeholder="Reference / UTR" aria-label="Reference" value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} />
            <label className="text-xs text-slate-500 flex items-center gap-1">Bill<input type="file" accept="image/*,application/pdf" aria-label="Payment bill" className="max-w-[11rem] text-xs" onChange={(e) => setPfBill(e.target.files?.[0] ?? null)} /></label>
            <button className="btn btn-primary" onClick={addPay}>Record payment</button></div>
          <ul className="divide-y divide-slate-100 text-sm">{pays.map((x) => <li key={x.id} className={`py-2 flex flex-wrap items-center gap-x-3 ${x.voided_at ? "text-slate-400 line-through" : ""}`}><span className="tabular-nums w-24">{x.paid_on}</span><span className="w-32 truncate">{vName(x.vehicle_id)}</span><span className="tabular-nums w-28">₹{inr(x.amount)}</span><span className="text-xs text-slate-400 flex-1 truncate">{x.reference}{x.note ? ` · ${x.note}` : ""}</span><PaymentBill path={x.bill_path} projectId={pid} onAttach={(path) => attachBill(x, path)} onError={setErr} />{x.voided_at ? <span className="text-xs">void</span> : <button className="text-xs text-red-700 underline" onClick={() => voidIt("transport_payments", x, "payment")}>Void</button>}</li>)}</ul>
          {!pays.length && <p className="text-sm text-slate-400">No payments recorded.</p>}</section>
        </>}
      </>}
    </div>
  );
}
