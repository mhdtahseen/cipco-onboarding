"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MEALS, addDays, istToday, rateFor, type MealRate, type Person, type Vendor } from "@/lib/attendance";
import type { Project } from "@/lib/types";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { uploadBill } from "@/lib/billUpload";
import PaymentBill from "@/components/PaymentBill";
import VendorSettings from "@/components/VendorSettings";

type MealRow = { employee_id: string; work_date: string; breakfast_vendor_id: string | null; lunch_vendor_id: string | null; dinner_vendor_id: string | null };
type Pay = { id: string; bill_path?: string | null; vendor_id: string; paid_on: string; amount: number; reference: string; note: string; voided_at: string | null };
type Bill = { id: string; vendor_id: string; project_id: string | null; bill_month: string; bill_from: string; bill_to: string; bill_no: string; bill_amount: number; status: "received" | "approved"; approved_amount: number | null; computed_amount: number | null; note: string; bill_path: string | null; approved_at: string | null; voided_at: string | null };
type Tab = "overview" | "daily" | "people" | "vendors" | "bills" | "payments" | "reports";
const TABS: [Tab, string][] = [["overview", "Overview"], ["daily", "Daily log"], ["people", "People"], ["vendors", "Vendors & prices"], ["bills", "Bills"], ["payments", "Payments"], ["reports", "Reports"]];
// a bill from before bills covered date ranges (the SQL migration not re-run yet) covers its whole month
const lastOfMonth = (iso: string) => { const ym = iso.slice(0, 7); const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };

// Admin back-office for meals. Marking meals stays on the Attendance page (that is where Supervisors and Site Engineers work);
// everything else lives here: overview, daily log, per-person, vendors and prices, payments and reports.
export default function Meals() {
  const today = istToday();
  const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState(""); const [vendors, setVendors] = useState<Vendor[]>([]); const [rates, setRates] = useState<MealRate[]>([]); const [meals, setMeals] = useState<MealRow[]>([]); const [people, setPeople] = useState<Person[]>([]); const [pays, setPays] = useState<Pay[]>([]); const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [tab, setTab] = useState<Tab>("overview"); const [month, setMonth] = useState(today.slice(0, 7)); const [stmtVendor, setStmtVendor] = useState("");
  const [pfBill, setPfBill] = useState<File | null>(null); const [pf, setPf] = useState({ vendor_id: "", amount: "", paid_on: today, reference: "", note: "" }); const [bf, setBf] = useState({ vendor_id: "", from: "", to: "", amount: "", no: "", note: "" }); const [stmtFrom, setStmtFrom] = useState(""); const [stmtTo, setStmtTo] = useState(""); const [billFile, setBillFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  async function load() {
    const sb = supabase(); const [pr, v, r, p, bl] = await Promise.all([sb.from("projects").select("*").eq("status", "active").order("name"), sb.from("food_vendors").select("*").order("sort_order"), sb.from("meal_rates").select("*"), sb.from("vendor_payments").select("*").order("paid_on", { ascending: false }), sb.from("vendor_bills").select("*").order("bill_month", { ascending: false })]);
    const x = pr.error || v.error || r.error || p.error || bl.error; if (x) { setErr(x.message + " — has the accountability SQL migration been run?"); setLoading(false); return; }
    const pl = (pr.data || []) as Project[]; setProjects(pl); setPid((c) => c || pl[0]?.id || ""); setVendors((v.data || []) as Vendor[]); setRates(((r.data || []) as MealRate[]).map((q) => ({ ...q, price: Number(q.price) }))); setPays(((p.data || []) as Pay[]).map((q) => ({ ...q, amount: Number(q.amount) }))); setBills(((bl.data || []) as Bill[]).map((q) => ({ ...q, bill_from: q.bill_from ?? q.bill_month, bill_to: q.bill_to ?? lastOfMonth(q.bill_month), bill_amount: Number(q.bill_amount), approved_amount: q.approved_amount === null ? null : Number(q.approved_amount), computed_amount: q.computed_amount === null ? null : Number(q.computed_amount) }))); setErr(""); setLoading(false);
  }
  useEffect(() => { load(); }, []);
  // The meals of the selected project (every day, in pages of 1000) and the people on it.
  useEffect(() => { if (!pid) return; let live = true; (async () => {
    const sb = supabase(); const all: MealRow[] = [];
    for (let from = 0; ; from += 1000) { const { data, error } = await sb.from("attendance").select("employee_id, work_date, breakfast_vendor_id, lunch_vendor_id, dinner_vendor_id").eq("project_id", pid).order("work_date").range(from, from + 999); if (error) { setErr(error.message); break; } all.push(...((data || []) as MealRow[])); if (!data || data.length < 1000) break; }
    const { data: ppl } = await sb.rpc("attendance_roster", { p_project: pid, p_from: `${month}-01`, p_to: `${month}-${String(lastDay(month)).padStart(2, "0")}` });
    if (live) { setMeals(all); setPeople((ppl || []) as Person[]); }
  })(); return () => { live = false; }; }, [pid, month]);

  const pv = useMemo(() => vendors.filter((v) => v.project_id === pid), [vendors, pid]); const ids = useMemo(() => new Set(pv.map((v) => v.id)), [pv]);
  const myPays = useMemo(() => pays.filter((x) => ids.has(x.vendor_id)), [pays, ids]);
  const taken = (r: MealRow, v: string): number[] => MEALS.map((m) => (r[m.col] === v ? 1 : 0)); // [b, l, d] of one vendor on one row
  const priceOf = (r: MealRow, i: number, v: string) => rateFor(rates, v, MEALS[i].key, r.work_date);
  const myBills = useMemo(() => bills.filter((b) => ids.has(b.vendor_id) && !b.voided_at), [bills, ids]);
  const billsOf = (vid: string, ym: string) => myBills.filter((b) => b.vendor_id === vid && b.bill_month.slice(0, 7) === ym).sort((x, y) => x.bill_from.localeCompare(y.bill_from));
  // what the recorded meals come to, per vendor and month, and per day
  const computed = useMemo(() => { const m: Record<string, Record<string, { cost: number; count: number; unpriced: number }>> = {}; const d: Record<string, Record<string, { cost: number; count: number }>> = {}; pv.forEach((v) => { m[v.id] = {}; d[v.id] = {}; });
    meals.forEach((r) => pv.forEach((v) => taken(r, v.id).forEach((t, i) => { if (!t) return; const e = (m[v.id][r.work_date.slice(0, 7)] ??= { cost: 0, count: 0, unpriced: 0 }); const x = (d[v.id][r.work_date] ??= { cost: 0, count: 0 }); e.count++; x.count++; const price = priceOf(r, i, v.id); if (price === null) e.unpriced++; else { e.cost += price; x.cost += price; } }))); return { m, d }; }, [meals, pv, rates]);
  const rangeOf = (vid: string, from: string, to: string) => { let cost = 0, count = 0; Object.entries(computed.d[vid] ?? {}).forEach(([day, x]) => { if (day >= from && day <= to) { cost += x.cost; count += x.count; } }); return { cost, count }; };
  // The amount due for a vendor in a month: an approved bill's amount for the days it covers, the computed meal cost for every other day.
  const dueFor = (vid: string, ym: string) => { const ap = billsOf(vid, ym).filter((b) => b.status === "approved"); const covered = (day: string) => ap.some((b) => day >= b.bill_from && day <= b.bill_to);
    let cost = ap.reduce((s, b) => s + (b.approved_amount ?? 0), 0); Object.entries(computed.d[vid] ?? {}).forEach(([day, x]) => { if (day.slice(0, 7) === ym && !covered(day)) cost += x.cost; }); return cost; };
  const rows = useMemo(() => pv.map((v) => {
    const counts = [0, 0, 0]; meals.forEach((r) => { if (!r.work_date.startsWith(month)) return; taken(r, v.id).forEach((t, i) => { if (t) counts[i]++; }); });
    const monthsAll = new Set([...Object.keys(computed.m[v.id] ?? {}), ...myBills.filter((b) => b.vendor_id === v.id && b.status === "approved").map((b) => b.bill_month.slice(0, 7))]);
    const all = [...monthsAll].reduce((s, ym) => s + dueFor(v.id, ym), 0); const unpriced = Object.values(computed.m[v.id] ?? {}).reduce((s, e) => s + e.unpriced, 0);
    const paid = myPays.filter((x) => x.vendor_id === v.id && !x.voided_at).reduce((s, x) => s + x.amount, 0);
    return { v, counts, month: dueFor(v.id, month), billed: all, paid, due: all - paid, unpriced };
  }), [pv, meals, computed, myBills, myPays, month]);
  const tot = rows.reduce((a, r) => ({ month: a.month + r.month, billed: a.billed + r.billed, paid: a.paid + r.paid, count: a.count + r.counts.reduce((s, n) => s + n, 0), unpriced: a.unpriced + r.unpriced }), { month: 0, billed: 0, paid: 0, count: 0, unpriced: 0 });
  // one entry per day of the chosen month
  const days = useMemo(() => Array.from({ length: lastDay(month) }, (_, i) => { const d = `${month}-${String(i + 1).padStart(2, "0")}`; const mine = meals.filter((r) => r.work_date === d); let cost = 0, n = 0; const per = pv.map((v) => { const c = [0, 0, 0]; mine.forEach((r) => taken(r, v.id).forEach((t, k) => { if (!t) return; c[k]++; n++; cost += priceOf(r, k, v.id) ?? 0; })); return c; }); return { d, per, n, cost, people: new Set(mine.filter((r) => MEALS.some((m) => r[m.col])).map((r) => r.employee_id)).size }; }), [meals, pv, rates, month]);
  const noMealDays = days.filter((x) => x.d < today && x.n === 0).map((x) => x.d);
  const personDays = days.reduce((s, x) => s + x.people, 0);
  const perPerson = useMemo(() => people.map((p) => { const mine = meals.filter((r) => r.employee_id === p.employee_id && r.work_date.startsWith(month)); const c = [0, 0, 0]; let cost = 0; mine.forEach((r) => MEALS.forEach((m, i) => { const v = r[m.col]; if (v && ids.has(v)) { c[i]++; cost += priceOf(r, i, v) ?? 0; } })); return { p, c, cost }; }).sort((a, b) => a.p.full_name.localeCompare(b.p.full_name)), [people, meals, ids, rates, month]);
  const awaiting = myBills.filter((b) => b.status === "received");
  const vName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "?";
  const proj = projects.find((p) => p.id === pid);

  async function addPay() {
    const amount = parseFloat(pf.amount); if (!pf.vendor_id || !(amount > 0)) { setErr("Choose the vendor and enter the amount."); return; } setErr("");
    let bill_path: string | undefined; if (pfBill) { const u = await uploadBill(pfBill, pid); if ("error" in u) { setErr(u.error); return; } bill_path = u.path; }
    const { error } = await supabase().from("vendor_payments").insert({ vendor_id: pf.vendor_id, amount, paid_on: pf.paid_on, reference: pf.reference.trim(), note: pf.note.trim(), ...(bill_path ? { bill_path } : {}) });
    if (error) { setErr(/bill_path|schema cache/i.test(error.message) ? "Attaching bills needs the latest SQL migration (2026-10-attendance-accountability-transport.sql). Run it in Supabase, then try again." : error.message); return; } setPfBill(null); setPf({ ...pf, amount: "", reference: "", note: "" }); note("Payment recorded and posted to the project's Food expenses ✓"); load();
  }
  async function attach(x: Pay, path: string) { const { error } = await supabase().from("vendor_payments").update({ bill_path: path }).eq("id", x.id); if (error) { setErr(error.message); return; } note("Bill attached; it shows on the project's expense ✓"); load(); }
  async function voidIt(x: Pay) {
    if (!confirm(`Void the ₹${inr(x.amount)} payment to ${vName(x.vendor_id)}? It stays in the list, marked void, and its Food expense is removed.`)) return;
    const { error } = await supabase().from("vendor_payments").update({ voided_at: new Date().toISOString() }).eq("id", x.id); if (error) { setErr(error.message); return; } note("Voided; the expense was removed ✓"); load();
  }
  // the next stretch to bill: the first day of the month no live bill covers, for up to a week (never into a day another bill covers)
  const suggest = (vid: string, ym = month) => { const bs = billsOf(vid, ym); const n = lastDay(ym); const day = (i: number) => `${ym}-${String(i).padStart(2, "0")}`; const covered = (d: string) => bs.some((x) => d >= x.bill_from && d <= x.bill_to); let i = 1; while (i <= n && covered(day(i))) i++; if (i > n) return { from: day(1), to: day(Math.min(7, n)) }; let j = i; while (j < n && j - i < 6 && !covered(day(j + 1))) j++; return { from: day(i), to: day(j) }; };
  const pickVendorForBill = (vid: string) => setBf({ ...bf, vendor_id: vid, ...(vid ? suggest(vid) : { from: "", to: "" }) });
  const period = (b: Pick<Bill, "bill_from" | "bill_to">) => { const f = new Date(b.bill_from + "T00:00:00"), t = new Date(b.bill_to + "T00:00:00"); const m = f.toLocaleDateString("en-IN", { month: "short" }); return b.bill_from === b.bill_to ? `${f.getDate()} ${m}` : `${f.getDate()}–${t.getDate()} ${m}`; };
  async function recordBill() {
    const amount = parseFloat(bf.amount); if (!bf.vendor_id || !(amount >= 0) || bf.amount === "") { setErr("Choose the vendor and enter the amount on the bill."); return; }
    if (!bf.from || !bf.to) { setErr("Enter the first and last day the bill covers."); return; } if (bf.from > bf.to) { setErr("The first day is after the last day."); return; } if (bf.from.slice(0, 7) !== bf.to.slice(0, 7)) { setErr("A bill cannot cross a month end. Record it as two bills, one for each month."); return; } setErr(""); setBusy(true);
    let bill_path: string | null = null;
    if (billFile) { const file = await prepareUpload(billFile); if (file.size > MAX_UPLOAD) { setErr("The bill is larger than 5 MB: please send a smaller photo or compressed PDF."); setBusy(false); return; }
      const fd = new FormData(); fd.set("file", file); fd.set("employeeId", `vbill-${pid}`); fd.set("docType", "vendorbill"); const r = await fetch("/api/docs/upload", { method: "POST", body: fd }); if (!r.ok) { setErr(await r.text()); setBusy(false); return; } bill_path = (await r.json()).path; }
    const { error } = await supabase().from("vendor_bills").insert({ vendor_id: bf.vendor_id, bill_from: bf.from, bill_to: bf.to, bill_no: bf.no.trim(), bill_amount: amount, note: bf.note.trim(), bill_path }); setBusy(false);
    if (error) { setErr(/bill_from|bill_to|schema cache/i.test(error.message) ? "Bills for date ranges need the latest SQL migration (2026-10-attendance-accountability-transport.sql). Run it in Supabase, then try again." : error.message); return; }
    if (bf.from.slice(0, 7) !== month) setMonth(bf.from.slice(0, 7));
    setBf({ vendor_id: bf.vendor_id, ...suggestAfter(bf.vendor_id, bf.to), amount: "", no: "", note: "" }); setBillFile(null); note("Bill recorded ✓"); load();
  }
  // after recording, offer the next week of the same month for the same vendor
  const suggestAfter = (_vid: string, lastTo: string) => { const ym = lastTo.slice(0, 7); const end = `${ym}-${String(lastDay(ym)).padStart(2, "0")}`; const from = lastTo < end ? addDays(lastTo, 1) : `${ym}-01`; const wk = addDays(from, 6); return { from, to: wk > end ? end : wk }; };
  async function approveBill(b: Bill, amount: number) { setErr(""); const { error } = await supabase().from("vendor_bills").update({ status: "approved", approved_amount: amount, computed_amount: rangeOf(b.vendor_id, b.bill_from, b.bill_to).cost }).eq("id", b.id); if (error) { setErr(error.message); return; } note(`Approved ₹${inr(amount)}: that is now the amount due for ${period(b)} ✓`); load(); }
  async function reopenBill(b: Bill) { const { error } = await supabase().from("vendor_bills").update({ status: "received" }).eq("id", b.id); if (error) { setErr(error.message); return; } note("Reopened ✓"); load(); }
  async function voidBill(b: Bill) { if (!confirm(`Void the ${vName(b.vendor_id)} bill for ${period(b)}? It stays in the list, marked void, and the computed amount is used again for those days.`)) return; const { error } = await supabase().from("vendor_bills").update({ voided_at: new Date().toISOString() }).eq("id", b.id); if (error) { setErr(error.message); return; } note("Voided ✓"); load(); }
  function approveCustom(b: Bill) { const v = prompt("Amount to approve (₹):", String(b.bill_amount)); if (v === null) return; const n = parseFloat(v); if (!(n >= 0)) { setErr("Enter a valid amount."); return; } approveBill(b, n); }
  function download(name: string, table: (string | number)[][]) { const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + table.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" })); a.download = `${proj?.name ?? "project"} - ${name}.csv`; a.click(); }
  const stmtV = pv.find((v) => v.id === (stmtVendor || pv[0]?.id)); const mFirst = `${month}-01`, mLast = `${month}-${String(lastDay(month)).padStart(2, "0")}`; const sFrom = stmtFrom && stmtFrom >= mFirst && stmtFrom <= mLast ? stmtFrom : mFirst, sTo = stmtTo && stmtTo >= mFirst && stmtTo <= mLast ? stmtTo : mLast;
  const stmtRows = useMemo(() => !stmtV ? [] : days.filter((x) => x.d >= sFrom && x.d <= sTo).map((x) => { const c = days.length ? x.per[pv.findIndex((v) => v.id === stmtV.id)] ?? [0, 0, 0] : [0, 0, 0]; const amt = meals.filter((r) => r.work_date === x.d).reduce((s, r) => s + taken(r, stmtV.id).reduce((t, n, i) => t + (n ? priceOf(r, i, stmtV.id) ?? 0 : 0), 0), 0); return { d: x.d, c, amt }; }).filter((r) => r.c.some(Boolean)), [stmtV, days, meals, rates, pv, sFrom, sTo]);
  const card = (l: string, v: string, sub?: string, tone = "") => <div className="rounded-2xl bg-white border border-slate-200/80 p-3 text-center"><div className="text-xs text-slate-400">{l}</div><div className={`text-lg font-medium tabular-nums ${tone}`}>{v}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
  const monthPick = <label className="text-xs text-slate-500 flex items-center gap-2">Month<input type="month" className="inp !w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" /></label>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Meals</h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => { setPid(e.target.value); setPf((f) => ({ ...f, vendor_id: "" })); setStmtVendor(""); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}</option>)}</select>}</div>
      <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab whitespace-nowrap ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}{loading && <p className="text-slate-500">Loading…</p>}

      {!loading && tab === "overview" && <>
        <div className="flex"><span className="text-xs text-slate-400 self-center">Meals are marked on the <Link className="underline" href="/attendance">Attendance</Link> page.</span><div className="ml-auto">{monthPick}</div></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{card("Meals this month", String(tot.count), personDays ? `₹${inr(tot.month / personDays)} per person per day` : undefined)}{card("Cost this month", `₹${inr(tot.month)}`)}{card("Paid (all time)", `₹${inr(tot.paid)}`)}{card("Balance due", `₹${inr(tot.billed - tot.paid)}`, "all time", tot.billed - tot.paid > 0 ? "text-amber-800" : "")}</div>
        {(noMealDays.length > 0 || tot.unpriced > 0 || awaiting.length > 0) && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 space-y-1 text-sm text-amber-900" data-alerts>
          {noMealDays.length > 0 && <p><b>{noMealDays.length}</b> past day{noMealDays.length > 1 ? "s have" : " has"} no meals recorded: {noMealDays.slice(0, 6).map((d) => d.slice(8)).join(", ")}{noMealDays.length > 6 ? "…" : ""}. <button className="underline" onClick={() => setTab("daily")}>See the daily log</button></p>}
          {awaiting.length > 0 && <p><b>{awaiting.length}</b> vendor bill{awaiting.length > 1 ? "s are" : " is"} waiting for approval. <button className="underline" onClick={() => setTab("bills")}>Review bills</button></p>}
          {tot.unpriced > 0 && <p><b>{tot.unpriced}</b> meal{tot.unpriced > 1 ? "s have" : " has"} no price, so {tot.unpriced > 1 ? "they are" : "it is"} not billed. <button className="underline" onClick={() => setTab("vendors")}>Set prices</button></p>}</section>}
        <section className="card space-y-2"><h2 className="font-medium">By vendor</h2><div className="overflow-x-auto"><table className="w-full text-sm min-w-[40rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Vendor</th>{MEALS.map((m) => <th key={m.key} className="text-right">{m.label}</th>)}<th className="text-right">This month</th><th className="text-right">Billed (all)</th><th className="text-right">Paid</th><th className="text-right">Due</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((o) => <tr key={o.v.id}><td className="py-2 font-medium">{o.v.name}{!o.v.active && <span className="text-xs text-slate-400"> (hidden)</span>}</td>{o.counts.map((n, i) => <td key={i} className="text-right tabular-nums">{n}</td>)}<td className="text-right tabular-nums">₹{inr(o.month)}</td><td className="text-right tabular-nums">₹{inr(o.billed)}</td><td className="text-right tabular-nums">₹{inr(o.paid)}</td><td className={`text-right tabular-nums ${o.due > 0 ? "text-amber-800 font-medium" : ""}`}>₹{inr(o.due)}</td></tr>)}</tbody></table></div>
          {!pv.length && <p className="text-sm text-slate-400">No vendors for this project yet. Add them on the Vendors &amp; prices tab.</p>}
          <p className="text-xs text-slate-400">Billed = every meal recorded on the attendance sheet (whatever the person's work status) x that vendor's price on the day, except for a month with an approved vendor bill, where the approved amount is used. Counts and "This month" follow the month chosen above.</p></section>
      </>}

      {!loading && tab === "daily" && <section className="card space-y-2"><div className="flex items-center"><h2 className="font-medium">Daily log</h2><div className="ml-auto">{monthPick}</div></div>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[36rem]" data-daily><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Date</th>{pv.map((v) => <th key={v.id} className="text-right">{v.name} <span className="normal-case">B·L·D</span></th>)}<th className="text-right">Meals</th><th className="text-right">Cost</th><th></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{days.filter((x) => x.d <= today).map((x) => <tr key={x.d} className={x.n === 0 ? "text-slate-400" : ""}><td className="py-1.5 tabular-nums whitespace-nowrap">{new Date(x.d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}</td>{x.per.map((c, i) => <td key={i} className="text-right tabular-nums">{c.join(" · ")}</td>)}<td className="text-right tabular-nums">{x.n || "—"}{x.n === 0 && x.d < today && <span className="text-amber-700"> !</span>}</td><td className="text-right tabular-nums">{x.cost ? `₹${inr(x.cost)}` : "—"}</td><td className="text-right pl-2"><Link className="text-xs text-blue-700 underline" href={`/attendance?p=${pid}&d=${x.d}`}>Open</Link></td></tr>)}</tbody></table></div>
        <p className="text-xs text-slate-400">"!" marks a past day with no meals recorded. Open takes you to that day on the attendance sheet, where meals are corrected.</p></section>}

      {!loading && tab === "people" && <section className="card space-y-2"><div className="flex items-center"><h2 className="font-medium">Meals per person</h2><div className="ml-auto">{monthPick}</div></div>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[30rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Name</th>{MEALS.map((m) => <th key={m.key} className="text-right">{m.label}</th>)}<th className="text-right">Meals</th><th className="text-right">Cost</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{perPerson.map((o) => <tr key={o.p.employee_id}><td className="py-1.5">{o.p.full_name}<span className="text-xs text-slate-400"> {o.p.emp_no ?? ""}</span></td>{o.c.map((n, i) => <td key={i} className="text-right tabular-nums">{n}</td>)}<td className="text-right tabular-nums">{o.c.reduce((a, b) => a + b, 0)}</td><td className="text-right tabular-nums">₹{inr(o.cost)}</td></tr>)}</tbody></table></div>
        {!perPerson.length && <p className="text-sm text-slate-400">Nobody on this project for the month.</p>}</section>}

      {!loading && tab === "vendors" && pid && <VendorSettings projectId={pid} />}

      {!loading && tab === "bills" && <section className="card space-y-3" data-bills><div className="flex flex-wrap items-center gap-3"><h2 className="font-medium">Vendor bills</h2>{monthPick}</div>
        <p className="text-xs text-slate-400">A vendor can send a bill every week, fortnight or month: record each one with the days it covers (never across a month end, and never overlapping another bill of the same vendor). Each bill is compared with the meals recorded for those days; you approve an amount (the bill, the computed amount, or your own), and that becomes what is due for those days. Days with no approved bill use the computed amount. Voiding a bill goes back to the computed amount.</p>
        {pv.map((v) => { const bs = billsOf(v.id, month); const mDays = Array.from({ length: lastDay(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`); const cov = (d: string) => { const b = bs.find((x) => d >= x.bill_from && d <= x.bill_to); return b ? b.status : null; };
          return (<div key={v.id} className="rounded-xl border border-slate-200 p-3 space-y-2" data-vendor-bills={v.name}>
            <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{v.name}</span><span className="text-xs text-slate-400">{bs.length} bill{bs.length === 1 ? "" : "s"} · ₹{inr(rangeOf(v.id, `${month}-01`, `${month}-31`).cost)} of meals recorded this month</span>
              <div className="flex gap-px ml-auto" aria-label="Days covered by a bill" data-coverage>{mDays.map((d) => { const c = cov(d); const has = (computed.d[v.id]?.[d]?.count ?? 0) > 0; return <span key={d} title={`${d.slice(8)}: ${c === "approved" ? "approved bill" : c === "received" ? "bill waiting for approval" : has ? "meals recorded, no bill" : "no meals, no bill"}`} className={`h-4 w-1.5 rounded-sm ${c === "approved" ? "bg-emerald-500" : c === "received" ? "bg-amber-400" : has ? "bg-slate-300" : "bg-slate-100"}`} />; })}</div>
              <button className="text-xs text-blue-700 underline" onClick={() => pickVendorForBill(v.id)}>+ Record a bill</button></div>
            {bs.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm min-w-[40rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Days</th><th className="text-right">Meals recorded</th><th className="text-right">Vendor's bill</th><th className="text-right">Difference</th><th className="text-left pl-3">Status</th><th></th></tr></thead>
              <tbody className="divide-y divide-slate-100">{bs.map((b) => { const r = rangeOf(v.id, b.bill_from, b.bill_to); const diff = b.bill_amount - r.cost; return (
                <tr key={b.id} className="align-top" data-bill-row><td className="py-2 font-medium whitespace-nowrap">{period(b)}</td><td className="text-right tabular-nums">₹{inr(r.cost)}<div className="text-[11px] text-slate-400">{r.count} meals</div></td>
                  <td className="text-right tabular-nums">₹{inr(b.bill_amount)}{b.bill_no && <div className="text-[11px] text-slate-400">{b.bill_no}</div>}</td>
                  <td className={`text-right tabular-nums ${Math.abs(diff) >= 1 ? (diff > 0 ? "text-rose-700 font-medium" : "text-emerald-700") : "text-slate-400"}`}>{Math.abs(diff) < 1 ? "Matches" : `${diff > 0 ? "+" : "−"}₹${inr(Math.abs(diff))}`}{Math.abs(diff) >= 1 && <div className="text-[11px] font-normal">{diff > 0 ? "charged more" : "charged less"}</div>}</td>
                  <td className="pl-3">{b.status === "approved" ? <><span className="rounded-full bg-emerald-50 text-emerald-700 text-[11px] px-2 py-0.5">Approved ₹{inr(b.approved_amount ?? 0)}</span><div className="text-[11px] text-slate-400">meals then ₹{inr(b.computed_amount ?? 0)}</div></> : <span className="rounded-full bg-amber-50 text-amber-800 text-[11px] px-2 py-0.5">Waiting for approval</span>}</td>
                  <td className="text-right pl-2 space-x-2 whitespace-nowrap">{b.status === "received" && <><button className="btn !py-0.5 !px-2 !text-xs btn-primary" onClick={() => approveBill(b, b.bill_amount)}>Approve bill</button><button className="btn !py-0.5 !px-2 !text-xs" disabled={!r.cost} onClick={() => approveBill(b, r.cost)}>Approve meals</button><button className="text-xs text-blue-700 underline" onClick={() => approveCustom(b)}>Other…</button></>}
                    {b.status === "approved" && <button className="text-xs text-blue-700 underline" onClick={() => reopenBill(b)}>Reopen</button>}
                    {b.bill_path && <a className="text-xs text-blue-700 underline" href={`/api/docs/view?path=${encodeURIComponent(b.bill_path)}`} target="_blank">Bill file</a>}
                    <button className="text-xs text-slate-500 underline" onClick={() => { setStmtVendor(v.id); setStmtFrom(b.bill_from); setStmtTo(b.bill_to); setTab("reports"); }}>See the meals</button><button className="text-xs text-red-700 underline" onClick={() => voidBill(b)}>Void</button></td></tr>); })}</tbody></table></div>}
          </div>); })}
        {!pv.length && <p className="text-sm text-slate-400">No vendors for this project yet.</p>}
        <p className="text-[11px] text-slate-400 flex flex-wrap gap-x-3"><span><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500 align-middle" /> approved</span><span><span className="inline-block h-2 w-2 rounded-sm bg-amber-400 align-middle" /> waiting for approval</span><span><span className="inline-block h-2 w-2 rounded-sm bg-slate-300 align-middle" /> meals but no bill yet</span></p>
        <div className="border-t border-slate-100 pt-3 space-y-2"><h3 className="text-sm font-medium">Record a bill</h3>
          <div className="flex flex-wrap gap-2 items-end">
            <select className="inp !w-44" aria-label="Bill vendor" value={bf.vendor_id} onChange={(e) => pickVendorForBill(e.target.value)}><option value="">Vendor…</option>{pv.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <label className="text-xs text-slate-500">From<input type="date" className="inp !w-36 block" value={bf.from} min={mFirst} max={mLast} onChange={(e) => setBf({ ...bf, from: e.target.value })} aria-label="Bill from" /></label>
            <label className="text-xs text-slate-500">To<input type="date" className="inp !w-36 block" value={bf.to} min={mFirst} max={mLast} onChange={(e) => setBf({ ...bf, to: e.target.value })} aria-label="Bill to" /></label>
            <span className="flex gap-1.5 pb-1.5 text-xs"><button type="button" className="text-blue-700 underline" onClick={() => bf.from && setBf({ ...bf, to: (addDays(bf.from, 6) > mLast ? mLast : addDays(bf.from, 6)) })}>week</button><button type="button" className="text-blue-700 underline" onClick={() => bf.from && setBf({ ...bf, to: (addDays(bf.from, 13) > mLast ? mLast : addDays(bf.from, 13)) })}>fortnight</button><button type="button" className="text-blue-700 underline" onClick={() => bf.from && setBf({ ...bf, to: mLast })}>to month end</button></span>
            <input className="inp !w-36" inputMode="decimal" placeholder="Bill amount ₹" aria-label="Bill amount" value={bf.amount} onChange={(e) => setBf({ ...bf, amount: e.target.value })} />
            <input className="inp !w-36" placeholder="Bill no. (optional)" aria-label="Bill number" value={bf.no} onChange={(e) => setBf({ ...bf, no: e.target.value })} />
            <input className="inp !w-48" placeholder="Note (optional)" aria-label="Bill note" value={bf.note} onChange={(e) => setBf({ ...bf, note: e.target.value })} />
            <label className="btn cursor-pointer truncate max-w-48">{billFile ? billFile.name : "Attach bill"}<input type="file" className="hidden" accept="image/*,application/pdf" aria-label="Attach bill file" onChange={(e) => setBillFile(e.target.files?.[0] ?? null)} /></label>
            <button className="btn btn-primary" disabled={busy} onClick={recordBill}>{busy ? "Saving…" : "Record bill"}</button></div></div>
        <div className="border-t border-slate-100 pt-3"><h3 className="text-sm font-medium mb-1">All bills</h3><ul className="divide-y divide-slate-100 text-sm" data-bill-list>{bills.filter((b) => ids.has(b.vendor_id)).sort((x, y) => y.bill_from.localeCompare(x.bill_from)).map((b) => <li key={b.id} className={`py-1.5 flex flex-wrap items-center gap-x-3 ${b.voided_at ? "text-slate-400 line-through" : ""}`}><span className="tabular-nums w-24">{b.bill_from.slice(0, 7)}</span><span className="w-20 whitespace-nowrap">{period(b)}</span><span className="w-32 truncate">{vName(b.vendor_id)}</span><span className="tabular-nums w-28">₹{inr(b.bill_amount)}</span><span className="text-xs flex-1 truncate">{b.voided_at ? "void" : b.status === "approved" ? `approved ₹${inr(b.approved_amount ?? 0)}` : "waiting for approval"}{b.bill_no ? ` · ${b.bill_no}` : ""}</span></li>)}</ul>{!bills.some((b) => ids.has(b.vendor_id)) && <p className="text-sm text-slate-400">No bills recorded.</p>}</div>
      </section>}

      {!loading && tab === "payments" && <section className="card space-y-3"><h2 className="font-medium">Payments</h2><p className="text-xs text-slate-400">Each payment is recorded once, here, and posts a Food expense on the project by itself. Payments are never edited; a wrong one is voided (its expense is removed) and entered again.</p>
        <div className="flex flex-wrap gap-2 items-end">
          <select className="inp !w-44" aria-label="Vendor" value={pf.vendor_id} onChange={(e) => setPf({ ...pf, vendor_id: e.target.value })}><option value="">Vendor…</option>{pv.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          <input className="inp !w-32" inputMode="decimal" placeholder="Amount ₹" aria-label="Amount" value={pf.amount} onChange={(e) => setPf({ ...pf, amount: e.target.value })} />
          <input className="inp !w-40" type="date" aria-label="Paid on" value={pf.paid_on} onChange={(e) => setPf({ ...pf, paid_on: e.target.value })} />
          <input className="inp !w-40" placeholder="Reference / UTR" aria-label="Reference" value={pf.reference} onChange={(e) => setPf({ ...pf, reference: e.target.value })} />
          <label className="text-xs text-slate-500 flex items-center gap-1">Bill<input type="file" accept="image/*,application/pdf" aria-label="Payment bill" className="max-w-[11rem] text-xs" onChange={(e) => setPfBill(e.target.files?.[0] ?? null)} /></label>
          <button className="btn btn-primary" onClick={addPay}>Record payment</button></div>
        <ul className="divide-y divide-slate-100 text-sm" data-payments>{myPays.map((x) => <li key={x.id} className={`py-2 flex flex-wrap items-center gap-x-3 ${x.voided_at ? "text-slate-400 line-through" : ""}`}><span className="tabular-nums w-24">{x.paid_on}</span><span className="w-32 truncate">{vName(x.vendor_id)}</span><span className="tabular-nums w-28">₹{inr(x.amount)}</span><span className="text-xs text-slate-400 flex-1 truncate">{x.reference}{x.note ? ` · ${x.note}` : ""}</span><PaymentBill path={x.bill_path} projectId={pid} onAttach={(path) => attach(x, path)} onError={setErr} />{x.voided_at ? <span className="text-xs">void</span> : <button className="text-xs text-red-700 underline" onClick={() => voidIt(x)}>Void</button>}</li>)}</ul>
        {!myPays.length && <p className="text-sm text-slate-400">No payments recorded.</p>}</section>}

      {!loading && tab === "reports" && <section className="card space-y-3"><div className="flex flex-wrap items-center gap-3"><h2 className="font-medium">Vendor statement</h2>{monthPick}<select className="inp !w-44" aria-label="Statement vendor" value={stmtV?.id ?? ""} onChange={(e) => setStmtVendor(e.target.value)}>{pv.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          <label className="text-xs text-slate-500 flex items-center gap-1.5">From<input type="date" className="inp !w-36" min={mFirst} max={mLast} value={sFrom} onChange={(e) => setStmtFrom(e.target.value)} aria-label="Statement from" /></label><label className="text-xs text-slate-500 flex items-center gap-1.5">to<input type="date" className="inp !w-36" min={mFirst} max={mLast} value={sTo} onChange={(e) => setStmtTo(e.target.value)} aria-label="Statement to" /></label>{(sFrom !== mFirst || sTo !== mLast) && <button className="text-xs text-blue-700 underline" onClick={() => { setStmtFrom(""); setStmtTo(""); }}>whole month</button>}</div>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[28rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Date</th>{MEALS.map((m) => <th key={m.key} className="text-right">{m.label}</th>)}<th className="text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{stmtRows.map((r) => <tr key={r.d}><td className="py-1.5 tabular-nums">{r.d}</td>{r.c.map((n, i) => <td key={i} className="text-right tabular-nums">{n || "—"}</td>)}<td className="text-right tabular-nums">₹{inr(r.amt)}</td></tr>)}
            {stmtRows.length > 0 && <tr className="font-medium"><td className="py-1.5">Total</td>{MEALS.map((m, i) => <td key={m.key} className="text-right tabular-nums">{stmtRows.reduce((s, r) => s + r.c[i], 0)}</td>)}<td className="text-right tabular-nums">₹{inr(stmtRows.reduce((s, r) => s + r.amt, 0))}</td></tr>}</tbody></table></div>
        {!stmtRows.length && <p className="text-sm text-slate-400">No meals for this vendor in these days.</p>}
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3"><button className="btn" disabled={!stmtRows.length} onClick={() => download(`${stmtV?.name} statement ${sFrom} to ${sTo}`, [["Date", ...MEALS.map((m) => m.label), "Amount"], ...stmtRows.map((r) => [r.d, ...r.c, r.amt])])}>⬇ Statement CSV</button>
          <button className="btn" disabled={!rows.length} onClick={() => download(`food summary ${month}`, [["Vendor", ...MEALS.map((m) => m.label), "This month", "Billed (all)", "Paid", "Due"], ...rows.map((o) => [o.v.name, ...o.counts, o.month, o.billed, o.paid, o.due])])}>⬇ Food summary CSV</button>
          <button className="btn" disabled={!perPerson.length} onClick={() => download(`meals per person ${month}`, [["Name", "Emp no.", ...MEALS.map((m) => m.label), "Cost"], ...perPerson.map((o) => [o.p.full_name, o.p.emp_no ?? "", ...o.c, o.cost])])}>⬇ Per-person CSV</button></div>
        <p className="text-xs text-slate-400">The statement lists the meals recorded for the vendor, day by day, with the amount at the price in force. It is what to check a vendor's bill against.</p></section>}
    </div>
  );
}
