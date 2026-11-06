"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRole } from "@/lib/roles";
import { keepProject, rememberedProject } from "@/lib/lastProject";
import { inr, JSL_LABEL, stockFrom, type InvBill, type InvItem } from "@/lib/inventory";
import BillEditor from "@/components/inventory/BillEditor";

type Project = { id: string; name: string; status: string };
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const pill = "text-[11px] rounded-full px-2 py-0.5";

// Inventory: purchase bills, entered item by item. Each bill posts its total to the project's expenses when it is recorded, and becomes one MRR on the JSL portal once an Admin authorizes it.
// The Received tab adds up what has come in. It does not yet take off what was issued or used (see "Inventory tracker" in to-do.md).
export default function Inventory() {
  const { role, viewer } = useRole(); const canEnter = !!role && role !== "none" && !viewer;
  const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState(""); const [loaded, setLoaded] = useState(false);
  const [bills, setBills] = useState<InvBill[]>([]); const [items, setItems] = useState<InvItem[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [tab, setTab] = useState<"bills" | "received">("bills"); const [openId, setOpenId] = useState<string | "new" | null>(null); const [q, setQ] = useState(""); const [showVoid, setShowVoid] = useState(false);

  useEffect(() => { (async () => {
    const { data, error } = await supabase().from("projects").select("id, name, status").order("status").order("name");
    if (error) setErr(error.message);
    const list = (data ?? []) as Project[]; setProjects(list); setPid(rememberedProject(list) || list[0]?.id || ""); setLoaded(true);
  })(); }, []);

  const load = useCallback(async () => {
    if (!pid) return; setBusy(true); setErr("");
    const sb = supabase();
    const b = await sb.from("inventory_bills").select("*").eq("project_id", pid).order("bill_date", { ascending: false }).order("created_at", { ascending: false });
    if (b.error) { setErr(b.error.code === "42P01" ? "The inventory tables are not in the database yet: run 2026-11-inventory.sql." : b.error.message); setBusy(false); return; }
    const list = (b.data ?? []) as InvBill[]; const all: InvItem[] = [];
    // a few bills at a time, and in pages: the API returns at most 1,000 rows per call
    for (let i = 0; i < list.length; i += 100) {
      const ids = list.slice(i, i + 100).map((x) => x.id);
      for (let from = 0; ; from += 1000) {
        const r = await sb.from("inventory_bill_items").select("*").in("bill_id", ids).order("line_no").range(from, from + 999);
        if (r.error) { setErr(r.error.message); setBusy(false); return; }
        all.push(...((r.data ?? []) as InvItem[])); if ((r.data ?? []).length < 1000) break;
      }
    }
    setBills(list); setItems(all); setBusy(false);
  }, [pid]);
  useEffect(() => { void load(); }, [load]);

  const countOf = useMemo(() => { const m = new Map<string, number>(); for (const i of items) m.set(i.bill_id, (m.get(i.bill_id) ?? 0) + 1); return m; }, [items]);
  const live = bills.filter((b) => !b.voided_at); const voided = bills.length - live.length;
  const shown = (showVoid ? bills : live).filter((b) => !q.trim() || `${b.vendor_name} ${b.bill_no}`.toLowerCase().includes(q.trim().toLowerCase()));
  const recorded = useMemo(() => new Set(live.filter((b) => b.status === "recorded").map((b) => b.id)), [live]);
  const stock = useMemo(() => stockFrom(items, recorded).filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase())), [items, recorded, q]);
  const openBill = openId && openId !== "new" ? bills.find((b) => b.id === openId) ?? null : null;
  const seg = (active: boolean) => `tab whitespace-nowrap ${active ? "tab-on" : ""}`;

  if (openId && pid) return <div className="space-y-4 mob"><BillEditor key={openId} projectId={pid} bill={openBill} items={items.filter((i) => openBill && i.bill_id === openBill.id)} pastBills={bills} pastItems={items} onClose={() => setOpenId(null)} onChanged={load} onCreated={(id) => setOpenId(id)} /></div>;

  return (
    <div className="space-y-4 mob">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Inventory</h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => { setPid(e.target.value); keepProject(e.target.value); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {canEnter && pid && <button className="btn btn-primary w-full sm:w-auto justify-center" onClick={() => setOpenId("new")}>+ New bill</button>}</div>
      <div role="tablist" className="flex border-b border-slate-200">{([["bills", `Bills (${live.length})`], ["received", "Received"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={seg(tab === k)} onClick={() => setTab(k)}>{l}</button>)}</div>
      {err && <p className="warn" role="alert">{err}</p>}
      {(!loaded || busy) && <p className="text-slate-500">Loading…</p>}
      {loaded && !projects.length && !err && <p className="text-slate-500">No projects{canEnter && !["admin", "staff"].includes(role ?? "") ? " assigned to you" : ""}.</p>}
      {(bills.length > 0) && <input className="inp" type="search" aria-label="Search" placeholder={tab === "bills" ? "Search vendor or bill number" : "Search items"} value={q} onChange={(e) => setQ(e.target.value)} />}

      {pid && tab === "bills" && <div className="space-y-2">
        {!busy && !err && !bills.length && <p className="text-sm text-slate-500">No bills on this project yet.{canEnter ? " Tap New bill and keep the bill in your hand." : ""}</p>}
        {!busy && bills.length > 0 && !shown.length && <p className="text-sm text-slate-500">Nothing matches.</p>}
        {shown.map((b) => { const j = JSL_LABEL[b.jsl_status]; return (
          <button key={b.id} className={`card !p-3 w-full text-left block hover:border-blue-300 ${b.voided_at ? "opacity-60" : ""}`} onClick={() => setOpenId(b.id)}>
            <div className="flex flex-wrap items-baseline gap-x-2"><b className={b.voided_at ? "line-through" : ""}>{b.vendor_name}</b><span className="text-sm text-slate-500">bill {b.bill_no}</span><b className="tabular-nums ml-auto">₹{inr(Number(b.bill_total))}</b></div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5"><span className="text-xs text-slate-500 mr-1">{dmy(b.bill_date)} · {countOf.get(b.id) ?? 0} item{countOf.get(b.id) === 1 ? "" : "s"}</span>
              {b.voided_at ? <span className={`${pill} bg-slate-100 text-slate-600`}>Void</span> : b.status === "draft" ? <span className={`${pill} bg-amber-50 text-amber-800`}>Draft</span> : <><span className={`${pill} bg-green-50 text-green-800`}>In expenses</span><span className={`${pill} ${j.cls}`}>{j.text}</span></>}</div>
          </button>); })}
        {voided > 0 && <button className="tlink" onClick={() => setShowVoid(!showVoid)}>{showVoid ? "Hide" : "Show"} {voided} void bill{voided === 1 ? "" : "s"}</button>}
      </div>}

      {pid && tab === "received" && <div className="card !p-3 space-y-2">
        <p className="text-xs text-slate-500">Everything received on recorded bills. Issues and returns are not taken off yet.</p>
        {!stock.length ? <p className="text-sm text-slate-500">Nothing received yet.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500 border-b"><tr><th className="py-2 pr-3">Item</th><th className="pr-3 text-right">Received</th><th className="pr-3 text-right">Rate</th><th className="text-right">Bills</th></tr></thead>
          <tbody>{stock.map((s) => <tr key={s.key} className="border-b border-slate-100"><td className="py-2 pr-3">{s.name}</td><td className="pr-3 text-right whitespace-nowrap tabular-nums">{s.qty.toLocaleString("en-IN", { maximumFractionDigits: 3 })} {s.unit}</td><td className="pr-3 text-right whitespace-nowrap tabular-nums">₹{inr(s.minRate)}{s.maxRate !== s.minRate ? ` to ₹${inr(s.maxRate)}` : ""}</td><td className="text-right tabular-nums">{s.bills}</td></tr>)}</tbody></table></div>}
      </div>}
    </div>
  );
}
