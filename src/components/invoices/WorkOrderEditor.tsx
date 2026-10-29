"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { lineAmount, money, normName, qtyText, r2, rowsFromQuote, type Client, type Invoice, type WoItem, type WorkOrder } from "@/lib/invoice";
import { createDraftBill, fmtD } from "@/lib/invoiceData";
import { swrDrop } from "@/lib/swr";
import type { Project } from "@/lib/types";
import type { QItem } from "@/lib/quote";

type QuoteRef = { id: string; ref_no: string | null; subject: string; client_id: string | null; client_name: string; project_id: string | null; items: QItem[]; quote_date: string };

type Row = { key: string; id?: string; description: string; unit: string; qty: string; rate: string };
type Head = { client_id: string; project_id: string; wo_no: string; wo_date: string; title: string; sac: string; gst_rate: string; retention_pct: string; tds_pct: string; payment_days: string; status: WorkOrder["status"]; notes: string };
const BLANK: Head = { client_id: "", project_id: "", wo_no: "", wo_date: "", title: "", sac: "9954", gst_rate: "18", retention_pct: "0", tds_pct: "1", payment_days: "45", status: "active", notes: "" };
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : NaN; };
let seq = 0; const newKey = () => `n${++seq}`;

// One work order: the commercial terms and the bill of quantities that running bills are measured against.
export default function WorkOrderEditor({ id }: { id: string }) {
  const router = useRouter(); const isNew = id === "new"; const fromQuote = useSearchParams().get("quotation");
  const [quotes, setQuotes] = useState<QuoteRef[]>([]); const [quotationId, setQuotationId] = useState("");
  const [clients, setClients] = useState<Client[]>([]); const [projects, setProjects] = useState<Project[]>([]);
  const [h, setH] = useState<Head>(BLANK); const [rows, setRows] = useState<Row[]>([{ key: newKey(), description: "", unit: "Nos", qty: "", rate: "" }]); const [origIds, setOrigIds] = useState<string[]>([]);
  const [billed, setBilled] = useState<Record<string, number>>({}); const [bills, setBills] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const sb = supabase(); const [c, p, qs] = await Promise.all([sb.from("clients").select("*").order("name"), sb.from("projects").select("*").order("name"), sb.from("quotations").select("id,ref_no,subject,client_id,client_name,project_id,items,quote_date").eq("status", "issued").order("quote_date", { ascending: false })]);
    setClients((c.data || []) as Client[]); setProjects((p.data || []) as Project[]); setQuotes((qs.data || []) as QuoteRef[]);
    if (isNew && fromQuote) { const q = ((qs.data || []) as QuoteRef[]).find((x) => x.id === fromQuote); if (q) applyQuote(q, (c.data || []) as Client[]); else setErr("That quotation could not be found, or it has not been issued yet."); }
    if (c.error) setErr(c.error.message + " — has the invoicing SQL migration been run?");
    if (!isNew) {
      const [w, it, inv] = await Promise.all([sb.from("work_orders").select("*").eq("id", id).maybeSingle(), sb.from("work_order_items").select("*").eq("work_order_id", id).order("sort"), sb.from("invoices").select("*").eq("work_order_id", id).order("bill_no")]);
      if (!w.data) { setErr(w.error?.message ?? "Work order not found."); setLoading(false); return; }
      const x = w.data as any; setQuotationId(x.quotation_id ?? ""); setH({ client_id: x.client_id, project_id: x.project_id ?? "", wo_no: x.wo_no, wo_date: x.wo_date ?? "", title: x.title, sac: x.sac, gst_rate: String(Number(x.gst_rate)), retention_pct: String(Number(x.retention_pct)), tds_pct: String(Number(x.tds_pct)), payment_days: String(x.payment_days), status: x.status, notes: x.notes ?? "" });
      const items = ((it.data || []) as any[]); setOrigIds(items.map((i) => i.id)); setRows(items.length ? items.map((i) => ({ key: i.id, id: i.id, description: i.description, unit: i.unit, qty: String(Number(i.qty)), rate: String(Number(i.rate)) })) : [{ key: newKey(), description: "", unit: "Nos", qty: "", rate: "" }]);
      const invs = ((inv.data || []) as any[]).map((i) => ({ ...i, taxable: Number(i.taxable), total: Number(i.total) })) as Invoice[]; setBills(invs);
      const issued = invs.filter((i) => i.status === "issued").map((i) => i.id); const b: Record<string, number> = {};
      if (issued.length) { const { data: lines } = await sb.from("invoice_items").select("work_order_item_id,qty").in("invoice_id", issued); (lines || []).forEach((l: any) => { if (l.work_order_item_id) b[l.work_order_item_id] = (b[l.work_order_item_id] || 0) + Number(l.qty); }); }
      setBilled(b);
    }
    setLoading(false);
  }, [id, isNew, fromQuote]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const blankRows = (r: Row[]) => r.every((x) => !x.description.trim() && !x.qty && !x.rate);
  const matchClient = (q: QuoteRef, cl: Client[]) => q.client_id ?? cl.find((c) => normName(c.name) === normName(q.client_name))?.id ?? "";
  /** Take the client, project, title and items from a quotation. Only empty fields are filled, unless the items are reloaded on purpose. */
  function applyQuote(q: QuoteRef, cl: Client[], reload = false) {
    setQuotationId(q.id);
    setH((p) => ({ ...p, client_id: p.client_id || matchClient(q, cl), project_id: p.project_id || q.project_id || "", title: p.title || q.subject || "", notes: p.notes || (q.ref_no ? `Against quotation ${q.ref_no}` : "") }));
    setRows((r) => (reload || blankRows(r) ? rowsFromQuote(q.items).map((i) => ({ key: newKey(), description: i.description, unit: i.unit, qty: String(i.qty), rate: String(i.rate) })) : r));
  }
  const set = (k: keyof Head, v: string) => setH((p) => ({ ...p, [k]: v }));
  const upd = (key: string, k: keyof Row, v: string) => setRows((r) => r.map((x) => (x.key === key ? { ...x, [k]: v } : x)));
  const value = useMemo(() => r2(rows.reduce((s, r) => s + lineAmount(num(r.qty) || 0, num(r.rate) || 0), 0)), [rows]);
  const clientOptions = clients.filter((c) => c.active || c.id === h.client_id);

  async function save() {
    setErr(""); setMsg("");
    if (!h.client_id) { setErr("Choose the client."); return; } if (!h.wo_no.trim()) { setErr("Enter the client's work order or PO number."); return; } if (!h.title.trim()) { setErr("Give the work order a title."); return; }
    const gst = num(h.gst_rate), ret = num(h.retention_pct), tds = num(h.tds_pct), days = num(h.payment_days);
    if ([gst, ret, tds, days].some((n) => Number.isNaN(n))) { setErr("GST, retention, TDS and payment days must be numbers."); return; }
    const used = rows.filter((r) => r.description.trim() || r.qty || r.rate);
    for (const [i, r] of used.entries()) {
      if (!r.description.trim()) { setErr(`Item ${i + 1} needs a description.`); return; }
      if (!(num(r.qty) >= 0) || !(num(r.rate) >= 0)) { setErr(`Item ${i + 1} (${r.description.trim()}) needs a quantity and a rate.`); return; }
      if (r.id && num(r.qty) < (billed[r.id] || 0)) { setErr(`Item ${i + 1} (${r.description.trim()}): ${qtyText(billed[r.id])} are already billed, so the quantity cannot be lower.`); return; }
    }
    setBusy(true); const sb = supabase();
    const head = { client_id: h.client_id, project_id: h.project_id || null, wo_no: h.wo_no.trim(), wo_date: h.wo_date || null, title: h.title.trim(), sac: h.sac.trim() || "9954", gst_rate: gst, retention_pct: ret, tds_pct: tds, payment_days: Math.round(days), status: h.status, notes: h.notes.trim() || null, quotation_id: quotationId || null };
    let woId = id;
    if (isNew) { const { data, error } = await sb.from("work_orders").insert(head).select("id").single(); if (error || !data) { setBusy(false); setErr(/work_orders_client_id_wo_no_key|duplicate/i.test(error?.message ?? "") ? "This client already has a work order with that number." : error?.message ?? "Could not save."); return; } woId = data.id; }
    else { const { error } = await sb.from("work_orders").update(head).eq("id", id); if (error) { setBusy(false); setErr(error.message); return; } }
    const keep = new Set(used.filter((r) => r.id).map((r) => r.id!));
    const removed = origIds.filter((o) => !keep.has(o));
    if (removed.length) { const { error } = await sb.from("work_order_items").delete().in("id", removed); if (error) { setBusy(false); setErr(/foreign key|violates/i.test(error.message) ? "An item that is on a bill cannot be removed. Set its quantity to what is billed instead." : error.message); return; } }
    for (const [i, r] of used.entries()) {
      const row = { work_order_id: woId, sort: i, description: r.description.trim(), unit: r.unit.trim() || "Nos", qty: num(r.qty), rate: num(r.rate) };
      const { error } = r.id ? await sb.from("work_order_items").update(row).eq("id", r.id) : await sb.from("work_order_items").insert(row);
      if (error) { setBusy(false); setErr(error.message); return; }
    }
    swrDrop("workorders", "invoices", "quotations"); setBusy(false); setMsg("Saved ✓");   // quotations show "Won" from work orders
    if (isNew) router.replace(`/work-orders/${woId}`); else load();
  }
  async function newBill() { setErr(""); setBusy(true); const r = await createDraftBill(id); setBusy(false); if (r.error) setErr(r.error); else router.push(`/invoices/${r.id}`); }

  if (loading) return <p className="card text-center text-sm text-slate-500">Loading…</p>;
  const field = (label: string, k: keyof Head, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <div><label className="lbl">{label}</label><input className="inp" value={h[k]} onChange={(e) => set(k, e.target.value)} {...props} /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold sm:mr-auto">{isNew ? "New work order" : h.title || "Work order"}</h1>
        {!isNew && h.status === "active" && <button className="btn" disabled={busy} onClick={newBill}>New running bill</button>}
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
      <section className="card space-y-3"><h2 className="font-semibold">Order details</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className="lbl">Client *</label><select className="inp" value={h.client_id} onChange={(e) => set("client_id", e.target.value)}><option value="">Choose…</option>{clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{!clients.length && <p className="warn"><Link className="underline" href="/clients">Add the client first</Link></p>}</div>
          <div><label className="lbl">Project</label><select className="inp" value={h.project_id} onChange={(e) => set("project_id", e.target.value)}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}</option>)}</select></div>
          <div><label className="lbl">Status</label><select className="inp" value={h.status} onChange={(e) => set("status", e.target.value)}><option value="active">Active</option><option value="completed">Completed</option><option value="closed">Closed</option></select></div>
          {field("Client's work order / PO no. *", "wo_no")}{field("Order date", "wo_date", { type: "date" })}{field("Title *", "title", { placeholder: "e.g. Electrical works, Plant 2" })}
          {field("SAC code", "sac", { maxLength: 8 })}{field("GST rate (%)", "gst_rate", { inputMode: "decimal" })}{field("Payment due in (days)", "payment_days", { inputMode: "numeric" })}
          {field("Retention held back (%)", "retention_pct", { inputMode: "decimal" })}{field("TDS the client deducts (%)", "tds_pct", { inputMode: "decimal" })}
          <div className="sm:col-span-2 lg:col-span-3"><label className="lbl">Quotation this order came from</label>
            <select className="inp" value={quotationId} onChange={(e) => { const q = quotes.find((x) => x.id === e.target.value); if (q) applyQuote(q, clients); else setQuotationId(""); }}><option value="">None (not from one of our quotations)</option>{quotes.filter((q) => !h.client_id || !q.client_id || q.client_id === h.client_id || q.id === quotationId).map((q) => <option key={q.id} value={q.id}>{q.ref_no} · {(q.subject || q.client_name).slice(0, 80)}</option>)}</select>
            {quotationId && <p className="text-xs text-slate-500 mt-1"><a className="underline" href={`/api/quotations/${quotationId}/pdf`} target="_blank">View the quotation</a>{isNew && <> · <button type="button" className="underline" onClick={() => { const q = quotes.find((x) => x.id === quotationId); if (q) applyQuote(q, clients, true); }}>Reload its items</button></>}</p>}
            {isNew && fromQuote && quotationId && !h.client_id && <p className="warn">The client on the quotation is not in your client list yet. <Link className="underline" href="/clients" target="_blank">Add it</Link>, then pick it above.</p>}</div>
          <div className="sm:col-span-2 lg:col-span-3"><label className="lbl">Notes</label><textarea className="inp" rows={2} value={h.notes} onChange={(e) => set("notes", e.target.value)} /></div></div>
        <p className="text-xs text-slate-500">These become the defaults on every bill of this order. Retention is held back from payment but GST is charged on the full amount. Check the SAC code and rate with your CA.</p></section>
      <section className="card space-y-3"><div className="flex items-center gap-2"><h2 className="font-semibold">Items (bill of quantities)</h2><span className="ml-auto text-sm text-slate-500">Order value <span className="font-medium text-slate-800 tabular-nums">₹{money(value)}</span> excl. GST</span></div>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[40rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="text-left p-1 w-8">#</th><th className="text-left p-1">Description</th><th className="text-left p-1 w-20">Unit</th><th className="text-right p-1 w-24">Quantity</th><th className="text-right p-1 w-28">Rate (₹)</th><th className="text-right p-1 w-28">Amount</th><th className="text-right p-1 w-24">Billed</th><th className="w-8" /></tr></thead>
          <tbody>{rows.map((r, i) => { const b = r.id ? billed[r.id] || 0 : 0; return (
            <tr key={r.key} className="border-t border-slate-100 align-top"><td className="p-1 pt-2.5 text-slate-400">{i + 1}</td>
              <td className="p-1"><textarea className="inp" rows={1} aria-label={`Item ${i + 1} description`} value={r.description} onChange={(e) => upd(r.key, "description", e.target.value)} /></td>
              <td className="p-1"><input className="inp" aria-label={`Item ${i + 1} unit`} value={r.unit} onChange={(e) => upd(r.key, "unit", e.target.value)} /></td>
              <td className="p-1"><input className="inp text-right" inputMode="decimal" aria-label={`Item ${i + 1} quantity`} value={r.qty} onChange={(e) => upd(r.key, "qty", e.target.value)} /></td>
              <td className="p-1"><input className="inp text-right" inputMode="decimal" aria-label={`Item ${i + 1} rate`} value={r.rate} onChange={(e) => upd(r.key, "rate", e.target.value)} /></td>
              <td className="p-1 pt-2.5 text-right tabular-nums">{money(lineAmount(num(r.qty) || 0, num(r.rate) || 0))}</td>
              <td className="p-1 pt-2.5 text-right tabular-nums text-slate-500">{r.id ? `${qtyText(b)}${num(r.qty) > 0 ? ` (${Math.round((b / num(r.qty)) * 100)}%)` : ""}` : "—"}</td>
              <td className="p-1 pt-1.5 text-right"><button type="button" className="text-slate-400 hover:text-red-700 px-1" aria-label={`Remove item ${i + 1}`} onClick={() => setRows((x) => (x.length > 1 ? x.filter((y) => y.key !== r.key) : x))}>✕</button></td></tr>); })}</tbody></table></div>
        <div className="flex flex-wrap items-center gap-2"><button className="btn btn-sm" onClick={() => setRows((r) => [...r, { key: newKey(), description: "", unit: r[r.length - 1]?.unit || "Nos", qty: "", rate: "" }])}>+ Add item</button>
          {!isNew && <span className="text-xs text-slate-500">Changing a rate here affects only bills you start from now on; issued bills keep the rate they were issued at.</span>}</div></section>
      {!isNew && <section className="card space-y-2"><h2 className="font-semibold">Bills</h2>
        {!bills.length && <p className="text-sm text-slate-500">No bills raised yet.{h.status === "active" ? " Use New running bill above." : ""}</p>}
        {bills.map((b) => <Link key={b.id} href={`/invoices/${b.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2 hover:bg-slate-50 text-sm"><span className="w-24 font-medium">Bill {b.bill_no}</span><span className="flex-1 min-w-32 text-slate-600">{b.invoice_no ?? "Draft"}</span><span className="text-slate-500">{fmtD(b.invoice_date)}</span><span className="w-32 text-right tabular-nums">₹{money(b.taxable)}</span><span className={`text-xs rounded-full px-2 py-0.5 capitalize ${b.status === "issued" ? "bg-green-50 text-green-800" : b.status === "draft" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-500"}`}>{b.status}</span></Link>)}</section>}
    </div>
  );
}
