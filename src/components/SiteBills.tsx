"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";

export type Computed = { amount: number; lines: string[]; warn?: string };
type Kind = "gas" | "equipment";
export type BillSource = { kind: Kind; label: string; vendors: { id: string; name: string }[]; compute: (vendorId: string, from: string, to: string) => Computed };
type Bill = { id: string; kind: Kind; vendor_id: string; bill_no: string; bill_date: string; period_from: string; period_to: string; bill_amount: number; status: "received" | "approved"; approved_amount: number | null; computed_amount: number | null; note: string; bill_path: string | null; voided_at: string | null };
type Pay = { id: string; kind: Kind; vendor_id: string; paid_on: string; amount: number; reference: string; note: string; voided_at: string | null };
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// Vendor bills and payments for gas and hired equipment on one project, in one list, for Operations / Admin. Each bill shows what the vendor billed next to what the site records
// come to (the parent works that out), so a difference is plain; you approve the amount you will pay. Only approved bills count in Payments due.
export default function SiteBills({ projectId, sources }: { projectId: string; sources: BillSource[] }) {
  const vendors = sources.flatMap((x) => x.vendors); const kindOf = (vid: string) => sources.find((x) => x.vendors.some((v) => v.id === vid))?.kind ?? null; const compute = (kind: Kind, vid: string, from: string, to: string): Computed => sources.find((x) => x.kind === kind)?.compute(vid, from, to) ?? { amount: 0, lines: [] };
  const labelOf = (k: Kind) => sources.find((x) => x.kind === k)?.label ?? k; const [show, setShow] = useState<"all" | Kind>("all");
  const vendorOptions = <><option value="">Choose…</option>{sources.map((x) => x.vendors.length > 0 && <optgroup key={x.kind} label={x.label}>{x.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</optgroup>)}</>;
  const today = istToday(); const [bills, setBills] = useState<Bill[]>([]); const [pays, setPays] = useState<Pay[]>([]); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [bf, setBf] = useState({ vendor_id: "", bill_no: "", bill_date: today, from: today.slice(0, 7) + "-01", to: today, amount: "", note: "" }); const [file, setFile] = useState<File | null>(null);
  const [pf, setPf] = useState({ vendor_id: "", amount: "", paid_on: today, reference: "", note: "" });
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };
  const vName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "?";
  async function load() {
    if (!projectId) return; const sb = supabase();
    const [b, p] = await Promise.all([sb.from("site_bills").select("*").eq("project_id", projectId).order("bill_date", { ascending: false }), sb.from("site_payments").select("*").eq("project_id", projectId).order("paid_on", { ascending: false })]);
    const x = b.error || p.error; if (x) { setErr(x.message + (/site_|schema cache|does not exist/i.test(x.message) ? ": run the 2026-11-consumables.sql migration first." : "")); return; }
    setBills(((b.data || []) as Bill[]).map((q) => ({ ...q, bill_amount: Number(q.bill_amount), approved_amount: q.approved_amount === null ? null : Number(q.approved_amount), computed_amount: q.computed_amount === null ? null : Number(q.computed_amount) }))); setPays(((p.data || []) as Pay[]).map((q) => ({ ...q, amount: Number(q.amount) }))); setErr("");
  }
  useEffect(() => { load(); }, [projectId]);
  async function addBill() {
    const amount = parseFloat(bf.amount); if (!bf.vendor_id || !(amount >= 0) || bf.amount === "") { setErr("Choose the vendor and enter the amount on the bill."); return; } if (bf.from > bf.to) { setErr("The first day is after the last day."); return; } setErr(""); setBusy(true);
    let bill_path: string | null = null;
    if (file) { const f = await prepareUpload(file); if (f.size > MAX_UPLOAD) { setErr("The bill is larger than 5 MB: please send a smaller photo or compressed PDF."); setBusy(false); return; } const fd = new FormData(); fd.set("file", f); fd.set("employeeId", `sbill-${projectId}`); fd.set("docType", "sitebill"); const r = await fetch("/api/docs/upload", { method: "POST", body: fd }); if (!r.ok) { setErr(await r.text()); setBusy(false); return; } bill_path = (await r.json()).path; }
    const { error } = await supabase().from("site_bills").insert({ kind: kindOf(bf.vendor_id), vendor_id: bf.vendor_id, project_id: projectId, bill_no: bf.bill_no.trim(), bill_date: bf.bill_date, period_from: bf.from, period_to: bf.to, bill_amount: amount, note: bf.note.trim(), bill_path }); setBusy(false);
    if (error) { setErr(error.message); return; } setBf({ ...bf, bill_no: "", amount: "", note: "" }); setFile(null); note("Bill recorded ✓"); load();
  }
  async function approve(b: Bill, amount: number) { const c = compute(b.kind, b.vendor_id, b.period_from, b.period_to).amount; const { error } = await supabase().from("site_bills").update({ status: "approved", approved_amount: amount, computed_amount: c, approved_at: new Date().toISOString() }).eq("id", b.id); if (error) { setErr(error.message); return; } note(`Approved ₹${inr(amount)} ✓`); load(); }
  function approveOther(b: Bill) { const v = prompt("Amount to approve (₹):", String(b.bill_amount)); if (v === null) return; const n = parseFloat(v); if (!(n >= 0)) { setErr("Enter a valid amount."); return; } approve(b, n); }
  async function reopen(b: Bill) { const { error } = await supabase().from("site_bills").update({ status: "received", approved_amount: null, approved_at: null }).eq("id", b.id); if (error) { setErr(error.message); return; } note("Reopened ✓"); load(); }
  async function voidBill(b: Bill) { if (!confirm(`Void the ${vName(b.vendor_id)} bill ${b.bill_no || ""}? It stays in the list, marked void.`)) return; const { error } = await supabase().from("site_bills").update({ voided_at: new Date().toISOString() }).eq("id", b.id); if (error) { setErr(error.message); return; } note("Voided ✓"); load(); }
  async function addPay() {
    const amount = parseFloat(pf.amount); if (!pf.vendor_id || !(amount > 0)) { setErr("Choose the vendor and enter the amount paid."); return; } setErr("");
    const { error } = await supabase().from("site_payments").insert({ kind: kindOf(pf.vendor_id), vendor_id: pf.vendor_id, project_id: projectId, amount, paid_on: pf.paid_on, reference: pf.reference.trim(), note: pf.note.trim() });
    if (error) { setErr(error.message); return; } setPf({ ...pf, amount: "", reference: "", note: "" }); note("Payment recorded and posted to the project's expenses ✓"); load();
  }
  async function voidPay(p: Pay) { if (!confirm(`Void the ₹${inr(p.amount)} payment to ${vName(p.vendor_id)}? Its expense is removed.`)) return; const { error } = await supabase().from("site_payments").update({ voided_at: new Date().toISOString() }).eq("id", p.id); if (error) { setErr(error.message); return; } note("Voided ✓"); load(); }

  const live = bills.filter((b) => !b.voided_at); const lp = pays.filter((p) => !p.voided_at);
  const sums = vendors.map((v) => { const total = live.filter((b) => b.vendor_id === v.id && b.status === "approved").reduce((s, b) => s + (b.approved_amount ?? 0), 0); const paid = lp.filter((p) => p.vendor_id === v.id).reduce((s, p) => s + p.amount, 0); return { v, total, paid }; }).filter((s) => s.total > 0 || s.paid > 0);
  const preview = bf.vendor_id && bf.from <= bf.to && kindOf(bf.vendor_id) ? compute(kindOf(bf.vendor_id)!, bf.vendor_id, bf.from, bf.to) : null; const billed = parseFloat(bf.amount);

  return (
    <div className="space-y-4 mob">
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
      {sums.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{sums.map(({ v, total, paid }) => <div key={v.id} className="rounded-2xl bg-white border border-slate-200/80 p-3"><div className="font-medium">{v.name}</div><div className="text-xs text-slate-500">Approved ₹{inr(total)} · paid ₹{inr(paid)}</div><div className={`text-lg font-medium tabular-nums ${total - paid > 0 ? "text-rose-700" : "text-green-700"}`}>{total - paid >= 0 ? `₹${inr(total - paid)} pending` : `₹${inr(paid - total)} advance`}</div></div>)}</div>}
      <div className="card !p-3 space-y-3"><div className="font-medium">Record a vendor bill</div>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="lbl">Vendor</label><select className="inp !w-52" value={bf.vendor_id} onChange={(e) => setBf({ ...bf, vendor_id: e.target.value })}>{vendorOptions}</select></div>
          <div><label className="lbl">Bill no.</label><input className="inp !w-32" value={bf.bill_no} onChange={(e) => setBf({ ...bf, bill_no: e.target.value })} /></div>
          <div><label className="lbl">Bill date</label><input type="date" className="inp" value={bf.bill_date} onChange={(e) => setBf({ ...bf, bill_date: e.target.value })} /></div>
          <div><label className="lbl">Covers from</label><input type="date" className="inp" value={bf.from} onChange={(e) => setBf({ ...bf, from: e.target.value })} /></div>
          <div><label className="lbl">to</label><input type="date" className="inp" value={bf.to} onChange={(e) => setBf({ ...bf, to: e.target.value })} /></div>
          <div><label className="lbl">Amount on bill (₹, with GST)</label><input className="inp !w-40" inputMode="decimal" value={bf.amount} onChange={(e) => setBf({ ...bf, amount: e.target.value.replace(/[^\d.]/g, "") })} /></div>
          <div><label className="lbl">Bill (photo or PDF)</label><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
          <button className="btn btn-primary" disabled={busy} onClick={addBill}>{busy ? "Saving…" : "Record bill"}</button></div>
        {preview && <p className="text-xs text-slate-500">Site records for these dates come to <b className="text-slate-700">₹{inr(preview.amount)}</b>{bf.amount !== "" && billed >= 0 && <> · the bill is <b className={Math.abs(billed - preview.amount) < 1 ? "text-green-700" : "text-amber-700"}>{Math.abs(billed - preview.amount) < 1 ? "the same" : `₹${inr(Math.abs(billed - preview.amount))} ${billed > preview.amount ? "more" : "less"}`}</b></>}{preview.warn ? <span className="text-amber-700"> · {preview.warn}</span> : null}</p>}</div>
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium sm:mr-auto">All bills</h3><div role="group" aria-label="Show" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">{([["all", "All"], ...sources.map((x) => [x.kind, x.label])] as [string, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={show === k} className={`px-3 py-1 text-sm rounded-md ${show === k ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => setShow(k as "all" | Kind)}>{l}</button>)}</div></div>
      {!bills.some((b) => show === "all" || b.kind === show) && <p className="text-sm text-slate-500">No bills recorded yet.</p>}
      {bills.filter((b) => show === "all" || b.kind === show).map((b) => { const c = b.status === "approved" && b.computed_amount !== null ? { amount: b.computed_amount, lines: [] as string[], warn: "" } : compute(b.kind, b.vendor_id, b.period_from, b.period_to); const diff = b.bill_amount - c.amount; return (
        <div key={b.id} className={`card !p-3 space-y-2 ${b.voided_at ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-2"><b className={b.voided_at ? "line-through" : ""}>{vName(b.vendor_id)} · {b.bill_no ? `bill ${b.bill_no}` : "bill"}</b><span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{labelOf(b.kind)}</span>{b.voided_at ? <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">void</span> : <span className={`text-[11px] rounded-full px-2 py-0.5 ${b.status === "approved" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{b.status === "approved" ? "Approved" : "To compare and approve"}</span>}<span className="text-xs text-slate-400 sm:ml-auto">dated {dmy(b.bill_date)} · covers {dmy(b.period_from)} to {dmy(b.period_to)}</span></div>
          <div className="grid gap-2 sm:grid-cols-3 text-sm"><div><div className="text-xs text-slate-400">Vendor billed</div><b className="tabular-nums">₹{inr(b.bill_amount)}</b></div><div><div className="text-xs text-slate-400">{b.status === "approved" ? "Site records at approval" : "Site records come to"}</div><b className="tabular-nums">₹{inr(c.amount)}</b></div><div><div className="text-xs text-slate-400">Difference</div><b className={`tabular-nums ${Math.abs(diff) < 1 ? "text-green-700" : "text-amber-700"}`}>{Math.abs(diff) < 1 ? "Matches" : `${diff > 0 ? "+" : "−"}₹${inr(Math.abs(diff))}`}</b></div></div>
          {!b.voided_at && b.status === "received" && c.lines.length > 0 && <details className="text-xs text-slate-500"><summary className="cursor-pointer text-blue-700">How the site records add up</summary><ul className="mt-1 space-y-0.5">{c.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></details>}
          {!b.voided_at && b.status === "received" && c.warn && <p className="warn">{c.warn}</p>}
          {b.status === "approved" && <p className="text-xs text-slate-500">Approved for payment: ₹{inr(b.approved_amount ?? 0)}</p>}{b.note && <p className="text-xs text-slate-500">{b.note}</p>}
          <div className="flex flex-wrap gap-2">{!b.voided_at && b.status === "received" && <><button className="btn btn-sm btn-primary" onClick={() => approve(b, b.bill_amount)}>Approve ₹{inr(b.bill_amount)} (as billed)</button>{Math.abs(diff) >= 1 && <button className="btn btn-sm" onClick={() => approve(b, Math.round(c.amount * 100) / 100)}>Approve ₹{inr(c.amount)} (site records)</button>}<button className="btn btn-sm" onClick={() => approveOther(b)}>Approve another amount…</button></>}
            {!b.voided_at && b.status === "approved" && <button className="btn btn-sm" onClick={() => reopen(b)}>Reopen</button>}{b.bill_path && <a className="btn btn-sm" href={`/api/docs/view?path=${encodeURIComponent(b.bill_path)}`} target="_blank" rel="noreferrer">View bill</a>}{!b.voided_at && <button className="btn btn-sm btn-danger" onClick={() => voidBill(b)}>Void</button>}</div></div>); })}
      <div className="card !p-3 space-y-3"><div className="font-medium">Payments to vendors</div>
        <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Vendor</label><select className="inp !w-52" value={pf.vendor_id} onChange={(e) => setPf({ ...pf, vendor_id: e.target.value })}>{vendorOptions}</select></div><div><label className="lbl">Amount (₹)</label><input className="inp !w-36" inputMode="decimal" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value.replace(/[^\d.]/g, "") })} /></div><div><label className="lbl">Paid on</label><input type="date" className="inp" max={today} value={pf.paid_on} onChange={(e) => setPf({ ...pf, paid_on: e.target.value })} /></div><div><label className="lbl">Reference</label><input className="inp !w-40" value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} placeholder="UTR / cheque no." /></div><button className="btn btn-primary" onClick={addPay}>Record payment</button></div>
        {pays.some((p) => show === "all" || p.kind === show) && <ul className="text-sm space-y-1">{pays.filter((p) => show === "all" || p.kind === show).map((p) => <li key={p.id} className={`flex flex-wrap gap-2 ${p.voided_at ? "opacity-60 line-through" : ""}`}><span>{dmy(p.paid_on)}</span><b>{vName(p.vendor_id)}</b><span className="tabular-nums">₹{inr(p.amount)}</span><span className="text-slate-500">{p.reference}</span>{!p.voided_at && <button className="tlink tlink-danger" onClick={() => voidPay(p)}>Void</button>}</li>)}</ul>}</div>
    </div>
  );
}
