"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { useRole } from "@/lib/roles";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { depositState, daysUsed, nextBill, perDay, rentFor, type Rates, type Rental, type RentalItem, type RentalTerms } from "@/lib/rentals";
import type { SupplyProject } from "./useGas";
import type { Computed } from "@/components/SiteBills";
import { ID_TYPES, JSL_LABEL, UNITS, type JslStatus } from "@/lib/inventory";

// Rented items on a project (Site supplies → Equipment → Rented; 2026-11-rentals.sql, rent worked out in src/lib/rentals.ts).
//  Admin and Operations only (Supervisors, Site Engineers and Viewers do not see the tab, and the database refuses them).
//  - Record a delivery (vendor, date, vehicle, the delivery note, items and quantities) and the return. Recording a delivery also makes its JSL portal
//    entry in Inventory.
//  - How rent is billed, the rates, the deposit; rent so far and the next bill. Vendor rent invoices are recorded under Bills & payments,
//    where they are compared with what these rentals come to (compute).
type Row = Rental & { delivery_vehicle: string; delivery_note_no: string; delivery_doc_path: string | null; note: string; return_vehicle: string; return_doc_path: string | null; return_note: string;
  inventory_bill_id: string | null; entered_by: string | null; created_at: string; void_reason: string };
type Line = { name: string; qty: string; unit: string; rate: string };
const inr = (n: number) => "₹" + (Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const BILLING: Record<RentalTerms["billing"], string> = { advance: "In advance, per period", month_end: "At each month end, days used", on_return: "Once, on return" };
const blankLine = (): Line => ({ name: "", qty: "", unit: "No", rate: "" });
const num = (s: string) => s.replace(/[^\d.]/g, "");

async function upload(file: File, pid: string): Promise<string | { error: string }> {
  const f = await prepareUpload(file); if (f.size > MAX_UPLOAD) return { error: "The file is larger than 5 MB: please send a smaller photo or compressed PDF." };
  const fd = new FormData(); fd.set("file", f); fd.set("employeeId", `rent-${pid}`); fd.set("docType", "rental");
  const r = await fetch("/api/docs/upload", { method: "POST", body: fd }); if (!r.ok) return { error: await r.text() }; return (await r.json()).path as string;
}

export function useRentals(project: SupplyProject | undefined, vendors: { id: string; name: string }[], allVendors: { id: string; name: string }[]) {
  const pid = project?.id ?? ""; const closed = project?.status === "closed";
  const { role, staff } = useRole(); const today = istToday(); const money = staff;   // Admin and Operations only (the database refuses everyone else too)
  const canAdd = staff && !closed;
  const [rentals, setRentals] = useState<Row[]>([]); const [items, setItems] = useState<RentalItem[]>([]); const [terms, setTerms] = useState<Record<string, RentalTerms>>({}); const [rates, setRates] = useState<Rates>({});
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(""); const [missing, setMissing] = useState(false);
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };
  // the JSL portal is only for projects marked "Uses the JSL portal" (today CSL); elsewhere a delivery makes no Inventory entry
  const [portal, setPortal] = useState(false); const [people, setPeople] = useState<{ id: string; name: string; last4: string | null }[]>([]);
  const [bills, setBills] = useState<Record<string, { jsl_wanted: boolean; jsl_status: JslStatus; bill_date: string }>>({});
  const [billItems, setBillItems] = useState<Record<string, { name: string; qty: number; unit: string }[]>>({});   // what the Inventory entry (and so the JSL portal) holds
  const vName = (id: string) => allVendors.find((v) => v.id === id)?.name ?? vendors.find((v) => v.id === id)?.name ?? "Vendor";

  /** How the Inventory entry (what the JSL portal holds) differs from the delivery: the date and the items. Empty when they agree. */
  const portalDiff = (r: Row, its: RentalItem[]): string[] => {
    const b = r.inventory_bill_id ? bills[r.inventory_bill_id] : undefined; if (!b || !b.jsl_wanted || ["none", "authorized", "failed"].includes(b.jsl_status)) return [];
    const out: string[] = []; if (b.bill_date !== r.delivered_on) out.push(`Date: portal ${dmy(b.bill_date)}, delivery ${dmy(r.delivered_on)}`);
    const have = billItems[r.inventory_bill_id!] ?? [], key = (n: string) => n.trim().toLowerCase();
    its.forEach((i) => { const h = have.find((x) => key(x.name) === key(i.name)); if (!h) out.push(`${i.name}: ${i.qty} ${i.unit} on the delivery, not on the portal`); else if (h.qty !== i.qty || h.unit !== i.unit) out.push(`${i.name}: portal ${h.qty} ${h.unit}, delivery ${i.qty} ${i.unit}`); });
    have.forEach((h) => { if (!its.some((i) => key(i.name) === key(h.name))) out.push(`${h.name}: ${h.qty} ${h.unit} on the portal, not on the delivery`); });
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
    const ids = list.map((r) => r.id); if (!ids.length) { setItems([]); setTerms({}); setRates({}); setBills({}); return; }
    const billIds = list.map((r) => r.inventory_bill_id).filter(Boolean) as string[];
    if (billIds.length) { const { data: bs } = await sb.from("inventory_bills").select("id, jsl_wanted, jsl_status, bill_date").in("id", billIds); setBills(Object.fromEntries(((bs || []) as { id: string; jsl_wanted: boolean; jsl_status: JslStatus; bill_date: string }[]).map((b) => [b.id, b])));
      const { data: bi } = await sb.from("inventory_bill_items").select("bill_id, name, qty, unit").in("bill_id", billIds).order("line_no"); const byBill: Record<string, { name: string; qty: number; unit: string }[]> = {};
      ((bi || []) as { bill_id: string; name: string; qty: number; unit: string }[]).forEach((x) => { (byBill[x.bill_id] ??= []).push({ name: x.name, qty: Number(x.qty), unit: x.unit }); }); setBillItems(byBill);
    } else { setBills({}); setBillItems({}); }
    const { data: it } = await sb.from("rental_items").select("*").in("rental_id", ids).order("line_no"); const its = ((it || []) as RentalItem[]).map((x) => ({ ...x, qty: Number(x.qty), missing_qty: Number(x.missing_qty) })); setItems(its);
    if (money) {
      const [{ data: tm }, { data: rt }] = await Promise.all([sb.from("rental_terms").select("*").in("rental_id", ids), sb.from("rental_item_rates").select("item_id, rate").in("item_id", its.map((x) => x.id))]);
      setTerms(Object.fromEntries(((tm || []) as RentalTerms[]).map((t) => [t.rental_id, { ...t, period_days: Number(t.period_days), min_days: Number(t.min_days), gst_pct: Number(t.gst_pct), deposit: Number(t.deposit), deduction: Number(t.deduction), refund_amount: t.refund_amount === null ? null : Number(t.refund_amount) }])));
      setRates(Object.fromEntries(((rt || []) as { item_id: string; rate: number }[]).map((r) => [r.item_id, Number(r.rate)])));
    }
  }
  useEffect(() => { void load(); }, [pid, role, money]);   // eslint-disable-line react-hooks/exhaustive-deps
  const itemsOf = (rid: string) => items.filter((i) => i.rental_id === rid);

  // ---------- record a delivery ----------
  const blankForm = () => ({ vendor_id: vendors[0]?.id ?? "", delivered_on: today, vehicle: "", note_no: "", note: "", file: null as File | null, lines: [blankLine()],
    billing: "advance" as RentalTerms["billing"], period_days: "30", min_days: "0", gst_pct: "0", deposit: "", deposit_paid_on: today,
    jsl: (portal ? "vehicle" : "none") as "none" | "vehicle" | "hand", driver_name: "", driver_dl_no: "", codriver_name: "", codriver_id_type: "", codriver_id_no: "", person: "", person_name: "", person_id_type: "", person_id_no: "" });
  const [form, setForm] = useState<ReturnType<typeof blankForm> | null>(null);
  const vendorChoices = staff ? allVendors : vendors;
  async function saveDelivery() {
    if (!form) return; const lines = form.lines.filter((l) => l.name.trim() || l.qty);
    if (!form.vendor_id) { setErr("Choose the vendor."); return; }
    if (!lines.length || lines.some((l) => !l.name.trim() || !(parseFloat(l.qty) > 0))) { setErr("Every item needs a name and a quantity."); return; }
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
    if (money) {   // the money the form also took: terms and rates
      await sb.from("rental_terms").update({ billing: form.billing, period_days: parseInt(form.period_days, 10) || 30, min_days: parseInt(form.min_days, 10) || 0, gst_pct: parseFloat(form.gst_pct) || 0,
        deposit: parseFloat(form.deposit) || 0, deposit_paid_on: parseFloat(form.deposit) > 0 ? form.deposit_paid_on || null : null, updated_at: new Date().toISOString() }).eq("rental_id", rid);
      const { data: made } = await sb.from("rental_items").select("id, line_no").eq("rental_id", rid);
      const rows = ((made || []) as { id: string; line_no: number }[]).map((m) => ({ item_id: m.id, rate: parseFloat(lines[m.line_no - 1]?.rate ?? "") })).filter((x) => x.rate >= 0);
      if (rows.length) await sb.from("rental_item_rates").upsert(rows.map((x) => ({ ...x, updated_at: new Date().toISOString() })));
    }
    setBusy(""); setForm(null); note(!portal ? "Delivery recorded ✓" : jsl ? "Delivery recorded ✓ Its JSL portal entry is in Inventory, ready for an Admin to authorize." : "Delivery recorded ✓ It is in Inventory, without a JSL portal entry (you can switch one on there)."); await load();
  }

  // ---------- terms, rates and the deposit (Operations / Admin) ----------
  const [tf, setTf] = useState<{ rid: string; billing: RentalTerms["billing"]; period_days: string; min_days: string; gst_pct: string; deposit: string; deposit_paid_on: string; deposit_ref: string; rates: Record<string, string> } | null>(null);
  const openTerms = (r: Row) => { const t = terms[r.id]; setTf({ rid: r.id, billing: t?.billing ?? "advance", period_days: String(t?.period_days ?? 30), min_days: String(t?.min_days ?? 0), gst_pct: String(t?.gst_pct ?? 0), deposit: t?.deposit ? String(t.deposit) : "",
    deposit_paid_on: t?.deposit_paid_on ?? today, deposit_ref: (t as any)?.deposit_ref ?? "", rates: Object.fromEntries(itemsOf(r.id).map((i) => [i.id, rates[i.id] === undefined ? "" : String(rates[i.id])])) }); };
  async function saveTerms() {
    if (!tf) return; setBusy("terms"); setErr(""); const sb = supabase(); const dep = parseFloat(tf.deposit) || 0;
    const { error } = await sb.from("rental_terms").upsert({ rental_id: tf.rid, billing: tf.billing, period_days: parseInt(tf.period_days, 10) || 30, min_days: parseInt(tf.min_days, 10) || 0, gst_pct: parseFloat(tf.gst_pct) || 0,
      deposit: dep, deposit_paid_on: dep > 0 ? tf.deposit_paid_on || null : null, deposit_ref: tf.deposit_ref.trim(), updated_at: new Date().toISOString() });
    const rows = Object.entries(tf.rates).filter(([, v]) => v !== "").map(([item_id, v]) => ({ item_id, rate: parseFloat(v) || 0, updated_at: new Date().toISOString() }));
    const e2 = rows.length ? (await sb.from("rental_item_rates").upsert(rows)).error : null;
    setBusy(""); if (error || e2) { setErr((error || e2)!.message); return; } setTf(null); note("Terms and rates saved ✓"); await load();
  }
  const [df, setDf] = useState<{ rid: string; deduction: string; deduction_note: string; refund_amount: string; refund_on: string; refund_ref: string } | null>(null);
  const openDeposit = (r: Row) => { const t = terms[r.id]; const s = depositState(r, t ?? null); setDf({ rid: r.id, deduction: t?.deduction ? String(t.deduction) : "", deduction_note: (t as any)?.deduction_note ?? "", refund_amount: String(t?.refund_amount ?? s.due), refund_on: t?.refund_on ?? today, refund_ref: (t as any)?.refund_ref ?? "" }); };
  async function saveDeposit(received: boolean) {
    if (!df) return; setBusy("deposit"); setErr("");
    const { error } = await supabase().from("rental_terms").update({ deduction: parseFloat(df.deduction) || 0, deduction_note: df.deduction_note.trim(), refund_amount: received ? parseFloat(df.refund_amount) || 0 : null, refund_on: received ? df.refund_on : null, refund_ref: received ? df.refund_ref.trim() : "", updated_at: new Date().toISOString() }).eq("rental_id", df.rid);
    setBusy(""); if (error) { setErr(error.message); return; } setDf(null); note(received ? "Deposit refund recorded ✓" : "Saved ✓"); await load();
  }

  // ---------- return, undo, void ----------
  // ---------- edit a delivery: date, vehicle, note number, note and the items (rental_update; its Inventory entry follows) ----------
  const [ef, setEf] = useState<{ rid: string; delivered_on: string; vehicle: string; note_no: string; note: string; lines: (Line & { id: string | null })[] } | null>(null);
  const openEdit = (r: Row) => { setErr(""); setRf(null); setTf(null); setEf({ rid: r.id, delivered_on: r.delivered_on, vehicle: r.delivery_vehicle, note_no: r.delivery_note_no, note: r.note,
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
    setBusy(""); if (error) { setErr(/rental_update|schema cache|does not exist/i.test(error.message) ? "Editing a delivery needs the 2026-11-rentals-edit.sql migration to be run first." : error.message); return; }
    setEf(null); note(b && st && !["none", "authorized", "failed"].includes(st) ? "Delivery updated ✓ Rent follows it. The portal entry is unchanged: correct it on the portal." : b ? "Delivery updated ✓ Its Inventory entry has the same items." : "Delivery updated ✓"); await load();
  }
  const [rf, setRf] = useState<{ rid: string; on: string; vehicle: string; note: string; file: File | null; missing: Record<string, string> } | null>(null);
  async function saveReturn() {
    if (!rf) return; setBusy("return"); setErr("");
    let path: string | null = null; if (rf.file) { const u = await upload(rf.file, pid); if (typeof u !== "string") { setErr(u.error); setBusy(""); return; } path = u; }
    const { error } = await supabase().rpc("rental_return", { p_rental: rf.rid, p_returned_on: rf.on, p_vehicle: rf.vehicle, p_doc_path: path, p_note: rf.note, p_missing: Object.entries(rf.missing).filter(([, v]) => parseFloat(v) > 0).map(([item_id, v]) => ({ item_id, qty: parseFloat(v) })) });
    setBusy(""); if (error) { setErr(error.message); return; } setRf(null); note(money ? "Return recorded ✓ Rent stops on that day; record the deposit refund when it comes." : "Return recorded ✓"); await load();
  }
  async function undoReturn(r: Row) { if (!confirm("Undo this return? The items count as on site again.")) return; const { error } = await supabase().rpc("rental_undo_return", { p_rental: r.id }); if (error) { setErr(error.message); return; } note("Return undone ✓"); await load(); }
  async function voidRental(r: Row) {
    const why = prompt("Void this delivery? Its JSL portal entry is voided too (only while it is not on the portal). Reason:"); if (why === null) return;
    const { error } = await supabase().rpc("rental_void", { p_rental: r.id, p_reason: why }); if (error) { setErr(error.message); return; } note("Voided ✓"); await load();
  }
  const mayVoid = (r: Row) => !r.voided_at && staff;

  // for Bills & payments: what a vendor's rentals on this project come to for the dates a bill covers
  const compute = (vendorId: string, from: string, to: string): Computed => {
    const lines: string[] = []; let total = 0, unpriced = 0;
    rentals.filter((r) => r.vendor_id === vendorId && !r.voided_at).forEach((r) => { const x = rentFor(r, itemsOf(r.id), rates, terms[r.id] ?? null, from, to); if (!x.days) return; total += x.total; if (!x.priced) unpriced++;
      lines.push(`Rental delivered ${dmy(r.delivered_on)}: ${x.days} day${x.days === 1 ? "" : "s"} → ${inr(x.base)}${x.gst ? ` + GST ${inr(x.gst)}` : ""}`); });
    return { amount: Math.round(total * 100) / 100, lines, warn: unpriced ? `${unpriced} rental${unpriced === 1 ? " has" : "s have"} items without a rate, so they count as ₹0` : "" };
  };

  const live = rentals.filter((r) => !r.voided_at && !r.returned_on), done = rentals.filter((r) => r.voided_at || r.returned_on);
  const heldTotal = useMemo(() => rentals.reduce((s, r) => s + depositState(r, terms[r.id] ?? null).held, 0), [rentals, terms]);

  const card = (r: Row) => {
    const its = itemsOf(r.id), t = terms[r.id] ?? null, pd = perDay(its, rates), used = daysUsed(r, today), nb = nextBill(r, t, today), dep = depositState(r, t);
    const sofar = rentFor(r, its, rates, t, r.delivered_on, r.returned_on ?? today);
    return (
      <div key={r.id} className={`card !p-3 space-y-2 ${r.voided_at ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <b className={r.voided_at ? "line-through" : ""}>{vName(r.vendor_id)}</b>
          {r.voided_at ? <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">void</span> : r.returned_on ? <span className="text-[11px] rounded-full bg-slate-100 text-slate-700 px-2 py-0.5">Returned {dmy(r.returned_on)}</span> : <span className="text-[11px] rounded-full bg-green-50 text-green-800 px-2 py-0.5">On site · day {used}</span>}
          {r.inventory_bill_id && bills[r.inventory_bill_id] && (bills[r.inventory_bill_id].jsl_wanted
            ? <span className={`text-[11px] rounded-full px-2 py-0.5 ${JSL_LABEL[bills[r.inventory_bill_id].jsl_status].cls}`}>JSL: {bills[r.inventory_bill_id].jsl_status === "none" ? "to authorize" : JSL_LABEL[bills[r.inventory_bill_id].jsl_status].text}</span>
            : <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">No JSL entry</span>)}
          <span className="text-xs text-slate-500 sm:ml-auto">Delivered {dmy(r.delivered_on)}{r.delivery_vehicle ? ` · ${r.delivery_vehicle}` : ""}{r.delivery_note_no ? ` · note ${r.delivery_note_no}` : ""}</span>
        </div>
        {(() => { const d = r.voided_at ? [] : portalDiff(r, its); return d.length ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 space-y-0.5"><div className="font-medium">The JSL portal entry differs from this delivery. Rent follows the delivery below; correct the portal entry too.</div>{d.map((x) => <div key={x}>{x}</div>)}</div> : null; })()}
        <div className="flex flex-wrap gap-1.5">{its.map((i) => <span key={i.id} className="text-xs rounded-lg bg-slate-100 px-2 py-1">{i.name} · {i.qty} {i.unit}{money && rates[i.id] !== undefined ? ` · ${inr(rates[i.id])}/day` : ""}{i.missing_qty > 0 && <b className="text-rose-700"> · {i.missing_qty} not returned</b>}</span>)}</div>
        {money && !r.voided_at && <div className="grid gap-2 sm:grid-cols-4 text-sm">
          <div><div className="text-xs text-slate-400">Rent per day</div><b className="tabular-nums">{pd === null ? <span className="text-amber-700">rates missing</span> : inr(pd)}</b>{t?.gst_pct ? <span className="text-xs text-slate-400"> + {t.gst_pct}% GST</span> : null}</div>
          <div><div className="text-xs text-slate-400">{r.returned_on ? "Rent in all" : "Rent so far"}</div><b className="tabular-nums">{inr(sofar.total)}</b><span className="text-xs text-slate-400"> · {sofar.days} days{t?.min_days ? ` (min ${t.min_days})` : ""}</span></div>
          <div><div className="text-xs text-slate-400">{t ? BILLING[t.billing] : "Billing"}</div>{nb && pd === null ? <span className="text-slate-400">set the rates first</span> : nb ? <><b className="tabular-nums">{inr(rentFor(r, its, rates, t, nb.from, nb.to).total)}</b><span className="text-xs text-slate-500"> for {dmy(nb.from)}–{dmy(nb.to)}{nb.dueOn ? ` · due ${dmy(nb.dueOn)}` : " · when returned"}</span></> : "—"}</div>
          <div><div className="text-xs text-slate-400">Deposit</div>{dep.amount > 0 ? <><b className="tabular-nums">{inr(dep.amount)}</b><span className="text-xs text-slate-500"> · {!dep.paid ? "not paid yet" : dep.refunded || t?.refund_on ? `refunded ${inr(dep.refunded)}` : r.returned_on ? <b className="text-amber-700">{inr(dep.toCollect)} to collect</b> : "held"}</span></> : <span className="text-slate-400">none</span>}</div>
        </div>}
        {(r.note || r.return_note || r.void_reason) && <p className="text-xs text-slate-500">{[r.note, r.return_note && `Return: ${r.return_note}`, r.voided_at && r.void_reason && `Void: ${r.void_reason}`].filter(Boolean).join(" · ")}</p>}
        <div className="flex flex-wrap gap-2">
          {!r.voided_at && !r.returned_on && staff && <button className="btn btn-sm" onClick={() => openEdit(r)}>Edit delivery</button>}
          {!r.voided_at && !r.returned_on && canAdd && <button className="btn btn-sm btn-primary" onClick={() => { setErr(""); setEf(null); setRf({ rid: r.id, on: today, vehicle: "", note: "", file: null, missing: {} }); }}>Items returned</button>}
          {money && !r.voided_at && <button className="btn btn-sm" onClick={() => openTerms(r)}>{t && pd !== null ? "Terms & rates" : "Set terms & rates"}</button>}
          {money && !r.voided_at && dep.paid > 0 && r.returned_on && <button className="btn btn-sm" onClick={() => openDeposit(r)}>{t?.refund_on ? "Deposit details" : "Deposit back"}</button>}
          {staff && r.returned_on && !r.voided_at && <button className="btn btn-sm" onClick={() => undoReturn(r)}>Undo return</button>}
          {r.delivery_doc_path && <a className="btn btn-sm" href={`/api/docs/view?path=${encodeURIComponent(r.delivery_doc_path)}`} target="_blank" rel="noreferrer">Delivery note</a>}
          {r.return_doc_path && <a className="btn btn-sm" href={`/api/docs/view?path=${encodeURIComponent(r.return_doc_path)}`} target="_blank" rel="noreferrer">Return receipt</a>}
          {r.inventory_bill_id && <a className="btn btn-sm" href={`/inventory?bill=${r.inventory_bill_id}`}>{bills[r.inventory_bill_id]?.jsl_wanted ? "JSL portal entry" : "Inventory entry"}</a>}
          {mayVoid(r) && <button className="btn btn-sm btn-danger" onClick={() => voidRental(r)}>Void</button>}
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
          <p className="text-xs text-slate-400">{r.inventory_bill_id ? "Its Inventory entry gets the same date, note number and items (and the vehicle, when it goes by vehicle). Once the entry is on the JSL portal, a change here fixes the rent only: the portal entry stays as submitted, and you are told where it differs." : "Rates can also be changed later under Terms & rates."}</p>
        </div>}
        {rf?.rid === r.id && <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="font-medium text-sm">Items returned to {vName(r.vendor_id)}</div>
          <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Returned on</label><input type="date" className="inp" min={r.delivered_on} max={today} value={rf.on} onChange={(e) => setRf({ ...rf, on: e.target.value })} /></div>
            <div><label className="lbl">Vehicle</label><input className="inp !w-40" value={rf.vehicle} onChange={(e) => setRf({ ...rf, vehicle: e.target.value })} placeholder="GJ 01 AB 1234" /></div>
            <div><label className="lbl">Vendor's receipt (photo or PDF)</label><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => setRf({ ...rf, file: e.target.files?.[0] ?? null })} /></div></div>
          <div><div className="lbl">Anything that did not come back?</div><div className="flex flex-wrap gap-2">{its.map((i) => <label key={i.id} className="text-xs flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1">{i.name} (of {i.qty})<input className="inp !w-16 !py-0.5" inputMode="decimal" placeholder="0" value={rf.missing[i.id] ?? ""} onChange={(e) => setRf({ ...rf, missing: { ...rf.missing, [i.id]: num(e.target.value) } })} /></label>)}</div></div>
          <div><label className="lbl">Note (optional)</label><input className="inp" value={rf.note} onChange={(e) => setRf({ ...rf, note: e.target.value })} placeholder="e.g. 1 item damaged" /></div>
          <div className="flex gap-2"><button className="btn btn-primary" disabled={busy === "return"} onClick={saveReturn}>{busy === "return" ? "Saving…" : "Save return"}</button><button className="btn" onClick={() => setRf(null)}>Cancel</button></div>
        </div>}
        {tf?.rid === r.id && <div className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="font-medium text-sm">Terms & rates</div>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="lbl">Rent is billed</label><select className="inp !w-56" value={tf.billing} onChange={(e) => setTf({ ...tf, billing: e.target.value as RentalTerms["billing"] })}>{Object.entries(BILLING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            {tf.billing === "advance" && <div><label className="lbl">Period (days)</label><input className="inp !w-24" inputMode="numeric" value={tf.period_days} onChange={(e) => setTf({ ...tf, period_days: num(e.target.value) })} /></div>}
            <div><label className="lbl">Minimum days</label><input className="inp !w-24" inputMode="numeric" value={tf.min_days} onChange={(e) => setTf({ ...tf, min_days: num(e.target.value) })} /></div>
            <div><label className="lbl">GST %</label><input className="inp !w-20" inputMode="decimal" value={tf.gst_pct} onChange={(e) => setTf({ ...tf, gst_pct: num(e.target.value) })} /></div>
            <div><label className="lbl">Deposit (₹)</label><input className="inp !w-32" inputMode="decimal" value={tf.deposit} onChange={(e) => setTf({ ...tf, deposit: num(e.target.value) })} /></div>
            {parseFloat(tf.deposit) > 0 && <><div><label className="lbl">Deposit paid on</label><input type="date" className="inp" value={tf.deposit_paid_on} onChange={(e) => setTf({ ...tf, deposit_paid_on: e.target.value })} /></div><div><label className="lbl">Reference</label><input className="inp !w-36" value={tf.deposit_ref} onChange={(e) => setTf({ ...tf, deposit_ref: e.target.value })} placeholder="UTR / cheque" /></div></>}
          </div>
          <div><div className="lbl">Rate per unit per day (₹, before GST)</div><div className="flex flex-wrap gap-2">{its.map((i) => <label key={i.id} className="text-xs flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1">{i.name} × {i.qty}<input className="inp !w-20 !py-0.5" inputMode="decimal" value={tf.rates[i.id] ?? ""} onChange={(e) => setTf({ ...tf, rates: { ...tf.rates, [i.id]: num(e.target.value) } })} /></label>)}</div></div>
          <div className="flex gap-2"><button className="btn btn-primary" disabled={busy === "terms"} onClick={saveTerms}>{busy === "terms" ? "Saving…" : "Save"}</button><button className="btn" onClick={() => setTf(null)}>Cancel</button></div>
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

  const formNode = !form ? null : <div className="card !p-3 space-y-3">
    <div className="font-medium">Record a rental delivery</div>
    {!vendorChoices.length ? <p className="text-sm text-amber-700">No equipment vendor is set up for this project. {staff ? "Add the vendor under Machines & rates first." : "Ask Operations or the Admin to add it."}</p> : <>
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="lbl">Vendor</label><select className="inp !w-56" value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}><option value="">Choose…</option>{vendorChoices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <div><label className="lbl">Delivered on</label><input type="date" className="inp" max={today} value={form.delivered_on} onChange={(e) => setForm({ ...form, delivered_on: e.target.value })} /></div>
        <div><label className="lbl">Vehicle{portal && form.jsl === "vehicle" ? "" : <span className="font-normal text-slate-400"> (if any)</span>}</label><input className="inp !w-40 uppercase" value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} placeholder="GJ 01 AB 1234" /></div>
        <div><label className="lbl">Delivery note no.</label><input className="inp !w-32" value={form.note_no} onChange={(e) => setForm({ ...form, note_no: e.target.value })} /></div>
        <div><label className="lbl">Delivery note (photo or PDF)</label><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} /></div>
      </div>
      <div className="space-y-1.5"><div className="lbl">Items</div>
        {form.lines.map((l, i) => <div key={i} className="flex flex-wrap items-center gap-2">
          <input className="inp !w-48" placeholder="e.g. Scaffolding frame" value={l.name} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
          <input className="inp !w-20" inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, qty: num(e.target.value) } : x)) })} />
          <select className="inp !w-24" aria-label="Unit" value={l.unit} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
          {money && <input className="inp !w-28" inputMode="decimal" placeholder="₹ per day each" value={l.rate} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, rate: num(e.target.value) } : x)) })} />}
          {form.lines.length > 1 && <button type="button" className="text-xs text-rose-700 hover:underline" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}>Remove</button>}
        </div>)}
        <button type="button" className="btn btn-sm" onClick={() => setForm({ ...form, lines: [...form.lines, blankLine()] })}>+ Add item</button>
      </div>
      {money && <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2">
        <div><label className="lbl">Rent is billed</label><select className="inp !w-56" value={form.billing} onChange={(e) => setForm({ ...form, billing: e.target.value as RentalTerms["billing"] })}>{Object.entries(BILLING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {form.billing === "advance" && <div><label className="lbl">Period (days)</label><input className="inp !w-24" inputMode="numeric" value={form.period_days} onChange={(e) => setForm({ ...form, period_days: num(e.target.value) })} /></div>}
        <div><label className="lbl">Minimum days</label><input className="inp !w-24" inputMode="numeric" value={form.min_days} onChange={(e) => setForm({ ...form, min_days: num(e.target.value) })} /></div>
        <div><label className="lbl">GST %</label><input className="inp !w-20" inputMode="decimal" value={form.gst_pct} onChange={(e) => setForm({ ...form, gst_pct: num(e.target.value) })} /></div>
        <div><label className="lbl">Deposit (₹)</label><input className="inp !w-32" inputMode="decimal" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: num(e.target.value) })} /></div>
        {parseFloat(form.deposit) > 0 && <div><label className="lbl">Deposit paid on</label><input type="date" className="inp" value={form.deposit_paid_on} onChange={(e) => setForm({ ...form, deposit_paid_on: e.target.value })} /></div>}
      </div>}
      {portal && <div className="space-y-2 border-t border-slate-100 pt-2">
        <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">JSL portal entry (MRR)</label><select className="inp !w-56" value={form.jsl} onChange={(e) => setForm({ ...form, jsl: e.target.value as typeof form.jsl })}>
          <option value="none">No portal entry</option><option value="vehicle">Yes, received by vehicle</option><option value="hand">Yes, received by hand</option></select></div>
          {form.jsl === "vehicle" && <><div><label className="lbl">Driver's name</label><input className="inp !w-44" value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></div>
            <div><label className="lbl">Driver's licence no.</label><input className="inp !w-44 uppercase" autoComplete="off" value={form.driver_dl_no} onChange={(e) => setForm({ ...form, driver_dl_no: e.target.value })} /></div></>}
          {form.jsl === "hand" && <div><label className="lbl">Who is bringing it?</label><select className="inp !w-56" value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })}><option value="">Choose…</option>
            {people.map((x) => <option key={x.id} value={x.id}>{x.name}{x.last4 ? ` · Aadhaar ••${x.last4}` : " · no Aadhaar"}</option>)}<option value="__other">Someone not on the team…</option></select></div>}
        </div>
        {form.jsl === "vehicle" && <div className="flex flex-wrap items-end gap-2">
          <div><label className="lbl">Co-driver's name <span className="font-normal text-slate-400">(if any)</span></label><input className="inp !w-44" value={form.codriver_name} onChange={(e) => setForm({ ...form, codriver_name: e.target.value })} /></div>
          {form.codriver_name.trim() && <><div><label className="lbl">Co-driver's ID type</label><select className="inp !w-32" value={form.codriver_id_type} onChange={(e) => setForm({ ...form, codriver_id_type: e.target.value })}><option value=""></option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label className="lbl">Co-driver's ID no.</label><input className="inp !w-44 uppercase" autoComplete="off" value={form.codriver_id_no} onChange={(e) => setForm({ ...form, codriver_id_no: e.target.value })} /></div></>}</div>}
        {form.jsl === "hand" && form.person === "__other" && <div className="flex flex-wrap items-end gap-2">
          <div><label className="lbl">Person's name</label><input className="inp !w-44" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} /></div>
          <div><label className="lbl">ID type</label><select className="inp !w-32" value={form.person_id_type} onChange={(e) => setForm({ ...form, person_id_type: e.target.value })}><option value=""></option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><label className="lbl">ID no.</label><input className="inp !w-44 uppercase" autoComplete="off" value={form.person_id_no} onChange={(e) => setForm({ ...form, person_id_no: e.target.value })} /></div></div>}
        <p className="text-xs text-slate-400">{form.jsl === "none" ? "It is still listed in Inventory, so a portal entry can be switched on there later." : form.jsl === "vehicle" ? "The vehicle number above is used for the portal." : "An Admin then authorizes it in Inventory (or the 08:30 automatic send takes it)."}</p>
      </div>}
      <div><label className="lbl">Note (optional)</label><input className="inp" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Bracing came with the frames" /></div>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={busy === "save"} onClick={saveDelivery}>{busy === "save" ? "Saving…" : "Save delivery"}</button><button className="btn" onClick={() => setForm(null)}>Cancel</button></div>
      <p className="text-xs text-slate-400">{portal ? "Saving also lists it in Inventory, marked as rented, with no amount (rent is billed by the vendor). " : ""}Items cannot be changed afterwards: void the delivery and record it again.</p>
    </>}
  </div>;

  const node = !pid || !staff ? null : missing ? <p className="warn">Rented items need the 2026-11-rentals.sql migration to be run first.</p> : <div className="space-y-3">
    {err && <p className="warn" role="alert">{err}</p>}{msg && <p className="text-sm text-green-700" role="status">{msg}</p>}
    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold sm:mr-auto">Rented items on {project?.name}</h2>
      {money && heldTotal > 0 && <span className="text-xs text-slate-500">Deposits held: <b className="text-slate-700">{inr(heldTotal)}</b></span>}
      {canAdd && !form && <button className="btn btn-primary" onClick={() => { setErr(""); setForm(blankForm()); }}>Record a delivery</button>}</div>
    {formNode}
    {!live.length && !form && <p className="text-sm text-slate-500">Nothing rented is on site.</p>}
    {live.map(card)}
    {done.length > 0 && <details className="space-y-2"><summary className="cursor-pointer text-sm text-slate-600">Returned and void ({done.length})</summary><div className="space-y-2 pt-2">{done.map(card)}</div></details>}
  </div>;

  return { node, compute, onSite: live.length };
}
