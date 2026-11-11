"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { gasCost, groupRuns, runCharge, type GMove, type GRun, type GRunMove } from "@/lib/gas";
import type { GasCtx } from "./useGas";
import { useRunDocs } from "./GasRuns";

// Charges: what gas has cost this project, for a month or to date. Each run is priced like the vendor's invoice (gas × rate + freight, with GST); lost and damaged
// cylinders are added. Per vendor: what the runs come to (the invoice where one is attached, else the expected amount), what was paid, and what is due. Payments are
// recorded here (they post to the project's expenses, as before). Operations / Admin only.
type Pay = { id: string; vendor_id: string; paid_on: string; amount: number; reference: string; note: string; bill_path: string | null; voided_at: string | null };
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const monthLabel = (ym: string) => new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });

export default function GasCharges({ c, deposits }: { c: GasCtx; deposits: React.ReactNode }) {
  const { docs } = useRunDocs(c.pid); const today = istToday();
  const [period, setPeriod] = useState<string>(today.slice(0, 7));   // "YYYY-MM" or "all"
  const [pays, setPays] = useState<Pay[]>([]); const [pf, setPf] = useState({ vendor_id: "", amount: "", paid_on: today, reference: "" }); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const loadPays = async () => { const { data } = await supabase().from("site_payments").select("*").eq("project_id", c.pid).eq("kind", "gas").order("paid_on", { ascending: false }); setPays(((data || []) as Pay[]).map((p) => ({ ...p, amount: Number(p.amount) }))); };
  useEffect(() => { loadPays(); }, [c.pid]);   // eslint-disable-line react-hooks/exhaustive-deps

  const priceCtx = { orders: c.orders, pricing: c.pricing, rates: c.rates, products: c.products, terms: c.terms, label: c.prodLabel };
  const runs = useMemo(() => groupRuns(c.moves as unknown as GRunMove[]).map((r) => ({ r, ch: runCharge(r as GRun, priceCtx), doc: docs[r.ref] })), [c.moves, docs, c.rates, c.terms]);   // eslint-disable-line react-hooks/exhaustive-deps
  const months = [...new Set([today.slice(0, 7), ...runs.map((x) => x.r.date.slice(0, 7))])].sort().reverse();
  const inPeriod = runs.filter((x) => period === "all" || x.r.date.startsWith(period));
  const from = period === "all" ? undefined : `${period}-01`, to = period === "all" ? undefined : `${period}-31`;
  const incidents = gasCost({ moves: c.moves as unknown as GMove[], orders: c.orders, pricing: c.pricing, rates: c.rates, products: c.products, terms: c.terms, from, to });
  const sum = (f: (x: (typeof runs)[number]) => number) => inPeriod.reduce((s, x) => s + f(x), 0);
  const gas = sum((x) => x.ch.gas), freight = sum((x) => x.ch.freight), gst = sum((x) => x.ch.gst), incid = incidents.lostAmount + incidents.damagedAmount;
  const total = sum((x) => x.ch.total) + incid;
  const cyl = new Map<string, number>(); inPeriod.forEach((x) => x.r.live.filter((m) => m.kind === "delivery").forEach((m) => cyl.set(m.product_id, (cyl.get(m.product_id) ?? 0) + m.qty)));
  // per vendor, all time: what is owed (the invoice where attached, else the expected amount), paid, due
  const vendorRows = c.myVendors.map((v) => { const rs = runs.filter((x) => x.r.vendor_id === v.id); const owed = rs.reduce((s, x) => s + (x.doc?.invoice_amount ?? x.ch.total), 0); const invoiced = rs.filter((x) => x.doc?.invoice_amount != null).length;
    const paid = pays.filter((p) => !p.voided_at && p.vendor_id === v.id).reduce((s, p) => s + p.amount, 0); return { v, runs: rs.length, owed, invoiced, paid, due: Math.round((owed - paid) * 100) / 100 }; }).filter((x) => x.runs || x.paid);

  async function addPay() {
    const amount = parseFloat(pf.amount); if (!pf.vendor_id || !(amount > 0)) { setErr("Choose the vendor and enter the amount paid."); return; }
    setBusy(true); setErr(""); let bill_path: string | null = null;
    if (file) { const p = await prepareUpload(file); if (p.size > MAX_UPLOAD) { setErr("The file is larger than 5 MB."); setBusy(false); return; } const fd = new FormData(); fd.set("file", p); fd.set("projectId", c.pid); const r = await fetch("/api/gas/upload", { method: "POST", body: fd }); if (!r.ok) { setErr(await r.text()); setBusy(false); return; } bill_path = (await r.json()).path; }
    const { error } = await supabase().from("site_payments").insert({ kind: "gas", vendor_id: pf.vendor_id, project_id: c.pid, amount, paid_on: pf.paid_on, reference: pf.reference.trim(), bill_path });
    setBusy(false); if (error) { setErr(error.message); return; } setPf({ ...pf, amount: "", reference: "" }); setFile(null); c.note("Payment recorded ✓ It is in the project's expenses."); loadPays();
  }
  async function voidPay(p: Pay) { if (!confirm(`Void the ${inr(p.amount)} payment of ${day(p.paid_on)}? It stays in the list, marked void, and comes off the expenses.`)) return; const { error } = await supabase().from("site_payments").update({ voided_at: new Date().toISOString() }).eq("id", p.id); if (error) { setErr(error.message); return; } loadPays(); }

  const stat = (label: string, value: string, sub?: string, tone = "") => <div className="rounded-2xl border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
  return (
    <div className="space-y-4" data-gas-charges>
      <div className="flex flex-wrap items-center gap-2">
        {months.map((m) => <button key={m} type="button" className={`chip ${period === m ? "chip-on" : ""}`} onClick={() => setPeriod(m)}>{monthLabel(m)}</button>)}
        <button type="button" className={`chip ${period === "all" ? "chip-on" : ""}`} onClick={() => setPeriod("all")}>All to date</button>
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {stat("Total", inr(total), period === "all" ? "to date" : monthLabel(period), "text-blue-800")}
        {stat("Runs", String(inPeriod.length), [...cyl.entries()].map(([p, n]) => `${n} ${c.prodLabel(p)}`).join(" · ") || "no cylinders delivered")}
        {stat("Gas", inr(gas), "before GST")}
        {stat("Freight", inr(freight), "before GST")}
        {stat("GST", inr(gst))}
        {incid > 0 && stat("Lost / damaged", inr(incid), `${incidents.lost} lost · ${incidents.damaged} damaged`, "text-rose-700")}
      </div>

      <section className="card !p-0 overflow-x-auto"><div className="px-4 pt-3 font-semibold">Run by run</div>
        <table className="w-full text-sm mt-2"><thead className="text-left text-xs text-slate-500 bg-slate-50"><tr><th className="px-4 py-2 font-medium">Run</th><th className="px-3 py-2 font-medium text-right">Gas</th><th className="px-3 py-2 font-medium text-right">Freight</th><th className="px-3 py-2 font-medium text-right">GST</th><th className="px-3 py-2 font-medium text-right">Expected</th><th className="px-4 py-2 font-medium text-right">Invoice</th></tr></thead>
          <tbody>{inPeriod.map(({ r, ch, doc }) => <tr key={r.ref} className="border-t border-slate-100 tabular-nums">
            <td className="px-4 py-2 whitespace-nowrap">{day(r.date)} <span className="text-xs text-slate-500">· {c.vName(r.vendor_id)}{r.challan ? ` · ${r.challan}` : ""}</span></td>
            <td className="px-3 py-2 text-right">{inr(ch.gas)}</td><td className="px-3 py-2 text-right">{ch.freight ? inr(ch.freight) : "—"}</td><td className="px-3 py-2 text-right">{inr(ch.gst)}</td><td className="px-3 py-2 text-right font-medium">{inr(ch.total)}</td>
            <td className={`px-4 py-2 text-right ${doc?.invoice_amount == null ? "text-slate-400" : Math.abs(doc.invoice_amount - ch.total) <= 1 ? "text-emerald-700" : "text-amber-700"}`}>{doc?.invoice_amount == null ? "not attached" : inr(doc.invoice_amount)}</td></tr>)}
            {!inPeriod.length && <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-500">No runs in this period.</td></tr>}
          </tbody></table>
        {incidents.lines.filter((l) => /lost|damaged/.test(l)).map((l) => <p key={l} className="px-4 pb-2 text-xs text-rose-700">{l}</p>)}
      </section>

      <section className="card space-y-3"><div className="font-semibold">Vendors: owed, paid and due <span className="text-xs font-normal text-slate-500">(all to date; a run counts at its invoice once attached, until then at the expected amount)</span></div>
        {vendorRows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-1 font-medium">Vendor</th><th className="py-1 font-medium text-right">Runs</th><th className="py-1 font-medium text-right">Owed</th><th className="py-1 font-medium text-right">Paid</th><th className="py-1 font-medium text-right">Due</th></tr></thead>
          <tbody>{vendorRows.map((x) => <tr key={x.v.id} className="border-t border-slate-100 tabular-nums"><td className="py-2">{x.v.name}<div className="text-xs text-slate-400">{x.invoiced} of {x.runs} runs invoiced</div></td><td className="py-2 text-right">{x.runs}</td><td className="py-2 text-right">{inr(x.owed)}</td><td className="py-2 text-right">{inr(x.paid)}</td><td className={`py-2 text-right font-semibold ${x.due > 0.5 ? "text-rose-700" : "text-emerald-700"}`}>{inr(x.due)}</td></tr>)}</tbody></table></div>
          : <p className="text-sm text-slate-500">Nothing owed yet.</p>}
        {c.mayAct && <div className="border-t border-slate-100 pt-3 space-y-2"><div className="text-sm font-medium">Record a payment</div>
          <div className="grid gap-2 sm:grid-cols-5 items-end">
            <label className="block text-xs text-slate-500">Vendor<select className="inp mt-1" value={pf.vendor_id} onChange={(e) => setPf({ ...pf, vendor_id: e.target.value })}><option value="">Choose…</option>{c.myVendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
            <label className="block text-xs text-slate-500">Amount (₹)<input className="inp mt-1" inputMode="decimal" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value.replace(/[^\d.]/g, "") })} /></label>
            <label className="block text-xs text-slate-500">Paid on<input type="date" className="inp mt-1" max={today} value={pf.paid_on} onChange={(e) => setPf({ ...pf, paid_on: e.target.value })} /></label>
            <label className="block text-xs text-slate-500">Reference / UTR<input className="inp mt-1" value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} /></label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={addPay}>{busy ? "Saving…" : "Record payment"}</button>
            <label className="block text-xs text-slate-500 sm:col-span-5">Receipt / proof (optional)<input type="file" accept="image/*,application/pdf" className="ml-2 text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          </div>{err && <p className="text-sm text-red-700">{err}</p>}</div>}
        {pays.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-blue-700">Payments ({pays.filter((p) => !p.voided_at).length})</summary>
          <ul className="mt-2 divide-y divide-slate-100">{pays.map((p) => <li key={p.id} className={`py-1.5 flex flex-wrap items-center gap-x-3 ${p.voided_at ? "text-slate-400 line-through" : ""}`}><span className="tabular-nums w-20">{day(p.paid_on)}</span><span className="tabular-nums w-28">{inr(p.amount)}</span><span className="flex-1">{c.vName(p.vendor_id)}{p.reference ? ` · ${p.reference}` : ""}</span>
            {p.bill_path && <a className="tlink text-xs" href={`/api/gas/file?path=${encodeURIComponent(p.bill_path)}`} target="_blank" rel="noreferrer">receipt</a>}{!p.voided_at && c.mayAct && <button type="button" className="text-xs text-red-700 underline" onClick={() => voidPay(p)}>Void</button>}</li>)}</ul></details>}
      </section>

      {deposits && <section className="space-y-2"><div className="font-semibold">Deposits held by vendors</div>{deposits}</section>}
    </div>
  );
}
