"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRole } from "@/lib/roles";
import { lineAmount, money, outstandingOf, r2, stateName, taxKind, type Client, type Invoice, type Receipt } from "@/lib/invoice";
import { fmtD } from "@/lib/invoiceData";
import { itemAmount, type Quote } from "@/lib/quote";

type Wo = { id: string; wo_no: string; title: string; status: string; quotation_id: string | null; value: number; billed: number };

/** The commercial chain of one project: client → quotations → work orders (POs) → billing. Work orders and invoices are Admin only, so staff see the first two. */
export default function ProjectCommercial({ projectId, clientId, stateCode }: { projectId: string; clientId: string | null; stateCode: string | null }) {
  const { admin } = useRole();
  const [client, setClient] = useState<Client | null>(null); const [quotes, setQuotes] = useState<Quote[]>([]); const [wos, setWos] = useState<Wo[]>([]); const [bill, setBill] = useState({ billed: 0, outstanding: 0, count: 0 }); const [err, setErr] = useState("");
  useEffect(() => { (async () => {
    const sb = supabase();
    const [c, q, w] = await Promise.all([clientId ? sb.from("clients").select("*").eq("id", clientId).maybeSingle() : Promise.resolve({ data: null, error: null }), sb.from("quotations").select("*").eq("project_id", projectId).order("quote_date", { ascending: false }), sb.from("work_orders").select("*").eq("project_id", projectId).order("created_at", { ascending: false })]);
    if (q.error) setErr(q.error.message + " — has the client / project links SQL migration been run?");
    setClient((c.data as Client | null) ?? null); setQuotes((q.data || []) as Quote[]);
    const wl = ((w.data || []) as any[]); const ids = wl.map((x) => x.id);
    if (!ids.length) { setWos([]); return; }
    const [it, inv] = await Promise.all([sb.from("work_order_items").select("work_order_id,qty,rate").in("work_order_id", ids), sb.from("invoices").select("*").in("work_order_id", ids)]);
    const invs = ((inv.data || []) as any[]).map((i) => ({ ...i, taxable: Number(i.taxable), total: Number(i.total) })) as Invoice[]; const issued = invs.filter((i) => i.status === "issued");
    const { data: rc } = issued.length ? await sb.from("invoice_receipts").select("*").in("invoice_id", issued.map((i) => i.id)) : { data: [] as any[] };
    const receipts = ((rc || []) as any[]).map((r) => ({ ...r, amount: Number(r.amount), tds_amount: Number(r.tds_amount) })) as Receipt[];
    setWos(wl.map((x) => ({ id: x.id, wo_no: x.wo_no, title: x.title, status: x.status, quotation_id: x.quotation_id, value: r2(((it.data || []) as any[]).filter((i) => i.work_order_id === x.id).reduce((s, i) => s + lineAmount(Number(i.qty), Number(i.rate)), 0)), billed: r2(issued.filter((i) => i.work_order_id === x.id).reduce((s, i) => s + i.taxable, 0)) })));
    setBill({ billed: r2(issued.reduce((s, i) => s + i.total, 0)), outstanding: r2(issued.reduce((s, i) => s + outstandingOf(i, receipts.filter((r) => r.invoice_id === i.id)), 0)), count: issued.length });
  })(); }, [projectId, clientId]);
  const wonQuote = (id: string) => wos.find((w) => w.quotation_id === id);

  return (
    <div className="card space-y-3"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">Commercial</h3><span className="text-xs text-slate-500">client → quotations → work orders → invoices</span>
      {admin && <Link className="btn !py-1 ml-auto" href="/work-orders/new">+ Work order</Link>}</div>
      {err && <p className="warn">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <div><div className="text-xs text-slate-400">Client</div>{client ? <Link className="font-medium text-blue-800 underline" href="/clients">{client.name}</Link> : <span className="text-amber-700">Not linked yet. Edit the project to choose the client.</span>}{client && <div className="text-xs text-slate-500">{client.gstin || "No GSTIN"}</div>}</div>
        <div><div className="text-xs text-slate-400">Site state (place of supply)</div>{stateCode ? <><span className="font-medium">{stateName(stateCode)}</span><span className="text-xs text-slate-500"> · {taxKind(stateCode)}</span></> : <span className="text-amber-700">Not set. Edit the project: invoices need it to charge the right GST.</span>}</div></div>
      <div><div className="text-xs text-slate-400 mb-1">Quotations ({quotes.length})</div>
        {!quotes.length && <p className="text-sm text-slate-400">None linked. Pick this project on a quotation.</p>}
        {quotes.map((q) => { const w = wonQuote(q.id!); const amt = (q.items || []).reduce((s, i) => s + itemAmount(i), 0); return (
          <Link key={q.id} href={`/quotations/${q.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 hover:bg-slate-50 text-sm"><span className="font-medium text-blue-800">{q.ref_no ?? "Draft"}</span><span className="flex-1 min-w-40 truncate text-slate-600">{q.subject}</span><span className="text-slate-500">{fmtD(q.quote_date)}</span><span className="tabular-nums w-28 text-right">₹{money(amt)}</span>{w ? <span className="text-xs rounded-full px-2 py-0.5 bg-blue-50 text-blue-800">Won · {w.wo_no}</span> : <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 text-slate-500">{q.status === "issued" ? "Open" : "Draft"}</span>}</Link>); })}</div>
      {admin && <div><div className="text-xs text-slate-400 mb-1">Work orders ({wos.length})</div>
        {!wos.length && <p className="text-sm text-slate-400">None yet. Open an issued quotation and choose <b>Create work order</b> when the client sends their PO.</p>}
        {wos.map((w) => <Link key={w.id} href={`/work-orders/${w.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 hover:bg-slate-50 text-sm"><span className="font-medium text-blue-800">{w.wo_no}</span><span className="flex-1 min-w-40 truncate text-slate-600">{w.title}</span><span className="tabular-nums w-36 text-right">₹{money(w.value)}</span><span className="tabular-nums w-40 text-right text-slate-500">billed ₹{money(w.billed)}</span><span className="text-xs capitalize text-slate-500">{w.status}</span></Link>)}
        {wos.length > 0 && <p className="text-xs text-slate-500 pt-1">{bill.count} invoice{bill.count === 1 ? "" : "s"} issued · ₹{money(bill.billed)} billed incl. GST · <Link className="underline" href="/invoices">₹{money(bill.outstanding)} outstanding</Link></p>}</div>}
    </div>
  );
}
