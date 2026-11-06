"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRole } from "@/lib/roles";
import { keepProject, rememberedProject } from "@/lib/lastProject";
import { inr, JSL_LABEL, stageOf, stockFrom, type InvBill, type InvItem } from "@/lib/inventory";
import BillEditor from "@/components/inventory/BillEditor";
import CsvImport from "@/components/inventory/CsvImport";

type Project = { id: string; name: string; status: string };
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const pill = "text-[11px] rounded-full px-2 py-0.5";

// Inventory: purchase bills, entered item by item. Each bill posts its total to the project's expenses when it is recorded, and becomes one MRR on the JSL portal once an Admin authorizes it.
// The Received tab adds up what has come in. It does not yet take off what was issued or used (see "Inventory tracker" in to-do.md).
export default function Inventory() {
  const { role, viewer, admin } = useRole(); const canEnter = !!role && role !== "none" && !viewer;
  const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState(""); const [loaded, setLoaded] = useState(false);
  const [bills, setBills] = useState<InvBill[]>([]); const [items, setItems] = useState<InvItem[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  // approval: true once 2026-11-inventory-approval.sql has been run. Until then the page works as it did before it: no submit or review buttons, nothing sent that the database would not understand.
  const [tab, setTab] = useState<"bills" | "received">("bills"); const [openId, setOpenId] = useState<string | "new" | null>(null); const [newKind, setNewKind] = useState<"bill" | "no_bill">("bill"); const [chip, setChip] = useState<"all" | "submitted" | "returned" | "draft" | "recorded">("all"); const [q, setQ] = useState(""); const [showVoid, setShowVoid] = useState(false); const [approval, setApproval] = useState(false); const [importing, setImporting] = useState(false);

  useEffect(() => { (async () => {
    const { data, error } = await supabase().from("projects").select("id, name, status").order("status").order("name");
    if (error) setErr(error.message);
    const list = (data ?? []) as Project[]; setProjects(list); setPid(rememberedProject(list) || list[0]?.id || ""); setLoaded(true);
  })(); }, []);

  const load = useCallback(async () => {
    if (!pid) return; setBusy(true); setErr("");
    const sb = supabase();
    const probe = await sb.from("inventory_review_notes").select("id").limit(1); setApproval(!probe.error);   // the table only exists once the approval migration has run
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
  const inStage = (b: InvBill, k: typeof chip) => k === "all" || (k === "submitted" ? b.status === "submitted" : k === "returned" ? b.status === "returned" : k === "draft" ? b.status === "draft" : b.status === "recorded");
  const shown = (showVoid ? bills : live).filter((b) => (showVoid || inStage(b, chip)) && (!q.trim() || `${b.vendor_name} ${b.bill_no} ${b.note}`.toLowerCase().includes(q.trim().toLowerCase())));
  const recorded = useMemo(() => new Set(live.filter((b) => b.status === "recorded").map((b) => b.id)), [live]);
  const stock = useMemo(() => stockFrom(items, recorded).filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase())), [items, recorded, q]);
  const openBill = openId && openId !== "new" ? bills.find((b) => b.id === openId) ?? null : null;
  const titleOf = (b: InvBill) => (b.kind === "no_bill" ? (b.vendor_name ? `No bill · ${b.vendor_name}` : "Entry without a bill") : b.vendor_name);
  const subOf = (b: InvBill) => (b.kind === "no_bill" ? (b.note.length > 48 ? `${b.note.slice(0, 48)}…` : b.note) : `bill ${b.bill_no}`);
  const amountOf = (b: InvBill) => (b.kind === "no_bill" && !(Number(b.bill_total) > 0) ? "—" : `₹${inr(Number(b.bill_total))}`);
  const pillsOf = (b: InvBill) => {
    const sg = stageOf(b); const j = JSL_LABEL[b.jsl_status]; const recd = b.status === "recorded" && !b.voided_at;
    return <><span className={`${pill} ${sg.cls}`}>{recd && b.kind === "no_bill" && !(Number(b.bill_total) > 0) ? "Received" : sg.text}</span>{recd && b.jsl_wanted && <span className={`${pill} ${b.jsl_status === "none" ? "bg-blue-50 text-blue-800" : j.cls}`}>{b.jsl_status === "none" ? "For the JSL portal" : j.text}</span>}</>;
  };
  const inExp = live.filter((b) => b.status === "recorded"); const spent = inExp.reduce((t, b) => t + Number(b.bill_total), 0);
  const waiting = live.filter((b) => b.status === "submitted").length; const open = live.filter((b) => b.status === "draft" || b.status === "returned").length;
  const stats: [string, string, string][] = [["In expenses", `₹${inr(spent)}`, `${inExp.length} entr${inExp.length === 1 ? "y" : "ies"} approved`], ...(approval ? [["Waiting for review", String(waiting), "to approve or send back"], ["Drafts and sent back", String(open), "still being entered"]] as [string, string, string][] : [["Drafts", String(open), "not recorded yet"]] as [string, string, string][]), ...(live.some((b) => b.jsl_wanted) ? [["Waiting to go to JSL", String(inExp.filter((b) => b.jsl_wanted && ["none", "authorized", "failed"].includes(b.jsl_status)).length), "switched on, not sent yet"], ["On the JSL portal", String(inExp.filter((b) => b.jsl_status === "submitted").length), "submitted"]] as [string, string, string][] : [])];
  const cols = "md:grid md:grid-cols-[minmax(0,1fr)_110px_56px_240px_120px] md:items-center md:gap-4";
  const seg = (active: boolean) => `tab whitespace-nowrap ${active ? "tab-on" : ""}`;

  if (openId && pid) return <div className="space-y-4 mob"><BillEditor key={openId} projectId={pid} bill={openBill} newKind={newKind} approval={approval} items={items.filter((i) => openBill && i.bill_id === openBill.id)} pastBills={bills} pastItems={items} onClose={() => setOpenId(null)} onChanged={load} onCreated={(id) => setOpenId(id)} /></div>;

  return (
    <div className="space-y-4 mob">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Inventory</h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => { setPid(e.target.value); keepProject(e.target.value); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {admin && pid && <button className="btn w-full sm:w-auto justify-center" onClick={() => setImporting(!importing)}>Import CSV</button>}
        {canEnter && pid && approval && <button className="btn w-full sm:w-auto justify-center" onClick={() => { setNewKind("no_bill"); setOpenId("new"); }}>+ Entry without a bill</button>}
        {canEnter && pid && <button className="btn btn-primary w-full sm:w-auto justify-center" onClick={() => { setNewKind("bill"); setOpenId("new"); }}>+ New bill</button>}</div>
      {importing && admin && pid && <CsvImport projectId={pid} onClose={() => setImporting(false)} onChanged={load} onCreated={(id) => { setImporting(false); setOpenId(id); }} />}
      <div className="space-y-4 md:space-y-0 md:flex md:items-end md:gap-4">
      <div role="tablist" className="flex border-b border-slate-200 md:flex-1">{([["bills", `Bills (${live.length})`], ["received", "Received"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={seg(tab === k)} onClick={() => setTab(k)}>{l}</button>)}</div>
      {(bills.length > 0) && <input className="inp md:!w-72" type="search" aria-label="Search" placeholder={tab === "bills" ? "Search vendor or bill number" : "Search items"} value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
      {err && <p className="warn" role="alert">{err}</p>}
      {(!loaded || busy) && <p className="text-slate-500">Loading…</p>}
      {loaded && !projects.length && !err && <p className="text-slate-500">No projects{canEnter && !["admin", "staff"].includes(role ?? "") ? " assigned to you" : ""}.</p>}

      {pid && tab === "bills" && live.length > 0 && <div className="flex flex-wrap gap-2" role="group" aria-label="Show">{([["all", "All", live.length], ["submitted", "Waiting for review", waiting], ["returned", "Sent back", live.filter((b) => b.status === "returned").length], ["draft", "Drafts", live.filter((b) => b.status === "draft").length], ["recorded", "Approved", inExp.length]] as const).filter(([k, , n]) => k === "all" || n > 0 || chip === k).map(([k, l, n]) => <button key={k} className={`text-sm rounded-full border px-3 py-1 ${chip === k ? "bg-[#1e4fa3] border-[#1e4fa3] text-white" : "bg-white border-slate-300 text-slate-700"}`} aria-pressed={chip === k} onClick={() => setChip(k)}>{l} ({n})</button>)}</div>}

      {pid && tab === "bills" && live.length > 0 && <div className={`hidden md:grid gap-3 ${stats.length >= 5 ? "grid-cols-5" : stats.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>{stats.map(([l, v, sub]) => <div key={l} className="card !p-3"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold tabular-nums">{v}</div><div className="text-xs text-slate-400">{sub}</div></div>)}</div>}

      {pid && tab === "bills" && <div className="space-y-2">
        {shown.length > 0 && <div className={`hidden ${cols} px-3 text-xs text-slate-500`}><span>Vendor and bill</span><span>Date</span><span className="text-right">Items</span><span>Status</span><span className="text-right">Amount</span></div>}
        {!busy && !err && !bills.length && <p className="text-sm text-slate-500">No bills on this project yet.{canEnter ? " Tap New bill and keep the bill in your hand." : ""}</p>}
        {!busy && bills.length > 0 && !shown.length && <p className="text-sm text-slate-500">Nothing matches.</p>}
        {shown.map((b) => (
          <button key={b.id} className={`card !p-3 w-full text-left block hover:border-blue-300 ${b.voided_at ? "opacity-60" : ""}`} onClick={() => setOpenId(b.id)}>
            <div className="md:hidden">
              <div className="flex flex-wrap items-baseline gap-x-2"><b className={b.voided_at ? "line-through" : ""}>{titleOf(b)}</b><span className="text-sm text-slate-500">{subOf(b)}</span><b className="tabular-nums ml-auto">{amountOf(b)}</b></div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5"><span className="text-xs text-slate-500 mr-1">{dmy(b.bill_date)} · {countOf.get(b.id) ?? 0} item{countOf.get(b.id) === 1 ? "" : "s"}</span>{pillsOf(b)}</div>
            </div>
            <div className={`hidden ${cols}`}>
              <div className="min-w-0 truncate"><b className={b.voided_at ? "line-through" : ""}>{titleOf(b)}</b> <span className="text-sm text-slate-500">{subOf(b)}</span></div>
              <span className="text-sm text-slate-600">{dmy(b.bill_date)}</span>
              <span className="text-sm text-slate-600 text-right tabular-nums">{countOf.get(b.id) ?? 0}</span>
              <div className="flex flex-wrap items-center gap-1.5">{pillsOf(b)}</div>
              <b className="tabular-nums text-right">{amountOf(b)}</b>
            </div>
          </button>))}
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
