"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRole } from "@/lib/roles";
import { istToday } from "@/lib/attendance";
import PayeeBank from "@/components/PayeeBank";
import { dueOfBill, inr, type PurchaseVendor } from "@/lib/inventory";

// Purchases → Vendors (2026-11-purchases-credit.sql): who bills are bought from, and what credit vendors are owed, across all projects.
//  - A bill marked "To pay" is owed to its vendor, due at the end of the bill's month. Bills paid at the time are not in the account.
//  - Pay one or several bills (tick them) or a lump sum, which clears the oldest bills first. Part payments are fine; voiding a payment puts its bills back.
//  - An Admin can edit a payment. The statement for any period can be printed or saved as a PDF.
// Operations and Admin make changes; the Viewer can look.
type Bill = { id: string; project_id: string; vendor_id: string; bill_no: string; bill_date: string; bill_total: number; pay_status: string; status: string; voided_at: string | null };
type Pay = { id: string; vendor_id: string; paid_on: string; amount: number; method: string; reference: string; note: string; voided_at: string | null; edited_at: string | null };
type Line = { payment_id: string; bill_id: string; amount: number };
const METHOD: Record<string, string> = { bank: "Bank transfer", upi: "UPI", cheque: "Cheque", cash: "Cash" };
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const r2 = (n: number) => Math.round(n * 100) / 100;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export default function VendorsTab({ projects }: { projects: { id: string; name: string }[] }) {
  const { role, staff, viewer } = useRole(); const isAdmin = role === "admin"; const canAct = staff && !viewer; const today = istToday();
  const [vendors, setVendors] = useState<PurchaseVendor[] | null>(null); const [bills, setBills] = useState<Bill[]>([]); const [pays, setPays] = useState<Pay[]>([]); const [lines, setLines] = useState<Line[]>([]);
  const [missing, setMissing] = useState(false); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null); const [q, setQ] = useState(""); const [onlyOwed, setOnlyOwed] = useState(false);
  const note = (m: string) => { setMsg(m); setErr(""); setTimeout(() => setMsg(""), 6000); };
  const pName = (id: string) => projects.find((p) => p.id === id)?.name ?? "—";

  const load = useCallback(async () => {
    const sb = supabase();
    const v = await sb.from("purchase_vendors").select("*").order("name");
    if (v.error) { setMissing(true); setVendors([]); return; }
    const [b, p, l] = await Promise.all([sb.from("inventory_bills").select("id, project_id, vendor_id, bill_no, bill_date, bill_total, pay_status, status, voided_at").not("vendor_id", "is", null).eq("kind", "bill").order("bill_date"),
      sb.from("purchase_payments").select("*").order("paid_on", { ascending: false }), sb.from("purchase_payment_bills").select("*")]);
    setVendors(((v.data ?? []) as PurchaseVendor[]).map((x) => ({ ...x, credit_limit: x.credit_limit === null ? null : Number(x.credit_limit) })));
    setBills(((b.data ?? []) as Bill[]).map((x) => ({ ...x, bill_total: Number(x.bill_total) }))); setPays(((p.data ?? []) as Pay[]).map((x) => ({ ...x, amount: Number(x.amount) }))); setLines(((l.data ?? []) as Line[]).map((x) => ({ ...x, amount: Number(x.amount) })));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const livePay = useMemo(() => new Set(pays.filter((p) => !p.voided_at).map((p) => p.id)), [pays]);
  const paidOn = useCallback((billId: string) => lines.filter((l) => l.bill_id === billId && livePay.has(l.payment_id)).reduce((t, l) => t + l.amount, 0), [lines, livePay]);
  /** A vendor's account: bills to pay (recorded, not void) with what is paid on each. */
  const accountOf = useCallback((vid: string) => {
    const bs = bills.filter((b) => b.vendor_id === vid && b.status === "recorded" && !b.voided_at && b.pay_status === "to_pay" && b.bill_total > 0).map((b) => { const paid = r2(paidOn(b.id)); const due = dueOfBill(b.bill_date); return { ...b, paid, left: r2(b.bill_total - paid), due, late: due < today && b.bill_total - paid > 0.004 }; });
    const open_ = bs.filter((b) => b.left > 0.004); return { bills: bs, open: open_, owed: r2(open_.reduce((t, b) => t + b.left, 0)), overdue: r2(open_.filter((b) => b.late).reduce((t, b) => t + b.left, 0)) };
  }, [bills, paidOn, today]);

  if (missing) return <p className="warn !text-sm">Vendors and credit need the 2026-11-purchases-credit.sql migration to be run first.</p>;
  if (!vendors) return <div className="card"><div className="skeleton h-24 w-full" /></div>;
  const rows = vendors.map((v) => ({ v, a: accountOf(v.id), n: bills.filter((b) => b.vendor_id === v.id && !b.voided_at).length }))
    .filter((r) => (!q.trim() || r.v.name.toLowerCase().includes(q.trim().toLowerCase())) && (!onlyOwed || r.a.owed > 0))
    .sort((x, y) => y.a.overdue - x.a.overdue || y.a.owed - x.a.owed || Number(y.v.credit) - Number(x.v.credit) || x.v.name.localeCompare(y.v.name));
  const tot = rows.reduce((t, r) => ({ owed: t.owed + r.a.owed, overdue: t.overdue + r.a.overdue }), { owed: 0, overdue: 0 });

  return (
    <div className="space-y-3">
      {err && <p className="warn" role="alert">{err}</p>}{msg && <p className="text-sm text-green-700" role="status">{msg}</p>}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
        <div className="card !p-3"><div className="text-xs text-slate-500">Owed to vendors</div><div className="text-lg font-semibold tabular-nums">₹{inr(r2(tot.owed))}</div><div className="text-xs text-slate-400">bills to pay, all projects</div></div>
        <div className="card !p-3"><div className="text-xs text-slate-500">Overdue</div><div className={`text-lg font-semibold tabular-nums ${tot.overdue > 0 ? "text-rose-700" : ""}`}>₹{inr(r2(tot.overdue))}</div><div className="text-xs text-slate-400">past the bill&apos;s month end</div></div>
        <div className="card !p-3 hidden sm:block"><div className="text-xs text-slate-500">Credit vendors</div><div className="text-lg font-semibold tabular-nums">{vendors.filter((v) => v.credit).length}</div><div className="text-xs text-slate-400">of {vendors.length} vendors</div></div>
      </div>
      <div className="flex flex-wrap items-center gap-2"><input className="inp sm:!w-72" type="search" aria-label="Search vendors" placeholder="Search vendors" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={onlyOwed} onChange={(e) => setOnlyOwed(e.target.checked)} />Only vendors owed money</label></div>
      {!rows.length && <p className="text-sm text-slate-500">No vendors{q || onlyOwed ? " match" : " yet: they are added from the bills"}.</p>}
      <div className="space-y-2">{rows.map(({ v, a, n }) => <div key={v.id} className={`card !p-0 ${v.active ? "" : "opacity-60"}`}>
        <button type="button" className="w-full text-left p-3 flex flex-wrap items-center gap-x-3 gap-y-1" aria-expanded={open === v.id} onClick={() => setOpen(open === v.id ? null : v.id)}>
          <b className="min-w-0">{v.name}</b>{v.credit && <span className="text-[11px] rounded-full bg-blue-50 text-blue-800 px-2 py-0.5">Credit</span>}{!v.active && <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">Not in use</span>}
          <span className="text-xs text-slate-500">{n} bill{n === 1 ? "" : "s"}</span>
          <span className="ml-auto text-right tabular-nums">{a.owed > 0 ? <><b className={a.overdue > 0 ? "text-rose-700" : ""}>₹{inr(a.owed)}</b><span className="block text-xs text-slate-500">{a.overdue > 0 ? `₹${inr(a.overdue)} overdue` : `owed · ${a.open.length} bill${a.open.length === 1 ? "" : "s"}`}</span></> : <span className="text-sm text-slate-400">Nothing owed</span>}</span>
        </button>
        {open === v.id && <VendorDetail v={v} a={a} bills={bills.filter((b) => b.vendor_id === v.id)} pays={pays.filter((p) => p.vendor_id === v.id)} lines={lines} pName={pName} canAct={canAct} isAdmin={isAdmin} busy={busy} setBusy={setBusy} setErr={setErr} note={note} reload={load} />}
      </div>)}</div>
    </div>
  );
}

type AccBill = Bill & { paid: number; left: number; due: string; late: boolean };
type Acc = { bills: AccBill[]; open: AccBill[]; owed: number; overdue: number };

function VendorDetail({ v, a, bills, pays, lines, pName, canAct, isAdmin, busy, setBusy, setErr, note, reload }: { v: PurchaseVendor; a: Acc; bills: Bill[]; pays: Pay[]; lines: Line[]; pName: (id: string) => string; canAct: boolean; isAdmin: boolean; busy: boolean;
  setBusy: (b: boolean) => void; setErr: (s: string) => void; note: (s: string) => void; reload: () => Promise<void> }) {
  const today = istToday();
  const [ef, setEf] = useState<PurchaseVendor & { limit: string } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [pf, setPf] = useState({ amount: "", paid_on: today, method: "bank", reference: "", note: "" });
  const [pe, setPe] = useState<{ id: string; amount: string; paid_on: string; method: string; reference: string; note: string } | null>(null);
  const [st, setSt] = useState({ from: today.slice(0, 7) + "-01", to: today });
  const tickedLeft = r2(a.open.filter((b) => ticked.has(b.id)).reduce((t, b) => t + b.left, 0));
  const tick = (id: string, on: boolean) => { const n = new Set(ticked); if (on) n.add(id); else n.delete(id); setTicked(n); setPf((p) => ({ ...p, amount: n.size ? String(r2(a.open.filter((b) => n.has(b.id)).reduce((t, b) => t + b.left, 0))) : p.amount })); };

  async function saveVendor() {
    if (!ef) return; if (!ef.name.trim()) { setErr("Enter the vendor's name."); return; }
    const lim = ef.limit.trim() === "" ? null : Number(ef.limit); if (lim !== null && !(lim >= 0)) { setErr("Enter a valid credit limit, or leave it empty."); return; }
    setBusy(true); const { error } = await supabase().from("purchase_vendors").update({ name: ef.name.trim().replace(/\s+/g, " "), gstin: ef.gstin.trim().toUpperCase(), phone: ef.phone.trim(), address: ef.address.trim(), credit: ef.credit, credit_limit: ef.credit ? lim : null, note: ef.note.trim(), active: ef.active, updated_at: new Date().toISOString() }).eq("id", v.id); setBusy(false);
    if (error) { setErr(error.code === "23505" ? "Another vendor already has that name." : error.message); return; } setEf(null); note("Vendor saved ✓"); await reload();
  }
  async function pay() {
    const amount = Number(pf.amount); if (!(amount > 0)) { setErr("Enter the amount paid."); return; }
    if (!ticked.size && amount > a.owed + 0.004) { setErr(`That is more than the ₹${inr(a.owed)} owed.`); return; }
    if (ticked.size && amount > tickedLeft + 0.004) { setErr(`That is more than the ₹${inr(tickedLeft)} left on the bills ticked.`); return; }
    setBusy(true); const { error } = await supabase().rpc("purchase_pay", { p_vendor: v.id, p_paid_on: pf.paid_on, p_amount: amount, p_method: pf.method, p_ref: pf.reference, p_note: pf.note, p_bills: ticked.size ? [...ticked] : null }); setBusy(false);
    if (error) { setErr(error.message); return; } setTicked(new Set()); setPf({ amount: "", paid_on: today, method: pf.method, reference: "", note: "" }); note(`Payment of ₹${inr(amount)} recorded ✓`); await reload();
  }
  async function voidPay(p: Pay) { if (!confirm(`Void the ₹${inr(p.amount)} payment of ${dmy(p.paid_on)}? The bills it paid become owed again.`)) return; setBusy(true); const { error } = await supabase().rpc("purchase_payment_void", { p_payment: p.id }); setBusy(false); if (error) { setErr(error.message); return; } note("Payment voided ✓"); await reload(); }
  async function savePayEdit() {
    if (!pe) return; const amount = Number(pe.amount); if (!(amount > 0)) { setErr("Enter the amount paid."); return; }
    setBusy(true); const { error } = await supabase().rpc("purchase_payment_update", { p_payment: pe.id, p_paid_on: pe.paid_on, p_amount: amount, p_method: pe.method, p_ref: pe.reference, p_note: pe.note }); setBusy(false);
    if (error) { setErr(error.message); return; } setPe(null); note("Payment updated ✓"); await reload();
  }
  const billsOfPay = (pid: string) => lines.filter((l) => l.payment_id === pid).map((l) => { const b = bills.find((x) => x.id === l.bill_id); return b ? `${b.bill_no || "bill"} ₹${inr(l.amount)}` : ""; }).filter(Boolean).join(", ");

  /** The account between two dates: bills to pay add, payments take off; with the balance before. */
  function statement() {
    const acc = a.bills; const live = pays.filter((p) => !p.voided_at);
    const before = r2(acc.filter((b) => b.bill_date < st.from).reduce((t, b) => t + b.bill_total, 0) - live.filter((p) => p.paid_on < st.from).reduce((t, p) => t + p.amount, 0));
    type Row = { d: string; what: string; project: string; billed: number; paid: number };
    const rows: Row[] = [...acc.filter((b) => b.bill_date >= st.from && b.bill_date <= st.to).map((b) => ({ d: b.bill_date, what: `Bill ${b.bill_no || ""}`.trim(), project: pName(b.project_id), billed: b.bill_total, paid: 0 })),
      ...live.filter((p) => p.paid_on >= st.from && p.paid_on <= st.to).map((p) => ({ d: p.paid_on, what: `Payment · ${METHOD[p.method] ?? p.method}${p.reference ? ` · ${p.reference}` : ""}`, project: "", billed: 0, paid: p.amount }))].sort((x, y) => x.d.localeCompare(y.d) || y.billed - x.billed);
    let bal = before; const body = rows.map((r) => { bal = r2(bal + r.billed - r.paid); return `<tr><td>${dmy(r.d)}</td><td>${esc(r.what)}</td><td>${esc(r.project)}</td><td class="n">${r.billed ? inr(r.billed) : ""}</td><td class="n">${r.paid ? inr(r.paid) : ""}</td><td class="n">${inr(bal)}</td></tr>`; }).join("");
    const w = window.open("", "_blank"); if (!w) { setErr("Allow pop-ups to open the statement."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Statement - ${esc(v.name)}</title><style>body{font:13px/1.4 system-ui,sans-serif;margin:24px;color:#0f172a}h1{font-size:18px;margin:0}p{margin:2px 0;color:#475569}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left}th{font-size:11px;color:#64748b;text-transform:uppercase}.n{text-align:right;font-variant-numeric:tabular-nums}tfoot td{font-weight:600;border-top:2px solid #0f172a}@media print{button{display:none}}</style></head><body>
      <h1>${esc(v.name)}</h1><p>Statement of account, ${dmy(st.from)} to ${dmy(st.to)}${v.gstin ? ` · GSTIN ${esc(v.gstin)}` : ""}</p><p>Bills bought on credit and payments made. Bills paid at the time of purchase are not included.</p>
      <table><thead><tr><th>Date</th><th>Details</th><th>Project</th><th class="n">Billed (₹)</th><th class="n">Paid (₹)</th><th class="n">Balance (₹)</th></tr></thead>
      <tbody><tr><td>${dmy(st.from)}</td><td>Balance brought forward</td><td></td><td></td><td></td><td class="n">${inr(before)}</td></tr>${body}</tbody>
      <tfoot><tr><td colspan="5">Balance owed on ${dmy(st.to)}</td><td class="n">₹${inr(bal)}</td></tr></tfoot></table>
      <p style="margin-top:16px"><button onclick="print()">Print or save as PDF</button></p></body></html>`);
    w.document.close();
  }

  return (
    <div className="border-t border-slate-100 p-3 space-y-4">
      {/* details */}
      {ef ? <div className="rounded-xl border border-slate-200 p-3 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className="lbl">Name</label><input className="inp" value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></div>
          <div><label className="lbl">GSTIN</label><input className="inp uppercase" value={ef.gstin} onChange={(e) => setEf({ ...ef, gstin: e.target.value })} /></div>
          <div><label className="lbl">Phone</label><input className="inp" inputMode="tel" value={ef.phone} onChange={(e) => setEf({ ...ef, phone: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="lbl">Address</label><input className="inp" value={ef.address} onChange={(e) => setEf({ ...ef, address: e.target.value })} /></div>
          <div><label className="lbl">Note</label><input className="inp" value={ef.note} onChange={(e) => setEf({ ...ef, note: e.target.value })} /></div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ef.credit} onChange={(e) => setEf({ ...ef, credit: e.target.checked })} />Credit vendor: new bills start at &ldquo;To pay&rdquo;, paid at the month end</label>
          {ef.credit && <div><label className="lbl">Credit limit (₹, optional)</label><input className="inp !w-36" inputMode="decimal" value={ef.limit} onChange={(e) => setEf({ ...ef, limit: e.target.value.replace(/[^\d.]/g, "") })} placeholder="No limit" /></div>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ef.active} onChange={(e) => setEf({ ...ef, active: e.target.checked })} />In use</label>
        </div>
        <div className="flex gap-2"><button className="btn btn-primary btn-sm" disabled={busy} onClick={saveVendor}>Save</button><button className="btn btn-sm" onClick={() => setEf(null)}>Cancel</button></div>
        {ef.credit && ef.limit && <p className="text-xs text-slate-400">The limit only warns, when a new bill takes what is owed over it. Nothing is blocked.</p>}
      </div> : <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
        {v.gstin && <span>GSTIN {v.gstin}</span>}{v.phone && <a className="underline" href={`tel:${v.phone}`}>{v.phone}</a>}{v.address && <span>{v.address}</span>}
        {v.credit && <span>{v.credit_limit != null ? <>Credit limit ₹{inr(v.credit_limit)}{a.owed > v.credit_limit && <b className="text-amber-700"> · over the limit</b>}</> : "No credit limit"}</span>}{v.note && <span className="text-slate-500">{v.note}</span>}
        {canAct && <button className="tlink" onClick={() => setEf({ ...v, limit: v.credit_limit == null ? "" : String(v.credit_limit) })}>Edit details</button>}
        {isAdmin && <PayeeBank kind="purchase_vendor" refId={v.id} />}
      </div>}

      {/* bills to pay, and paying them */}
      <div className="space-y-2"><h4 className="text-sm font-semibold">Bills to pay {a.open.length > 0 && <span className="font-normal text-slate-500">· ₹{inr(a.owed)}</span>}</h4>
        {!a.open.length ? <p className="text-sm text-slate-500">Nothing owed.{!v.credit ? " Bills from this vendor are marked paid at the time unless you choose To pay on a bill." : ""}</p> : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr>{canAct && <th className="py-1 pr-2 w-6"><span className="sr-only">Pay</span></th>}<th className="py-1 pr-3 font-medium">Bill</th><th className="py-1 pr-3 font-medium">Date</th><th className="py-1 pr-3 font-medium">Project</th><th className="py-1 pr-3 font-medium text-right">Total</th><th className="py-1 pr-3 font-medium text-right">Paid</th><th className="py-1 pr-3 font-medium text-right">Left</th><th className="py-1 font-medium">Due</th></tr></thead>
          <tbody>{a.open.map((b) => <tr key={b.id} className="border-t border-slate-100">
            {canAct && <td className="py-1.5 pr-2"><input type="checkbox" aria-label={`Pay bill ${b.bill_no}`} checked={ticked.has(b.id)} onChange={(e) => tick(b.id, e.target.checked)} /></td>}
            <td className="py-1.5 pr-3"><a className="text-blue-700 hover:underline" href={`/inventory?project=${b.project_id}&bill=${b.id}`}>{b.bill_no || "bill"}</a></td><td className="py-1.5 pr-3 tabular-nums">{dmy(b.bill_date)}</td><td className="py-1.5 pr-3">{pName(b.project_id)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">₹{inr(b.bill_total)}</td><td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{b.paid ? `₹${inr(b.paid)}` : "—"}</td><td className="py-1.5 pr-3 text-right tabular-nums font-semibold">₹{inr(b.left)}</td>
            <td className={`py-1.5 tabular-nums ${b.late ? "text-rose-700 font-medium" : "text-slate-600"}`}>{b.late ? "Overdue " : ""}{dmy(b.due)}</td></tr>)}</tbody></table></div>}
        {canAct && a.open.length > 0 && <div className="rounded-xl bg-slate-50 p-3 space-y-2">
          <div className="text-sm font-medium">{ticked.size ? `Pay the ${ticked.size} bill${ticked.size === 1 ? "" : "s"} ticked (₹${inr(tickedLeft)} left on them)` : "Pay a sum: it clears the oldest bills first"}</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="lbl">Amount (₹)</label><input className="inp !w-36" inputMode="decimal" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value.replace(/[^\d.]/g, "") })} placeholder={inr(ticked.size ? tickedLeft : a.owed)} /></div>
            <div><label className="lbl">Paid on</label><input type="date" className="inp" max={today} value={pf.paid_on} onChange={(e) => setPf({ ...pf, paid_on: e.target.value })} /></div>
            <div><label className="lbl">How</label><select className="inp !w-40" value={pf.method} onChange={(e) => setPf({ ...pf, method: e.target.value })}>{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="lbl">Reference</label><input className="inp !w-40" value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} placeholder="UTR / cheque no." /></div>
            <div className="min-w-40 flex-1"><label className="lbl">Note</label><input className="inp" value={pf.note} onChange={(e) => setPf({ ...pf, note: e.target.value })} /></div>
            <button className="btn btn-primary" disabled={busy} onClick={pay}>Record payment</button>
            {!pf.amount && <button className="btn btn-sm" type="button" onClick={() => setPf({ ...pf, amount: String(ticked.size ? tickedLeft : a.owed) })}>Pay all ₹{inr(ticked.size ? tickedLeft : a.owed)}</button>}
          </div>
          <p className="text-xs text-slate-400">Less than a bill&apos;s amount pays part of it; the rest stays owed. The cost is already in the project&apos;s expenses from when the bill was recorded, so a payment adds no expense.</p>
        </div>}
      </div>

      {/* payments */}
      <div className="space-y-1"><h4 className="text-sm font-semibold">Payments</h4>
        {!pays.length ? <p className="text-sm text-slate-500">No payments recorded.</p> : <ul className="text-sm space-y-1">{pays.map((p) => <li key={p.id} className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${p.voided_at ? "opacity-60 line-through" : ""}`}>
          <span className="tabular-nums">{dmy(p.paid_on)}</span><b className="tabular-nums">₹{inr(p.amount)}</b><span className="text-slate-500">{METHOD[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
          <span className="text-xs text-slate-500">{billsOfPay(p.id) && `for ${billsOfPay(p.id)}`}{p.note ? ` · ${p.note}` : ""}{p.edited_at ? " · edited" : ""}</span>
          {!p.voided_at && isAdmin && <button className="tlink" onClick={() => setPe({ id: p.id, amount: String(p.amount), paid_on: p.paid_on, method: p.method, reference: p.reference, note: p.note })}>Edit</button>}
          {!p.voided_at && canAct && <button className="tlink tlink-danger" onClick={() => voidPay(p)}>Void</button>}
          {pe?.id === p.id && <div className="basis-full rounded-xl border border-slate-200 p-2 space-y-2" style={{ textDecoration: "none" }}><div className="flex flex-wrap items-end gap-2">
            <div><label className="lbl">Amount (₹)</label><input className="inp !w-32" inputMode="decimal" value={pe.amount} onChange={(e) => setPe({ ...pe, amount: e.target.value.replace(/[^\d.]/g, "") })} /></div>
            <div><label className="lbl">Paid on</label><input type="date" className="inp" max={today} value={pe.paid_on} onChange={(e) => setPe({ ...pe, paid_on: e.target.value })} /></div>
            <div><label className="lbl">How</label><select className="inp !w-36" value={pe.method} onChange={(e) => setPe({ ...pe, method: e.target.value })}>{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="lbl">Reference</label><input className="inp !w-36" value={pe.reference} onChange={(e) => setPe({ ...pe, reference: e.target.value })} /></div>
            <div className="min-w-32 flex-1"><label className="lbl">Note</label><input className="inp" value={pe.note} onChange={(e) => setPe({ ...pe, note: e.target.value })} /></div></div>
            <div className="flex gap-2"><button className="btn btn-sm btn-primary" disabled={busy} onClick={savePayEdit}>Save</button><button className="btn btn-sm" onClick={() => setPe(null)}>Cancel</button></div>
            <p className="text-xs text-slate-400">A new amount is shared out again over the same bills, oldest first.</p></div>}
        </li>)}</ul>}
      </div>

      {/* statement */}
      <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Statement from</label><input type="date" className="inp" value={st.from} onChange={(e) => setSt({ ...st, from: e.target.value })} /></div>
        <div><label className="lbl">to</label><input type="date" className="inp" max={today} value={st.to} onChange={(e) => setSt({ ...st, to: e.target.value })} /></div>
        <button className="btn" disabled={st.from > st.to} onClick={statement}>Open statement</button><span className="text-xs text-slate-400">Opens in a new tab, to print or save as PDF and send.</span></div>
    </div>
  );
}
