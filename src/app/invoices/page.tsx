"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { AGING_LABEL, agingOf, daysBetween, fyOf, money, outstandingOf, r2, receivedOf, retentionHeld, settledOf, tdsOf, type Aging, type Client, type Invoice, type Receipt, type WorkOrder } from "@/lib/invoice";
import { createDraftBill, fmtD } from "@/lib/invoiceData";
import SortControl, { useSortState } from "@/components/SortControl";
import FilterBar, { FilterSelect } from "@/components/FilterBar";
import { swrGet, swrSet } from "@/lib/swr";
import { sortRows, type SortOption } from "@/lib/sorting";

type InvSort = "created" | "date" | "number" | "client" | "total" | "outstanding" | "due" | "status";
const INV_SORT: SortOption<InvSort>[] = [{ key: "created", label: "Newest added", dir: "desc" }, { key: "date", label: "Invoice date", dir: "desc" }, { key: "number", label: "Invoice number", dir: "desc" }, { key: "client", label: "Client", dir: "asc" }, { key: "total", label: "Amount", dir: "desc" }, { key: "outstanding", label: "Outstanding", dir: "desc" }, { key: "due", label: "Due date", dir: "asc" }, { key: "status", label: "Status", dir: "asc" }];
const STATUS_RANK: Record<string, number> = { issued: 0, draft: 1, cancelled: 2 };
type InvSnap = { invs: Invoice[]; rcs: Receipt[]; clients: Client[]; wos: WorkOrder[]; projects: { id: string; name: string }[] };

const BADGE = { draft: "bg-amber-50 text-amber-800", issued: "bg-green-50 text-green-800", cancelled: "bg-slate-100 text-slate-500" } as const;
const BUCKETS: Aging[] = ["not_due", "d0_30", "d31_60", "d61_90", "d90"];
type Tab = "register" | "outstanding";

// Admin: every bill we have raised, and what is still to be collected.
export default function Invoices() {
  const router = useRouter(); const today = istToday(); const snap = swrGet<InvSnap>("invoices");   // last result, shown at once while a fresh one loads
  const [sort, setSort] = useSortState<InvSort>("cipco_sort_invoices", { key: "created", dir: "desc" }, INV_SORT);
  const [tab, setTab] = useState<Tab>("register"); const [invs, setInvs] = useState<Invoice[]>(snap?.invs ?? []); const [rcs, setRcs] = useState<Receipt[]>(snap?.rcs ?? []); const [clients, setClients] = useState<Client[]>(snap?.clients ?? []); const [wos, setWos] = useState<WorkOrder[]>(snap?.wos ?? []);
  const [loading, setLoading] = useState(!snap); const [err, setErr] = useState(""); const [q, setQ] = useState(""); const [status, setStatus] = useState(""); const [cid, setCid] = useState(""); const [wo, setWo] = useState(""); const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState(""); const [project, setProject] = useState(""); const [fyF, setFyF] = useState(""); const [projects, setProjects] = useState<{ id: string; name: string }[]>(snap?.projects ?? []);
  useEffect(() => { (async () => {
    const sb = supabase(); const [i, r, c, w, p] = await Promise.all([sb.from("invoices").select("*").order("created_at", { ascending: false }), sb.from("invoice_receipts").select("*"), sb.from("clients").select("*").order("name"), sb.from("work_orders").select("*").order("created_at", { ascending: false }), sb.from("projects").select("id,name").order("name")]);
    const e = i.error || r.error || c.error || w.error; if (e) setErr(e.message + " — has the invoicing SQL migration been run?");
    const N = ["gst_rate", "taxable", "cgst", "sgst", "igst", "round_off", "total", "retention_pct", "retention", "other_deduction", "payable", "tds_pct"];
    const iv = ((i.data || []) as any[]).map((x) => { const o = { ...x }; N.forEach((k) => { o[k] = Number(o[k]); }); return o; }) as Invoice[];
    const rc = ((r.data || []) as any[]).map((x) => ({ ...x, amount: Number(x.amount), tds_amount: Number(x.tds_amount) })) as Receipt[]; const cl = (c.data || []) as Client[]; const wl = (w.data || []) as WorkOrder[]; const pj = ((p.data || []) as any[]);
    setInvs(iv); setRcs(rc); setClients(cl); setWos(wl); setProjects(pj); setLoading(false);
    if (!e) swrSet("invoices", { invs: iv, rcs: rc, clients: cl, wos: wl, projects: pj } satisfies InvSnap);   // a failed load is never remembered
  })(); }, []);
  const cName = (id: string) => clients.find((c) => c.id === id)?.short_name || clients.find((c) => c.id === id)?.name || "?";
  const woNo = (id: string) => wos.find((w) => w.id === id)?.wo_no ?? "";
  const rOf = (id: string) => rcs.filter((r) => r.invoice_id === id);

  // payment: unpaid = issued with something still to collect; overdue = unpaid past its due date, not counting retention that is only being held
  const payOk = (x: Invoice) => { if (!payment) return true; if (x.status !== "issued") return false; const out = outstandingOf(x, rOf(x.id)); if (payment === "paid") return out === 0; if (payment === "unpaid") return out > 0; return out - retentionHeld(x, rOf(x.id)) > 0 && !!x.due_date && daysBetween(x.due_date, today) > 0; };
  const fyOptions = [...new Set(invs.map((x) => fyOf(x.invoice_date)))].sort().reverse();
  const nFilters = [status, payment, cid, project, fyF].filter(Boolean).length;
  const clearFilters = () => { setStatus(""); setPayment(""); setCid(""); setProject(""); setFyF(""); setQ(""); };
  const filtered = useMemo(() => invs.filter((x) => (!status || x.status === status) && (!cid || x.client_id === cid) && (!project || (project === "__none" ? !x.project_id : x.project_id === project)) && (!fyF || fyOf(x.invoice_date) === fyF) && payOk(x) && ((x.invoice_no ?? "draft") + " " + cName(x.client_id) + " " + woNo(x.work_order_id)).toLowerCase().includes(q.toLowerCase())), [invs, status, cid, project, fyF, payment, rcs, q, clients, wos]);   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => sortRows(filtered, (x) => ({ created: x.created_at, date: x.invoice_date, number: x.invoice_no, client: cName(x.client_id), total: x.total, outstanding: outstandingOf(x, rOf(x.id)), due: x.status === "issued" && outstandingOf(x, rOf(x.id)) > 0 ? x.due_date : null, status: STATUS_RANK[x.status] } as Record<InvSort, string | number | null>)[sort.key], sort.dir, (a, b) => b.created_at.localeCompare(a.created_at)), [filtered, sort, rcs, clients]);   // eslint-disable-line react-hooks/exhaustive-deps
  const live = invs.filter((x) => x.status === "issued");
  const sum = (f: (x: Invoice) => number, list = live) => r2(list.reduce((s, x) => s + f(x), 0));
  const fy = fyOf(today); const inFy = live.filter((x) => fyOf(x.invoice_date) === fy);

  // outstanding per client; retention held is shown apart, and is not counted as late
  const byClient = useMemo(() => clients.map((c) => {
    const list = live.filter((x) => x.client_id === c.id).map((x) => { const out = outstandingOf(x, rOf(x.id)); const held = retentionHeld(x, rOf(x.id)); return { x, out, held, due: out - held, aging: agingOf(x.due_date, today) }; });
    const b: Record<Aging, number> = { not_due: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 }; list.forEach((l) => { b[l.aging] = r2(b[l.aging] + l.due); });
    return { c, list: list.filter((l) => l.out > 0), billed: r2(list.reduce((s, l) => s + l.x.total, 0)), settledCash: r2(list.reduce((s, l) => s + receivedOf(rOf(l.x.id)), 0)), tds: r2(list.reduce((s, l) => s + tdsOf(rOf(l.x.id)), 0)), out: r2(list.reduce((s, l) => s + l.out, 0)), held: r2(list.reduce((s, l) => s + l.held, 0)), b };
  }).filter((r) => r.billed > 0), [clients, invs, rcs, today]);   // eslint-disable-line react-hooks/exhaustive-deps
  const totalOut = r2(byClient.reduce((s, r) => s + r.out, 0)), totalHeld = r2(byClient.reduce((s, r) => s + r.held, 0)); const overdue = r2(byClient.reduce((s, r) => s + r.b.d0_30 + r.b.d31_60 + r.b.d61_90 + r.b.d90, 0));

  async function newBill() { if (!wo) return; setBusy(true); setErr(""); const r = await createDraftBill(wo); setBusy(false); if (r.error) setErr(r.error); else router.push(`/invoices/${r.id}`); }
  function csv() {
    const q2 = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Invoice no", "Date", "Client", "Client GSTIN", "Work order", "Bill no", "Taxable", "CGST", "SGST", "IGST", "Round off", "Total", "Received", "TDS deducted", "Outstanding", "Status"], ...shown.filter((x) => x.status !== "draft").map((x) => [x.invoice_no, x.invoice_date, clients.find((c) => c.id === x.client_id)?.name, clients.find((c) => c.id === x.client_id)?.gstin ?? "", woNo(x.work_order_id), x.bill_no, x.taxable, x.cgst, x.sgst, x.igst, x.round_off, x.total, receivedOf(rOf(x.id)), tdsOf(rOf(x.id)), outstandingOf(x, rOf(x.id)), x.status])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(q2).join(",")).join("\n")], { type: "text/csv" })); a.download = `Invoice register ${today}.csv`; a.click();
  }
  const card = (l: string, v: string, sub?: string) => <div className="rounded-2xl bg-white border border-slate-200/80 p-3"><div className="text-xs text-slate-400">{l}</div><div className="text-lg font-medium tabular-nums">{v}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold sm:mr-auto w-full sm:w-auto">Invoices</h1>
        <Link className="btn" href="/clients">Clients</Link><Link className="btn" href="/work-orders">Work orders</Link>
        <select className="inp !w-56" aria-label="Work order for the new bill" value={wo} onChange={(e) => setWo(e.target.value)}><option value="">New bill for…</option>{wos.filter((w) => w.status === "active").map((w) => <option key={w.id} value={w.id}>{cName(w.client_id)} · {w.wo_no}</option>)}</select>
        <button className="btn btn-primary" disabled={!wo || busy} onClick={newBill}>{busy ? "Starting…" : "+ New running bill"}</button></div>
      {err && <p className="warn">{err}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{card("Billed (all, incl. GST)", `₹${money(sum((x) => x.total))}`, `${live.length} invoice${live.length === 1 ? "" : "s"} issued`)}{card("Received", `₹${money(r2(byClient.reduce((s, r) => s + r.settledCash, 0)))}`)}{card("TDS deducted by clients", `₹${money(r2(byClient.reduce((s, r) => s + r.tds, 0)))}`, "claim against Form 26AS")}{card("Outstanding", `₹${money(totalOut)}`, `₹${money(totalHeld)} is retention · ₹${money(overdue)} overdue`)}{card(`GST charged, FY ${fy}`, `₹${money(sum((x) => x.cgst + x.sgst + x.igst, inFy))}`, "for your GSTR-1 and 3B")}</div>
      <div role="tablist" className="flex border-b border-slate-200">{([["register", "Register"], ["outstanding", "Outstanding"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === "register" && <div key="register" className="space-y-3 fade-in">
        <div className="flex flex-wrap gap-2"><input className="inp w-full sm:!w-64" placeholder="Search number, client, order…" aria-label="Search invoices" value={q} onChange={(e) => setQ(e.target.value)} />
          <SortControl options={INV_SORT} value={sort} onChange={setSort} />
          <button className="btn sm:ml-auto" onClick={csv} disabled={!shown.some((x) => x.status !== "draft")}>⬇ Export for CA (CSV)</button></div>
        <FilterBar active={nFilters + (q ? 1 : 0)} onClear={clearFilters} shown={shown.length} total={invs.length} noun="invoices">
          <FilterSelect label="Status" value={status} onChange={setStatus} width="!w-36"><option value="">All statuses</option><option value="draft">Draft</option><option value="issued">Issued</option><option value="cancelled">Cancelled</option></FilterSelect>
          <FilterSelect label="Payment" value={payment} onChange={setPayment} width="!w-40"><option value="">Any payment</option><option value="unpaid">Unpaid</option><option value="overdue">Overdue</option><option value="paid">Paid</option></FilterSelect>
          <FilterSelect label="Client" value={cid} onChange={setCid} width="!w-48"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.short_name || c.name}</option>)}</FilterSelect>
          <FilterSelect label="Project" value={project} onChange={setProject} width="!w-48"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="__none">No project</option></FilterSelect>
          <FilterSelect label="Financial year" value={fyF} onChange={setFyF} width="!w-40"><option value="">All years</option>{fyOptions.map((y) => <option key={y} value={y}>FY {y}</option>)}</FilterSelect>
        </FilterBar>
        <div className="space-y-2">
          {loading && <p className="card text-center text-sm text-slate-500">Loading…</p>}
          {!loading && !shown.length && !err && <p className="card text-center text-sm text-slate-500">{invs.length ? "Nothing matches the filters." : "No invoices yet. Choose a work order above to raise the first running bill."}</p>}
          {shown.map((x) => { const out = outstandingOf(x, rOf(x.id)); const late = x.status === "issued" && out > 0 && x.due_date && daysBetween(x.due_date, today) > 0; return (
            <Link key={x.id} href={`/invoices/${x.id}`} className="card !p-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-slate-50 fade">
              <div className="min-w-0 flex-1 basis-56"><div className="font-semibold text-blue-800 truncate">{x.invoice_no ?? `Draft · Bill ${x.bill_no}`}</div><div className="text-sm text-slate-600 truncate">{cName(x.client_id)} · {woNo(x.work_order_id)} · Bill {x.bill_no}</div></div>
              <div className="text-sm text-slate-500 w-28">{fmtD(x.invoice_date)}</div><div className="text-sm sm:text-right w-32 tabular-nums">₹{money(x.total)}</div>
              <div className="text-sm sm:text-right w-36 tabular-nums">{x.status === "issued" ? (out > 0 ? <span className={late ? "text-red-700 font-medium" : "text-amber-800"}>₹{money(out)} due{late ? ` · ${daysBetween(x.due_date!, today)}d late` : ""}</span> : <span className="text-green-700">Paid</span>) : "—"}</div>
              <span className={`text-xs rounded-full px-2 py-0.5 capitalize ${BADGE[x.status]}`}>{x.status}</span></Link>); })}
        </div></div>}

      {tab === "outstanding" && <div key="outstanding" className="space-y-3 fade-in">
        {!byClient.length && !loading && <p className="card text-center text-sm text-slate-500">Nothing issued yet, so nothing to collect.</p>}
        {byClient.map((r) => (
          <section key={r.c.id} className="card space-y-2 fade"><div className="flex flex-wrap items-baseline gap-x-6 gap-y-1"><h2 className="font-semibold mr-auto">{r.c.name}</h2>
            <span className="text-sm text-slate-500">Billed ₹{money(r.billed)}</span><span className="text-sm text-slate-500">Received ₹{money(r.settledCash)}</span><span className="text-sm text-slate-500">TDS ₹{money(r.tds)}</span><span className={`text-sm font-medium ${r.out > 0 ? "text-amber-800" : "text-green-700"}`}>Outstanding ₹{money(r.out)}</span></div>
            {r.out > 0 && <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">{BUCKETS.map((k) => <div key={k} className={`rounded-lg p-2 ${k !== "not_due" && r.b[k] > 0 ? "bg-red-50 text-red-900" : "bg-slate-50 text-slate-600"}`}><div>{AGING_LABEL[k]}</div><div className="text-sm font-medium tabular-nums">₹{money(r.b[k])}</div></div>)}</div>}
            {r.held > 0 && <p className="text-xs text-slate-500">₹{money(r.held)} of the outstanding is retention, which is released later and is not counted as late.</p>}
            {r.list.map((l) => <Link key={l.x.id} href={`/invoices/${l.x.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 rounded-lg px-2 py-1.5 hover:bg-slate-50 text-sm"><span className="flex-1 min-w-40 font-medium text-blue-800">{l.x.invoice_no}</span><span className="text-slate-500 w-36">due {fmtD(l.x.due_date)}</span><span className={`w-28 ${l.aging === "not_due" ? "text-slate-500" : "text-red-700"}`}>{l.aging === "not_due" ? "not yet due" : `${daysBetween(l.x.due_date!, today)} days late`}</span><span className="w-32 text-right tabular-nums">₹{money(l.out)}</span></Link>)}</section>))}
      </div>}
    </div>
  );
}
