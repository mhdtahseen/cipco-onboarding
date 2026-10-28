"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MEALS, istToday, rateFor, type MealRate, type Vendor } from "@/lib/attendance";
import type { Project } from "@/lib/types";

type MealRow = { work_date: string; breakfast_vendor_id: string | null; lunch_vendor_id: string | null; dinner_vendor_id: string | null };
type Pay = { id: string; vendor_id: string; paid_on: string; amount: number; reference: string; note: string; voided_at: string | null };
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Admin: what each food vendor is owed on a project (meals recorded on the attendance sheet x the vendor's price) and what has been paid.
// Recording a payment also posts a Food expense on the project, and voiding the payment removes it, so nothing is entered twice.
export default function MealPayments() {
  const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState(""); const [vendors, setVendors] = useState<Vendor[]>([]); const [rates, setRates] = useState<MealRate[]>([]); const [meals, setMeals] = useState<MealRow[]>([]); const [pays, setPays] = useState<Pay[]>([]);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [month, setMonth] = useState(istToday().slice(0, 7)); const [pf, setPf] = useState({ vendor_id: "", amount: "", paid_on: istToday(), reference: "", note: "" });

  async function load() {
    const sb = supabase(); const [pr, v, r, p] = await Promise.all([sb.from("projects").select("*").eq("status", "active").order("name"), sb.from("food_vendors").select("*").order("sort_order"), sb.from("meal_rates").select("*"), sb.from("vendor_payments").select("*").order("paid_on", { ascending: false })]);
    const x = pr.error || v.error || r.error || p.error; if (x) { setErr(x.message + " — has the accountability SQL migration been run?"); setLoading(false); return; }
    const pl = (pr.data || []) as Project[]; setProjects(pl); setPid((c) => c || pl[0]?.id || ""); setVendors((v.data || []) as Vendor[]); setRates(((r.data || []) as MealRate[]).map((q) => ({ ...q, price: Number(q.price) }))); setPays(((p.data || []) as Pay[]).map((q) => ({ ...q, amount: Number(q.amount) }))); setErr(""); setLoading(false);
  }
  useEffect(() => { load(); }, []);
  // The meals of the selected project (every day, in pages of 1000).
  useEffect(() => { if (!pid) return; let live = true; (async () => {
    const sb = supabase(); const all: MealRow[] = [];
    for (let from = 0; ; from += 1000) { const { data, error } = await sb.from("attendance").select("work_date, breakfast_vendor_id, lunch_vendor_id, dinner_vendor_id").eq("project_id", pid).order("work_date").range(from, from + 999); if (error) { setErr(error.message); break; } all.push(...((data || []) as MealRow[])); if (!data || data.length < 1000) break; }
    if (live) setMeals(all);
  })(); return () => { live = false; }; }, [pid]);

  const pv = useMemo(() => vendors.filter((v) => v.project_id === pid), [vendors, pid]); const ids = useMemo(() => new Set(pv.map((v) => v.id)), [pv]);
  const myPays = useMemo(() => pays.filter((x) => ids.has(x.vendor_id)), [pays, ids]);
  const rows = useMemo(() => pv.map((v) => {
    let all = 0, inMonth = 0, unpriced = 0; const counts = [0, 0, 0];
    meals.forEach((r) => MEALS.forEach((m, i) => { if (r[m.col] !== v.id) return; const price = rateFor(rates, v.id, m.key, r.work_date); const mo = r.work_date.startsWith(month); if (mo) counts[i]++; if (price === null) unpriced++; else { all += price; if (mo) inMonth += price; } }));
    const paid = myPays.filter((x) => x.vendor_id === v.id && !x.voided_at).reduce((s, x) => s + x.amount, 0);
    return { v, counts, month: inMonth, billed: all, paid, due: all - paid, unpriced };
  }), [pv, meals, rates, myPays, month]);
  const tot = rows.reduce((a, r) => ({ month: a.month + r.month, billed: a.billed + r.billed, paid: a.paid + r.paid }), { month: 0, billed: 0, paid: 0 });
  const vName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "?";
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  async function addPay() {
    const amount = parseFloat(pf.amount); if (!pf.vendor_id || !(amount > 0)) { setErr("Choose the vendor and enter the amount."); return; } setErr("");
    const { error } = await supabase().from("vendor_payments").insert({ vendor_id: pf.vendor_id, amount, paid_on: pf.paid_on, reference: pf.reference.trim(), note: pf.note.trim() });
    if (error) { setErr(error.message); return; } setPf({ ...pf, amount: "", reference: "", note: "" }); note("Payment recorded and posted to the project's Food expenses ✓"); load();
  }
  async function voidIt(x: Pay) {
    if (!confirm(`Void the ₹${inr(x.amount)} payment to ${vName(x.vendor_id)}? It stays in the list, marked void, and its Food expense is removed.`)) return;
    const { error } = await supabase().from("vendor_payments").update({ voided_at: new Date().toISOString() }).eq("id", x.id); if (error) { setErr(error.message); return; } note("Voided; the expense was removed ✓"); load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Meal payments</h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => { setPid(e.target.value); setPf((f) => ({ ...f, vendor_id: "" })); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}</option>)}</select>}</div>
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}{loading && <p className="text-slate-500">Loading…</p>}
      {!loading && <>
        <div className="grid grid-cols-3 gap-3 text-center">{[["This month", tot.month], ["Paid (all time)", tot.paid], ["Balance due", tot.billed - tot.paid]].map(([l, n]) => <div key={l as string} className="rounded-2xl bg-white border border-slate-200/80 p-3"><div className="text-xs text-slate-400">{l}</div><div className="text-lg font-medium tabular-nums">₹{inr(n as number)}</div></div>)}</div>

        <section className="card space-y-3"><div className="flex items-center gap-3"><h2 className="font-medium">Vendors on this project</h2><label className="ml-auto text-xs text-slate-500 flex items-center gap-2">Month<input type="month" className="inp !w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label></div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[40rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Vendor</th>{MEALS.map((m) => <th key={m.key} className="text-right">{m.label}</th>)}<th className="text-right">This month</th><th className="text-right">Billed (all)</th><th className="text-right">Paid</th><th className="text-right">Due</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((o) => <tr key={o.v.id}><td className="py-2 font-medium">{o.v.name}{!o.v.active && <span className="text-xs text-slate-400"> (hidden)</span>}</td>{o.counts.map((n, i) => <td key={i} className="text-right tabular-nums">{n}</td>)}<td className="text-right tabular-nums">₹{inr(o.month)}</td><td className="text-right tabular-nums">₹{inr(o.billed)}</td><td className="text-right tabular-nums">₹{inr(o.paid)}</td>
              <td className={`text-right tabular-nums ${o.due > 0 ? "text-amber-800 font-medium" : ""}`}>₹{inr(o.due)}{o.unpriced > 0 && <div className="text-[11px] text-slate-400">{o.unpriced} meals unpriced</div>}</td></tr>)}</tbody></table></div>
          {!pv.length && <p className="text-sm text-slate-400">No vendors for this project yet. Add them under Settings → Food vendors.</p>}
          <p className="text-xs text-slate-400">Billed = every meal recorded on the attendance sheet (whatever the person's work status) x that vendor's price on the day. Set prices under Settings → Food vendors; meals with no price are counted but not billed. The counts follow the month chosen above.</p></section>

        <section className="card space-y-3"><h2 className="font-medium">Payments</h2><p className="text-xs text-slate-400">Each payment is recorded once, here, and posts a Food expense on the project by itself. Payments are never edited; a wrong one is voided (its expense is removed) and entered again.</p>
          <div className="flex flex-wrap gap-2 items-end">
            <select className="inp !w-44" aria-label="Vendor" value={pf.vendor_id} onChange={(e) => setPf({ ...pf, vendor_id: e.target.value })}><option value="">Vendor…</option>{pv.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <input className="inp !w-32" inputMode="decimal" placeholder="Amount ₹" aria-label="Amount" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} />
            <input className="inp !w-40" type="date" aria-label="Paid on" value={pf.paid_on} onChange={(e) => setPf({ ...pf, paid_on: e.target.value })} />
            <input className="inp !w-40" placeholder="Reference / UTR" aria-label="Reference" value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} />
            <button className="btn btn-primary" onClick={addPay}>Record payment</button></div>
          <ul className="divide-y divide-slate-100 text-sm" data-payments>{myPays.map((x) => <li key={x.id} className={`py-2 flex flex-wrap items-center gap-x-3 ${x.voided_at ? "text-slate-400 line-through" : ""}`}><span className="tabular-nums w-24">{x.paid_on}</span><span className="w-32 truncate">{vName(x.vendor_id)}</span><span className="tabular-nums w-28">₹{inr(x.amount)}</span><span className="text-xs text-slate-400 flex-1 truncate">{x.reference}{x.note ? ` · ${x.note}` : ""}</span>{x.voided_at ? <span className="text-xs">void</span> : <button className="text-xs text-red-700 underline" onClick={() => voidIt(x)}>Void</button>}</li>)}</ul>
          {!myPays.length && <p className="text-sm text-slate-400">No payments recorded.</p>}</section>
      </>}
    </div>
  );
}
