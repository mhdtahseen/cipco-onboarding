"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { lineAmount, money, r2, type Client, type WoItem, type WorkOrder } from "@/lib/invoice";
import { createDraftBill, fmtD } from "@/lib/invoiceData";
import SortControl, { useSortState } from "@/components/SortControl";
import FilterBar, { FilterSelect } from "@/components/FilterBar";
import { swrGet, swrSet } from "@/lib/swr";
import { sortRows, type SortOption } from "@/lib/sorting";

type WSort = "created" | "date" | "no" | "client" | "value" | "billed" | "pct" | "balance" | "status";
const W_SORT: SortOption<WSort>[] = [{ key: "created", label: "Newest added", dir: "desc" }, { key: "date", label: "Order date", dir: "desc" }, { key: "no", label: "Order number", dir: "desc" }, { key: "client", label: "Client", dir: "asc" }, { key: "value", label: "Order value", dir: "desc" }, { key: "billed", label: "Billed so far", dir: "desc" }, { key: "pct", label: "% billed", dir: "desc" }, { key: "balance", label: "Left to bill", dir: "desc" }, { key: "status", label: "Status", dir: "asc" }];
const W_STATUS: Record<string, number> = { active: 0, completed: 1, closed: 2 };
type Bill = { work_order_id: string; status: string; taxable: number };
type WSnap = { wos: WorkOrder[]; clients: Client[]; items: WoItem[]; bills: Bill[]; projects: { id: string; name: string }[] };

const TONE = { active: "bg-green-50 text-green-800", completed: "bg-blue-50 text-blue-800", closed: "bg-slate-100 text-slate-600" } as const;

// Admin: the client's orders for our projects, with how much of each has been billed.
export default function WorkOrders() {
  const router = useRouter(); const snap = swrGet<WSnap>("workorders");   // last result, shown at once while a fresh one loads
  const [wos, setWos] = useState<WorkOrder[]>(snap?.wos ?? []); const [clients, setClients] = useState<Client[]>(snap?.clients ?? []); const [items, setItems] = useState<WoItem[]>(snap?.items ?? []); const [bills, setBills] = useState<Bill[]>(snap?.bills ?? []);
  const [sort, setSort] = useSortState<WSort>("cipco_sort_workorders", { key: "created", dir: "desc" }, W_SORT);
  const [loading, setLoading] = useState(!snap); const [err, setErr] = useState(""); const [q, setQ] = useState(""); const [wstatus, setWstatus] = useState("active"); const [cid, setCid] = useState(""); const [pid, setPid] = useState(""); const [billing, setBilling] = useState(""); const [projects, setProjects] = useState<{ id: string; name: string }[]>(snap?.projects ?? []); const [busy, setBusy] = useState("");
  useEffect(() => { (async () => {
    const sb = supabase(); const [w, c, i, b, p] = await Promise.all([sb.from("work_orders").select("*").order("created_at", { ascending: false }), sb.from("clients").select("*"), sb.from("work_order_items").select("*"), sb.from("invoices").select("work_order_id,status,taxable"), sb.from("projects").select("id,name").order("name")]);
    const e = w.error || c.error || i.error || b.error; if (e) setErr(e.message + " — has the invoicing SQL migration been run?");
    const wl = ((w.data || []) as any[]).map((x) => ({ ...x, gst_rate: Number(x.gst_rate), retention_pct: Number(x.retention_pct), tds_pct: Number(x.tds_pct) })) as WorkOrder[]; const cl = (c.data || []) as Client[];
    const it = ((i.data || []) as any[]).map((x) => ({ ...x, qty: Number(x.qty), rate: Number(x.rate) })) as WoItem[]; const bl = ((b.data || []) as any[]).map((x) => ({ ...x, taxable: Number(x.taxable) })) as Bill[]; const pj = (p.data || []) as any[];
    setWos(wl); setClients(cl); setItems(it); setBills(bl); setProjects(pj); setLoading(false);
    if (!e) swrSet("workorders", { wos: wl, clients: cl, items: it, bills: bl, projects: pj } satisfies WSnap);   // a failed load is never remembered
  })(); }, []);
  const cName = (id: string) => clients.find((c) => c.id === id)?.short_name || clients.find((c) => c.id === id)?.name || "?";
  const filteredRows = useMemo(() => wos.map((w) => {
    const value = r2(items.filter((i) => i.work_order_id === w.id).reduce((s, i) => s + lineAmount(i.qty, i.rate), 0));
    const billed = r2(bills.filter((b) => b.work_order_id === w.id && b.status === "issued").reduce((s, b) => s + b.taxable, 0));
    return { w, value, billed, count: bills.filter((b) => b.work_order_id === w.id && b.status !== "cancelled").length };
  }).filter((r) => (wstatus === "all" || r.w.status === wstatus) && (!cid || r.w.client_id === cid) && (!pid || (pid === "__none" ? !r.w.project_id : r.w.project_id === pid)) && (!billing || (billing === "notstarted" ? r.billed === 0 : billing === "inprogress" ? r.billed > 0 && r.billed < r.value : r.value > 0 && r.billed >= r.value)) && (r.w.wo_no + " " + r.w.title + " " + cName(r.w.client_id)).toLowerCase().includes(q.toLowerCase())), [wos, items, bills, clients, q, wstatus, cid, pid, billing]);   // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => sortRows(filteredRows, (r) => ({ created: (r.w as any).created_at ?? "", date: r.w.wo_date, no: r.w.wo_no, client: cName(r.w.client_id), value: r.value, billed: r.billed, pct: r.value > 0 ? r.billed / r.value : 0, balance: r2(r.value - r.billed), status: W_STATUS[r.w.status] } as Record<WSort, string | number | null>)[sort.key], sort.dir, (a, b) => String((b.w as any).created_at ?? "").localeCompare(String((a.w as any).created_at ?? ""))), [filteredRows, sort, clients]);   // eslint-disable-line react-hooks/exhaustive-deps
  async function bill(id: string) { setBusy(id); setErr(""); const r = await createDraftBill(id); setBusy(""); if (r.error) setErr(r.error); else router.push(`/invoices/${r.id}`); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold sm:mr-auto w-full sm:w-auto">Work orders</h1>
        <input className="inp w-full sm:!w-64" placeholder="Search order, title, client…" aria-label="Search work orders" value={q} onChange={(e) => setQ(e.target.value)} />
        <SortControl options={W_SORT} value={sort} onChange={setSort} />
        <Link className="btn flex-1 sm:flex-none justify-center" href="/clients">Clients</Link><Link className="btn btn-primary flex-1 sm:flex-none justify-center" href="/work-orders/new">+ New work order</Link></div>
      <FilterBar active={(wstatus !== "active" ? 1 : 0) + [cid, pid, billing].filter(Boolean).length + (q ? 1 : 0)} onClear={() => { setWstatus("active"); setCid(""); setPid(""); setBilling(""); setQ(""); }} shown={rows.length} total={wos.length} noun="work orders">
        <FilterSelect label="Status" value={wstatus} on={wstatus !== "active"} onChange={setWstatus} width="!w-40"><option value="active">Active</option><option value="completed">Completed</option><option value="closed">Closed</option><option value="all">All statuses</option></FilterSelect>
        <FilterSelect label="Client" value={cid} onChange={setCid} width="!w-48"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.short_name || c.name}</option>)}</FilterSelect>
        <FilterSelect label="Project" value={pid} onChange={setPid} width="!w-48"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="__none">No project</option></FilterSelect>
        <FilterSelect label="Billing" value={billing} onChange={setBilling} width="!w-44"><option value="">Any billing</option><option value="notstarted">Not billed yet</option><option value="inprogress">Part billed</option><option value="complete">Fully billed</option></FilterSelect>
      </FilterBar>
      {err && <p className="warn">{err}</p>}
      <div className="space-y-2">
        {loading && <p className="card text-center text-sm text-slate-500">Loading…</p>}
        {!loading && !rows.length && !err && <p className="card text-center text-sm text-slate-500">{q ? "Nothing matches your search." : "No work orders yet. Add the client first, then enter their work order with its items."}</p>}
        {rows.map(({ w, value, billed, count }) => (
          <div key={w.id} className="card !p-3 flex flex-wrap items-center gap-x-4 gap-y-2 fade">
            <Link href={`/work-orders/${w.id}`} className="min-w-0 flex-1 basis-64 hover:underline"><div className="font-semibold text-blue-800 truncate">{w.title}</div><div className="text-sm text-slate-600 truncate">{cName(w.client_id)} · {w.wo_no}{w.wo_date ? ` · ${fmtD(w.wo_date)}` : ""}</div></Link>
            <div className="text-sm sm:text-right w-40"><div className="tabular-nums">₹{money(value)}</div><div className="text-xs text-slate-500">order value</div></div>
            <div className="text-sm sm:text-right w-40"><div className="tabular-nums">₹{money(billed)}</div><div className="text-xs text-slate-500">billed · {value > 0 ? Math.round((billed / value) * 100) : 0}% · {count} bill{count === 1 ? "" : "s"}</div></div>
            <span className={`text-xs rounded-full px-2 py-0.5 capitalize ${TONE[w.status]}`}>{w.status}</span>
            {w.status === "active" && <button className="btn btn-sm" disabled={!!busy} onClick={() => bill(w.id)}>{busy === w.id ? "Starting…" : "New bill"}</button>}
          </div>))}
      </div>
    </div>
  );
}
