"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { BANK } from "@/lib/company";
import { addDays, calcInvoice, checkLine, lineAmount, money, outstandingOf, qtyText, r2, receivedOf, retentionHeld, settledOf, STATE_OPTIONS, stateName, taxKind, tdsOf, type Client, type Invoice, type Receipt, type WoItem, type WorkOrder } from "@/lib/invoice";
import { fmtD } from "@/lib/invoiceData";
import { swrDrop } from "@/lib/swr";

type Row = { key: string; id?: string; woItemId: string | null; description: string; unit: string; rate: string; prev: number; cum: string };
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };
let seq = 0; const newKey = () => `x${++seq}`;
const BADGE = { draft: "bg-amber-50 text-amber-800", issued: "bg-green-50 text-green-800", cancelled: "bg-slate-100 text-slate-500" } as const;

// One running bill. A draft is editable (quantities done to date, deductions, dates); issuing gives it its number and freezes it.
// After that only receipts can be added, or the invoice cancelled with a reason.
export default function InvoiceView({ id }: { id: string }) {
  const router = useRouter(); const today = istToday();
  const [inv, setInv] = useState<Invoice | null>(null); const [client, setClient] = useState<Client | null>(null); const [wo, setWo] = useState<WorkOrder | null>(null); const [project, setProject] = useState(""); const [projState, setProjState] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]); const [orderQty, setOrderQty] = useState<Record<string, number>>({}); const [receipts, setReceipts] = useState<Receipt[]>([]); const [lastIssued, setLastIssued] = useState<string | null>(null);
  const [f, setF] = useState({ invoice_date: "", period_from: "", period_to: "", due_date: "", other_deduction: "0", other_deduction_note: "", notes: "", place_of_supply_code: "27" });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [rc, setRc] = useState({ received_on: today, amount: "", tds_amount: "", reference: "", note: "" }); const [cancelling, setCancelling] = useState(false); const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const sb = supabase(); const { data: i, error } = await sb.from("invoices").select("*").eq("id", id).maybeSingle();
    if (!i) { setErr(error?.message ?? "Invoice not found."); setLoading(false); return; }
    const x = { ...(i as any) }; ["gst_rate", "taxable", "cgst", "sgst", "igst", "round_off", "total", "retention_pct", "retention", "other_deduction", "payable", "tds_pct"].forEach((k) => { x[k] = Number(x[k]); }); const invoice = x as Invoice; setInv(invoice);
    const [it, rcs, c, w, wi, last] = await Promise.all([
      sb.from("invoice_items").select("*").eq("invoice_id", id).order("sort"), sb.from("invoice_receipts").select("*").eq("invoice_id", id).order("received_on", { ascending: false }),
      sb.from("clients").select("*").eq("id", invoice.client_id).maybeSingle(), sb.from("work_orders").select("*").eq("id", invoice.work_order_id).maybeSingle(),
      sb.from("work_order_items").select("*").eq("work_order_id", invoice.work_order_id), sb.from("invoices").select("invoice_date").eq("status", "issued").order("invoice_date", { ascending: false }).limit(1),
    ]);
    setClient(c.data as Client | null); setWo(w.data ? ({ ...w.data, payment_days: Number((w.data as any).payment_days) } as WorkOrder) : null); setLastIssued((last.data as any)?.[0]?.invoice_date ?? null);
    setReceipts(((rcs.data || []) as any[]).map((r) => ({ ...r, amount: Number(r.amount), tds_amount: Number(r.tds_amount) })) as Receipt[]);
    const oq: Record<string, number> = {}; ((wi.data || []) as any[]).forEach((r) => { oq[r.id] = Number(r.qty); }); setOrderQty(oq);
    setRows(((it.data || []) as any[]).map((r) => ({ key: r.id, id: r.id, woItemId: r.work_order_item_id, description: r.description, unit: r.unit, rate: String(Number(r.rate)), prev: Number(r.prev_qty), cum: String(Number(r.cum_qty)) })));
    setF({ invoice_date: invoice.invoice_date, period_from: invoice.period_from ?? "", period_to: invoice.period_to ?? "", due_date: invoice.due_date ?? "", other_deduction: String(invoice.other_deduction), other_deduction_note: invoice.other_deduction_note ?? "", notes: invoice.notes ?? "", place_of_supply_code: invoice.place_of_supply_code });
    if (invoice.project_id) { const { data: p } = await sb.from("projects").select("name,state_code").eq("id", invoice.project_id).maybeSingle(); setProject(p?.name ?? ""); setProjState((p as any)?.state_code ?? null); }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const draft = inv?.status === "draft";
  const calc = useMemo(() => (inv ? calcInvoice(rows.map((r) => ({ qty: Math.max(0, num(r.cum) - r.prev), rate: num(r.rate) })), { gstRate: inv.gst_rate, retentionPct: inv.retention_pct, otherDeduction: num(f.other_deduction), tdsPct: inv.tds_pct, supplyCode: f.place_of_supply_code }) : null), [inv, rows, f.other_deduction, f.place_of_supply_code]);
  const problems = rows.map((r) => (r.woItemId ? checkLine(num(r.cum), r.prev, orderQty[r.woItemId] ?? null) : ""));
  const upd = (key: string, k: keyof Row, v: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, [k]: v } : x)));
  const setField = (k: keyof typeof f, v: string) => setF((p) => { const n = { ...p, [k]: v }; if (k === "invoice_date" && wo && v && (!p.due_date || p.due_date === addDays(p.invoice_date, wo.payment_days))) n.due_date = addDays(v, wo.payment_days); return n; });

  async function save(): Promise<boolean> {
    if (!inv || !calc) return false; setErr(""); setMsg("");
    if (!f.invoice_date) { setErr("Enter the invoice date."); return false; }
    if (rows.some((r, i) => !r.woItemId && (!r.description.trim() || num(r.rate) < 0))) { setErr("Every extra item needs a description."); return false; }
    if (problems.some(Boolean)) { setErr("Fix the quantities marked in red first."); return false; }
    setBusy(true); const sb = supabase();
    const { error } = await sb.from("invoices").update({ invoice_date: f.invoice_date, period_from: f.period_from || null, period_to: f.period_to || null, due_date: f.due_date || null, other_deduction: num(f.other_deduction), other_deduction_note: f.other_deduction_note.trim() || null, notes: f.notes.trim() || null, place_of_supply_code: f.place_of_supply_code, taxable: calc.taxable, cgst: calc.cgst, sgst: calc.sgst, igst: calc.igst, round_off: calc.roundOff, total: calc.total, retention: calc.retention, payable: calc.payable }).eq("id", id);
    if (error) { setBusy(false); setErr(error.message); return false; }
    const del = await sb.from("invoice_items").delete().eq("invoice_id", id); if (del.error) { setBusy(false); setErr(del.error.message); return false; }
    const ins = await sb.from("invoice_items").insert(rows.map((r, i) => { const qty = Math.max(0, num(r.cum) - r.prev); return { invoice_id: id, work_order_item_id: r.woItemId, sort: i, description: r.description.trim(), unit: r.unit.trim() || "Nos", rate: num(r.rate), prev_qty: r.prev, cum_qty: Math.max(num(r.cum), r.prev), qty, amount: lineAmount(qty, num(r.rate)) }; }));
    setBusy(false); if (ins.error) { setErr(ins.error.message + " The bill header was saved, but its items were not. Save again."); return false; }
    swrDrop("invoices", "workorders"); setMsg("Draft saved ✓"); await load(); return true;
  }
  async function issue() {
    if (!inv) return; if (!(await save())) return;
    if (!confirm(`Issue this invoice? It gets the next invoice number and can no longer be edited (only cancelled). Total ₹${money(calc?.total ?? 0)}.`)) return;
    setBusy(true); const { data, error } = await supabase().rpc("issue_invoice", { p_id: id }); setBusy(false);
    if (error) { setErr(error.message); return; } swrDrop("invoices", "workorders"); setMsg(`Issued as ${data} ✓`); load();
  }
  async function removeDraft() { if (!confirm("Delete this draft bill? Nothing has been issued, so the number is not used.")) return; setBusy(true); const { error } = await supabase().from("invoices").delete().eq("id", id); setBusy(false); if (error) setErr(error.message); else { swrDrop("invoices", "workorders"); router.push("/invoices"); } }
  async function cancel() { setBusy(true); setErr(""); const { error } = await supabase().rpc("cancel_invoice", { p_id: id, p_reason: reason }); setBusy(false); if (error) { setErr(error.message); return; } swrDrop("invoices", "workorders"); setCancelling(false); setReason(""); setMsg("Invoice cancelled. Its number stays in the register."); load(); }
  async function addReceipt() {
    const amount = num(rc.amount), tds = num(rc.tds_amount); if (!(amount + tds > 0)) { setErr("Enter the amount received, the TDS deducted, or both."); return; }
    setBusy(true); setErr(""); const { error } = await supabase().from("invoice_receipts").insert({ invoice_id: id, received_on: rc.received_on, amount, tds_amount: tds, reference: rc.reference.trim() || null, note: rc.note.trim() || null }); setBusy(false);
    if (error) { setErr(error.message); return; } swrDrop("invoices", "workorders"); setRc({ received_on: today, amount: "", tds_amount: "", reference: "", note: "" }); load();
  }
  async function voidReceipt(r: Receipt) { if (!confirm(`Void this receipt of ₹${money(r.amount)} (TDS ₹${money(r.tds_amount)})? It stays in the list, marked void.`)) return; const { error } = await supabase().from("invoice_receipts").update({ voided_at: new Date().toISOString() }).eq("id", r.id); if (error) setErr(error.message); else { swrDrop("invoices", "workorders"); load(); } }

  if (loading) return <p className="card text-center text-sm text-slate-500">Loading…</p>;
  if (!inv || !calc || !wo || !client) return <p className="warn">{err || "This invoice's client or work order could not be loaded."}</p>;
  const out = outstandingOf(inv, receipts), held = retentionHeld(inv, receipts);
  const warnings = [!inv.project_id && "No project is linked to this work order, so the place of supply is the one shown. Check the site's state: another state means IGST.", projState && f.place_of_supply_code !== projState && `The project's site is in ${stateName(projState)}, but the place of supply is ${stateName(f.place_of_supply_code)}. Check this: it decides CGST + SGST or IGST.`, !client.gstin && "The client has no GSTIN, so this will be issued as an unregistered-client invoice.", !BANK.accountNo && "Your bank details are not set (src/lib/company.ts), so the PDF will not show where to pay.", lastIssued && f.invoice_date < lastIssued && `An invoice dated ${fmtD(lastIssued)} has already been issued. Dates normally follow the invoice numbers.`, rows.every((r) => num(r.cum) <= r.prev) && "Nothing is billed yet: enter the quantity done to date against at least one item."].filter(Boolean) as string[];
  const show = draft ? calc : { taxable: inv.taxable, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst, roundOff: inv.round_off, total: inv.total, retention: inv.retention, payable: inv.payable, tds: r2((inv.taxable * inv.tds_pct) / 100) };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold">{inv.invoice_no ?? `Draft · Bill ${inv.bill_no}`}</h1><span className={`text-xs rounded-full px-2 py-0.5 capitalize ${BADGE[inv.status]}`}>{inv.status}</span>
        <span className="text-sm text-slate-500 sm:mr-auto">{client.short_name || client.name} · <Link className="underline" href={`/work-orders/${wo.id}`}>{wo.wo_no}</Link>{project ? ` · ${project}` : ""} · Bill {inv.bill_no}</span>
        <a className="btn" href={`/api/invoices/${id}`} target="_blank">{draft ? "Preview PDF (saved draft)" : "PDF"}</a>
        {draft && <><button className="btn" disabled={busy} onClick={save}>Save draft</button><button className="btn btn-primary" disabled={busy} onClick={issue}>Issue invoice</button></>}</div>
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
      {inv.status === "cancelled" && <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Cancelled {fmtD(inv.cancelled_at)}: {inv.cancel_reason}. The number {inv.invoice_no} stays in the register.</p>}
      {draft && warnings.length > 0 && <ul className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">{warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}

      <section className="card"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([["Invoice date", "invoice_date"], ["Bill period from", "period_from"], ["Bill period to", "period_to"], ["Payment due by", "due_date"]] as const).map(([l, k]) => <div key={k}><label className="lbl">{l}</label>{draft ? <input type="date" className="inp" value={f[k]} onChange={(e) => setField(k, e.target.value)} /> : <div className="text-sm py-2">{fmtD(f[k])}</div>}</div>)}
        <div><label className="lbl">Billed to</label><div className="text-sm py-1.5">{client.name}<div className="text-xs text-slate-500">{client.gstin || "No GSTIN"} · {stateName(client.state_code)}</div></div></div>
        <div><label className="lbl">Place of supply (the site's state)</label>{draft ? <select className="inp" value={f.place_of_supply_code} onChange={(e) => setField("place_of_supply_code", e.target.value)}>{STATE_OPTIONS.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}</select> : <div className="text-sm py-2">{stateName(inv.place_of_supply_code)} ({inv.place_of_supply_code})</div>}<div className="text-xs text-slate-500">{taxKind(draft ? f.place_of_supply_code : inv.place_of_supply_code)}</div></div>
        <div><label className="lbl">SAC · GST</label><div className="text-sm py-2">{inv.sac} · {inv.gst_rate}%</div></div></div></section>

      <section className="card space-y-2"><h2 className="font-semibold">Work billed</h2>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[46rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="text-left p-1 w-8">#</th><th className="text-left p-1">Description</th><th className="text-left p-1 w-16">Unit</th><th className="text-right p-1 w-24">Rate (₹)</th><th className="text-right p-1 w-20">Earlier</th><th className="text-right p-1 w-28">{draft ? "Done to date" : "To date"}</th><th className="text-right p-1 w-20">This bill</th><th className="text-right p-1 w-28">Amount</th>{draft && <th className="w-8" />}</tr></thead>
          <tbody>{rows.map((r, i) => { const qty = Math.max(0, num(r.cum) - r.prev); const extra = !r.woItemId; return (
            <tr key={r.key} className="border-t border-slate-100 align-top"><td className="p-1 pt-2.5 text-slate-400">{i + 1}</td>
              <td className="p-1">{draft && extra ? <input className="inp" aria-label={`Extra item ${i + 1} description`} placeholder="Extra work, as instructed by…" value={r.description} onChange={(e) => upd(r.key, "description", e.target.value)} /> : <div className="py-1.5">{r.description}{extra && <span className="ml-2 text-xs text-slate-500">extra</span>}</div>}{problems[i] && <div className="text-xs text-red-700">{problems[i]}</div>}</td>
              <td className="p-1 pt-2.5">{draft && extra ? <input className="inp" aria-label={`Extra item ${i + 1} unit`} value={r.unit} onChange={(e) => upd(r.key, "unit", e.target.value)} /> : r.unit}</td>
              <td className="p-1 pt-2.5 text-right tabular-nums">{draft && extra ? <input className="inp text-right" inputMode="decimal" aria-label={`Extra item ${i + 1} rate`} value={r.rate} onChange={(e) => upd(r.key, "rate", e.target.value)} /> : money(num(r.rate))}</td>
              <td className="p-1 pt-2.5 text-right tabular-nums text-slate-500">{qtyText(r.prev)}</td>
              <td className="p-1 text-right">{draft ? <input className={`inp text-right ${problems[i] ? "!border-red-400" : ""}`} inputMode="decimal" aria-label={`Item ${i + 1} quantity done to date`} value={r.cum} onChange={(e) => upd(r.key, "cum", e.target.value)} /> : <span className="inline-block pt-1.5 tabular-nums">{qtyText(num(r.cum))}</span>}{!extra && <div className="text-[11px] text-slate-400">of {qtyText(orderQty[r.woItemId!] ?? 0)}</div>}</td>
              <td className="p-1 pt-2.5 text-right tabular-nums">{qtyText(qty)}</td><td className="p-1 pt-2.5 text-right tabular-nums font-medium">{money(lineAmount(qty, num(r.rate)))}</td>
              {draft && <td className="p-1 pt-1.5 text-right">{extra && <button type="button" className="text-slate-400 hover:text-red-700 px-1" aria-label={`Remove extra item ${i + 1}`} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>✕</button>}</td>}</tr>); })}</tbody></table></div>
        {draft && <button className="btn btn-sm" onClick={() => setRows((r) => [...r, { key: newKey(), woItemId: null, description: "", unit: "Nos", rate: "", prev: 0, cum: "" }])}>+ Add extra item (not in the order)</button>}</section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-2"><h2 className="font-semibold">Deductions and notes</h2>
          <div className="grid gap-3 sm:grid-cols-2"><div><label className="lbl">Other deduction (₹)</label>{draft ? <input className="inp" inputMode="decimal" value={f.other_deduction} onChange={(e) => setField("other_deduction", e.target.value)} /> : <div className="text-sm py-2">₹{money(inv.other_deduction)}</div>}</div>
            <div><label className="lbl">What it is for</label>{draft ? <input className="inp" placeholder="Material back-charge…" value={f.other_deduction_note} onChange={(e) => setField("other_deduction_note", e.target.value)} /> : <div className="text-sm py-2">{inv.other_deduction_note || "—"}</div>}</div></div>
          <div><label className="lbl">Note printed on the invoice</label>{draft ? <textarea className="inp" rows={2} value={f.notes} onChange={(e) => setField("notes", e.target.value)} /> : <div className="text-sm py-1">{inv.notes || "—"}</div>}</div>
          <p className="text-xs text-slate-500">Retention ({inv.retention_pct}%) and other deductions reduce what is payable now; GST is on the full taxable value. The client deducts TDS ({inv.tds_pct}%) when paying, which you record as a receipt.</p></section>
        <section className="card"><h2 className="font-semibold mb-2">Totals</h2>
          {([["Taxable value", show.taxable], ...(show.igst > 0 ? [[`IGST @ ${inv.gst_rate}%`, show.igst]] : [[`CGST @ ${inv.gst_rate / 2}%`, show.cgst], [`SGST @ ${inv.gst_rate / 2}%`, show.sgst]]), ...(show.roundOff !== 0 ? [["Round off", show.roundOff]] : [])] as [string, number][]).map(([l, v]) => <div key={l} className="flex justify-between text-sm py-0.5"><span>{l}</span><span className="tabular-nums">{money(v)}</span></div>)}
          <div className="flex justify-between text-base font-semibold border-t border-slate-200 mt-1 pt-1.5"><span>Invoice total</span><span className="tabular-nums text-[#1e4fa3]">₹{money(show.total)}</span></div>
          {(show.retention > 0 || num(f.other_deduction) > 0) && <><div className="flex justify-between text-sm text-slate-500 pt-1"><span>Less retention ({inv.retention_pct}%)</span><span className="tabular-nums">- {money(show.retention)}</span></div><div className="flex justify-between text-sm text-slate-500"><span>Less other deduction</span><span className="tabular-nums">- {money(draft ? num(f.other_deduction) : inv.other_deduction)}</span></div><div className="flex justify-between text-sm font-medium"><span>Payable on this bill</span><span className="tabular-nums">₹{money(show.payable)}</span></div></>}
          <div className="flex justify-between text-xs text-slate-500 pt-2"><span>TDS the client is expected to deduct ({inv.tds_pct}% of taxable)</span><span className="tabular-nums">₹{money(show.tds)}</span></div>
          {draft && <div className="pt-3"><button className="btn btn-danger btn-sm" disabled={busy} onClick={removeDraft}>Delete this draft</button></div>}</section></div>

      {!draft && inv.status === "issued" && <section className="card space-y-3"><div className="flex flex-wrap items-center gap-x-6 gap-y-1"><h2 className="font-semibold mr-auto">Receipts</h2>
        <span className="text-sm">Received <b className="tabular-nums">₹{money(receivedOf(receipts))}</b></span><span className="text-sm">TDS deducted <b className="tabular-nums">₹{money(tdsOf(receipts))}</b></span>
        <span className="text-sm">Outstanding <b className={`tabular-nums ${out > 0 ? "text-amber-800" : "text-green-700"}`}>₹{money(out)}</b>{held > 0 && <span className="text-xs text-slate-500"> (₹{money(held)} is retention)</span>}</span></div>
        {out > 0 && <div className="flex flex-wrap items-end gap-2">
          <div><label className="lbl">Received on</label><input type="date" className="inp !w-40" value={rc.received_on} onChange={(e) => setRc({ ...rc, received_on: e.target.value })} /></div>
          <div><label className="lbl">Amount received (₹)</label><input className="inp !w-36" inputMode="decimal" value={rc.amount} onChange={(e) => setRc({ ...rc, amount: e.target.value })} /></div>
          <div><label className="lbl">TDS deducted (₹)</label><input className="inp !w-32" inputMode="decimal" placeholder={String(show.tds)} value={rc.tds_amount} onChange={(e) => setRc({ ...rc, tds_amount: e.target.value })} /></div>
          <div className="flex-1 min-w-40"><label className="lbl">Reference (UTR / cheque)</label><input className="inp" value={rc.reference} onChange={(e) => setRc({ ...rc, reference: e.target.value })} /></div>
          <button className="btn btn-primary" disabled={busy} onClick={addReceipt}>Add receipt</button></div>}
        <ul className="divide-y divide-slate-100 text-sm">{receipts.map((r) => <li key={r.id} className={`py-2 flex flex-wrap items-center gap-x-4 ${r.voided_at ? "text-slate-400 line-through" : ""}`}><span className="w-28 tabular-nums">{fmtD(r.received_on)}</span><span className="w-32 tabular-nums">₹{money(r.amount)}</span><span className="w-32 tabular-nums">TDS ₹{money(r.tds_amount)}</span><span className="flex-1 text-xs text-slate-500 truncate">{r.reference}{r.note ? ` · ${r.note}` : ""}</span>{r.voided_at ? <span className="text-xs">void</span> : <button className="text-xs text-red-700 underline" onClick={() => voidReceipt(r)}>Void</button>}</li>)}</ul>
        {!receipts.length && <p className="text-sm text-slate-400">No receipts yet.</p>}
        <div className="border-t border-slate-100 pt-3">{!cancelling ? <button className="btn btn-danger btn-sm" onClick={() => setCancelling(true)}>Cancel this invoice…</button> : <div className="flex flex-wrap items-end gap-2"><div className="flex-1 min-w-64"><label className="lbl">Reason for cancelling (kept on record)</label><input className="inp" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></div><button className="btn btn-danger" disabled={busy || !reason.trim()} onClick={cancel}>Cancel the invoice</button><button className="btn" onClick={() => setCancelling(false)}>Keep it</button></div>}
          <p className="text-xs text-slate-500 mt-2">An issued invoice is never edited. To correct it, cancel it (void its receipts first) and raise a new bill, or ask your CA about a credit note.</p></div></section>}
    </div>
  );
}
