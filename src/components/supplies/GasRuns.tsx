"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { groupRuns, runCharge, type GRun, type GRunMove } from "@/lib/gas";
import { JSL_LABEL } from "@/lib/inventory";
import type { GasCtx } from "./useGas";

// Runs: one row per visit of a vendor's truck (one delivery challan, one invoice). Open a run to see what came in and went back, what it should cost line by line
// (like the vendor's invoice), its delivery challan, the vendor's invoice for it, and its JSL portal entry. The challan can be attached by the site; the invoice by
// Operations or an Admin (2026-11-gas-runs.sql).
export type RunDoc = { run_ref: string; challan_path: string | null; invoice_no: string; invoice_date: string | null; invoice_amount: number | null; invoice_path: string | null; note: string };
const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso + "T00:00:00");
const fileUrl = (p: string) => `/api/gas/file?path=${encodeURIComponent(p)}`;
const CARRIER: Record<string, string> = { vendor: "Vendor's truck", own: "Our vehicle", none: "Collected" };

export function useRunDocs(pid: string) {
  const [docs, setDocs] = useState<Record<string, RunDoc>>({}); const [missing, setMissing] = useState(false);
  const load = async () => { if (!pid) return; const { data, error } = await supabase().from("gas_runs").select("*").eq("project_id", pid); if (error) { setMissing(true); return; } setMissing(false); setDocs(Object.fromEntries(((data || []) as RunDoc[]).map((d) => [d.run_ref, { ...d, invoice_amount: d.invoice_amount == null ? null : Number(d.invoice_amount) }]))); };
  useEffect(() => { load(); }, [pid]);   // eslint-disable-line react-hooks/exhaustive-deps
  return { docs, missing, reload: load };
}

export default function GasRuns({ c }: { c: GasCtx }) {
  const { docs, missing, reload } = useRunDocs(c.pid);
  const runs = useMemo(() => groupRuns(c.moves as unknown as GRunMove[]), [c.moves]);
  const months = useMemo(() => [...new Set(runs.map((r) => r.date.slice(0, 7)))], [runs]);
  const [month, setMonth] = useState("all"); const [open, setOpen] = useState<string | null>(null);
  const priceCtx = { orders: c.orders, pricing: c.pricing, rates: c.rates, products: c.products, terms: c.terms, label: c.prodLabel };
  const shown = runs.filter((r) => month === "all" || r.date.startsWith(month));
  const billOf = (r: GRun) => c.gasBills.find((b) => !b.voided_at && b.vendor_name === c.vName(r.vendor_id) && b.bill_date === r.date && b.bill_no === r.challan);
  const sumBy = (r: GRun, kind: string) => { const m = new Map<string, number>(); r.live.filter((x) => x.kind === kind).forEach((x) => m.set(x.product_id, (m.get(x.product_id) ?? 0) + x.qty)); return m; };

  if (!runs.length) return <div className="card text-sm text-slate-500 text-center">No runs recorded for this project yet. Use <b>+ Record a run</b> on the Stock tab when a truck comes.</div>;
  return (
    <div className="space-y-3" data-gas-runs>
      {missing && <p className="warn !text-sm">Attaching challans and invoices to runs needs 2026-11-gas-runs.sql to be run first.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`chip ${month === "all" ? "chip-on" : ""}`} onClick={() => setMonth("all")}>All <span className="text-slate-500">{runs.length}</span></button>
        {months.map((m) => <button key={m} type="button" className={`chip ${month === m ? "chip-on" : ""}`} onClick={() => setMonth(m)}>{day(m + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" })} <span className="text-slate-500">{runs.filter((r) => r.date.startsWith(m)).length}</span></button>)}
      </div>
      <ul className="space-y-2">
        {shown.map((r) => {
          const ch = c.money ? runCharge(r as unknown as GRun, priceCtx) : null; const d = docs[r.ref]; const hasChallan = r.photos.length > 0 || !!d?.challan_path;
          const inv = d?.invoice_amount ?? null; const diff = ch && inv != null ? Math.round((inv - ch.total) * 100) / 100 : null; const ins = sumBy(r, "delivery"), outs = sumBy(r, "return");
          const prods = [...new Set([...ins.keys(), ...outs.keys()])]; const gb = billOf(r); const isOpen = open === r.ref;
          return <li key={r.ref} className={`card !p-0 overflow-hidden ${isOpen ? "ring-1 ring-blue-200" : ""}`}>
            <button type="button" className="w-full text-left px-3 py-3 sm:px-4 grid grid-cols-[3.25rem_1fr] sm:grid-cols-[3.25rem_1fr_auto] gap-x-3 gap-y-2 items-center hover:bg-slate-50" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.ref)}>
              <span className="rounded-xl bg-slate-100 text-center py-1.5 leading-tight"><span className="block text-lg font-semibold tabular-nums">{day(r.date).getDate()}</span><span className="block text-[11px] uppercase text-slate-500">{day(r.date).toLocaleDateString("en-IN", { month: "short" })}</span></span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2"><b className="font-medium">{c.vName(r.vendor_id)}</b><span className="text-xs text-slate-500">{r.challan ? `Challan ${r.challan}` : <span className="text-amber-700">no challan no.</span>}</span></span>
                <span className="flex flex-wrap gap-1.5 mt-1">{prods.map((p) => <span key={p} className="text-xs rounded-full bg-blue-50 text-blue-800 px-2 py-0.5">{c.prodLabel(p)}: {ins.get(p) ?? 0} in · {outs.get(p) ?? 0} out</span>)}
                  {r.carrier !== "vendor" && <span className="text-xs rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{CARRIER[r.carrier]}</span>}</span>
              </span>
              <span className="col-span-2 sm:col-span-1 flex flex-wrap sm:flex-col sm:items-end gap-1.5 text-xs">
                {ch && <b className="text-base tabular-nums">{inr0(ch.total)}</b>}
                <span className="flex flex-wrap gap-1.5 sm:justify-end">
                  <span className={`rounded-full px-2 py-0.5 ${hasChallan ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{hasChallan ? "Challan ✓" : "Challan missing"}</span>
                  {c.money && <span className={`rounded-full px-2 py-0.5 ${inv == null ? "bg-slate-100 text-slate-600" : Math.abs(diff ?? 0) <= 1 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{inv == null ? "No invoice" : Math.abs(diff ?? 0) <= 1 ? "Invoice ✓" : `Invoice ${diff! > 0 ? "+" : "−"}${inr0(Math.abs(diff!))}`}</span>}
                  {gb && <span className={`rounded-full px-2 py-0.5 ${gb.jsl_wanted ? JSL_LABEL[gb.jsl_status].cls : "bg-slate-100 text-slate-600"}`}>{gb.jsl_wanted ? `JSL: ${JSL_LABEL[gb.jsl_status].text}` : "JSL: not sent"}</span>}
                </span>
              </span>
            </button>
            {isOpen && <RunDetail r={r as unknown as GRun} c={c} doc={d} charge={ch} jsl={gb} missing={missing} onSaved={reload} />}
          </li>; })}
      </ul>
    </div>
  );
}

function RunDetail({ r, c, doc, charge, jsl, missing, onSaved }: { r: GRun; c: GasCtx; doc?: RunDoc; charge: ReturnType<typeof runCharge> | null; jsl?: GasCtx["gasBills"][number]; missing: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const [f, setF] = useState({ invoice_no: doc?.invoice_no ?? "", invoice_date: doc?.invoice_date ?? r.date, invoice_amount: doc?.invoice_amount != null ? String(doc.invoice_amount) : "" }); const [inv, setInv] = useState<File | null>(null);
  const upload = async (file: File) => { const p = await prepareUpload(file); if (p.size > MAX_UPLOAD) throw new Error("The file is larger than 5 MB."); const fd = new FormData(); fd.set("file", p); fd.set("projectId", c.pid); const res = await fetch("/api/gas/upload", { method: "POST", body: fd }); if (!res.ok) throw new Error(await res.text()); return (await res.json()).path as string; };
  const save = async (patch: Partial<RunDoc>, what: string) => {
    const { error } = await supabase().from("gas_runs").upsert({ run_ref: r.ref, project_id: c.pid, vendor_id: r.vendor_id, ...patch }, { onConflict: "run_ref" });
    if (error) throw new Error(/gas_runs|schema cache/.test(error.message) ? "Run 2026-11-gas-runs.sql first." : error.message); c.note(`${what} ✓`); onSaved();
  };
  async function attachChallan(file: File) { setBusy("challan"); setErr(""); try { await save({ challan_path: await upload(file) }, "Challan attached"); } catch (e) { setErr((e as Error).message); } setBusy(""); }
  async function saveInvoice() {
    const amt = parseFloat(f.invoice_amount); if (!f.invoice_no.trim() || !(amt >= 0) || f.invoice_amount === "") { setErr("Enter the invoice number and its total."); return; }
    setBusy("invoice"); setErr("");
    try { await save({ invoice_no: f.invoice_no.trim(), invoice_date: f.invoice_date || null, invoice_amount: amt, ...(inv ? { invoice_path: await upload(inv) } : {}) }, "Invoice saved"); setInv(null); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  }
  const challans = [...r.photos, ...(doc?.challan_path ? [doc.challan_path] : [])];
  const diff = charge && doc?.invoice_amount != null ? Math.round((doc.invoice_amount - charge.total) * 100) / 100 : null;
  return (
    <div className="border-t border-slate-100 px-3 py-3 sm:px-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]" data-run-detail>
      <div className="space-y-3 min-w-0">
        <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cylinders</div><div className="divide-y divide-slate-100">{r.moves.map((m) => <div key={m.id}>{c.moveNode(m as never, true)}</div>)}</div>
          {r.live[0] && c.carrierNode(r.live[0] as never)}</div>
        <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Delivery challan</div>
          <div className="flex flex-wrap items-center gap-2">{challans.map((p, i) => <a key={p} className="btn btn-sm" href={fileUrl(p)} target="_blank" rel="noreferrer">View challan{challans.length > 1 ? ` ${i + 1}` : ""}</a>)}
            {!challans.length && <span className="text-sm text-rose-700">Not attached yet.</span>}
            {!c.viewer && !missing && <label className="btn btn-sm cursor-pointer">{busy === "challan" ? "Uploading…" : challans.length ? "Add another" : "Attach challan"}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && attachChallan(e.target.files[0])} /></label>}</div></div>
        <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">JSL portal</div>
          {jsl && !c.money ? <span className={`text-xs rounded-full px-2 py-0.5 ${jsl.jsl_wanted ? JSL_LABEL[jsl.jsl_status].cls : "bg-slate-100 text-slate-600"}`}>{jsl.jsl_wanted ? JSL_LABEL[jsl.jsl_status].text : "Not sent yet (the Admin sends it)"}</span>
            : jsl ? <a className={`btn btn-sm ${jsl.jsl_wanted ? "" : "btn-primary"}`} href={`/inventory?project=${c.pid}&bill=${jsl.id}`}>{jsl.jsl_wanted ? `${JSL_LABEL[jsl.jsl_status].text} →` : "Send to the JSL portal →"}</a>
            : <span className="text-sm text-slate-500">No portal entry for this run (only deliveries make one; a run needs its challan number to be matched).</span>}</div>
      </div>
      {c.money && charge && <div className="space-y-3 min-w-0">
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">What this run should cost</div>
          <table className="w-full text-sm tabular-nums"><tbody>
            {charge.lines.map((l, i) => <tr key={i}><td className="py-0.5 pr-2">{l.label}{l.qty != null && <span className="text-xs text-slate-500"> {l.qty} × ₹{inr(l.rate!)}</span>}</td><td className="py-0.5 text-right">{inr(l.taxable)}</td></tr>)}
            {!charge.lines.length && <tr><td className="text-slate-500">Nothing charged (only empties went back, or no rate is set).</td></tr>}
            <tr className="border-t border-slate-200"><td className="pt-1 text-slate-600">Before GST</td><td className="pt-1 text-right">{inr(charge.taxable)}</td></tr>
            {charge.lines.filter((l) => l.gst).map((l, i) => <tr key={"g" + i}><td className="text-slate-600">GST {l.gstPct}% on {l.label.toLowerCase()}</td><td className="text-right">{inr(l.gst)}</td></tr>)}
            <tr className="border-t border-slate-200 font-semibold"><td className="pt-1">Total (rounded)</td><td className="pt-1 text-right">₹{inr(charge.total)}</td></tr>
          </tbody></table>
          {charge.unpriced > 0 && <p className="text-xs text-amber-700 mt-1">{charge.unpriced} cylinder{charge.unpriced === 1 ? " has" : "s have"} no rate set: add it under Vendors &amp; rates.</p>}
        </div>
        <div className="rounded-xl border border-slate-200 p-3 space-y-2"><div className="flex items-center gap-2"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor's invoice</div>
          {doc?.invoice_amount != null && <span className={`ml-auto text-xs rounded-full px-2 py-0.5 ${Math.abs(diff ?? 0) <= 1 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{Math.abs(diff ?? 0) <= 1 ? "Matches" : `${diff! > 0 ? "₹" + inr(diff!) + " more" : "₹" + inr(-diff!) + " less"} than expected`}</span>}</div>
          {doc?.invoice_path && <a className="btn btn-sm" href={fileUrl(doc.invoice_path)} target="_blank" rel="noreferrer">View invoice {doc.invoice_no}</a>}
          {c.mayAct && !missing ? <div className="grid gap-2 grid-cols-2">
            <label className="block text-xs text-slate-500">Invoice no.<input className="inp mt-1" value={f.invoice_no} onChange={(e) => setF({ ...f, invoice_no: e.target.value })} placeholder="e.g. RKW/26-27/2788" /></label>
            <label className="block text-xs text-slate-500">Date<input type="date" className="inp mt-1" value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} /></label>
            <label className="block text-xs text-slate-500">Total on the invoice (₹)<input className="inp mt-1" inputMode="decimal" value={f.invoice_amount} onChange={(e) => setF({ ...f, invoice_amount: e.target.value.replace(/[^\d.]/g, "") })} placeholder={String(charge.total)} /></label>
            <label className="block text-xs text-slate-500">File (PDF or photo)<input type="file" accept="image/*,application/pdf" className="mt-2 text-xs w-full" onChange={(e) => setInv(e.target.files?.[0] ?? null)} /></label>
            <div className="col-span-2"><button type="button" className="btn btn-primary btn-sm" disabled={busy === "invoice"} onClick={saveInvoice}>{busy === "invoice" ? "Saving…" : doc?.invoice_no ? "Update invoice" : "Save invoice"}</button></div>
          </div> : !doc?.invoice_no && <p className="text-sm text-slate-500">Not attached yet.</p>}
        </div>
      </div>}
      {err && <p className="lg:col-span-2 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
    </div>
  );
}
