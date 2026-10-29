"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Project } from "@/lib/types";
import { STAGES, stageIndex, stageLabel } from "@/lib/pipeline";
import { LIST_COLUMNS, PILES, SORT_LABEL, matches, pileOfRow, sortRows, type ListRow, type Pile, type SortKey } from "@/lib/employeeList";
import { Icon } from "../NavIcons";
import { EmployeeCards, EmployeeTable } from "./EmployeeTable";

export const LIST_QS_KEY = "cipco_emp_list_qs";   // the employee page reads this so "← Employees" returns to the same filtered list
const isPile = (x: string | null): x is Pile => x === "process" || x === "onboarded" || x === "rejected";
const isSort = (x: string | null): x is SortKey => !!x && x in SORT_LABEL;

export default function EmployeeList() {
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  // Filters live in the address bar, so Back, refresh and "← Employees" all return to the same view.
  const pile: Pile = isPile(sp.get("pile")) ? (sp.get("pile") as Pile) : "process";
  const stage = sp.get("stage") || ""; const proj = sp.get("project") || ""; const qParam = sp.get("q") || "";
  const sort: SortKey = isSort(sp.get("sort")) ? (sp.get("sort") as SortKey) : "newest"; const dir: "asc" | "desc" = sp.get("dir") === "asc" ? "asc" : sp.get("dir") === "desc" ? "desc" : sort === "newest" || sort === "updated" ? "desc" : "asc";
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp.toString()); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    const s = n.toString(); router.replace(s ? `${path}?${s}` : path, { scroll: false });
  }, [sp, router, path]);
  useEffect(() => { try { sessionStorage.setItem(LIST_QS_KEY, sp.toString()); } catch { /* storage unavailable */ } }, [sp]);

  const [rows, setRows] = useState<ListRow[]>([]); const [docs, setDocs] = useState<Record<string, number>>({}); const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [sel, setSel] = useState<string[]>([]); const [q, setQ] = useState(qParam); const [filters, setFilters] = useState(false);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr(""); const sb = supabase();
    sb.from("projects").select("*").order("name").then(({ data }) => setProjects((data || []) as Project[]));   // empty until the projects migration has been run
    const { data, error } = await sb.from("employees").select(LIST_COLUMNS).order("created_at", { ascending: false });
    if (error) { setErr(error.message); setLoading(false); return; }
    setRows((data || []) as unknown as ListRow[]);
    const { data: d } = await sb.from("employee_documents").select("employee_id,status").neq("doc_type", "resume");
    const c: Record<string, number> = {}; (d || []).forEach((x: any) => { if (x.status === "verified" || x.status === "received") c[x.employee_id] = (c[x.employee_id] || 0) + 1; }); setDocs(c); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // typing updates the box at once; the address bar follows a moment later
  useEffect(() => { const t = setTimeout(() => { if (q !== qParam) setParams({ q: q || null }); }, 250); return () => clearTimeout(t); }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQ(qParam); }, [qParam]);

  // Everything is filtered by project and search first, so the pile and stage counts always describe what you would see.
  const base = useMemo(() => rows.filter((r) => !proj || r.project_id === proj).filter((r) => matches(r, qParam)), [rows, proj, qParam]);
  const inPile = useMemo(() => base.filter((r) => pileOfRow(r) === pile), [base, pile]);
  const shown = useMemo(() => sortRows(inPile.filter((r) => pile !== "process" || !stage || r.stage === stage), sort, dir, stageIndex), [inPile, pile, stage, sort, dir]);
  const pileCount = (k: Pile) => base.filter((r) => pileOfRow(r) === k).length;
  const stageCount = (k: string) => base.filter((r) => pileOfRow(r) === "process" && r.stage === k).length;
  const live = sel.filter((id) => rows.some((r) => r.id === id)); const hidden = live.filter((id) => !shown.some((r) => r.id === id)).length;
  const filtersOn = (proj ? 1 : 0) + (stage ? 1 : 0) + (sort !== "newest" ? 1 : 0);

  const onSort = (k: SortKey) => setParams(k === sort ? { dir: dir === "asc" ? "desc" : "asc" } : { sort: k === "newest" ? null : k, dir: null });
  const empty = qParam ? "Nothing matches your search." : proj || stage ? "Nobody here with these filters." : pile === "rejected" ? "Nobody has been rejected or declined." : pile === "onboarded" ? "Nobody has been marked Onboarded yet." : "No candidates here yet.";
  const clearAll = () => { setQ(""); setParams({ q: null, stage: null, project: null, sort: null, dir: null }); };
  const emptyAction = qParam || proj || stage ? <button className="btn btn-sm" onClick={clearAll}>Clear search and filters</button> : pile === "process" ? <Link className="btn btn-primary btn-sm" href="/employees/new">+ New candidate</Link> : undefined;

  async function bulk(patch: Record<string, any>, done: string, confirmText?: string) {
    if (!live.length || (confirmText && !confirm(confirmText))) return;
    setBusy(true); setMsg("");
    const { error } = await supabase().from("employees").update({ ...patch, updated_at: new Date().toISOString() }).in("id", live);
    setBusy(false); if (error) { setMsg(error.message); return; }
    setRows((rs) => rs.map((r) => (live.includes(r.id) ? { ...r, ...patch, updated_at: new Date().toISOString() } : r))); setMsg(`${done} for ${live.length} ${live.length === 1 ? "person" : "people"} ✓`); setSel([]); setTimeout(() => setMsg(""), 3000);
  }
  const moveStage = (k: string) => k && bulk({ stage: k }, `Moved to ${stageLabel(k)}`, `Move ${live.length} ${live.length === 1 ? "person" : "people"} to ${stageLabel(k)}?${k === "onboarded" ? " They will appear in the Onboarded list." : ""}`);
  const assignProject = (id: string) => { const p = projects.find((x) => x.id === id); if (p) bulk({ project: p.name, project_id: p.id, ...(p.location ? { site_location: p.location } : {}) }, `Assigned to ${p.name}`, `Assign ${live.length} ${live.length === 1 ? "person" : "people"} to ${p.name}? Their work location changes to the project's.`); };

  const filterControls = (
    <>
      {projects.length > 0 && <select className="inp md:!w-48" aria-label="Filter by project" value={proj} onChange={(e) => { setParams({ project: e.target.value || null }); setSel([]); }}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === "closed" ? " (closed)" : ""}</option>)}</select>}
      <select className="inp md:hidden" aria-label="Sort by" value={sort} onChange={(e) => setParams({ sort: e.target.value === "newest" ? null : e.target.value, dir: null })}>{(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>Sort: {SORT_LABEL[k]}</option>)}</select>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="sm:mr-auto w-full sm:w-auto"><h1 className="text-xl font-bold">Employees</h1><p className="text-sm text-slate-500">Candidates in hiring and onboarded staff</p></div>
        <details className="relative">
          <summary className="btn list-none [&::-webkit-details-marker]:hidden"><Icon name="download" className="h-4 w-4" />Export<Icon name="chevron-down" className="h-4 w-4" /></summary>
          <div className="pop absolute right-0 z-20 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg text-sm">
            <a className="block rounded-lg px-3 py-2 hover:bg-slate-100" href="/api/export/excel">Excel — all employees</a>
            {live.length > 0 ? <a className="block rounded-lg px-3 py-2 hover:bg-slate-100" href={`/api/export/excel?ids=${live.join(",")}`}>Excel — selected ({live.length})</a> : <span className="block rounded-lg px-3 py-2 text-slate-400">Excel — selected (tick rows first)</span>}
          </div>
        </details>
        <Link className="btn btn-primary flex-1 sm:flex-none justify-center" href="/employees/new">+ New candidate</Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full md:w-72">
          <input className="inp !pr-9" type="search" placeholder="Search name, role, project, phone…" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button type="button" aria-label="Clear search" onClick={() => { setQ(""); setParams({ q: null }); }} className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><Icon name="x" className="h-4 w-4" /></button>}
        </div>
        <div className="hidden md:flex items-center gap-2">{filterControls}</div>
        <button type="button" className="btn md:hidden" aria-expanded={filters} onClick={() => setFilters(!filters)}>Filters{filtersOn ? ` (${filtersOn})` : ""}<Icon name="chevron-down" className={`h-4 w-4 transition-transform ${filters ? "rotate-180" : ""}`} /></button>
        {(filtersOn > 0 || qParam) && <button type="button" className="text-sm text-blue-700 hover:underline" onClick={clearAll}>Clear all</button>}
      </div>
      {filters && <div className="md:hidden grid gap-2">{filterControls}</div>}

      <div role="tablist" aria-label="Employee lists" className="flex border-b border-slate-200 overflow-x-auto">
        {PILES.map((p) => <button key={p.key} role="tab" aria-selected={pile === p.key} className={`tab ${pile === p.key ? "tab-on" : ""}`} onClick={() => { setParams({ pile: p.key === "process" ? null : p.key, stage: null }); setSel([]); }}>{p.label} <span className="text-slate-500 font-normal">({pileCount(p.key)})</span></button>)}
      </div>
      {pile === "process" && <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap" aria-label="Filter by stage">
        <button className={`chip ${!stage ? "chip-on" : ""}`} onClick={() => setParams({ stage: null })}>All stages</button>
        {STAGES.filter((s) => s.key !== "onboarded").map((s) => <button key={s.key} className={`chip ${stage === s.key ? "chip-on" : ""}`} aria-pressed={stage === s.key} onClick={() => setParams({ stage: stage === s.key ? null : s.key })}>{s.label} <span className="text-slate-500">{stageCount(s.key)}</span></button>)}
      </div>}

      {err && <div className="warn !text-sm flex flex-wrap items-center gap-3"><span>Couldn't load the list: {err}</span><button className="btn btn-sm" onClick={load}>Try again</button></div>}
      {live.length > 0 && <div className="card !py-2 !px-3 flex flex-wrap items-center gap-2 text-sm sticky top-14 z-10 border-blue-200 bg-blue-50/60">
        <b>{live.length} selected</b>{hidden > 0 && <span className="text-xs text-slate-500">({hidden} hidden by filters)</span>}
        {pile === "process" && <select className="inp !w-auto" aria-label="Move selected to stage" disabled={busy} value="" onChange={(e) => moveStage(e.target.value)}><option value="">Move to stage…</option>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>}
        {pile !== "rejected" && projects.length > 0 && <select className="inp !w-auto" aria-label="Assign selected to project" disabled={busy} value="" onChange={(e) => assignProject(e.target.value)}><option value="">Assign to project…</option>{projects.filter((p) => p.status === "active").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <a className="btn btn-sm" href={`/api/export/excel?ids=${live.join(",")}`}>Export</a>
        <button className="btn btn-sm ml-auto" onClick={() => setSel([])}>Clear selection</button>
      </div>}
      {msg && <p role="status" className="text-sm text-slate-600">{msg}</p>}

      {!loading && !err && <p className="text-xs text-slate-500" aria-live="polite">Showing {shown.length} of {rows.filter((r) => pileOfRow(r) === pile).length}</p>}
      <EmployeeCards rows={shown} pile={pile} sel={sel} setSel={setSel} docs={docs} loading={loading} empty={empty} emptyAction={emptyAction} />
      <EmployeeTable rows={shown} pile={pile} sel={sel} setSel={setSel} docs={docs} loading={loading} empty={empty} emptyAction={emptyAction} sort={sort} dir={dir} onSort={onSort} />
    </div>
  );
}
