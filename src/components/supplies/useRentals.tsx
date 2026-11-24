"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { useRole } from "@/lib/roles";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { BILLING, DEFAULT_VENDOR_TERMS, depositState, daysUsed, joinedFirstBill, onSite, perDay, rentFor, vendorNextBills, withReturns,
  type Billing, type Rates, type Rental, type RentalItem, type RentalTerms, type VendorTerms } from "@/lib/rentals";
import type { SupplyProject } from "./useGas";
import type { Computed } from "@/components/SiteBills";
import { ID_TYPES, JSL_LABEL, UNITS, type JslStatus } from "@/lib/inventory";

// Rented items on a project (Site supplies → Equipment → Rented; 2026-11-rentals.sql and 2026-11-rentals-vendor.sql, rent worked out in src/lib/rentals.ts).
//  Admin and Operations only (Supervisors, Site Engineers and Viewers do not see the tab, and the database refuses them).
//  - One card per vendor: what is on site across all its deliveries, rent from each delivery date to today, approved bills and payments, the next bill
//    expected (by the vendor's billing setting), returns, quotations. "Repeat delivery" fills a new delivery from the last ones, every field editable.
//  - Each delivery: its items, its own JSL portal entry (made when it is recorded), rates, minimum days, deposit; edit or void it.
//  - Returns are per vendor: what went back (and what did not come back) comes off the oldest delivery first. Partial returns are fine.
//  - The vendor's rent bills are recorded under Bills & payments and compared there with what these deliveries come to (compute), like Meals.
type Row = Rental & { delivery_vehicle: string; delivery_note_no: string; delivery_doc_path: string | null; note: string; return_vehicle: string; return_doc_path: string | null; return_note: string;
  inventory_bill_id: string | null; entered_by: string | null; created_at: string; void_reason: string };
type Line = { name: string; qty: string; unit: string; rate: string };
type Ret = { id: string; vendor_id: string; returned_on: string; vehicle: string; doc_path: string | null; note: string; voided_at: string | null; created_at: string };
type RetLine = { return_id: string; item_id: string; qty: number; missing: number };
type QLine = { name: string; unit: string; rate: number };
type Quote = { id: string; vendor_id: string; project_id: string | null; quote_no: string; quote_date: string; amount: number | null; note: string; file_path: string | null; lines: QLine[]; voided_at: string | null };
type SBill = { id: string; vendor_id: string; status: string; approved_amount: number | null; voided_at: string | null };
type SPay = { vendor_id: string; amount: number; voided_at: string | null };
const inr = (n: number) => "₹" + (Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const dm = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const blankLine = (): Line => ({ name: "", qty: "", unit: "No", rate: "" });
const num = (s: string) => s.replace(/[^\d.]/g, "");
const qn = (n: number) => String(Math.round(n * 1000) / 1000);
const key = (name: string, unit: string) => `${name.trim().toLowerCase()}|${unit}`;

async function upload(file: File, pid: string): Promise<string | { error: string }> {
  const f = await prepareUpload(file); if (f.size > MAX_UPLOAD) return { error: "The file is larger than 5 MB: please send a smaller photo or compressed PDF." };
  const fd = new FormData(); fd.set("file", f); fd.set("employeeId", `rent-${pid}`); fd.set("docType", "rental");
  const r = await fetch("/api/docs/upload", { method: "POST", body: fd }); if (!r.ok) return { error: await r.text() }; return (await r.json()).path as string;
}

export function useRentals(project: SupplyProject | undefined, vendors: { id: string; name: string }[], allVendors: { id: string; name: string }[]) {
  const pid = project?.id ?? ""; const closed = project?.status === "closed";
  const { role, staff } = useRole(); const today = istToday(); const money = staff; const isAdmin = role === "admin";
  const canAdd = staff && !closed;
  const [rentals, setRentals] = useState<Row[]>([]); const [rawItems, setRawItems] = useState<RentalItem[]>([]); const [terms, setTerms] = useState<Record<string, RentalTerms>>({}); const [rates, setRates] = useState<Rates>({});
  const [rets, setRets] = useState<Ret[]>([]); const [retLines, setRetLines] = useState<RetLine[]>([]); const [vterms, setVterms] = useState<Record<string, VendorTerms>>({}); const [quotes, setQuotes] = useState<Quote[]>([]);
  const [sbills, setSbills] = useState<SBill[]>([]); const [spays, setSpays] = useState<SPay[]>([]);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(""); const [missing, setMissing] = useState(false); const [needsV2, setNeedsV2] = useState(false);
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 6000); };
  const [portal, setPortal] = useState(false); const [people, setPeople] = useState<{ id: string; name: string; last4: string | null }[]>([]);
  const [bills, setBills] = useState<Record<string, { jsl_wanted: boolean; jsl_status: JslStatus; bill_date: string }>>({});
  const [billItems, setBillItems] = useState<Record<string, { name: string; qty: number; unit: string }[]>>({});   // what the Inventory entry (and so the JSL portal) holds
  const vName = (id: string) => allVendors.find((v) => v.id === id)?.name ?? vendors.find((v) => v.id === id)?.name ?? "Vendor";
  const vt = (vid: string): VendorTerms => vterms[vid] ?? DEFAULT_VENDOR_TERMS(vid);

  /** How the Inventory entry (what the JSL portal holds) differs from the delivery: the date and the items. Empty when they agree. */
  const portalDiff = (r: Row, its: RentalItem[]): string[] => {
    const b = r.inventory_bill_id ? bills[r.inventory_bill_id] : undefined; if (!b || !b.jsl_wanted || ["none", "authorized", "failed"].includes(b.jsl_status)) return [];
    const out: string[] = []; if (b.bill_date !== r.delivered_on) out.push(`Date: portal ${dmy(b.bill_date)}, delivery ${dmy(r.delivered_on)}`);
    const have = billItems[r.inventory_bill_id!] ?? [], k = (n: string) => n.trim().toLowerCase();
    its.forEach((i) => { const h = have.find((x) => k(x.name) === k(i.name)); if (!h) out.push(`${i.name}: ${i.qty} ${i.unit} on the delivery, not on the portal`); else if (h.qty !== i.qty || h.unit !== i.unit) out.push(`${i.name}: portal ${h.qty} ${h.unit}, delivery ${i.qty} ${i.unit}`); });
    have.forEach((h) => { if (!its.some((i) => k(i.name) === k(h.name))) out.push(`${h.name}: ${h.qty} ${h.unit} on the portal, not on the delivery`); });
    return out;
  };

  async function load() {
    if (!pid || !staff) return; const sb = supabase();
    void (async () => {   // the project's portal flag, and who could bring the items by hand (the last 4 Aadhaar digits only)
      const { data: pj } = await sb.from("projects").select("jsl_portal").eq("id", pid).maybeSingle(); const on = !!(pj as { jsl_portal?: boolean } | null)?.jsl_portal; setPortal(on);
      if (!on) { setPeople([]); return; }
      const { data: es } = await sb.from("employees").select("id, full_name, aadhaar, outcome, join_date, left_on").eq("project_id", pid).order("full_name");
      setPeople(((es || []) as { id: string; full_name: string; aadhaar: string | null; outcome: string | null; join_date: string | null; left_on: string | null }[])
        .filter((e) => e.outcome !== "rejected" && e.join_date && (!e.left_on || e.left_on >= today)).map((e) => ({ id: e.id, name: e.full_name, last4: e.aadhaar && /^\d{12}$/.test(e.aadhaar) ? e.aadhaar.slice(-4) : null })));
    })();
    const { data: rs, error } = await sb.from("rentals").select("*").eq("project_id", pid).order("delivered_on", { ascending: false });
    if (error) { if (/rentals|schema cache|does not exist/i.test(error.message)) { setMissing(true); return; } setErr(error.message); return; }
    setMissing(false); const list = (rs || []) as Row[]; setRentals(list);
    // phase 2 (2026-11-rentals-vendor.sql): vendor billing, returns per vendor, quotations
    const [vtq, rq, qq] = await Promise.all([sb.from("rental_vendor_terms").select("*"), sb.from("rental_returns").select("*").eq("project_id", pid).order("returned_on", { ascending: false }),
      sb.from("rental_quotes").select("*").or(`project_id.eq.${pid},project_id.is.null`).order("quote_date", { ascending: false })]);
    setNeedsV2(!!vtq.error);
    setVterms(Object.fromEntries(((vtq.data || []) as VendorTerms[]).map((t) => [t.vendor_id, { ...t, period_days: Number(t.period_days), min_days: Number(t.min_days), gst_pct: Number(t.gst_pct) }])));
    setRets((rq.data || []) as Ret[]); setQuotes(((qq.data || []) as Quote[]).map((x) => ({ ...x, amount: x.amount === null ? null : Number(x.amount), lines: (x.lines || []).map((l) => ({ ...l, rate: Number(l.rate) })) })));
    const ids = list.map((r) => r.id); if (!ids.length) { setRawItems([]); setTerms({}); setRates({}); setBills({}); setRetLines([]); return; }
    const billIds = list.map((r) => r.inventory_bill_id).filter(Boolean) as string[];
    if (billIds.length) { const { data: bs } = await sb.from("inventory_bills").select("id, jsl_wanted, jsl_status, bill_date").in("id", billIds); setBills(Object.fromEntries(((bs || []) as { id: string; jsl_wanted: boolean; jsl_status: JslStatus; bill_date: string }[]).map((b) => [b.id, b])));
      const { data: bi } = await sb.from("inventory_bill_items").select("bill_id, name, qty, unit").in("bill_id", billIds).order("line_no"); const byBill: Record<string, { name: string; qty: number; unit: string }[]> = {};
      ((bi || []) as { bill_id: string; name: string; qty: number; unit: string }[]).forEach((x) => { (byBill[x.bill_id] ??= []).push({ name: x.name, qty: Number(x.qty), unit: x.unit }); }); setBillItems(byBill);
    } else { setBills({}); setBillItems({}); }
    const { data: it } = await sb.from("rental_items").select("*").in("rental_id", ids).order("line_no"); const its = ((it || []) as RentalItem[]).map((x) => ({ ...x, qty: Number(x.qty), missing_qty: Number(x.missing_qty) })); setRawItems(its);
    const rids = ((rq.data || []) as Ret[]).map((x) => x.id);
    if (rids.length) { const { data: rl } = await sb.from("rental_return_lines").select("return_id, item_id, qty, missing").in("return_id", rids); setRetLines(((rl || []) as RetLine[]).map((l) => ({ ...l, qty: Number(l.qty), missing: Number(l.missing) }))); } else setRetLines([]);
    if (money) {
      const [{ data: tm }, { data: rt }, { data: sbs }, { data: sps }] = await Promise.all([sb.from("rental_terms").select("*").in("rental_id", ids), sb.from("rental_item_rates").select("item_id, rate").in("item_id", its.map((x) => x.id)),
        sb.from("site_bills").select("id, vendor_id, status, approved_amount, voided_at").eq("project_id", pid).eq("kind", "equipment"), sb.from("site_payments").select("vendor_id, amount, voided_at").eq("project_id", pid).eq("kind", "equipment")]);
      setTerms(Object.fromEntries(((tm || []) as RentalTerms[]).map((t) => [t.rental_id, { ...t, period_days: Number(t.period_days), min_days: Number(t.min_days), gst_pct: Number(t.gst_pct), deposit: Number(t.deposit), deduction: Number(t.deduction), refund_amount: t.refund_amount === null ? null : Number(t.refund_amount) }])));
      setRates(Object.fromEntries(((rt || []) as { item_id: string; rate: number }[]).map((r) => [r.item_id, Number(r.rate)])));
      setSbills(((sbs || []) as SBill[]).map((b) => ({ ...b, approved_amount: b.approved_amount === null ? null : Number(b.approved_amount) }))); setSpays(((sps || []) as SPay[]).map((p) => ({ ...p, amount: Number(p.amount) })));
    }
  }
  useEffect(() => { void load(); }, [pid, role, money]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the items with what has gone back on each live return
  const items = useMemo(() => { const on = new Map(rets.filter((x) => !x.voided_at).map((x) => [x.id, x.returned_on]));
    return withReturns(rawItems, retLines.filter((l) => on.has(l.return_id)).map((l) => ({ item_id: l.item_id, qty: l.qty, missing: l.missing, on: on.get(l.return_id)! }))); }, [rawItems, retLines, rets]);
  const itemsOf = (rid: string) => items.filter((i) => i.rental_id === rid);
  const liveOf = (vid: string) => rentals.filter((r) => r.vendor_id === vid && !r.voided_at);

  // ---------- record a delivery (fresh, or a repeat of the vendor's last ones: every field stays editable) ----------
  type Form = { vendor_id: string; delivered_on: string; vehicle: string; note_no: string; note: string; file: File | null; lines: Line[]; min_days: string; gst_pct: string; deposit: string; deposit_paid_on: string;
    jsl: "none" | "vehicle" | "hand"; driver_name: string; driver_dl_no: string; codriver_name: string; codriver_id_type: string; codriver_id_no: string; person: string; person_name: string; person_id_type: string; person_id_no: string; repeatOf: string | null };
  const blankForm = (vid = vendors[0]?.id ?? ""): Form => ({ vendor_id: vid, delivered_on: today, vehicle: "", note_no: "", note: "", file: null, lines: [blankLine()],
    min_days: String(vt(vid).min_days), gst_pct: String(vt(vid).gst_pct), deposit: "", deposit_paid_on: today,
    jsl: portal ? "vehicle" : "none", driver_name: "", driver_dl_no: "", codriver_name: "", codriver_id_type: "", codriver_id_no: "", person: "", person_name: "", person_id_type: "", person_id_no: "", repeatOf: null });
  const [form, setForm] = useState<Form | null>(null);
  const vendorChoices = staff ? allVendors : vendors;
  async function repeatDelivery(vid: string) {
    const last = [...liveOf(vid)].sort((a, b) => b.delivered_on.localeCompare(a.delivered_on) || b.created_at.localeCompare(a.created_at))[0]; if (!last) return;
    // the same items as the vendor's deliveries so far (latest first, so a changed rate wins), quantities left for today's count
    const seen = new Map<string, Line>(); [...liveOf(vid)].sort((a, b) => b.delivered_on.localeCompare(a.delivered_on)).forEach((r) => itemsOf(r.id).forEach((i) => { const k = key(i.name, i.unit); if (!seen.has(k)) seen.set(k, { name: i.name, qty: "", unit: i.unit, rate: rates[i.id] !== undefined ? String(rates[i.id]) : "" }); }));
    const t = terms[last.id]; const f: Form = { ...blankForm(vid), vehicle: last.delivery_vehicle, lines: seen.size ? [...seen.values()] : [blankLine()], min_days: String(t?.min_days ?? vt(vid).min_days), gst_pct: String(t?.gst_pct ?? vt(vid).gst_pct), repeatOf: last.delivered_on };
    if (portal && last.inventory_bill_id) {   // who brought it last time, for the JSL portal entry
      const { data: g } = await supabase().from("inventory_gatepass").select("*").eq("bill_id", last.inventory_bill_id).maybeSingle();
      const x = g as { received_by: string; person_source: string; person_employee_id: string | null; person_name: string; person_id_type: string; person_id_no: string; driver_name: string; driver_dl_no: string; codriver_name: string; codriver_id_type: string; codriver_id_no: string } | null;
      if (x?.received_by === "vehicle") Object.assign(f, { jsl: "vehicle", driver_name: x.driver_name, driver_dl_no: x.driver_dl_no, codriver_name: x.codriver_name, codriver_id_type: x.codriver_id_type, codriver_id_no: x.codriver_id_no });
      else if (x?.received_by === "hand") Object.assign(f, x.person_source === "employee" && x.person_employee_id ? { jsl: "hand", person: x.person_employee_id } : { jsl: "hand", person: "__other", person_name: x.person_name, person_id_type: x.person_id_type, person_id_no: x.person_id_no });
      else if (last.inventory_bill_id && bills[last.inventory_bill_id] && !bills[last.inventory_bill_id].jsl_wanted) f.jsl = "none";
    }
    setErr(""); setForm(f); setTimeout(() => document.getElementById("rent-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  const quoteFor = (vid: string) => quotes.find((q) => q.vendor_id === vid && !q.voided_at && q.lines.length > 0);
  function ratesFromQuote() {
    if (!form) return; const q = quoteFor(form.vendor_id); if (!q) return; let n = 0;
    setForm({ ...form, lines: form.lines.map((l) => { const m = q.lines.find((x) => key(x.name, x.unit) === key(l.name, l.unit)) ?? q.lines.find((x) => x.name.trim().toLowerCase() === l.name.trim().toLowerCase()); if (!m) return l; n++; return { ...l, rate: String(m.rate) }; }) });
    note(n ? `Rates filled from quotation ${q.quote_no || dmy(q.quote_date)} for ${n} item${n === 1 ? "" : "s"} ✓` : "No item names match the quotation.");
  }
  async function saveDelivery() {
    if (!form) return; const lines = form.lines.filter((l) => l.name.trim() || l.qty);
    if (!form.vendor_id) { setErr("Choose the vendor."); return; }
    if (!lines.length || lines.some((l) => !l.name.trim() || !(parseFloat(l.qty) > 0))) { setErr(form.repeatOf ? "Every item needs today's quantity. Remove the items that did not come." : "Every item needs a name and a quantity."); return; }
    const jsl = !portal || form.jsl === "none" ? null : form.jsl === "vehicle"
      ? { received_by: "vehicle", driver_name: form.driver_name.trim(), driver_dl_no: form.driver_dl_no.trim(), codriver_name: form.codriver_name.trim(), codriver_id_type: form.codriver_id_type, codriver_id_no: form.codriver_id_no.trim() }
      : form.person && form.person !== "__other" ? { received_by: "hand", person_employee_id: form.person }
      : { received_by: "hand", person_name: form.person_name.trim(), person_id_type: form.person_id_type, person_id_no: form.person_id_no.trim() };
    if (jsl?.received_by === "vehicle" && (!form.vehicle.trim() || !form.driver_name.trim() || !form.driver_dl_no.trim())) { setErr("For the JSL portal, enter the vehicle number, the driver's name and licence number."); return; }
    if (jsl?.received_by === "hand" && !form.person) { setErr("For the JSL portal, choose who is bringing it."); return; }
    if (jsl?.received_by === "hand" && form.person === "__other" && (!form.person_name.trim() || !form.person_id_type || !form.person_id_no.trim())) { setErr("Enter the name, ID type and ID number of the person bringing it."); return; }
    if (jsl?.received_by === "hand" && form.person !== "__other" && !people.find((x) => x.id === form.person)?.last4) { setErr("That person has no Aadhaar on their employee record. Choose someone else or someone not on the team."); return; }
    setBusy("save"); setErr("");
    let path: string | null = null; if (form.file) { const u = await upload(form.file, pid); if (typeof u !== "string") { setErr(u.error); setBusy(""); return; } path = u; }
    const sb = supabase();
    const { data: rid, error } = await sb.rpc("rental_create", { p_project: pid, p_vendor: form.vendor_id, p_delivered_on: form.delivered_on, p_vehicle: form.vehicle, p_note_no: form.note_no, p_doc_path: path, p_note: form.note,
      p_items: lines.map((l) => ({ name: l.name.trim(), qty: parseFloat(l.qty), unit: l.unit.trim() || "No" })), p_jsl: jsl });
    if (error || !rid) { setErr(error?.message ?? "Could not save."); setBusy(""); return; }
    if (money) {   // the money the form also took: terms and rates; the vendor's billing setting is made with the defaults the first time
      const v = vt(form.vendor_id);
      await sb.from("rental_terms").update({ billing: v.billing, period_days: v.period_days, min_days: parseInt(form.min_days, 10) || 0, gst_pct: parseFloat(form.gst_pct) || 0,
        deposit: parseFloat(form.deposit) || 0, deposit_paid_on: parseFloat(form.deposit) > 0 ? form.deposit_paid_on || null : null, updated_at: new Date().toISOString() }).eq("rental_id", rid);
      if (!vterms[form.vendor_id] && !needsV2) await sb.from("rental_vendor_terms").upsert({ ...DEFAULT_VENDOR_TERMS(form.vendor_id), min_days: parseInt(form.min_days, 10) || 0, gst_pct: parseFloat(form.gst_pct) || 0 }, { onConflict: "vendor_id", ignoreDuplicates: true });
      const { data: made } = await sb.from("rental_items").select("id, line_no").eq("rental_id", rid);
      const rows = ((made || []) as { id: string; line_no: number }[]).map((m) => ({ item_id: m.id, rate: parseFloat(lines[m.line_no - 1]?.rate ?? "") })).filter((x) => x.rate >= 0);
      if (rows.length) await sb.from("rental_item_rates").upsert(rows.map((x) => ({ ...x, updated_at: new Date().toISOString() })));
    }
    setBusy(""); setForm(null); note(!portal ? "Delivery recorded ✓" : jsl ? "Delivery recorded ✓ Its own JSL portal entry is in Inventory, ready for an Admin to authorize." : "Delivery recorded ✓ It is in Inventory, without a JSL portal entry (you can switch one on there)."); await load();
  }

  // ---------- a delivery's terms and rates, and its deposit (Operations / Admin) ----------
  const [tf, setTf] = useState<{ rid: string; min_days: string; gst_pct: string; deposit: string; deposit_paid_on: string; deposit_ref: string; rates: Record<string, string> } | null>(null);
  const openTerms = (r: Row) => { const t = terms[r.id]; setTf({ rid: r.id, min_days: String(t?.min_days ?? 0), gst_pct: String(t?.gst_pct ?? 0), deposit: t?.deposit ? String(t.deposit) : "",
    deposit_paid_on: t?.deposit_paid_on ?? today, deposit_ref: (t as unknown as { deposit_ref?: string })?.deposit_ref ?? "", rates: Object.fromEntries(itemsOf(r.id).map((i) => [i.id, rates[i.id] === undefined ? "" : String(rates[i.id])])) }); };
  async function saveTerms() {
    if (!tf) return; setBusy("terms"); setErr(""); const sb = supabase(); const dep = parseFloat(tf.deposit) || 0;
    const { error } = await sb.from("rental_terms").upsert({ rental_id: tf.rid, min_days: parseInt(tf.min_days, 10) || 0, gst_pct: parseFloat(tf.gst_pct) || 0,
      deposit: dep, deposit_paid_on: dep > 0 ? tf.deposit_paid_on || null : null, deposit_ref: tf.deposit_ref.trim(), updated_at: new Date().toISOString() });
    const rows = Object.entries(tf.rates).filter(([, v]) => v !== "").map(([item_id, v]) => ({ item_id, rate: parseFloat(v) || 0, updated_at: new Date().toISOString() }));
    const e2 = rows.length ? (await sb.from("rental_item_rates").upsert(rows)).error : null;
    setBusy(""); if (error || e2) { setErr((error || e2)!.message); return; } setTf(null); note("Terms and rates saved ✓"); await load();
  }
  const [df, setDf] = useState<{ rid: string; deduction: string; deduction_note: string; refund_amount: string; refund_on: string; refund_ref: string } | null>(null);
  const openDeposit = (r: Row) => { const t = terms[r.id] as (RentalTerms & { deduction_note?: string; refund_ref?: string }) | undefined; const s = depositState(r, t ?? null); setDf({ rid: r.id, deduction: t?.deduction ? String(t.deduction) : "", deduction_note: t?.deduction_note ?? "", refund_amount: String(t?.refund_amount ?? s.due), refund_on: t?.refund_on ?? today, refund_ref: t?.refund_ref ?? "" }); };
  async function saveDeposit(received: boolean) {
    if (!df) return; setBusy("deposit"); setErr("");
    const { error } = await supabase().from("rental_terms").update({ deduction: parseFloat(df.deduction) || 0, deduction_note: df.deduction_note.trim(), refund_amount: received ? parseFloat(df.refund_amount) || 0 : null, refund_on: received ? df.refund_on : null, refund_ref: received ? df.refund_ref.trim() : "", updated_at: new Date().toISOString() }).eq("rental_id", df.rid);
    setBusy(""); if (error) { setErr(error.message); return; } setDf(null); note(received ? "Deposit refund recorded ✓" : "Saved ✓"); await load();
  }

  // ---------- edit a delivery: date, vehicle, note number, note and the items (rental_update; its Inventory entry follows) ----------
  const [ef, setEf] = useState<{ rid: string; delivered_on: string; vehicle: string; note_no: string; note: string; lines: (Line & { id: string | null })[] } | null>(null);
  const openEdit = (r: Row) => { setErr(""); setTf(null); setEf({ rid: r.id, delivered_on: r.delivered_on, vehicle: r.delivery_vehicle, note_no: r.delivery_note_no, note: r.note,
    lines: itemsOf(r.id).map((i) => ({ id: i.id, name: i.name, qty: String(i.qty), unit: i.unit, rate: rates[i.id] !== undefined ? String(rates[i.id]) : "" })) }); };
  async function saveEdit() {
    if (!ef) return; const lines = ef.lines.filter((l) => l.name.trim() || l.qty);
    if (!lines.length || lines.some((l) => !l.name.trim() || !(parseFloat(l.qty) > 0))) { setErr("Every item needs a name and a quantity."); return; }
    const b = rentals.find((r) => r.id === ef.rid)?.inventory_bill_id; const st = b ? bills[b]?.jsl_status : undefined;
    if (st === "authorized" && !confirm("This delivery is authorized for the JSL portal. Saving withdraws that, so an Admin authorizes it again. Save?")) return;
    if (b && st && !["none", "authorized", "failed"].includes(st) && !confirm("This delivery is already on the JSL portal. Saving changes the rent here, but the portal entry stays as it was submitted, so correct it on the portal too. Save?")) return;
    setBusy("edit"); setErr("");
    const { error } = await supabase().rpc("rental_update", { p_rental: ef.rid, p_delivered_on: ef.delivered_on, p_vehicle: ef.vehicle, p_note_no: ef.note_no, p_note: ef.note,
      p_items: lines.map((l) => ({ id: l.id, name: l.name.trim(), qty: parseFloat(l.qty), unit: l.unit || "No", rate: l.rate === "" ? null : parseFloat(l.rate) })) });
    setBusy(""); if (error) { setErr(error.message); return; }
    setEf(null); note(b && st && !["none", "authorized", "failed"].includes(st) ? "Delivery updated ✓ Rent follows it. The portal entry is unchanged: correct it on the portal." : b ? "Delivery updated ✓ Its Inventory entry has the same items." : "Delivery updated ✓"); await load();
  }
  async function voidRental(r: Row) {
    const why = prompt("Void this delivery? Its JSL portal entry is voided too (only while it is not on the portal). Reason:"); if (why === null) return;
    const { error } = await supabase().rpc("rental_void", { p_rental: r.id, p_reason: why }); if (error) { setErr(error.message); return; } note("Voided ✓"); await load();
  }

  // ---------- per vendor: what is on site, returns, billing, quotations ----------
  /** Each item (name + unit) across the vendor's deliveries: how many came on each delivery, how many are on site now. */
  const groupsOf = (vid: string) => { const g = new Map<string, { name: string; unit: string; parts: { on: string; qty: number }[]; onSite: number; back: number }>();
    [...liveOf(vid)].sort((a, b) => a.delivered_on.localeCompare(b.delivered_on)).forEach((r) => itemsOf(r.id).forEach((i) => { const k = key(i.name, i.unit); const x = g.get(k) ?? { name: i.name, unit: i.unit, parts: [], onSite: 0, back: 0 };
      x.parts.push({ on: r.delivered_on, qty: i.qty }); x.onSite += onSite(i); x.back += i.qty - onSite(i); g.set(k, x); }));
    return [...g.values()]; };
  const [rf, setRf] = useState<{ vid: string; on: string; vehicle: string; note: string; file: File | null; back: Record<string, string>; lost: Record<string, string> } | null>(null);
  async function saveReturn() {
    if (!rf) return; const lines = groupsOf(rf.vid).map((g) => { const k = key(g.name, g.unit); return { name: g.name, unit: g.unit, qty: parseFloat(rf.back[k] || "0") || 0, missing: parseFloat(rf.lost[k] || "0") || 0, max: g.onSite }; }).filter((l) => l.qty + l.missing > 0);
    if (!lines.length) { setErr("Enter how many of each item went back."); return; }
    const over = lines.find((l) => l.qty + l.missing > l.max + 1e-9); if (over) { setErr(`Only ${qn(over.max)} ${over.unit} of ${over.name} are on site.`); return; }
    setBusy("return"); setErr("");
    let path: string | null = null; if (rf.file) { const u = await upload(rf.file, pid); if (typeof u !== "string") { setErr(u.error); setBusy(""); return; } path = u; }
    const { error } = await supabase().rpc("rental_vendor_return", { p_project: pid, p_vendor: rf.vid, p_returned_on: rf.on, p_vehicle: rf.vehicle, p_doc_path: path, p_note: rf.note, p_lines: lines.map(({ max: _m, ...l }) => l) });
    setBusy(""); if (error) { setErr(error.message); return; } setRf(null); note("Return recorded ✓ Rent stops for what went back, oldest delivery first."); await load();
  }
  async function undoReturn(x: Ret) { if (!confirm(`Undo the return of ${dmy(x.returned_on)}? Those items count as on site again.`)) return; const { error } = await supabase().rpc("rental_return_void", { p_return: x.id }); if (error) { setErr(error.message); return; } note("Return undone ✓"); await load(); }

  const [vf, setVf] = useState<{ vid: string; billing: Billing; period_days: string; join_cycle: boolean; min_days: string; gst_pct: string } | null>(null);
  const openVendorTerms = (vid: string) => { const t = vt(vid); setErr(""); setVf({ vid, billing: t.billing, period_days: String(t.period_days), join_cycle: t.join_cycle, min_days: String(t.min_days), gst_pct: String(t.gst_pct) }); };
  async function saveVendorTerms() {
    if (!vf) return; setBusy("vterms"); setErr("");
    const { error } = await supabase().from("rental_vendor_terms").upsert({ vendor_id: vf.vid, billing: vf.billing, period_days: parseInt(vf.period_days, 10) || 30, join_cycle: vf.join_cycle, min_days: parseInt(vf.min_days, 10) || 0, gst_pct: parseFloat(vf.gst_pct) || 0, updated_at: new Date().toISOString() });
    setBusy(""); if (error) { setErr(error.message); return; } setVf(null); note("Billing saved ✓ It applies to all of this vendor's deliveries. Minimum days and GST are what new deliveries start with."); await load();
  }

  const [qf, setQf] = useState<{ vid: string; quote_no: string; quote_date: string; amount: string; note: string; file: File | null; lines: { name: string; unit: string; rate: string }[] } | null>(null);
  const openQuote = (vid: string) => { setErr(""); const g = groupsOf(vid); const rateOf = (name: string, unit: string) => { const it = items.find((i) => liveOf(vid).some((r) => r.id === i.rental_id) && key(i.name, i.unit) === key(name, unit) && rates[i.id] !== undefined); return it ? String(rates[it.id]) : ""; };
    setQf({ vid, quote_no: "", quote_date: today, amount: "", note: "", file: null, lines: g.length ? g.map((x) => ({ name: x.name, unit: x.unit, rate: rateOf(x.name, x.unit) })) : [{ name: "", unit: "No", rate: "" }] }); };
  async function saveQuote() {
    if (!qf) return; const lines = qf.lines.filter((l) => l.name.trim()).map((l) => ({ name: l.name.trim(), unit: l.unit || "No", rate: parseFloat(l.rate) || 0 }));
    if (!qf.quote_date) { setErr("Enter the quotation's date."); return; }
    setBusy("quote"); setErr("");
    let path: string | null = null; if (qf.file) { const u = await upload(qf.file, pid); if (typeof u !== "string") { setErr(u.error); setBusy(""); return; } path = u; }
    const { error } = await supabase().from("rental_quotes").insert({ vendor_id: qf.vid, project_id: pid, quote_no: qf.quote_no.trim(), quote_date: qf.quote_date, amount: qf.amount === "" ? null : parseFloat(qf.amount) || 0, note: qf.note.trim(), file_path: path, lines });
    setBusy(""); if (error) { setErr(error.message); return; } setQf(null); note("Quotation saved ✓ It is for reference only: it is not owed and is not an expense."); await load();
  }
  async function voidQuote(q: Quote) { if (!confirm(`Remove quotation ${q.quote_no || dmy(q.quote_date)}? It stays in the list, crossed out.`)) return; const { error } = await supabase().from("rental_quotes").update({ voided_at: new Date().toISOString() }).eq("id", q.id); if (error) { setErr(error.message); return; } await load(); }

  // ---------- for Bills & payments: what a vendor's deliveries on this project come to for the dates a bill covers, item by item ----------
  const compute = (vendorId: string, from: string, to: string): Computed => {
    const lines: string[] = []; let total = 0, unpriced = 0;
    rentals.filter((r) => r.vendor_id === vendorId && !r.voided_at).sort((a, b) => a.delivered_on.localeCompare(b.delivered_on)).forEach((r) => { const its = itemsOf(r.id), t = terms[r.id] ?? null; const x = rentFor(r, its, rates, t, from, to); if (!x.total && !x.days) return; total += x.total; if (!x.priced) unpriced++;
      lines.push(`Delivery of ${dmy(r.delivered_on)}: ${inr(x.base)}${x.gst ? ` + GST ${inr(x.gst)}` : ""}`);
      its.forEach((i) => { const one = rentFor(r, [i], rates, t ? { ...t, gst_pct: 0 } : null, from, to); if (!one.base && rates[i.id] !== undefined) return;
        lines.push(`   ${i.name}: ${qn(i.qty)} ${i.unit}${i.qty !== onSite(i) ? ` (${qn(i.qty - onSite(i))} back)` : ""} × ${rates[i.id] === undefined ? "no rate" : inr(rates[i.id])}/day → ${inr(one.base)}`); }); });
    return { amount: Math.round(total * 100) / 100, lines, warn: unpriced ? `${unpriced} deliver${unpriced === 1 ? "y has" : "ies have"} items without a rate, so they count as ₹0` : "" };
  };

  const heldTotal = useMemo(() => rentals.reduce((s, r) => s + depositState(r, terms[r.id] ?? null).held, 0), [rentals, terms]);
  const vendorIds = [...new Set(rentals.filter((r) => !r.voided_at).map((r) => r.vendor_id))];
  const liveVendors = vendorIds.filter((vid) => liveOf(vid).some((r) => !r.returned_on)), doneVendors = vendorIds.filter((vid) => !liveVendors.includes(vid));
  const [openQuotes, setOpenQuotes] = useState<string | null>(null); const [openRets, setOpenRets] = useState<string | null>(null);

  // ---------- one delivery ----------
  const card = (r: Row) => {
    const its = itemsOf(r.id), t = terms[r.id] ?? null, pd = perDay(its, rates), used = daysUsed(r, today), dep = depositState(r, t);
    const sofar = rentFor(r, its, rates, t, r.delivered_on, r.returned_on ?? today); const first = liveOf(r.vendor_id).map((x) => x.delivered_on).sort()[0];
    const joined = !r.voided_at && !r.returned_on ? joinedFirstBill(first, r.delivered_on, vt(r.vendor_id)) : null; const partly = its.some((i) => onSite(i) < i.qty);
    return (
      <div key={r.id} className={`rounded-xl border border-slate-200 bg-white p-3 space-y-2 ${r.voided_at ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <b className={`text-sm ${r.voided_at ? "line-through" : ""}`}>Delivery of {dmy(r.delivered_on)}</b>
          {r.voided_at ? <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">void</span> : r.returned_on ? <span className="text-[11px] rounded-full bg-slate-100 text-slate-700 px-2 py-0.5">All back {dmy(r.returned_on)}</span> : <span className="text-[11px] rounded-full bg-green-50 text-green-800 px-2 py-0.5">{partly ? "Partly back · " : "On site · "}day {used}</span>}
          {r.inventory_bill_id && bills[r.inventory_bill_id] && (bills[r.inventory_bill_id].jsl_wanted
            ? <span className={`text-[11px] rounded-full px-2 py-0.5 ${JSL_LABEL[bills[r.inventory_bill_id].jsl_status].cls}`}>JSL: {bills[r.inventory_bill_id].jsl_status === "none" ? "to authorize" : JSL_LABEL[bills[r.inventory_bill_id].jsl_status].text}</span>
            : <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">No JSL entry</span>)}
          <span className="text-xs text-slate-500 sm:ml-auto">{[r.delivery_vehicle, r.delivery_note_no && `note ${r.delivery_note_no}`].filter(Boolean).join(" · ")}</span>
        </div>
        {(() => { const d = r.voided_at ? [] : portalDiff(r, its); return d.length ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 space-y-0.5"><div className="font-medium">The JSL portal entry differs from this delivery. Rent follows the delivery below; correct the portal entry too.</div>{d.map((x) => <div key={x}>{x}</div>)}</div> : null; })()}
        <div className="flex flex-wrap gap-1.5">{its.map((i) => <span key={i.id} className="text-xs rounded-lg bg-slate-100 px-2 py-1">{i.name} · {qn(i.qty)} {i.unit}{money && rates[i.id] !== undefined ? ` · ${inr(rates[i.id])}/day` : ""}{onSite(i) < i.qty && <span className="text-slate-500"> · {qn(i.qty - onSite(i) - i.missing_qty)} back</span>}{i.missing_qty > 0 && <b className="text-rose-700"> · {qn(i.missing_qty)} not returned</b>}</span>)}</div>
        {money && !r.voided_at && <div className="grid gap-2 sm:grid-cols-3 text-sm">
          <div><div className="text-xs text-slate-400">Rent per day{r.returned_on ? "" : " now"}</div><b className="tabular-nums">{pd === null ? <span className="text-amber-700">rates missing</span> : inr(pd)}</b>{t?.gst_pct ? <span className="text-xs text-slate-400"> + {t.gst_pct}% GST</span> : null}</div>
          <div><div className="text-xs text-slate-400">{r.returned_on ? "Rent in all" : "Rent so far"}</div><b className="tabular-nums">{inr(sofar.total)}</b><span className="text-xs text-slate-400"> · {sofar.days} days{t?.min_days ? ` (min ${t.min_days})` : ""}</span></div>
          <div><div className="text-xs text-slate-400">Deposit</div>{dep.amount > 0 ? <><b className="tabular-nums">{inr(dep.amount)}</b><span className="text-xs text-slate-500"> · {!dep.paid ? "not paid yet" : dep.refunded || t?.refund_on ? `refunded ${inr(dep.refunded)}` : r.returned_on ? <b className="text-amber-700">{inr(dep.toCollect)} to collect</b> : "held"}</span></> : <span className="text-slate-400">none</span>}</div>
        </div>}
        {money && joined && r.delivered_on > first && <p className="text-xs text-slate-500">Joins {vName(r.vendor_id)}&apos;s billing: its first bill runs {dm(joined.from)} – {dm(joined.to)}, then it is billed with the rest.</p>}
        {(r.note || r.void_reason) && <p className="text-xs text-slate-500">{[r.note, r.voided_at && r.void_reason && `Void: ${r.void_reason}`].filter(Boolean).join(" · ")}</p>}
        <div className="flex flex-wrap gap-2">
          {!r.voided_at && !r.returned_on && staff && <button className="btn btn-sm" onClick={() => openEdit(r)}>Edit delivery</button>}
          {money && !r.voided_at && <button className="btn btn-sm" onClick={() => { setEf(null); openTerms(r); }}>{t && pd !== null ? "Rates, minimum & deposit" : "Set rates"}</button>}
          {money && !r.voided_at && dep.paid > 0 && r.returned_on && <button className="btn btn-sm" onClick={() => openDeposit(r)}>{t?.refund_on ? "Deposit details" : "Deposit back"}</button>}
          {r.delivery_doc_path && <a className="btn btn-sm" href={`/api/docs/view?path=${encodeURIComponent(r.delivery_doc_path)}`} target="_blank" rel="noreferrer" data-view-group={`rent-${r.vendor_id}`} data-view-name={`Delivery note ${dmy(r.delivered_on)} - ${vName(r.vendor_id)}`}>Delivery note</a>}
          {r.inventory_bill_id && <a className="btn btn-sm" href={`/inventory?bill=${r.inventory_bill_id}`}>{bills[r.inventory_bill_id]?.jsl_wanted ? "JSL portal entry" : "Inventory entry"}</a>}
          {!r.voided_at && staff && <button className="btn btn-sm btn-danger" onClick={() => voidRental(r)}>Void</button>}
        </div>
        {ef?.rid === r.id && <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="font-medium text-sm">Edit the delivery</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="lbl">Delivered on</label><input type="date" className="inp" max={today} value={ef.delivered_on} onChange={(e) => setEf({ ...ef, delivered_on: e.target.value })} /></div>
            <div><label className="lbl">Vehicle</label><input className="inp !w-40 uppercase" value={ef.vehicle} onChange={(e) => setEf({ ...ef, vehicle: e.target.value })} placeholder="GJ 01 AB 1234" /></div>
            <div><label className="lbl">Delivery note no.</label><input className="inp !w-32" value={ef.note_no} onChange={(e) => setEf({ ...ef, note_no: e.target.value })} /></div></div>
          <div className="space-y-1.5"><div className="lbl">Items</div>
            {ef.lines.map((l, i) => { const set = (p: Partial<typeof l>) => setEf({ ...ef, lines: ef.lines.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return <div key={l.id ?? `n${i}`} className="flex flex-wrap items-center gap-2">
                <input className="inp !w-48" placeholder="e.g. Scaffolding frame" value={l.name} onChange={(e) => set({ name: e.target.value })} />
                <input className="inp !w-20" inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => set({ qty: num(e.target.value) })} />
                <select className="inp !w-24" aria-label="Unit" value={l.unit} onChange={(e) => set({ unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
                <input className="inp !w-28" inputMode="decimal" placeholder="₹ per day each" value={l.rate} onChange={(e) => set({ rate: num(e.target.value) })} />
                {ef.lines.length > 1 && <button type="button" className="text-xs text-rose-700 hover:underline" onClick={() => setEf({ ...ef, lines: ef.lines.filter((_, j) => j !== i) })}>Remove</button>}
              </div>; })}
            <button type="button" className="btn btn-sm" onClick={() => setEf({ ...ef, lines: [...ef.lines, { ...blankLine(), id: null }] })}>+ Add item</button></div>
          <div><label className="lbl">Note (optional)</label><input className="inp" value={ef.note} onChange={(e) => setEf({ ...ef, note: e.target.value })} /></div>
          <div className="flex gap-2"><button className="btn btn-primary" disabled={busy === "edit"} onClick={saveEdit}>{busy === "edit" ? "Saving…" : "Save changes"}</button><button className="btn" onClick={() => setEf(null)}>Cancel</button></div>
          <p className="text-xs text-slate-400">{r.inventory_bill_id ? "Its Inventory entry gets the same date, note number and items (and the vehicle, when it goes by vehicle). Once the entry is on the JSL portal, a change here fixes the rent only: the portal entry stays as submitted, and you are told where it differs." : "Rates can also be changed later."} A quantity cannot go below what has already gone back.</p>
        </div>}
        {tf?.rid === r.id && <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="font-medium text-sm">Rates, minimum days and deposit for this delivery</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="lbl">Minimum days</label><input className="inp !w-24" inputMode="numeric" value={tf.min_days} onChange={(e) => setTf({ ...tf, min_days: num(e.target.value) })} /></div>
            <div><label className="lbl">GST %</label><input className="inp !w-20" inputMode="decimal" value={tf.gst_pct} onChange={(e) => setTf({ ...tf, gst_pct: num(e.target.value) })} /></div>
            <div><label className="lbl">Deposit (₹)</label><input className="inp !w-32" inputMode="decimal" value={tf.deposit} onChange={(e) => setTf({ ...tf, deposit: num(e.target.value) })} /></div>
            {parseFloat(tf.deposit) > 0 && <><div><label className="lbl">Deposit paid on</label><input type="date" className="inp" value={tf.deposit_paid_on} onChange={(e) => setTf({ ...tf, deposit_paid_on: e.target.value })} /></div><div><label className="lbl">Reference</label><input className="inp !w-36" value={tf.deposit_ref} onChange={(e) => setTf({ ...tf, deposit_ref: e.target.value })} placeholder="UTR / cheque" /></div></>}
          </div>
          <div><div className="lbl">Rate per unit per day (₹, before GST)</div><div className="flex flex-wrap gap-2">{its.map((i) => <label key={i.id} className="text-xs flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1">{i.name} × {qn(i.qty)}<input className="inp !w-20 !py-0.5" inputMode="decimal" value={tf.rates[i.id] ?? ""} onChange={(e) => setTf({ ...tf, rates: { ...tf.rates, [i.id]: num(e.target.value) } })} /></label>)}</div></div>
          <div className="flex gap-2"><button className="btn btn-primary" disabled={busy === "terms"} onClick={saveTerms}>{busy === "terms" ? "Saving…" : "Save"}</button><button className="btn" onClick={() => setTf(null)}>Cancel</button></div>
          <p className="text-xs text-slate-400">How the vendor bills (monthly, in advance…) is set once for the vendor, on its card above.</p>
        </div>}
        {df?.rid === r.id && <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="font-medium text-sm">Deposit of {inr(dep.amount)}</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="lbl">Kept back by the vendor (₹)</label><input className="inp !w-32" inputMode="decimal" value={df.deduction} onChange={(e) => setDf({ ...df, deduction: num(e.target.value), refund_amount: String(Math.max(0, dep.paid - (parseFloat(num(e.target.value)) || 0))) })} /></div>
            <div className="min-w-48 flex-1"><label className="lbl">Why</label><input className="inp" value={df.deduction_note} onChange={(e) => setDf({ ...df, deduction_note: e.target.value })} placeholder="e.g. 2 items not returned" /></div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="lbl">Refund received (₹)</label><input className="inp !w-32" inputMode="decimal" value={df.refund_amount} onChange={(e) => setDf({ ...df, refund_amount: num(e.target.value) })} /></div>
            <div><label className="lbl">On</label><input type="date" className="inp" max={today} value={df.refund_on} onChange={(e) => setDf({ ...df, refund_on: e.target.value })} /></div>
            <div><label className="lbl">Reference</label><input className="inp !w-36" value={df.refund_ref} onChange={(e) => setDf({ ...df, refund_ref: e.target.value })} /></div>
          </div>
          <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy === "deposit"} onClick={() => saveDeposit(true)}>Refund received</button><button className="btn" disabled={busy === "deposit"} onClick={() => saveDeposit(false)}>Save, not received yet</button><button className="btn" onClick={() => setDf(null)}>Cancel</button></div>
        </div>}
      </div>);
  };

  // ---------- one vendor ----------
  const vendorCard = (vid: string) => {
    const mine = rentals.filter((r) => r.vendor_id === vid).sort((a, b) => b.delivered_on.localeCompare(a.delivered_on)); const live = liveOf(vid); const groups = groupsOf(vid); const t = vt(vid);
    const anyOnSite = groups.some((g) => g.onSite > 0); const sofar = live.reduce((s, r) => s + rentFor(r, itemsOf(r.id), rates, terms[r.id] ?? null, r.delivered_on, r.returned_on ?? today).total, 0);
    const approved = sbills.filter((b) => b.vendor_id === vid && !b.voided_at && b.status === "approved").reduce((s, b) => s + (b.approved_amount ?? 0), 0);
    const waiting = sbills.filter((b) => b.vendor_id === vid && !b.voided_at && b.status !== "approved").length; const paid = spays.filter((p) => p.vendor_id === vid && !p.voided_at).reduce((s, p) => s + p.amount, 0);
    const next = vendorNextBills(live, t, today); const priced = live.every((r) => perDay(itemsOf(r.id), rates) !== null);
    const held = live.reduce((s, r) => s + depositState(r, terms[r.id] ?? null).held, 0);
    const myRets = rets.filter((x) => x.vendor_id === vid); const myQuotes = quotes.filter((q) => q.vendor_id === vid);
    const lineName = (l: RetLine) => { const i = rawItems.find((x) => x.id === l.item_id); return i ? `${i.name} ${qn(l.qty)}${l.missing ? ` + ${qn(l.missing)} not returned` : ""}` : ""; };
    const retSummary = (x: Ret) => { const m = new Map<string, number>(); retLines.filter((l) => l.return_id === x.id).forEach((l) => { const i = rawItems.find((y) => y.id === l.item_id); if (i) m.set(i.name, (m.get(i.name) ?? 0) + l.qty + l.missing); }); return [...m.entries()].map(([n, q]) => `${n} ${qn(q)}`).join(", "); };
    return (
      <section key={vid} className="card !p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{vName(vid)}</h3>
          {money && <span className="text-[11px] rounded-full bg-blue-50 text-blue-800 px-2 py-0.5">{t.billing === "advance" ? `${t.period_days} days, in advance${t.join_cycle ? "" : " · own cycle per delivery"}` : BILLING[t.billing]}</span>}
          <span className="text-xs text-slate-500">{live.length} deliver{live.length === 1 ? "y" : "ies"}</span>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {canAdd && <button className="btn btn-sm btn-primary" onClick={() => repeatDelivery(vid)}>Repeat delivery</button>}
            {canAdd && anyOnSite && <button className="btn btn-sm" onClick={() => { setErr(""); setRf({ vid, on: today, vehicle: "", note: "", file: null, back: {}, lost: {} }); }}>Items returned</button>}
            {money && !needsV2 && <button className="btn btn-sm" onClick={() => openVendorTerms(vid)}>Billing</button>}
          </div>
        </div>

        {groups.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1 pr-3 font-medium">Item</th><th className="py-1 pr-3 font-medium">Delivered</th><th className="py-1 pr-3 font-medium text-right">Gone back</th><th className="py-1 font-medium text-right">On site</th></tr></thead>
          <tbody>{groups.map((g) => <tr key={key(g.name, g.unit)} className="border-t border-slate-100">
            <td className="py-1 pr-3">{g.name} <span className="text-xs text-slate-400">{g.unit}</span></td>
            <td className="py-1 pr-3 text-slate-600 tabular-nums">{g.parts.map((p) => `${qn(p.qty)} (${dm(p.on)})`).join(" + ")}{g.parts.length > 1 ? ` = ${qn(g.parts.reduce((s, p) => s + p.qty, 0))}` : ""}</td>
            <td className="py-1 pr-3 text-right tabular-nums text-slate-500">{g.back ? qn(g.back) : "—"}</td>
            <td className="py-1 text-right tabular-nums font-semibold">{qn(g.onSite)}</td></tr>)}</tbody></table></div>}

        {money && <div className="grid gap-2 grid-cols-2 lg:grid-cols-5 text-sm">
          <div><div className="text-xs text-slate-400">Rent to date</div><b className="tabular-nums">{inr(Math.round(sofar * 100) / 100)}</b>{!priced && <div className="text-xs text-amber-700">some rates missing</div>}</div>
          <div><div className="text-xs text-slate-400">Bills approved</div><b className="tabular-nums">{inr(approved)}</b>{waiting > 0 && <div className="text-xs text-amber-700">{waiting} bill{waiting === 1 ? "" : "s"} to compare</div>}</div>
          <div><div className="text-xs text-slate-400">Paid</div><b className="tabular-nums">{inr(paid)}</b></div>
          <div><div className="text-xs text-slate-400">Left to pay</div><b className={`tabular-nums ${approved - paid > 0.004 ? "text-rose-700" : ""}`}>{approved - paid >= 0 ? inr(Math.round((approved - paid) * 100) / 100) : `${inr(Math.round((paid - approved) * 100) / 100)} ahead`}</b><div className="text-xs text-slate-400">on approved bills</div></div>
          <div><div className="text-xs text-slate-400">Deposits held</div><b className="tabular-nums">{held ? inr(held) : "—"}</b></div>
        </div>}
        {money && next.length > 0 && <div className="text-sm space-y-0.5">{next.map((n, i) => { const amt = live.filter((r) => n.rentalIds.includes(r.id)).reduce((s, r) => s + rentFor(r, itemsOf(r.id), rates, terms[r.id] ?? null, n.from, n.to).total, 0);
          return <p key={i}><span className="text-slate-500">Next bill expected:</span> <b className="tabular-nums">{inr(Math.round(amt * 100) / 100)}</b> <span className="text-slate-500">for {dmy(n.from)} – {dmy(n.to)}{n.dueOn ? ` · due ${dmy(n.dueOn)}` : " · when everything is returned"}{n.rentalIds.length < live.filter((r) => !r.returned_on).length ? ` · delivery of ${dmy(live.find((r) => r.id === n.rentalIds[0])?.delivered_on ?? n.from)}` : ""}</span></p>; })}
          <p className="text-xs text-slate-400">An estimate for checking the vendor&apos;s bill when it comes: record the bill under Bills &amp; payments, where it is compared with these deliveries.</p></div>}

        {vf?.vid === vid && <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="font-medium text-sm">How {vName(vid)} bills</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="lbl">Rent is billed</label><select className="inp !w-60" value={vf.billing} onChange={(e) => setVf({ ...vf, billing: e.target.value as Billing })}>{(Object.keys(BILLING) as Billing[]).map((k) => <option key={k} value={k}>{BILLING[k]}</option>)}</select></div>
            {vf.billing === "advance" && <div><label className="lbl">Every (days)</label><input className="inp !w-24" inputMode="numeric" value={vf.period_days} onChange={(e) => setVf({ ...vf, period_days: num(e.target.value) })} /></div>}
            <div><label className="lbl">Usual minimum days</label><input className="inp !w-24" inputMode="numeric" value={vf.min_days} onChange={(e) => setVf({ ...vf, min_days: num(e.target.value) })} /></div>
            <div><label className="lbl">Usual GST %</label><input className="inp !w-20" inputMode="decimal" value={vf.gst_pct} onChange={(e) => setVf({ ...vf, gst_pct: num(e.target.value) })} /></div>
          </div>
          {vf.billing === "advance" && <fieldset className="space-y-1 text-sm"><legend className="lbl">A later delivery is billed</legend>
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={vf.join_cycle} onChange={() => setVf({ ...vf, join_cycle: true })} /><span>With the first delivery: its first bill runs only to the end of the current {vf.period_days || 30}-day period, then everything is billed together</span></label>
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={!vf.join_cycle} onChange={() => setVf({ ...vf, join_cycle: false })} /><span>On its own: its own {vf.period_days || 30}-day periods from its delivery date</span></label></fieldset>}
          <p className="text-xs text-slate-400">{vf.billing === "month_end" ? "Like payroll: from the delivery date to the month end, then each calendar month, billed at its end. A later delivery joins the same months." : vf.billing === "month_advance" ? "From the delivery date to the month end, paid on delivery; then each calendar month, due on the 1st. A later delivery joins the same months." : vf.billing === "on_return" ? "One bill once everything has gone back." : "A full period is billed at its start."} This only says when a bill is expected; what is owed is the bills you approve. Minimum days and GST here are what new deliveries start with: each delivery keeps its own, as agreed.</p>
          <div className="flex gap-2"><button className="btn btn-primary" disabled={busy === "vterms"} onClick={saveVendorTerms}>{busy === "vterms" ? "Saving…" : "Save"}</button><button className="btn" onClick={() => setVf(null)}>Cancel</button></div>
        </div>}

        {rf?.vid === vid && <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="font-medium text-sm">Items returned to {vName(vid)}</div>
          <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Returned on</label><input type="date" className="inp" min={live.map((r) => r.delivered_on).sort()[0]} max={today} value={rf.on} onChange={(e) => setRf({ ...rf, on: e.target.value })} /></div>
            <div><label className="lbl">Vehicle</label><input className="inp !w-40 uppercase" value={rf.vehicle} onChange={(e) => setRf({ ...rf, vehicle: e.target.value })} placeholder="GJ 01 AB 1234" /></div>
            <div><label className="lbl">Vendor&apos;s receipt (photo or PDF)</label><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => setRf({ ...rf, file: e.target.files?.[0] ?? null })} /></div></div>
          <div className="overflow-x-auto"><table className="text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-1 pr-3 font-medium">Item</th><th className="py-1 pr-3 font-medium text-right">On site</th><th className="py-1 pr-3 font-medium">Went back</th><th className="py-1 font-medium">Did not come back</th></tr></thead>
            <tbody>{groups.filter((g) => g.onSite > 0).map((g) => { const k = key(g.name, g.unit); return <tr key={k} className="border-t border-slate-100"><td className="py-1 pr-3">{g.name} <span className="text-xs text-slate-400">{g.unit}</span></td><td className="py-1 pr-3 text-right tabular-nums">{qn(g.onSite)}</td>
              <td className="py-1 pr-3"><div className="flex items-center gap-1"><input className="inp !w-20 !py-1" inputMode="decimal" placeholder="0" aria-label={`${g.name} went back`} value={rf.back[k] ?? ""} onChange={(e) => setRf({ ...rf, back: { ...rf.back, [k]: num(e.target.value) } })} /><button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setRf({ ...rf, back: { ...rf.back, [k]: qn(g.onSite - (parseFloat(rf.lost[k] || "0") || 0)) } })}>all</button></div></td>
              <td className="py-1"><input className="inp !w-20 !py-1" inputMode="decimal" placeholder="0" aria-label={`${g.name} did not come back`} value={rf.lost[k] ?? ""} onChange={(e) => setRf({ ...rf, lost: { ...rf.lost, [k]: num(e.target.value) } })} /></td></tr>; })}</tbody></table></div>
          <div><label className="lbl">Note (optional)</label><input className="inp" value={rf.note} onChange={(e) => setRf({ ...rf, note: e.target.value })} placeholder="e.g. 1 item damaged" /></div>
          <div className="flex gap-2"><button className="btn btn-primary" disabled={busy === "return"} onClick={saveReturn}>{busy === "return" ? "Saving…" : "Save return"}</button><button className="btn" onClick={() => setRf(null)}>Cancel</button></div>
          <p className="text-xs text-slate-400">What went back comes off the oldest delivery first. Rent stops after the return day. What did not come back is charged until the return too; the loss comes off the deposit.</p>
        </div>}

        <div className="space-y-2">{mine.filter((r) => !r.voided_at && !r.returned_on).map(card)}
          {mine.some((r) => r.voided_at || r.returned_on) && <details><summary className="cursor-pointer text-sm text-slate-600">All back and void ({mine.filter((r) => r.voided_at || r.returned_on).length})</summary><div className="space-y-2 pt-2">{mine.filter((r) => r.voided_at || r.returned_on).map(card)}</div></details>}</div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {myRets.length > 0 && <button type="button" className="text-blue-700 hover:underline" aria-expanded={openRets === vid} onClick={() => setOpenRets(openRets === vid ? null : vid)}>Returns ({myRets.filter((x) => !x.voided_at).length})</button>}
          {money && !needsV2 && <button type="button" className="text-blue-700 hover:underline" aria-expanded={openQuotes === vid} onClick={() => setOpenQuotes(openQuotes === vid ? null : vid)}>Quotations ({myQuotes.filter((q) => !q.voided_at).length})</button>}
        </div>
        {openRets === vid && <ul className="text-sm space-y-1">{myRets.map((x) => <li key={x.id} className={`flex flex-wrap items-center gap-2 ${x.voided_at ? "opacity-60 line-through" : ""}`}>
          <b className="tabular-nums">{dmy(x.returned_on)}</b><span className="text-slate-600" title={retLines.filter((l) => l.return_id === x.id).map(lineName).join(" · ")}>{retSummary(x)}</span>
          <span className="text-xs text-slate-500">{[x.vehicle, x.note].filter(Boolean).join(" · ")}</span>
          {x.doc_path && <a className="tlink" href={`/api/docs/view?path=${encodeURIComponent(x.doc_path)}`} target="_blank" rel="noreferrer" data-view-group={`rent-${vid}`} data-view-name={`Return receipt ${dmy(x.returned_on)} - ${vName(vid)}`}>Receipt</a>}
          {!x.voided_at && staff && <button className="tlink tlink-danger" onClick={() => undoReturn(x)}>Undo</button>}</li>)}</ul>}
        {openQuotes === vid && <div className="space-y-2">
          {myQuotes.length === 0 && <p className="text-sm text-slate-500">No quotation saved.</p>}
          <ul className="text-sm space-y-1">{myQuotes.map((q) => <li key={q.id} className={`flex flex-wrap items-center gap-2 ${q.voided_at ? "opacity-60 line-through" : ""}`}>
            <b>{q.quote_no || "Quotation"}</b><span className="text-slate-500">{dmy(q.quote_date)}</span>{q.amount !== null && <span className="tabular-nums">{inr(q.amount)}</span>}
            {q.lines.length > 0 && <span className="text-xs text-slate-500">{q.lines.map((l) => `${l.name} ${inr(l.rate)}/day`).join(" · ")}</span>}{q.note && <span className="text-xs text-slate-500">{q.note}</span>}
            {q.file_path && <a className="tlink" href={`/api/docs/view?path=${encodeURIComponent(q.file_path)}`} target="_blank" rel="noreferrer">View</a>}
            {!q.voided_at && <button className="tlink tlink-danger" onClick={() => voidQuote(q)}>Remove</button>}</li>)}</ul>
          {qf?.vid === vid ? <div className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div><label className="lbl">Quotation no.</label><input className="inp !w-32" value={qf.quote_no} onChange={(e) => setQf({ ...qf, quote_no: e.target.value })} /></div>
              <div><label className="lbl">Date</label><input type="date" className="inp" value={qf.quote_date} onChange={(e) => setQf({ ...qf, quote_date: e.target.value })} /></div>
              <div><label className="lbl">Amount (₹, if any)</label><input className="inp !w-32" inputMode="decimal" value={qf.amount} onChange={(e) => setQf({ ...qf, amount: num(e.target.value) })} /></div>
              <div><label className="lbl">File (photo or PDF)</label><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => setQf({ ...qf, file: e.target.files?.[0] ?? null })} /></div></div>
            <div className="space-y-1.5"><div className="lbl">Rates quoted (₹ per unit per day, before GST)</div>
              {qf.lines.map((l, i) => { const set = (p: Partial<typeof l>) => setQf({ ...qf, lines: qf.lines.map((x, j) => (j === i ? { ...x, ...p } : x)) }); return <div key={i} className="flex flex-wrap items-center gap-2">
                <input className="inp !w-48" placeholder="Item" value={l.name} onChange={(e) => set({ name: e.target.value })} />
                <select className="inp !w-24" aria-label="Unit" value={l.unit} onChange={(e) => set({ unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
                <input className="inp !w-28" inputMode="decimal" placeholder="₹ per day" value={l.rate} onChange={(e) => set({ rate: num(e.target.value) })} />
                <button type="button" className="text-xs text-rose-700 hover:underline" onClick={() => setQf({ ...qf, lines: qf.lines.filter((_, j) => j !== i) })}>Remove</button></div>; })}
              <button type="button" className="btn btn-sm" onClick={() => setQf({ ...qf, lines: [...qf.lines, { name: "", unit: "No", rate: "" }] })}>+ Add item</button></div>
            <div><label className="lbl">Note (optional)</label><input className="inp" value={qf.note} onChange={(e) => setQf({ ...qf, note: e.target.value })} placeholder="e.g. the paper says invoice, but it is a quotation" /></div>
            <div className="flex gap-2"><button className="btn btn-primary" disabled={busy === "quote"} onClick={saveQuote}>{busy === "quote" ? "Saving…" : "Save quotation"}</button><button className="btn" onClick={() => setQf(null)}>Cancel</button></div>
          </div> : canAdd && <button className="btn btn-sm" onClick={() => openQuote(vid)}>+ Add a quotation</button>}
          <p className="text-xs text-slate-400">For reference only: a quotation is never owed and never an expense. A new delivery&apos;s rates can be filled from it.</p>
        </div>}
      </section>);
  };

  const formNode = !form ? null : <div id="rent-form" className="card !p-3 space-y-3 scroll-mt-20">
    <div className="font-medium">{form.repeatOf ? `New delivery from ${vName(form.vendor_id)}` : "Record a rental delivery"}</div>
    {form.repeatOf && <p className="text-sm rounded-lg bg-blue-50 text-blue-900 px-3 py-2">Filled in from the earlier deliveries (last on {dmy(form.repeatOf)}). Check every field: the vehicle, driver and items can change. Type the quantities that came today, and remove items that did not come. This delivery gets its own {portal ? "JSL portal entry" : "record"}.</p>}
    {!vendorChoices.length ? <p className="text-sm text-amber-700">No equipment vendor is set up for this project. {staff ? "Add the vendor under Machines & rates first." : "Ask Operations or the Admin to add it."}</p> : <>
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="lbl">Vendor</label><select className="inp !w-56" value={form.vendor_id} onChange={(e) => { const v = e.target.value; setForm({ ...form, vendor_id: v, min_days: String(vt(v).min_days), gst_pct: String(vt(v).gst_pct) }); }}><option value="">Choose…</option>{vendorChoices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div><label className="lbl">Delivered on</label><input type="date" className="inp" max={today} value={form.delivered_on} onChange={(e) => setForm({ ...form, delivered_on: e.target.value })} /></div>
        <div><label className="lbl">Vehicle{portal && form.jsl === "vehicle" ? "" : <span className="font-normal text-slate-400"> (if any)</span>}</label><input className="inp !w-40 uppercase" value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} placeholder="GJ 01 AB 1234" /></div>
        <div><label className="lbl">Delivery note no.</label><input className="inp !w-32" value={form.note_no} onChange={(e) => setForm({ ...form, note_no: e.target.value })} /></div>
        <div><label className="lbl">Delivery note (photo or PDF)</label><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} /></div>
      </div>
      <div className="space-y-1.5"><div className="flex flex-wrap items-center gap-2"><span className="lbl !mb-0">Items</span>{money && quoteFor(form.vendor_id) && <button type="button" className="text-xs text-blue-700 hover:underline" onClick={ratesFromQuote}>Fill rates from quotation {quoteFor(form.vendor_id)!.quote_no || dmy(quoteFor(form.vendor_id)!.quote_date)}</button>}</div>
        {form.lines.map((l, i) => <div key={i} className="flex flex-wrap items-center gap-2">
          <input className="inp !w-48" placeholder="e.g. Scaffolding frame" value={l.name} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
          <input className={`inp !w-20 ${form.repeatOf && !l.qty ? "ring-1 ring-amber-300" : ""}`} inputMode="decimal" placeholder="Qty" aria-label={`${l.name || "Item"} quantity`} value={l.qty} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, qty: num(e.target.value) } : x)) })} />
          <select className="inp !w-24" aria-label="Unit" value={l.unit} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
          {money && <input className="inp !w-28" inputMode="decimal" placeholder="₹ per day each" value={l.rate} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, rate: num(e.target.value) } : x)) })} />}
          {form.lines.length > 1 && <button type="button" className="text-xs text-rose-700 hover:underline" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}>Remove</button>}
        </div>)}
        <button type="button" className="btn btn-sm" onClick={() => setForm({ ...form, lines: [...form.lines, blankLine()] })}>+ Add item</button>
      </div>
      {money && <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2">
        <div><label className="lbl">Minimum days</label><input className="inp !w-24" inputMode="numeric" value={form.min_days} onChange={(e) => setForm({ ...form, min_days: num(e.target.value) })} /></div>
        <div><label className="lbl">GST %</label><input className="inp !w-20" inputMode="decimal" value={form.gst_pct} onChange={(e) => setForm({ ...form, gst_pct: num(e.target.value) })} /></div>
        <div><label className="lbl">Deposit (₹)</label><input className="inp !w-32" inputMode="decimal" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: num(e.target.value) })} placeholder={form.repeatOf ? "0" : ""} /></div>
        {parseFloat(form.deposit) > 0 && <div><label className="lbl">Deposit paid on</label><input type="date" className="inp" value={form.deposit_paid_on} onChange={(e) => setForm({ ...form, deposit_paid_on: e.target.value })} /></div>}
        {form.vendor_id && <p className="text-xs text-slate-500 pb-2">Billed: {vt(form.vendor_id).billing === "advance" ? `every ${vt(form.vendor_id).period_days} days, in advance` : BILLING[vt(form.vendor_id).billing].toLowerCase()} (set on the vendor)</p>}
      </div>}
      {portal && <div className="space-y-2 border-t border-slate-100 pt-2">
        <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">JSL portal entry (MRR)</label><select className="inp !w-56" value={form.jsl} onChange={(e) => setForm({ ...form, jsl: e.target.value as Form["jsl"] })}>
          <option value="none">No portal entry</option><option value="vehicle">Yes, received by vehicle</option><option value="hand">Yes, received by hand</option></select></div>
          {form.jsl === "vehicle" && <><div><label className="lbl">Driver&apos;s name</label><input className="inp !w-44" value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></div>
            <div><label className="lbl">Driver&apos;s licence no.</label><input className="inp !w-44 uppercase" autoComplete="off" value={form.driver_dl_no} onChange={(e) => setForm({ ...form, driver_dl_no: e.target.value })} /></div></>}
          {form.jsl === "hand" && <div><label className="lbl">Who is bringing it?</label><select className="inp !w-56" value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })}><option value="">Choose…</option>
            {people.map((x) => <option key={x.id} value={x.id}>{x.name}{x.last4 ? ` · Aadhaar ••${x.last4}` : " · no Aadhaar"}</option>)}<option value="__other">Someone not on the team…</option></select></div>}
        </div>
        {form.jsl === "vehicle" && <div className="flex flex-wrap items-end gap-2">
          <div><label className="lbl">Co-driver&apos;s name <span className="font-normal text-slate-400">(if any)</span></label><input className="inp !w-44" value={form.codriver_name} onChange={(e) => setForm({ ...form, codriver_name: e.target.value })} /></div>
          {form.codriver_name.trim() && <><div><label className="lbl">Co-driver&apos;s ID type</label><select className="inp !w-32" value={form.codriver_id_type} onChange={(e) => setForm({ ...form, codriver_id_type: e.target.value })}><option value=""></option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label className="lbl">Co-driver&apos;s ID no.</label><input className="inp !w-44 uppercase" autoComplete="off" value={form.codriver_id_no} onChange={(e) => setForm({ ...form, codriver_id_no: e.target.value })} /></div></>}</div>}
        {form.jsl === "hand" && form.person === "__other" && <div className="flex flex-wrap items-end gap-2">
          <div><label className="lbl">Person&apos;s name</label><input className="inp !w-44" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} /></div>
          <div><label className="lbl">ID type</label><select className="inp !w-32" value={form.person_id_type} onChange={(e) => setForm({ ...form, person_id_type: e.target.value })}><option value=""></option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><label className="lbl">ID no.</label><input className="inp !w-44 uppercase" autoComplete="off" value={form.person_id_no} onChange={(e) => setForm({ ...form, person_id_no: e.target.value })} /></div></div>}
        <p className="text-xs text-slate-400">{form.jsl === "none" ? "It is still listed in Inventory, so a portal entry can be switched on there later." : form.jsl === "vehicle" ? "The vehicle number above is used for the portal." : "An Admin then authorizes it in Inventory (or the 08:30 automatic send takes it)."}</p>
      </div>}
      <div><label className="lbl">Note (optional)</label><input className="inp" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Bracing came with the frames" /></div>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={busy === "save"} onClick={saveDelivery}>{busy === "save" ? "Saving…" : "Save delivery"}</button><button className="btn" onClick={() => setForm(null)}>Cancel</button></div>
      <p className="text-xs text-slate-400">{portal ? "Saving also lists it in Inventory, marked as rented, with no amount (rent is billed by the vendor). " : ""}It can be edited afterwards with Edit delivery.</p>
    </>}
  </div>;

  const node = !pid || !staff ? null : missing ? <p className="warn">Rented items need the 2026-11-rentals.sql migration to be run first.</p> : <div className="space-y-3">
    {err && <p className="warn" role="alert">{err}</p>}{msg && <p className="text-sm text-green-700" role="status">{msg}</p>}
    {needsV2 && <p className="warn !text-sm">Returns per vendor, vendor billing and quotations need the 2026-11-rentals-vendor.sql migration to be run first.</p>}
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold sm:mr-auto">Rented items on {project?.name}</h2>
      {money && heldTotal > 0 && <span className="text-xs text-slate-500">Deposits held: <b className="text-slate-700">{inr(heldTotal)}</b></span>}
      {canAdd && !form && <button className="btn" onClick={() => { setErr(""); setForm(blankForm()); }}>Record a delivery</button>}</div>
    {formNode}
    {!liveVendors.length && !form && <p className="text-sm text-slate-500">Nothing rented is on site.</p>}
    {liveVendors.map(vendorCard)}
    {doneVendors.length > 0 && <details className="space-y-2"><summary className="cursor-pointer text-sm text-slate-600">Vendors with everything returned ({doneVendors.length})</summary><div className="space-y-3 pt-2">{doneVendors.map(vendorCard)}</div></details>}
  </div>;

  return { node, compute, onSite: rentals.filter((r) => !r.voided_at && !r.returned_on).length };
}
