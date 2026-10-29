"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { itemAmount, inr, type Quote } from "@/lib/quote";
import SortControl, { useSortState } from "@/components/SortControl";
import FilterBar, { FilterSelect } from "@/components/FilterBar";
import { swrGet, swrSet } from "@/lib/swr";
import { fyOf, type Client } from "@/lib/invoice";
import { useRole } from "@/lib/roles";
import { sortRows, type SortOption } from "@/lib/sorting";

type QSort = "created" | "date" | "ref" | "client" | "amount" | "status" | "project";
const Q_SORT: SortOption<QSort>[] = [{ key: "created", label: "Newest added", dir: "desc" }, { key: "date", label: "Quotation date", dir: "desc" }, { key: "ref", label: "Reference no.", dir: "desc" }, { key: "client", label: "Client", dir: "asc" }, { key: "amount", label: "Amount", dir: "desc" }, { key: "project", label: "Project", dir: "asc" }, { key: "status", label: "Status", dir: "asc" }];

type QSnap = { rows: Quote[]; projects: Record<string, string>; won: Record<string, string>; clients: Client[] };

export default function QuotationsPage() {
  const snap = swrGet<QSnap>("quotations");   // last result, shown at once while a fresh one loads
  const [projects, setProjects] = useState<Record<string, string>>(snap?.projects ?? {}); const [won, setWon] = useState<Record<string, string>>(snap?.won ?? {});
  const [sort, setSort] = useSortState<QSort>("cipco_sort_quotations", { key: "created", dir: "desc" }, Q_SORT);
  const { admin } = useRole(); const [clients, setClients] = useState<Client[]>(snap?.clients ?? []);
  const [fStatus, setFStatus] = useState(""); const [fClient, setFClient] = useState(""); const [fProject, setFProject] = useState(""); const [fOutcome, setFOutcome] = useState(""); const [fFy, setFFy] = useState("");
  const [rows, setRows] = useState<Quote[]>(snap?.rows ?? []); const [q, setQ] = useState(""); const [err, setErr] = useState(""); const [loading, setLoading] = useState(!snap);
  useEffect(() => { (async () => {
    const sb = supabase(); const [{ data, error }, p, w, c] = await Promise.all([sb.from("quotations").select("*").order("created_at", { ascending: false }), sb.from("projects").select("id,name"), sb.from("work_orders").select("quotation_id,wo_no").not("quotation_id", "is", null), sb.from("clients").select("*").order("name")]);
    const cl = (c.data || []) as Client[]; const pj = Object.fromEntries(((p.data || []) as any[]).map((x) => [x.id, x.name])); const wn = Object.fromEntries(((w.data || []) as any[]).map((x) => [x.quotation_id, x.wo_no]));   // work orders are Admin only, so staff see no "Won"
    const rw = (data || []) as Quote[];
    setClients(cl); setProjects(pj); setWon(wn); setRows(rw); setLoading(false);
    if (error) setErr(error.message + " — has the quotations SQL migration been run?"); else swrSet("quotations", { rows: rw, projects: pj, won: wn, clients: cl } satisfies QSnap);
  })(); }, []);
  const fyOptions = [...new Set(rows.map((r) => fyOf(r.quote_date)))].sort().reverse();
  const nFilters = [fStatus, fClient, fProject, fOutcome, fFy].filter(Boolean).length;
  const clearFilters = () => { setFStatus(""); setFClient(""); setFProject(""); setFOutcome(""); setFFy(""); setQ(""); };
  // "Won" = a work order was created from it; staff cannot see work orders, so the outcome filter is for Admins only
  const filtered = rows.filter((r) => (!fStatus || r.status === fStatus) && (!fClient || (fClient === "__none" ? !r.client_id : r.client_id === fClient)) && (!fProject || (fProject === "__none" ? !r.project_id : r.project_id === fProject)) && (!fFy || fyOf(r.quote_date) === fFy)
    && (!fOutcome || (fOutcome === "won" ? !!(r.id && won[r.id]) : r.status === "issued" && !(r.id && won[r.id]))) && (r.client_name + " " + r.subject + " " + (r.ref_no || "")).toLowerCase().includes(q.toLowerCase()));
  const shown = sortRows(filtered, (r) => ({ created: r.created_at ?? "", date: r.quote_date, ref: r.ref_no, client: r.client_name, amount: (r.items || []).reduce((s, i) => s + itemAmount(i), 0), project: r.project_id ? projects[r.project_id] ?? "" : "", status: r.status === "issued" ? 0 : 1 } as Record<QSort, string | number | null>)[sort.key], sort.dir, (a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const amt = (r: Quote) => inr((r.items || []).reduce((s, i) => s + itemAmount(i), 0));
  const date = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold sm:mr-auto w-full sm:w-auto">Quotations</h1>
        <input className="inp w-full sm:!w-64" placeholder="Search client, subject, ref…" value={q} onChange={(e) => setQ(e.target.value)} />
        <SortControl options={Q_SORT} value={sort} onChange={setSort} />
        <Link className="btn flex-1 sm:flex-none justify-center" href="/quote-library">Wording library</Link>
        <Link className="btn btn-primary flex-1 sm:flex-none justify-center" href="/quotations/new">+ New quotation</Link>
      </div>
      <FilterBar active={nFilters + (q ? 1 : 0)} onClear={clearFilters} shown={shown.length} total={rows.length} noun="quotations">
        <FilterSelect label="Status" value={fStatus} onChange={setFStatus} width="!w-36"><option value="">All statuses</option><option value="draft">Draft</option><option value="issued">Issued</option></FilterSelect>
        {admin && <FilterSelect label="Outcome" value={fOutcome} onChange={setFOutcome} width="!w-40"><option value="">Any outcome</option><option value="won">Won (has a work order)</option><option value="open">Issued, no order yet</option></FilterSelect>}
        <FilterSelect label="Client" value={fClient} onChange={setFClient} width="!w-48"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.short_name || c.name}</option>)}<option value="__none">Not linked to a client</option></FilterSelect>
        <FilterSelect label="Project" value={fProject} onChange={setFProject} width="!w-48"><option value="">All projects</option>{Object.entries(projects).map(([id, name]) => <option key={id} value={id}>{name}</option>)}<option value="__none">Not linked to a project</option></FilterSelect>
        <FilterSelect label="Financial year" value={fFy} onChange={setFFy} width="!w-40"><option value="">All years</option>{fyOptions.map((y) => <option key={y} value={y}>FY {y}</option>)}</FilterSelect>
      </FilterBar>
      {err && <p className="warn">{err}</p>}
      <div className="space-y-2">
        {loading && <p className="card text-center text-sm text-slate-500">Loading…</p>}
        {!loading && !shown.length && !err && <p className="card text-center text-sm text-slate-500">{q ? "Nothing matches your search." : "No quotations yet."}</p>}
        {shown.map((r) => (
          <Link key={r.id} href={`/quotations/${r.id}`} className="card !p-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-slate-50">
            <div className="min-w-0 flex-1 basis-64"><div className="font-semibold text-blue-800 truncate">{r.client_name}</div><div className="text-sm text-slate-600 truncate">{r.subject || "—"}</div>{r.project_id && projects[r.project_id] && <div className="text-xs text-slate-400 truncate">Project: {projects[r.project_id]}</div>}</div>
            <div className="text-sm text-slate-500">{r.ref_no ?? "—"}</div>
            <div className="text-sm text-slate-500">{date(r.quote_date)}</div>
            <div className="text-sm font-medium w-28 sm:text-right">₹{amt(r)}</div>
            <span className={`text-xs rounded-full px-2 py-0.5 ${r.status === "issued" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{r.status === "issued" ? "Issued" : "Draft"}</span>{r.id && won[r.id] && <span className="text-xs rounded-full px-2 py-0.5 bg-blue-50 text-blue-800" title="A work order was created from this quotation">Won · {won[r.id]}</span>}
          </Link>))}
      </div>
    </div>
  );
}
