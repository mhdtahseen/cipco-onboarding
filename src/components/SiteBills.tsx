"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { paidByBill } from "@/lib/siteBillsPaid";

export type Computed = { amount: number; lines: string[]; warn?: string };
type Kind = "gas" | "equipment";
/** One stretch of machine work, priced (with GST) for Operations / Admin. amount is null when the machine has no rate for that day. */
export type Stretch = { id: string; vendor_id: string; date: string; label: string; amount: number | null; bill_id: string | null };
/** compute: what the site records come to between two dates (gas; rented items). stretches: machine work, which a bill claims one by one instead of by dates. */
export type BillSource = { kind: Kind; label: string; vendors: { id: string; name: string }[]; compute: (vendorId: string, from: string, to: string) => Computed; stretches?: Stretch[] };
type Bill = { id: string; kind: Kind; vendor_id: string; bill_no: string; no_bill?: boolean; bill_date: string; period_from: string; period_to: string; bill_amount: number; status: "received" | "approved"; approved_amount: number | null; computed_amount: number | null; note: string; bill_path: string | null; voided_at: string | null };
type Pay = { id: string; kind: Kind; vendor_id: string; site_bill_id?: string | null; paid_on: string; amount: number; reference: string; note: string; voided_at: string | null };
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// Vendor bills and payments for gas and hired equipment on one project, for Operations / Admin.
//  - Gas and rented items: a bill covers dates, and shows what the site records come to for them.
//  - Cranes and other machines: a bill claims the stretches of work it covers (2026-11-equipment-claims.sql), so the same work is never billed twice.
//    When the vendor sends no bill, "No bill" makes a statement from the stretches, approved at once.
//  - Each approved bill shows what is paid on it and has a Pay button; a payment without a bill is an advance. Only approved bills count in Payments due.
export default function SiteBills({ projectId, sources, onChange }: { projectId: string; sources: BillSource[]; onChange?: () => void }) {
  const vendors = sources.flatMap((x) => x.vendors); const kindOf = (vid: string) => sources.find((x) => x.vendors.some((v) => v.id === vid))?.kind ?? null;
  const labelOf = (k: Kind) => sources.find((x) => x.kind === k)?.label ?? k; const [show, setShow] = useState<"all" | Kind>("all");
  const vendorOptions = <><option value="">Choose…</option>{sources.map((x) => x.vendors.length > 0 && <optgroup key={x.kind} label={x.label}>{x.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup>)}</>;
  const today = istToday(); const [bills, setBills] = useState<Bill[]>([]); const [pays, setPays] = useState<Pay[]>([]); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [bf, setBf] = useState({ vendor_id: "", bill_no: "", bill_date: today, from: today.slice(0, 7) + "-01", to: today, amount: "", note: "", noBill: false }); const [file, setFile] = useState<File | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pf, setPf] = useState({ vendor_id: "", amount: "", paid_on: today, reference: "", note: "", bill_id: "" });
  const [claimEdit, setClaimEdit] = useState<{ bill: string; ids: Set<string> } | null>(null);
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };
  const vName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "?";

  // machine work by vendor
  const stretches = useMemo(() => sources.flatMap((x) => x.stretches ?? []), [sources]);
  const byStretch = (vid: string) => stretches.filter((s) => s.vendor_id === vid);
  const usesStretches = (vid: string) => kindOf(vid) === "equipment" && byStretch(vid).length > 0;
  const unbilled = (vid: string) => byStretch(vid).filter((s) => !s.bill_id);
  const sum = (ss: Stretch[]) => r2(ss.reduce((t, s) => t + (s.amount ?? 0), 0));
  const sLine = (s: Stretch) => `${dmy(s.date)} · ${s.label} → ${s.amount === null ? "no rate" : `₹${inr(s.amount)}`}`;

  async function load() {
    if (!projectId) return; const sb = supabase();
    const [b, p] = await Promise.all([sb.from("site_bills").select("*").eq("project_id", projectId).order("bill_date", { ascending: false }), sb.from("site_payments").select("*").eq("project_id", projectId).order("paid_on", { ascending: false })]);
    const x = b.error || p.error; if (x) { setErr(x.message + (/site_|schema cache|does not exist/i.test(x.message) ? ": run the 2026-11-consumables.sql migration first." : "")); return; }
    setBills(((b.data || []) as Bill[]).map((q) => ({ ...q, bill_amount: Number(q.bill_amount), approved_amount: q.approved_amount === null ? null : Number(q.approved_amount), computed_amount: q.computed_amount === null ? null : Number(q.computed_amount) }))); setPays(((p.data || []) as Pay[]).map((q) => ({ ...q, amount: Number(q.amount) }))); setErr("");
  }
  useEffect(() => { load(); }, [projectId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const changed = async () => { await load(); onChange?.(); };

  /** What the site records come to for a bill: its stretches (machines), plus anything dated (gas, rented items) inside its dates. */
  function recordsFor(b: Pick<Bill, "id" | "kind" | "vendor_id" | "period_from" | "period_to">): Computed {
    const dated = sources.find((x) => x.kind === b.kind)?.compute(b.vendor_id, b.period_from, b.period_to) ?? { amount: 0, lines: [] };
    if (b.kind !== "equipment") return dated;
    const mine = stretches.filter((s) => s.bill_id === b.id); const noRate = mine.filter((s) => s.amount === null).length;
    return { amount: r2(sum(mine) + dated.amount), lines: [...mine.map(sLine), ...dated.lines], warn: [noRate ? `${noRate} stretch${noRate === 1 ? " has" : "es have"} no rate, so ${noRate === 1 ? "it counts" : "they count"} as ₹0` : "", dated.warn ?? ""].filter(Boolean).join(" · ") };
  }
  const paidMap = useMemo(() => paidByBill(bills, pays), [bills, pays]);
  const paidOn = (billId: string) => paidMap.get(billId) ?? 0;

  // ---------- recording a bill (or a statement when there is none) ----------
  const pickVendor = (vid: string) => { setBf({ ...bf, vendor_id: vid, noBill: false }); setPicked(new Set(usesStretches(vid) ? unbilled(vid).map((s) => s.id) : [])); };
  const pickedList = byStretch(bf.vendor_id).filter((s) => picked.has(s.id));
  const stretchMode = !!bf.vendor_id && usesStretches(bf.vendor_id);
  async function addBill() {
    if (!bf.vendor_id) { setErr("Choose the vendor."); return; }
    const kind = kindOf(bf.vendor_id)!; const pickedTotal = sum(pickedList);
    const amount = bf.noBill ? pickedTotal : parseFloat(bf.amount);
    if (bf.noBill && !pickedList.length) { setErr("Tick the stretches this statement covers."); return; }
    if (!bf.noBill && (!(amount >= 0) || bf.amount === "")) { setErr("Enter the amount on the bill."); return; }
    const dates = pickedList.map((s) => s.date).sort();
    const from = stretchMode ? dates[0] ?? bf.bill_date : bf.from, to = stretchMode ? dates[dates.length - 1] ?? bf.bill_date : bf.to;
    if (from > to) { setErr("The first day is after the last day."); return; } setErr(""); setBusy(true);
    let bill_path: string | null = null;
    if (file && !bf.noBill) { const f = await prepareUpload(file); if (f.size > MAX_UPLOAD) { setErr("The bill is larger than 5 MB: please send a smaller photo or compressed PDF."); setBusy(false); return; } const fd = new FormData(); fd.set("file", f); fd.set("employeeId", `sbill-${projectId}`); fd.set("docType", "sitebill"); const r = await fetch("/api/docs/upload", { method: "POST", body: fd }); if (!r.ok) { setErr(await r.text()); setBusy(false); return; } bill_path = (await r.json()).path; }
    const sb = supabase();
    const { data: made, error } = await sb.from("site_bills").insert({ kind, vendor_id: bf.vendor_id, project_id: projectId, bill_no: bf.noBill ? "" : bf.bill_no.trim(), bill_date: bf.bill_date, period_from: from, period_to: to, bill_amount: amount, note: bf.note.trim(), bill_path, ...(stretchMode && bf.noBill ? { no_bill: true } : {}) }).select("id").single();
    if (error || !made) { setBusy(false); setErr(error?.message ?? "Could not save."); return; }
    if (stretchMode) {
      const c = await sb.rpc("equipment_bill_claim", { p_bill: made.id, p_logs: pickedList.map((s) => s.id) });
      if (c.error) { setBusy(false); setErr(/equipment_bill_claim|schema cache/i.test(c.error.message) ? "Run the 2026-11-equipment-claims.sql migration first." : c.error.message); await changed(); return; }
      if (bf.noBill) await sb.from("site_bills").update({ status: "approved", approved_amount: amount, computed_amount: amount, approved_at: new Date().toISOString() }).eq("id", made.id);
    }
    setBusy(false); setBf({ ...bf, bill_no: "", amount: "", note: "", noBill: false }); setFile(null); setPicked(new Set());
    note(bf.noBill ? `Statement of ₹${inr(amount)} made and approved ✓ Pay it from the list.` : "Bill recorded ✓"); await changed();
  }
  async function approve(b: Bill, amount: number) { const c = recordsFor(b).amount; const { error } = await supabase().from("site_bills").update({ status: "approved", approved_amount: amount, computed_amount: c, approved_at: new Date().toISOString() }).eq("id", b.id); if (error) { setErr(error.message); return; } note(`Approved ₹${inr(amount)} ✓`); changed(); }
  function approveOther(b: Bill) { const v = prompt("Amount to approve (₹):", String(b.bill_amount)); if (v === null) return; const n = parseFloat(v); if (!(n >= 0)) { setErr("Enter a valid amount."); return; } approve(b, n); }
  async function reopen(b: Bill) { const { error } = await supabase().from("site_bills").update({ status: "received", approved_amount: null, approved_at: null }).eq("id", b.id); if (error) { setErr(error.message); return; } note("Reopened ✓ Its stretches can be changed again."); changed(); }
  async function voidBill(b: Bill) { if (!confirm(`Void the ${vName(b.vendor_id)} ${b.no_bill ? "statement" : `bill ${b.bill_no || ""}`}? It stays in the list, marked void${b.kind === "equipment" ? ", and its stretches become unbilled again" : ""}.`)) return; const { error } = await supabase().from("site_bills").update({ voided_at: new Date().toISOString() }).eq("id", b.id); if (error) { setErr(error.message); return; } note("Voided ✓"); changed(); }
  async function saveClaim() {
    if (!claimEdit) return; setBusy(true); const { error } = await supabase().rpc("equipment_bill_claim", { p_bill: claimEdit.bill, p_logs: [...claimEdit.ids] }); setBusy(false);
    if (error) { setErr(error.message); return; } setClaimEdit(null); note("Stretches saved ✓"); changed();
  }
  async function addPay() {
    const amount = parseFloat(pf.amount); if (!pf.vendor_id || !(amount > 0)) { setErr("Choose the vendor and enter the amount paid."); return; } setErr("");
    const { error } = await supabase().from("site_payments").insert({ kind: kindOf(pf.vendor_id), vendor_id: pf.vendor_id, project_id: projectId, amount, paid_on: pf.paid_on, reference: pf.reference.trim(), note: pf.note.trim(), ...(pf.bill_id ? { site_bill_id: pf.bill_id } : {}) });
    if (error) { setErr(error.message); return; } setPf({ ...pf, amount: "", reference: "", note: "", bill_id: "" }); note("Payment recorded and posted to the project's expenses ✓"); changed();
  }
  const payBill = (b: Bill) => { const due = r2((b.approved_amount ?? 0) - paidOn(b.id)); setPf({ ...pf, vendor_id: b.vendor_id, amount: String(due > 0 ? due : ""), bill_id: b.id }); setTimeout(() => document.getElementById("pay-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); };
  async function voidPay(p: Pay) { if (!confirm(`Void the ₹${inr(p.amount)} payment to ${vName(p.vendor_id)}? Its expense is removed.`)) return; const { error } = await supabase().from("site_payments").update({ voided_at: new Date().toISOString() }).eq("id", p.id); if (error) { setErr(error.message); return; } note("Voided ✓"); changed(); }

  const live = bills.filter((b) => !b.voided_at); const lp = pays.filter((p) => !p.voided_at);
  const billName = (b: Bill) => (b.no_bill ? "statement (no bill)" : b.bill_no ? `bill ${b.bill_no}` : "bill");
  const sums = vendors.map((v) => { const total = live.filter((b) => b.vendor_id === v.id && b.status === "approved").reduce((s, b) => s + (b.approved_amount ?? 0), 0); const paid = lp.filter((p) => p.vendor_id === v.id).reduce((s, p) => s + p.amount, 0);
    const machines = usesStretches(v.id); const used = machines ? sum(byStretch(v.id)) : 0; const notBilled = machines ? sum(unbilled(v.id)) : 0; return { v, total, paid, machines, used, notBilled }; }).filter((s) => s.total > 0 || s.paid > 0 || s.used > 0);
  const preview = !stretchMode && bf.vendor_id && bf.from <= bf.to && kindOf(bf.vendor_id) ? recordsFor({ id: "", kind: kindOf(bf.vendor_id)!, vendor_id: bf.vendor_id, period_from: bf.from, period_to: bf.to }) : null; const billed = parseFloat(bf.amount);
  const pickedTotal = sum(pickedList);
  const tick = (set: Set<string>, id: string, on: boolean) => { const n = new Set(set); if (on) n.add(id); else n.delete(id); return n; };
  const stretchBox = (list: Stretch[], sel: Set<string>, onTick: (id: string, on: boolean) => void) => !list.length ? <p className="text-sm text-slate-500">No unbilled stretches for this vendor.</p> :
    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">{list.map((s) => <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm"><input type="checkbox" checked={sel.has(s.id)} onChange={(e) => onTick(s.id, e.target.checked)} /><span className="tabular-nums text-slate-500 w-24 shrink-0">{dmy(s.date)}</span><span className="min-w-0 flex-1 truncate">{s.label}</span><b className="tabular-nums">{s.amount === null ? <span className="text-amber-700">no rate</span> : `₹${inr(s.amount)}`}</b></label>)}</div>;

  return (
    <div className="space-y-4 mob">
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
      {sums.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{sums.map(({ v, total, paid, machines, used, notBilled }) => <div key={v.id} className="rounded-2xl bg-white border border-slate-200/80 p-3">
        <div className="font-medium">{v.name}</div>
        <div className="text-xs text-slate-500">{machines ? `Used ₹${inr(used)} · ` : ""}Approved ₹{inr(total)} · paid ₹{inr(paid)}</div>
        <div className={`text-lg font-medium tabular-nums ${total - paid > 0 ? "text-rose-700" : "text-green-700"}`}>{total - paid >= 0 ? `₹${inr(total - paid)} owed` : `₹${inr(paid - total)} advance`}</div>
        {machines && notBilled > 0 && <div className="text-xs text-amber-700">₹{inr(notBilled)} of work not billed yet</div>}</div>)}</div>}

      <div className="card !p-3 space-y-3"><div className="font-medium">Record a vendor bill</div>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="lbl">Vendor</label><select className="inp !w-52" value={bf.vendor_id} onChange={(e) => pickVendor(e.target.value)}>{vendorOptions}</select></div>
          {stretchMode && <div role="group" aria-label="Bill" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">{([[false, "They sent a bill"], [true, "No bill: make a statement"]] as [boolean, string][]).map(([k, l]) => <button key={l} type="button" aria-pressed={bf.noBill === k} className={`px-3 py-1.5 text-sm rounded-md ${bf.noBill === k ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => setBf({ ...bf, noBill: k })}>{l}</button>)}</div>}
        </div>
        {stretchMode && <div className="space-y-1.5"><div className="lbl">Work it covers <span className="font-normal text-slate-400">(stretches not on any bill yet)</span></div>
          {stretchBox(unbilled(bf.vendor_id), picked, (id, on) => setPicked(tick(picked, id, on)))}
          {pickedList.length > 0 && <p className="text-sm">Ticked: <b className="tabular-nums">₹{inr(pickedTotal)}</b> for {pickedList.length} stretch{pickedList.length === 1 ? "" : "es"}{!bf.noBill && bf.amount !== "" && billed >= 0 && <> · the bill is <b className={Math.abs(billed - pickedTotal) < 1 ? "text-green-700" : "text-amber-700"}>{Math.abs(billed - pickedTotal) < 1 ? "the same" : `₹${inr(Math.abs(billed - pickedTotal))} ${billed > pickedTotal ? "more" : "less"}`}</b></>}</p>}</div>}
        <div className="flex flex-wrap items-end gap-2">
          {!bf.noBill && <div><label className="lbl">Bill no.</label><input className="inp !w-32" value={bf.bill_no} onChange={(e) => setBf({ ...bf, bill_no: e.target.value })} /></div>}
          <div><label className="lbl">{bf.noBill ? "Statement date" : "Bill date"}</label><input type="date" className="inp" value={bf.bill_date} onChange={(e) => setBf({ ...bf, bill_date: e.target.value })} /></div>
          {!stretchMode && <><div><label className="lbl">Covers from</label><input type="date" className="inp" value={bf.from} onChange={(e) => setBf({ ...bf, from: e.target.value })} /></div>
            <div><label className="lbl">to</label><input type="date" className="inp" value={bf.to} onChange={(e) => setBf({ ...bf, to: e.target.value })} /></div></>}
          {!bf.noBill && <div><label className="lbl">Amount on bill (₹, with GST)</label><input className="inp !w-40" inputMode="decimal" value={bf.amount} onChange={(e) => setBf({ ...bf, amount: e.target.value.replace(/[^\d.]/g, "") })} /></div>}
          {!bf.noBill && <div><label className="lbl">Bill (photo or PDF)</label><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>}
          {bf.noBill && <div className="min-w-48 flex-1"><label className="lbl">Note (optional)</label><input className="inp" value={bf.note} onChange={(e) => setBf({ ...bf, note: e.target.value })} placeholder="e.g. paid against the logged hours" /></div>}
          <button className="btn btn-primary" disabled={busy} onClick={addBill}>{busy ? "Saving…" : bf.noBill ? `Make statement${pickedList.length ? ` of ₹${inr(pickedTotal)}` : ""}` : "Record bill"}</button></div>
        {preview && <p className="text-xs text-slate-500">Site records for these dates come to <b className="text-slate-700">₹{inr(preview.amount)}</b>{bf.amount !== "" && billed >= 0 && <> · the bill is <b className={Math.abs(billed - preview.amount) < 1 ? "text-green-700" : "text-amber-700"}>{Math.abs(billed - preview.amount) < 1 ? "the same" : `₹${inr(Math.abs(billed - preview.amount))} ${billed > preview.amount ? "more" : "less"}`}</b></>}{preview.warn ? <span className="text-amber-700"> · {preview.warn}</span> : null}</p>}
        {bf.noBill && <p className="text-xs text-slate-400">The statement is the amount the logged hours come to. It is approved at once and goes to Payments due; pay it with its Pay button.</p>}</div>

      <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium sm:mr-auto">All bills</h3><div role="group" aria-label="Show" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">{([["all", "All"], ...sources.map((x) => [x.kind, x.label])] as [string, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={show === k} className={`px-3 py-1 text-sm rounded-md ${show === k ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => setShow(k as "all" | Kind)}>{l}</button>)}</div></div>
      {!bills.some((b) => show === "all" || b.kind === show) && <p className="text-sm text-slate-500">No bills recorded yet.</p>}
      {bills.filter((b) => show === "all" || b.kind === show).map((b) => { const c = b.status === "approved" && b.computed_amount !== null ? { ...recordsFor(b), amount: b.computed_amount } : recordsFor(b); const diff = b.bill_amount - c.amount;
        const claims = b.kind === "equipment" && usesStretches(b.vendor_id); const paid = paidOn(b.id); const due = r2((b.approved_amount ?? 0) - paid); const editing = claimEdit?.bill === b.id; return (
        <div key={b.id} className={`card !p-3 space-y-2 ${b.voided_at ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-2"><b className={b.voided_at ? "line-through" : ""}>{vName(b.vendor_id)} · {billName(b)}</b><span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{labelOf(b.kind)}</span>
            {b.voided_at ? <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">void</span> : b.status === "approved" ? <span className={`text-[11px] rounded-full px-2 py-0.5 ${due <= 0 ? "bg-green-50 text-green-800" : "bg-blue-50 text-blue-800"}`}>{due <= 0 ? "Paid" : paid > 0 ? `₹${inr(due)} still to pay` : "Approved, to pay"}</span> : <span className="text-[11px] rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">To compare and approve</span>}
            <span className="text-xs text-slate-400 sm:ml-auto">dated {dmy(b.bill_date)} · {b.period_from === b.period_to ? dmy(b.period_from) : `${dmy(b.period_from)} to ${dmy(b.period_to)}`}</span></div>
          <div className="grid gap-2 sm:grid-cols-3 text-sm"><div><div className="text-xs text-slate-400">{b.no_bill ? "Statement" : "Vendor billed"}</div><b className="tabular-nums">₹{inr(b.bill_amount)}</b></div><div><div className="text-xs text-slate-400">{claims ? "Its stretches come to" : b.status === "approved" ? "Site records at approval" : "Site records come to"}</div><b className="tabular-nums">₹{inr(c.amount)}</b></div><div><div className="text-xs text-slate-400">Difference</div><b className={`tabular-nums ${Math.abs(diff) < 1 ? "text-green-700" : "text-amber-700"}`}>{Math.abs(diff) < 1 ? "Matches" : `${diff > 0 ? "+" : "−"}₹${inr(Math.abs(diff))}`}</b></div></div>
          {!b.voided_at && c.lines.length > 0 && !editing && <details className="text-xs text-slate-500" open={claims && c.lines.length <= 4}><summary className="cursor-pointer text-blue-700">{claims ? `The work it covers (${c.lines.length})` : "How the site records add up"}</summary><ul className="mt-1 space-y-0.5">{c.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></details>}
          {!b.voided_at && claims && c.lines.length === 0 && !editing && <p className="text-xs text-amber-700">No stretches on this bill yet.</p>}
          {editing && <div className="space-y-2">{stretchBox(byStretch(b.vendor_id).filter((s) => !s.bill_id || s.bill_id === b.id), claimEdit.ids, (id, on) => setClaimEdit({ bill: b.id, ids: tick(claimEdit.ids, id, on) }))}
            <div className="flex gap-2"><button className="btn btn-sm btn-primary" disabled={busy} onClick={saveClaim}>Save stretches</button><button className="btn btn-sm" onClick={() => setClaimEdit(null)}>Cancel</button></div></div>}
          {!b.voided_at && b.status === "received" && c.warn && <p className="warn">{c.warn}</p>}
          {b.status === "approved" && <p className="text-xs text-slate-500">Approved for payment: ₹{inr(b.approved_amount ?? 0)}{paid > 0 ? ` · paid ₹${inr(paid)}` : ""}</p>}{b.note && <p className="text-xs text-slate-500">{b.note}</p>}
          <div className="flex flex-wrap gap-2">{!b.voided_at && b.status === "received" && <><button className="btn btn-sm btn-primary" onClick={() => approve(b, b.bill_amount)}>Approve ₹{inr(b.bill_amount)} (as billed)</button>{Math.abs(diff) >= 1 && <button className="btn btn-sm" onClick={() => approve(b, r2(c.amount))}>Approve ₹{inr(c.amount)} (site records)</button>}<button className="btn btn-sm" onClick={() => approveOther(b)}>Approve another amount…</button>
              {claims && !editing && <button className="btn btn-sm" onClick={() => setClaimEdit({ bill: b.id, ids: new Set(byStretch(b.vendor_id).filter((s) => s.bill_id === b.id).map((s) => s.id)) })}>Change stretches</button>}</>}
            {!b.voided_at && b.status === "approved" && due > 0 && <button className="btn btn-sm btn-primary" onClick={() => payBill(b)}>Pay ₹{inr(due)}</button>}
            {!b.voided_at && b.status === "approved" && <button className="btn btn-sm" onClick={() => reopen(b)}>Reopen</button>}{b.bill_path && <a className="btn btn-sm" href={`/api/docs/view?path=${encodeURIComponent(b.bill_path)}`} target="_blank" rel="noreferrer">View bill</a>}{!b.voided_at && <button className="btn btn-sm btn-danger" onClick={() => voidBill(b)}>Void</button>}</div></div>); })}

      <div id="pay-form" className="card !p-3 space-y-3"><div className="font-medium">Payments to vendors</div>
        {pf.bill_id && (() => { const b = bills.find((x) => x.id === pf.bill_id); return b ? <p className="text-sm">Paying {vName(b.vendor_id)} · {billName(b)} <button className="tlink" onClick={() => setPf({ ...pf, bill_id: "" })}>not for this bill</button></p> : null; })()}
        <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Vendor</label><select className="inp !w-52" value={pf.vendor_id} onChange={(e) => setPf({ ...pf, vendor_id: e.target.value, bill_id: "" })}>{vendorOptions}</select></div><div><label className="lbl">Amount (₹)</label><input className="inp !w-36" inputMode="decimal" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value.replace(/[^\d.]/g, "") })} /></div><div><label className="lbl">Paid on</label><input type="date" className="inp" max={today} value={pf.paid_on} onChange={(e) => setPf({ ...pf, paid_on: e.target.value })} /></div><div><label className="lbl">Reference</label><input className="inp !w-40" value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} placeholder="UTR / cheque no." /></div><button className="btn btn-primary" onClick={addPay}>Record payment</button></div>
        {!pf.bill_id && <p className="text-xs text-slate-400">To pay a particular bill, use its Pay button. A payment made here is an advance to the vendor.</p>}
        {pays.some((p) => show === "all" || p.kind === show) && <ul className="text-sm space-y-1">{pays.filter((p) => show === "all" || p.kind === show).map((p) => { const b = p.site_bill_id ? bills.find((x) => x.id === p.site_bill_id) : null; return <li key={p.id} className={`flex flex-wrap gap-2 ${p.voided_at ? "opacity-60 line-through" : ""}`}><span>{dmy(p.paid_on)}</span><b>{vName(p.vendor_id)}</b><span className="tabular-nums">₹{inr(p.amount)}</span><span className="text-slate-500">{[b ? `for ${billName(b)}` : "", p.reference].filter(Boolean).join(" · ")}</span>{!p.voided_at && <button className="tlink tlink-danger" onClick={() => voidPay(p)}>Void</button>}</li>; })}</ul>}</div>
    </div>
  );
}
