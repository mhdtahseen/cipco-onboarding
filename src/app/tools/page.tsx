"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRole } from "@/lib/roles";
import { PageLoader } from "@/components/Loader";
import { stockIndex, type StockRow, type ToolItem, type Transfer } from "@/lib/tools";
import StockTab from "@/components/tools/StockTab";
import TransfersTab from "@/components/tools/TransfersTab";
import ItemsTab from "@/components/tools/ItemsTab";

type Site = { id: string; name: string; status: string };
type Tab = "stock" | "transfers" | "items";
const SITE_KEY = "cipco_tools_site";

// Tools & equipment: what the company owns (the container list, and later purchases) and where it is. Stock is the sum of recorded movements per site
// (2026-11-tools-register.sql): opening stock, used up, damaged, repaired, lost, recounts, and two-step transfers between sites. Admin and Operations make changes; the Viewer can look.
export default function ToolsPage() {
  const { role, staff } = useRole(); const canAct = staff && role !== "viewer";
  const [sites, setSites] = useState<Site[]>([]); const [items, setItems] = useState<ToolItem[]>([]); const [stock, setStock] = useState<StockRow[]>([]); const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [names, setNames] = useState<Record<string, string>>({}); const [loading, setLoading] = useState(true); const [missing, setMissing] = useState(false); const [err, setErr] = useState("");
  const [site, setSite0] = useState(""); const [tab, setTab] = useState<Tab>("stock");
  const setSite = (s: string) => { setSite0(s); try { localStorage.setItem(SITE_KEY, s); } catch { /* storage unavailable */ } };

  const load = useCallback(async () => {
    const sb = supabase();
    const [p, i, s, t, u] = await Promise.all([
      sb.from("projects").select("id, name, status").order("name"),
      sb.from("tool_items").select("*").order("sort_order").order("name"),
      sb.from("tool_stock").select("*"),
      sb.from("tool_transfers").select("*, tool_transfer_lines(*)").order("created_at", { ascending: false }).limit(200),
      sb.from("user_profiles").select("user_id, full_name"),
    ]);
    if (i.error) { setMissing(/tool_items|schema cache|does not exist/i.test(i.error.message)); setErr(i.error.message); setLoading(false); return; }
    const ps = (p.data || []) as Site[]; setSites(ps); setItems((i.data || []) as ToolItem[]);
    setStock(((s.data || []) as StockRow[]).map((r) => ({ ...r, ok: Number(r.ok), damaged: Number(r.damaged) })));
    setTransfers(((t.data || []) as Transfer[]).map((x) => ({ ...x, tool_transfer_lines: x.tool_transfer_lines.map((l) => ({ ...l, qty: Number(l.qty), qty_received: l.qty_received == null ? null : Number(l.qty_received) })) })));
    setNames(Object.fromEntries(((u.data || []) as { user_id: string; full_name: string }[]).filter((x) => x.full_name).map((x) => [x.user_id, x.full_name])));
    setErr(""); setMissing(false); setLoading(false);
    // the site last looked at, else the one with the most recorded stock (CSL to start with)
    setSite0((cur) => { if (cur) return cur; let saved = ""; try { saved = localStorage.getItem(SITE_KEY) || ""; } catch { /* storage unavailable */ }
      if (saved === "all" || ps.some((x) => x.id === saved)) return saved; const rows = (s.data || []) as StockRow[];
      const best = ps.map((x) => ({ id: x.id, n: rows.filter((r) => r.project_id === x.id).length })).sort((a, b) => b.n - a.n)[0]; return best?.n ? best.id : ps.find((x) => x.status === "active")?.id ?? "all"; });
  }, []);
  useEffect(() => { load(); }, [load]);

  const at = useMemo(() => stockIndex(stock), [stock]);
  // sites to show: active ones, plus any closed one that still holds something or has a transfer
  const shownSites = useMemo(() => sites.filter((s) => s.status !== "closed" || stock.some((r) => r.project_id === s.id && Number(r.ok) + Number(r.damaged) > 0)), [sites, stock]);
  const inTransit = transfers.filter((t) => t.status === "in_transit").length;

  if (loading) return <PageLoader />;
  return (
    <div className="space-y-4" data-tools-page>
      <div className="flex flex-wrap items-center gap-2">
        <div className="sm:mr-auto"><h1 className="text-xl font-bold">Tools &amp; equipment</h1><p className="text-sm text-slate-500">What the company owns, and which site it is at</p></div>
        {!missing && <select className="inp !w-auto" aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)}><option value="all">All sites</option>{shownSites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === "closed" ? " (closed)" : ""}</option>)}</select>}
      </div>
      {missing ? <div className="card space-y-1 text-sm"><p className="font-medium">Not switched on yet.</p><p className="text-slate-600">Run <code>2026-11-tools-register.sql</code> in the Supabase SQL editor, then <code>supabase/seed/tools-opening-csl.sql</code> to load the container list at CSL.</p></div>
        : err ? <p className="warn !text-sm">Couldn&apos;t load: {err}</p> : <>
        <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">
          {([["stock", "Stock"], ["transfers", "Transfers"], ["items", "Catalogue"]] as [Tab, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{l}{k === "transfers" && inTransit > 0 && <span className="ml-1.5 text-xs font-normal text-amber-700">{inTransit} in transit</span>}{k === "items" && <span className="ml-1.5 text-xs font-normal text-slate-500">{items.length}</span>}</button>)}
        </div>
        {tab === "stock" && <StockTab items={items} at={at} sites={shownSites} site={site} canAct={canAct} names={names} reload={load} />}
        {tab === "transfers" && <TransfersTab items={items} at={at} sites={shownSites} site={site} transfers={transfers} canAct={canAct} names={names} reload={load} />}
        {tab === "items" && <ItemsTab items={items} canAct={canAct} reload={load} />}
      </>}
    </div>
  );
}
