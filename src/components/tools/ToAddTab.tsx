"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import ToolsLink from "@/components/inventory/ToolsLink";
import type { InvBill, InvItem } from "@/lib/inventory";

// Inventory → To add: what was bought (recorded Purchases bills at a site) and is not in stock yet, so new purchases are put into stock rather than forgotten.
// Each bill opens the usual "add to stock" matching (ToolsLink). A line that is not stock (used at once, a service) is marked so and leaves the list
// (2026-11-purchases-credit.sql). Gas and rented items are never stock. Admin and Operations only.
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function ToAddTab({ site, sites, canAct }: { site: string; sites: { id: string; name: string }[]; canAct: boolean }) {
  const [bills, setBills] = useState<InvBill[] | null>(null); const [items, setItems] = useState<InvItem[]>([]); const [linked, setLinked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null); const [err, setErr] = useState(""); const [noSkip, setNoSkip] = useState(false);

  const load = useCallback(async () => {
    const sb = supabase(); setErr("");
    let q = sb.from("inventory_bills").select("*").eq("status", "recorded").is("voided_at", null).in("kind", ["bill", "no_bill"]).order("bill_date", { ascending: false }).limit(300);
    if (site !== "all") q = q.eq("project_id", site);
    const { data: bs, error } = await q; if (error) { setErr(error.message); setBills([]); return; }
    const list = (bs ?? []) as InvBill[]; const ids = list.map((b) => b.id);
    if (!ids.length) { setBills([]); setItems([]); setLinked(new Set()); return; }
    const all: InvItem[] = []; for (let i = 0; i < ids.length; i += 100) { const r = await sb.from("inventory_bill_items").select("*").in("bill_id", ids.slice(i, i + 100)).order("line_no"); if (r.error) { setErr(r.error.message); return; } all.push(...((r.data ?? []) as InvItem[])); }
    const lk = new Set<string>(); for (let i = 0; i < all.length; i += 200) { const r = await sb.from("tool_moves").select("bill_item_id").in("bill_item_id", all.slice(i, i + 200).map((x) => x.id)).is("voided_at", null); ((r.data ?? []) as { bill_item_id: string }[]).forEach((x) => lk.add(x.bill_item_id)); }
    setNoSkip(all.length > 0 && !("stock_skip" in all[0]));
    setBills(list); setItems(all); setLinked(lk);
  }, [site]);
  useEffect(() => { setBills(null); void load(); }, [load]);

  async function skip(i: InvItem, on: boolean) {
    const { error } = await supabase().rpc("inventory_item_stock_skip", { p_item: i.id, p_skip: on }); if (error) { setErr(error.message); return; }
    setItems((xs) => xs.map((x) => (x.id === i.id ? { ...x, stock_skip: on } : x)));
  }

  if (!bills) return <div className="card"><div className="skeleton h-24 w-full" /></div>;
  const openLines = (bid: string) => items.filter((i) => i.bill_id === bid && !linked.has(i.id) && !i.stock_skip);
  const waiting = bills.filter((b) => openLines(b.id).length > 0); const lineCount = waiting.reduce((t, b) => t + openLines(b.id).length, 0);
  const skipped = items.filter((i) => i.stock_skip && !linked.has(i.id));
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "";

  return (
    <div className="space-y-3">
      {err && <p className="warn" role="alert">{err}</p>}
      <p className="text-sm text-slate-600">{waiting.length ? <><b>{lineCount}</b> line{lineCount === 1 ? "" : "s"} on <b>{waiting.length}</b> purchase bill{waiting.length === 1 ? "" : "s"} are not in stock yet. Add them, or mark what is not stock (used at once, a service).</> : "Everything bought is in stock or marked as not stock."}</p>
      {noSkip && <p className="text-xs text-amber-700">Marking lines as not stock needs the 2026-11-purchases-credit.sql migration.</p>}
      {waiting.map((b) => { const ls = openLines(b.id); return <div key={b.id} className="card !p-0">
        <button type="button" className="w-full text-left p-3 flex flex-wrap items-center gap-x-3 gap-y-1" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
          <b className="min-w-0">{b.vendor_name || (b.kind === "no_bill" ? "Entry without a bill" : "Bill")}</b><span className="text-sm text-slate-500">{b.bill_no ? `bill ${b.bill_no} · ` : ""}{dmy(b.bill_date)}{site === "all" ? ` · ${siteName(b.project_id)}` : ""}</span>
          <span className="ml-auto text-sm text-slate-600">{ls.length} to add</span>
        </button>
        {open === b.id ? <div className="border-t border-slate-100 p-3 space-y-3">
          {canAct && !noSkip && <div className="flex flex-wrap gap-1.5">{ls.map((i) => <span key={i.id} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs">{i.name} · {Number(i.qty)} {i.unit}<button className="tlink" onClick={() => skip(i, true)}>Not stock</button></span>)}</div>}
          {canAct ? <ToolsLink bill={b} items={items.filter((i) => i.bill_id === b.id && !i.stock_skip)} /> : <ul className="text-sm">{ls.map((i) => <li key={i.id}>{i.name} · {Number(i.qty)} {i.unit}</li>)}</ul>}
          <a className="text-xs text-blue-700 hover:underline" href={`/inventory?project=${b.project_id}&bill=${b.id}`}>Open the bill in Purchases</a>
        </div> : <div className="px-3 pb-3 -mt-1 text-xs text-slate-500 truncate">{ls.map((i) => i.name).join(" · ")}</div>}
      </div>; })}
      {skipped.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-slate-600">Marked as not stock ({skipped.length})</summary>
        <ul className="mt-2 space-y-1">{skipped.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-2"><span>{i.name} · {Number(i.qty)} {i.unit}</span>{canAct && <button className="tlink" onClick={() => skip(i, false)}>Put back on the list</button>}</li>)}</ul></details>}
    </div>
  );
}
