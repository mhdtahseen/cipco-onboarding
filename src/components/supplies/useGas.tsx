"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { useRole } from "@/lib/roles";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import PayeeBank from "@/components/PayeeBank";
import type { Computed } from "@/components/SiteBills";
import GasCostCard from "@/components/GasCostCard";
import { countTrips, gasCost, stockOf, type GKind, type GMove, type GOrder } from "@/lib/gas";
import GasDeposits from "@/components/GasDeposits";
import { JSL_LABEL, type JslStatus } from "@/lib/inventory";

export type SupplyProject = { id: string; name: string; location?: string | null; status?: string; closed_on?: string | null };
type Vendor = { id: string; name: string; contact: string; phone: string; gstin: string; address?: string; notice_hours: number; free_delivery_min: number; active: boolean; kind?: string };
type Product = { id: string; vendor_id: string; name: string; capacity: string; active: boolean; sort_order: number; deposit_per_cylinder: number };
type Line = { id: string; product_id: string; qty: number };
type Order = { id: string; order_no: string; project_id: string; vendor_id: string; status: string; needed_by: string | null; note: string; requested_by: string | null; requested_role: string | null; decided_by: string | null; decided_at: string | null; reject_reason: string; created_at: string; gas_order_lines: Line[] };
type Move = { id: string; project_id: string; vendor_id: string; product_id: string; order_id: string | null; kind: GKind; qty: number; moved_on: string; challan_no: string; photo_path: string | null; note: string; entered_by: string | null; entered_role: string | null; created_at: string; voided_at: string | null; gas_movement_serials: { serial: string }[]; carrier?: Carrier | null; vehicle_id?: string | null; trip_ref?: string | null };
type Carrier = "vendor" | "own" | "none";
type TVehicle = { id: string; name: string; operator: string; active: boolean };
type TripErrand = { id: string; gas_trip_ref: string; amount: number | null; voided_at: string | null };
type GasEdit = { id: string; movement_id: string; changes: Record<string, [unknown, unknown]>; reason: string; edited_by: string | null; edited_at: string };
type EditForm = { m: Move; moved_on: string; challan_no: string; carrier: Carrier; vehicle_id: string; product_id: string; qty: string; order_id: string; note: string; reason: string; photo: File | null };
type Rate = { id: string; product_id: string; rate: number; gst_pct: number; valid_from: string };
type Terms = { vendor_id: string; loss_charge_per_cylinder: number; damage_charge_per_cylinder: number; charges_gst_pct: number; transport_per_trip: number; due_day_first_half: number; due_day_second_half: number; terms_note: string };
type Pricing = { line_id: string; rate: number; gst_pct: number };
// one of these exists per delivered truck visit, made automatically (2026-11-inventory-gas.sql); matched back to its visit by vendor, date and challan, since that is how the trigger names it
type GasBill = { id: string; vendor_name: string; bill_no: string; bill_date: string; jsl_wanted: boolean; jsl_status: JslStatus; voided_at: string | null };

const STATUS: Record<string, [string, string]> = { requested: ["Waiting for approval", "bg-amber-50 text-amber-800"], approved: ["Approved", "bg-blue-50 text-blue-800"], sent: ["Sent to vendor", "bg-blue-50 text-blue-800"], partly_delivered: ["Partly delivered", "bg-violet-50 text-violet-800"], delivered: ["Delivered", "bg-green-50 text-green-800"], closed: ["Closed", "bg-slate-100 text-slate-600"], rejected: ["Rejected", "bg-rose-50 text-rose-800"], cancelled: ["Cancelled", "bg-slate-100 text-slate-500"] };
const KIND: Record<string, string> = { delivery: "Delivered (new, full)", return: "Picked up (empties)", lost: "Lost", damaged: "Damaged (valve / cap)", opening: "Opening stock (already at the site)", emptied: "Used up (went empty)" };
const CARRIER: Record<Carrier, string> = { vendor: "The gas vendor's vehicle", own: "Our transport vehicle", none: "Collected / no charge" };
const FORM_KIND: Record<string, string> = { trip: "Delivery trip: new cylinders in, empties out", emptied: "Cylinders used up (went empty)", lost: "Lost", damaged: "Damaged (valve / cap)" };
const OPENING_KIND = "Opening stock: cylinders already at the site before this app";
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const dmy = (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: iso.length === 10 ? undefined : "Asia/Kolkata" });
const plusDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
const BLANK_TERMS = (vendor_id: string): Terms => ({ vendor_id, loss_charge_per_cylinder: 0, damage_charge_per_cylinder: 0, charges_gst_pct: 18, transport_per_trip: 0, due_day_first_half: 25, due_day_second_half: 10, terms_note: "" });

// Gas cylinders on the Site supplies page: all the data and actions, and each screen's content for the page to place. Cylinders are not rented: a deposit is paid once per cylinder, and refills are paid for as they arrive.
// Ordered by Site Engineers, approved by Operations / Admin, swapped against the vendor's challan, and counted per site.
// Supervisors and Site Engineers see quantities only. Everything with a rupee value (rates, terms, order amounts) is fetched, and shown, only for Operations / Admin,
// and the database holds it in tables the other roles cannot read.
export function useGas(project: SupplyProject | undefined, go: (tab: "orders") => void) {
  const pid = project?.id ?? "";
  const { role, money, see: admin, userId } = useRole(); const today = istToday();
  const viewer = role === "viewer"; const mayAct = money && !viewer;   // a Viewer sees the money side but cannot approve, order or change anything
  const canOrder = role === "site_engineer" || mayAct;
  const [vendors, setVendors] = useState<Vendor[]>([]); const [products, setProducts] = useState<Product[]>([]); const [links, setLinks] = useState<{ project_id: string; vendor_id: string }[]>([]);
  const [orders, setOrders] = useState<Order[]>([]); const [moves, setMoves] = useState<Move[]>([]); const [names, setNames] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Rate[]>([]); const [terms, setTerms] = useState<Terms[]>([]); const [pricing, setPricing] = useState<Pricing[]>([]); const [gasBills, setGasBills] = useState<GasBill[]>([]);
  const [edits, setEdits] = useState<GasEdit[]>([]); const [ef, setEf] = useState<EditForm | null>(null); const isAdmin = role === "admin";
  const [tVehicles, setTVehicles] = useState<TVehicle[]>([]); const [tripErrands, setTripErrands] = useState<TripErrand[]>([]); const [errAmt, setErrAmt] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  async function load() {
    if (!role) return; const sb = supabase();
    const [v, p, l] = await Promise.all([sb.from("gas_vendors").select("*").order("name"), sb.from("gas_products").select("*").order("sort_order").order("name"), sb.from("gas_project_vendors").select("*")]);
    const x = v.error || p.error || l.error; if (x) { setErr(x.message + (/gas_|schema cache|does not exist/i.test(x.message) ? ": the Gas SQL migration (2026-11-gas.sql) has not been run yet." : "")); setLoading(false); return; }
    setVendors(((v.data || []) as Vendor[]).filter((q) => (q.kind ?? "gas") === "gas")); setProducts(((p.data || []) as Product[]).map((q) => ({ ...q, deposit_per_cylinder: Number(q.deposit_per_cylinder ?? 0) }))); setLinks((l.data || []) as { project_id: string; vendor_id: string }[]);
    const { data: pf } = await sb.from("user_profiles").select("user_id, full_name"); setNames(Object.fromEntries(((pf || []) as { user_id: string; full_name: string }[]).map((r) => [r.user_id, r.full_name])));
    if (money) {
      const [r, t] = await Promise.all([sb.from("gas_rates").select("*").order("valid_from", { ascending: false }), sb.from("gas_terms").select("*")]);
      setRates(((r.data || []) as Rate[]).map((q) => ({ ...q, rate: Number(q.rate), gst_pct: Number(q.gst_pct) }))); setTerms(((t.data || []) as Terms[]).map((q) => ({ ...q, loss_charge_per_cylinder: Number(q.loss_charge_per_cylinder), damage_charge_per_cylinder: Number(q.damage_charge_per_cylinder ?? 0), charges_gst_pct: Number(q.charges_gst_pct ?? 18), transport_per_trip: Number(q.transport_per_trip ?? 0) })));
    }
    setErr(""); setLoading(false);
  }
  useEffect(() => { load(); }, [role]);
  async function loadProject() {
    if (!pid) return; const sb = supabase();
    const [o, m] = await Promise.all([sb.from("gas_orders").select("*, gas_order_lines(id, product_id, qty)").eq("project_id", pid).order("created_at", { ascending: false }), sb.from("gas_movements").select("*, gas_movement_serials(serial)").eq("project_id", pid).order("moved_on", { ascending: false }).order("created_at", { ascending: false })]);
    if (o.error || m.error) { setErr((o.error || m.error)!.message); return; }
    const od = (o.data || []) as Order[]; setOrders(od); setMoves((m.data || []) as Move[]);
    if (money && od.length) { const ids = od.flatMap((x) => x.gas_order_lines.map((l) => l.id)); const { data } = await sb.from("gas_order_pricing").select("*").in("line_id", ids); setPricing(((data || []) as Pricing[]).map((q) => ({ ...q, rate: Number(q.rate), gst_pct: Number(q.gst_pct) }))); } else setPricing([]);
    // the JSL portal is an Operations / Admin matter, so only they see which deliveries can go to it
    // the project's transport vehicles (a trip can be brought by one of them), and, for Operations / Admin, the errands those trips made
    const ge = await sb.from("gas_movement_edits").select("*").order("edited_at"); setEdits(ge.error ? [] : (ge.data || []) as GasEdit[]);   // empty until 2026-11-gas-edit.sql is run
    const tv = await sb.from("transport_vehicles").select("id, name, operator, active").eq("project_id", pid).order("name"); setTVehicles(tv.error ? [] : (tv.data || []) as TVehicle[]);
    if (money) { const te = await sb.from("transport_errands").select("id, gas_trip_ref, amount, voided_at").eq("project_id", pid).not("gas_trip_ref", "is", null); setTripErrands(te.error ? [] : ((te.data || []) as TripErrand[]).map((x) => ({ ...x, amount: x.amount == null ? null : Number(x.amount) }))); } else setTripErrands([]);
    if (money) { const gb = await sb.from("inventory_bills").select("id, vendor_name, bill_no, bill_date, jsl_wanted, jsl_status, voided_at").eq("project_id", pid).eq("kind", "gas"); setGasBills(gb.error ? [] : (gb.data || []) as GasBill[]); } else setGasBills([]);
  }
  useEffect(() => { loadProject(); }, [pid, money]);

  const pName = (id: string) => products.find((p) => p.id === id); const prodLabel = (id: string) => { const p = pName(id); return p ? `${p.name}${p.capacity ? ` (${p.capacity})` : ""}` : "?"; };
  const vName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "?"; const who = (id: string | null) => (id && names[id]) || (id === userId ? "you" : "someone");
  const myVendors = useMemo(() => { const ids = new Set(links.filter((l) => l.project_id === pid).map((l) => l.vendor_id)); return vendors.filter((v) => ids.has(v.id) && v.active); }, [vendors, links, pid]);
  const live = moves.filter((m) => !m.voided_at);

  // cylinders at the site per product: opening stock and every delivery, less the empties taken back and any lost or damaged (full and empty together; a swap leaves it unchanged). Of those, "empty" are the ones used up and not yet taken back.
  const held = useMemo(() => { const out = new Map<string, { qty: number; full: number; empty: number }>(); [...new Set(live.map((m) => m.product_id))].forEach((id) => { const s = stockOf(live.filter((m) => m.product_id === id)); out.set(id, { qty: s.total, full: s.full, empty: s.empty }); }); return out; }, [moves]);
  const totals = (pidd: string) => { const s = stockOf(live.filter((m) => m.product_id === pidd)); return { d: s.delivered, r: s.returned, l: s.lost, g: s.damaged, o: s.opening, e: s.emptied }; };
  const projectProducts = useMemo(() => products.filter((p) => myVendors.some((v) => v.id === p.vendor_id) || moves.some((m) => m.product_id === p.id)), [products, myVendors, moves]);
  // the bill a delivery became (2026-11-inventory-gas.sql names it the same way: vendor, delivery date, challan); only a delivery makes one
  const gasBillOf = (m: Move) => (m.kind !== "delivery" ? undefined : gasBills.find((b) => !b.voided_at && b.vendor_name === vName(m.vendor_id) && b.bill_date === m.moved_on && b.bill_no === m.challan_no.trim()));
  const priceOf = (l: Line) => pricing.find((p) => p.line_id === l.id);
  const orderTotal = (o: Order) => o.gas_order_lines.reduce((s, l) => { const p = priceOf(l); return p ? s + l.qty * p.rate * (1 + p.gst_pct / 100) : s; }, 0);
  const received = (o: Order, productId: string) => live.filter((m) => m.order_id === o.id && m.kind === "delivery" && m.product_id === productId).reduce((s, m) => s + m.qty, 0);

  // for the bills and deposits tabs (Operations / Admin): what the recorded deliveries come to for a vendor between two dates
  const termsOf = (vid: string) => terms.find((t) => t.vendor_id === vid);
  const compute = (vendorId: string, from: string, to: string): Computed => {
    const c = gasCost({ moves: moves as GMove[], orders: orders as GOrder[], pricing, rates, products, terms, vendorId, from, to, label: prodLabel });   // the same rules as the order cards and the project's gas cost (src/lib/gas.ts)
    return { amount: Math.round(c.total * 100) / 100, lines: c.lines, warn: c.unpriced ? `${c.unpriced} delivered cylinders have no rate set, so they are not counted` : "" };
  };
  const depositProducts = products.filter((p) => p.deposit_per_cylinder > 0 && (myVendors.some((v) => v.id === p.vendor_id) || (held.get(p.id)?.qty ?? 0) !== 0)).map((p) => ({ id: p.id, vendor_id: p.vendor_id, label: prodLabel(p.id), deposit: p.deposit_per_cylinder, held: Math.max(0, held.get(p.id)?.qty ?? 0), lost: totals(p.id).l, everIn: totals(p.id).d }));

  // ---------- orders ----------
  const [of, setOf] = useState<{ id: string | null; vendor_id: string; needed_by: string; note: string; lines: { product_id: string; qty: string }[] } | null>(null);
  const startOrder = (o?: Order) => { const v = o?.vendor_id || myVendors[0]?.id || ""; setOf(o ? { id: o.id, vendor_id: o.vendor_id, needed_by: o.needed_by ?? "", note: o.note, lines: o.gas_order_lines.map((l) => ({ product_id: l.product_id, qty: String(l.qty) })) } : { id: null, vendor_id: v, needed_by: plusDays(today, 2), note: "", lines: [{ product_id: products.find((p) => p.vendor_id === v && p.active)?.id ?? "", qty: "" }] }); setErr(""); };
  const ofVendor = vendors.find((v) => v.id === of?.vendor_id); const ofProducts = products.filter((p) => p.vendor_id === of?.vendor_id && p.active);
  const ofQty = of ? of.lines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0) : 0;
  const noticeWarn = of && ofVendor && of.needed_by ? (() => { const hrs = (Date.parse(of.needed_by + "T00:00:00+05:30") - Date.now()) / 3600000; return hrs < ofVendor.notice_hours ? `${ofVendor.name} asks for ${ofVendor.notice_hours} hours' notice, so this date may be too soon.` : ""; })() : "";
  const freeWarn = of && ofVendor && ofQty > 0 && ofQty < ofVendor.free_delivery_min ? `Delivery is free from ${ofVendor.free_delivery_min} cylinders in one order; this one is ${ofQty}, so delivery may be charged.` : "";
  async function saveOrder() {
    if (!of) return; const lines = of.lines.map((l) => ({ product_id: l.product_id, qty: parseInt(l.qty, 10) })).filter((l) => l.product_id && l.qty > 0);
    if (!of.vendor_id || !lines.length) { setErr("Choose the vendor and enter at least one product with a quantity."); return; } setBusy(true); setErr(""); const sb = supabase(); let orderId = of.id;
    if (orderId) { const { error } = await sb.from("gas_orders").update({ needed_by: of.needed_by || null, note: of.note.trim() }).eq("id", orderId); if (error) { setErr(error.message); setBusy(false); return; }
      const d = await sb.from("gas_order_lines").delete().eq("order_id", orderId); if (d.error) { setErr(d.error.message); setBusy(false); return; } }
    else { const { data, error } = await sb.from("gas_orders").insert({ project_id: pid, vendor_id: of.vendor_id, needed_by: of.needed_by || null, note: of.note.trim() }).select("id").single(); if (error) { setErr(error.message); setBusy(false); return; } orderId = data!.id as string; }
    const { error } = await sb.from("gas_order_lines").insert(lines.map((l) => ({ ...l, order_id: orderId }))); setBusy(false); if (error) { setErr(error.message); return; }
    if (!of.id) fetch("/api/gas/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: orderId, event: "requested" }) }).catch(() => {});
    setOf(null); note(of.id ? "Order updated ✓" : "Order sent for approval ✓"); loadProject();
  }
  async function setStatus(o: Order, status: string, extra: Record<string, unknown> = {}) {
    setErr(""); const { error } = await supabase().from("gas_orders").update({ status, ...extra }).eq("id", o.id); if (error) { setErr(error.message); return; }
    if (status === "approved" || status === "rejected") fetch("/api/gas/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: o.id, event: "decided" }) }).catch(() => {});
    note(status === "approved" ? "Approved: the rates in force today are locked on the order ✓" : "Updated ✓"); loadProject();
  }
  function reject(o: Order) { const why = prompt("Why is this order rejected? (the Site Engineer sees this)"); if (why === null) return; if (!why.trim()) { setErr("Say why the order is rejected."); return; } setStatus(o, "rejected", { reject_reason: why.trim() }); }
  function cancel(o: Order) { if (confirm(`Cancel order ${o.order_no}?`)) setStatus(o, "cancelled"); }

  // ---------- deliveries and returns ----------
  const [mf, setMf] = useState({ kind: "trip", product_id: "", qty: "", moved_on: today, order_id: "", challan_no: "", serials: "", note: "", carrier: "vendor" as Carrier, vehicle_id: "" }); const [tr, setTr] = useState<Record<string, { inQ: string; outQ: string; sIn: string; sOut: string }>>({}); const [photo, setPhoto] = useState<File | null>(null); const [showMove, setShowMove] = useState(false);
  const moveProducts = projectProducts.filter((p) => p.active || held.has(p.id));
  const openOrders = orders.filter((o) => ["approved", "sent", "partly_delivered"].includes(o.status));
  const serialList = (t: string) => [...new Set(t.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  const uploadPhoto = async (): Promise<{ path: string | null } | { error: string }> => {
    if (!photo) return { path: null }; const file = await prepareUpload(photo); if (file.size > MAX_UPLOAD) return { error: "The photo is larger than 5 MB: please send a smaller photo." };
    const fd = new FormData(); fd.set("file", file); fd.set("projectId", pid); const r = await fetch("/api/gas/upload", { method: "POST", body: fd }); if (!r.ok) return { error: await r.text() }; return { path: (await r.json()).path };
  };
  const addMove = async (row: Record<string, unknown>, serials: string[]) => {
    const sb = supabase(); const { data, error } = await sb.from("gas_movements").insert(row).select("id").single(); if (error) return /carrier|trip_ref|vehicle_id/.test(error.message) ? "choosing who brought the cylinders needs 2026-11-gas-own-transport.sql to be run first" : /gas_movements_kind_check/.test(error.message) ? "opening stock and used-up cylinders need 2026-11-gas-stock.sql to be run first" : error.message;
    if (serials.length) { const s2 = await sb.from("gas_movement_serials").insert(serials.map((serial) => ({ movement_id: data!.id, serial }))); if (s2.error) return "the serial numbers were not saved: " + s2.error.message; } return "";
  };
  // a lost or damaged cylinder: one entry
  async function saveMove() {
    const qty = parseInt(mf.qty, 10); const prod = pName(mf.product_id); if (!prod || !(qty > 0)) { setErr("Choose the product and enter how many cylinders."); return; }
    if (mf.kind === "emptied") { const full = held.get(prod.id)?.full ?? 0; if (qty > full) { setErr(`Only ${full} full ${prodLabel(prod.id)} ${full === 1 ? "is" : "are"} at the site, so ${qty} cannot be marked empty.`); return; } }
    if ((mf.kind === "lost" || mf.kind === "damaged") && qty > (held.get(prod.id)?.qty ?? 0)) { setErr(`Only ${held.get(prod.id)?.qty ?? 0} ${prodLabel(prod.id)} ${(held.get(prod.id)?.qty ?? 0) === 1 ? "is" : "are"} at the site, so ${qty} cannot be entered.`); return; }
    const serials = serialList(mf.serials); if (serials.length > qty) { setErr(`You entered ${serials.length} serial numbers for ${qty} cylinders.`); return; }
    setBusy(true); setErr(""); const up = await uploadPhoto(); if ("error" in up) { setErr(up.error); setBusy(false); return; }
    const e = await addMove({ project_id: pid, vendor_id: prod.vendor_id, product_id: prod.id, order_id: null, kind: mf.kind, qty, moved_on: mf.moved_on, challan_no: mf.challan_no.trim(), photo_path: up.path, note: mf.note.trim() }, serials);
    setBusy(false); if (e) { setErr(e); loadProject(); return; } setPhoto(null); setMf({ ...mf, qty: "", challan_no: "", serials: "", note: "" }); note(`${KIND[mf.kind]}: ${qty} recorded ✓`); loadProject();
  }
  // a delivery trip: the new cylinders coming in and the empties going back are the same visit, so they are saved together with one date, challan number and photo
  async function saveTrip() {
    const rows = moveProducts.map((p) => { const t = tr[p.id]; return { p, i: parseInt(t?.inQ || "", 10) || 0, o: parseInt(t?.outQ || "", 10) || 0, sIn: serialList(t?.sIn || ""), sOut: serialList(t?.sOut || "") }; }).filter((r) => r.i > 0 || r.o > 0);
    if (!rows.length) { setErr("Enter how many new cylinders came in and/or how many empties went back, for at least one product."); return; }
    for (const r of rows) { if (r.sIn.length > r.i) { setErr(`${prodLabel(r.p.id)}: ${r.sIn.length} serial numbers for ${r.i} new cylinders.`); return; } if (r.sOut.length > r.o) { setErr(`${prodLabel(r.p.id)}: ${r.sOut.length} serial numbers for ${r.o} empties.`); return; }
      const have = (held.get(r.p.id)?.qty ?? 0) + r.i; if (r.o > have) { setErr(`${prodLabel(r.p.id)}: only ${have} cylinders are here (including this delivery), so ${r.o} cannot be taken back.`); return; } }
    if (mf.carrier === "own" && !mf.vehicle_id) { setErr("Choose which of our vehicles brought the cylinders."); return; }
    setBusy(true); setErr(""); const up = await uploadPhoto(); if ("error" in up) { setErr(up.error); setBusy(false); return; }
    // who brought it: the vendor's own vehicle is the default and needs nothing extra (so it also works before 2026-11-gas-own-transport.sql is run)
    const carried = mf.carrier === "vendor" ? {} : { carrier: mf.carrier, vehicle_id: mf.carrier === "own" ? mf.vehicle_id : null, trip_ref: crypto.randomUUID() };
    const base = { project_id: pid, moved_on: mf.moved_on, challan_no: mf.challan_no.trim(), photo_path: up.path, note: mf.note.trim(), ...carried };
    for (const r of rows.filter((x) => x.i > 0)) { const e = await addMove({ ...base, vendor_id: r.p.vendor_id, product_id: r.p.id, order_id: mf.order_id || null, kind: "delivery", qty: r.i }, r.sIn); if (e) { setErr(`${prodLabel(r.p.id)} delivery: ${e}. Nothing after it was saved.`); setBusy(false); loadProject(); return; } }
    for (const r of rows.filter((x) => x.o > 0)) { const e = await addMove({ ...base, vendor_id: r.p.vendor_id, product_id: r.p.id, order_id: null, kind: "return", qty: r.o }, r.sOut); if (e) { setErr(`${prodLabel(r.p.id)} pick-up: ${e}. The deliveries above were saved.`); setBusy(false); loadProject(); return; } }
    setBusy(false); setPhoto(null); setTr({}); setMf({ ...mf, challan_no: "", note: "", order_id: "", carrier: "vendor", vehicle_id: "" }); note(`Trip recorded ✓${mf.carrier === "own" ? " · an errand was added on the vehicle; Operations / Admin enter its amount" : ""} (${rows.filter((x) => x.i > 0).map((x) => `${x.i} ${prodLabel(x.p.id)} in`).concat(rows.filter((x) => x.o > 0).map((x) => `${x.o} ${prodLabel(x.p.id)} out`)).join(", ")})`); loadProject();
  }
  // one tap: a cylinder was used up (full → empty). The database refuses it when no full cylinder of this product is at the site.
  async function markEmpty(productId: string) {
    const prod = pName(productId); if (!prod) return; setBusy(true); setErr("");
    const e = await addMove({ project_id: pid, vendor_id: prod.vendor_id, product_id: prod.id, order_id: null, kind: "emptied", qty: 1, moved_on: today, challan_no: "", photo_path: null, note: "" }, []);
    setBusy(false); if (e) { setErr(/gas_movements_kind_check|kind_check/.test(e) ? "Marking cylinders empty needs 2026-11-gas-stock.sql to be run first" : e); return; } note(`1 ${prodLabel(productId)} marked empty ✓ It goes back with the next truck.`); loadProject();
  }
  async function voidMove(m: Move) {
    const lastOfTrip = m.carrier === "own" && m.trip_ref && moves.filter((x) => x.trip_ref === m.trip_ref && !x.voided_at).length === 1;
    if (!confirm(`Void this ${KIND[m.kind].toLowerCase()} entry of ${m.qty}? It stays in the list, marked void, and the count is corrected.${lastOfTrip ? " It is the last entry of this trip, so the trip's errand on our vehicle is voided too." : ""}`)) return;
    const { error } = await supabase().from("gas_movements").update({ voided_at: new Date().toISOString() }).eq("id", m.id); if (error) { setErr(error.message); return; } note("Voided ✓"); loadProject();
  }

  // ---------- setup (Operations / Admin) ----------
  const [vf, setVf] = useState({ name: "", contact: "", phone: "", gstin: "", address: "" }); const [pf, setPf] = useState<{ vendor_id: string; name: string; capacity: string; deposit: string }>({ vendor_id: "", name: "", capacity: "", deposit: "" }); const [rf, setRf] = useState({ product_id: "", rate: "", gst_pct: "18", valid_from: today });
  const [tf, setTf] = useState<Terms | null>(null); const [tfV, setTfV] = useState("");
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string, after: () => void) => { setErr(""); const { error } = await fn(); if (error) { setErr(error.message); return; } note(ok); after(); };
  const addVendor = () => vf.name.trim() ? run(() => supabase().from("gas_vendors").insert({ name: vf.name.trim(), contact: vf.contact.trim(), phone: vf.phone.trim(), gstin: vf.gstin.trim().toUpperCase(), address: vf.address.trim() }), "Vendor added ✓", () => { setVf({ name: "", contact: "", phone: "", gstin: "", address: "" }); load(); }) : setErr("Enter the vendor's name.");
  const addProduct = () => pf.vendor_id && pf.name.trim() ? run(() => supabase().from("gas_products").insert({ vendor_id: pf.vendor_id, name: pf.name.trim(), capacity: pf.capacity.trim(), deposit_per_cylinder: parseFloat(pf.deposit) || 0 }), "Product added ✓", () => { setPf({ ...pf, name: "", capacity: "", deposit: "" }); load(); }) : setErr("Choose the vendor and enter the product's name.");
  const addRate = () => { const r = parseFloat(rf.rate); return rf.product_id && r >= 0 && rf.rate !== "" ? run(() => supabase().from("gas_rates").insert({ product_id: rf.product_id, rate: r, gst_pct: parseFloat(rf.gst_pct) || 0, valid_from: rf.valid_from }), "Rate saved: it applies to orders approved from that date ✓", () => { setRf({ ...rf, rate: "" }); load(); }) : setErr("Choose the product and enter the rate."); };
  const toggleLink = (vendor_id: string, on: boolean) => run(() => on ? supabase().from("gas_project_vendors").insert({ project_id: pid, vendor_id }) : supabase().from("gas_project_vendors").delete().eq("project_id", pid).eq("vendor_id", vendor_id), "Saved ✓", load);
  const setActive = (table: "gas_vendors" | "gas_products", id: string, active: boolean) => run(() => supabase().from(table).update({ active }).eq("id", id), "Saved ✓", load);
  const pickTerms = (vid: string) => { setTfV(vid); setTf(vid ? terms.find((t) => t.vendor_id === vid) ?? BLANK_TERMS(vid) : null); };
  const saveTerms = () => tf && run(() => supabase().from("gas_terms").upsert({ ...tf, updated_at: new Date().toISOString() }, { onConflict: "vendor_id" }), "Terms saved ✓", load);
  const rateNow = (productId: string) => rates.find((r) => r.product_id === productId && r.valid_from <= today);
  const num = (k: keyof Terms, l: string, step = "1") => tf && <div><label className="lbl">{l}</label><input className="inp !w-32" type="number" min="0" step={step} value={String(tf[k])} onChange={(e) => setTf({ ...tf, [k]: e.target.value === "" ? 0 : parseFloat(e.target.value) })} /></div>;

  const badge = (s: string) => <span className={`text-[11px] rounded-full px-2 py-0.5 ${STATUS[s]?.[1] ?? ""}`}>{STATUS[s]?.[0] ?? s}</span>;
  const card = (l: string, v: string, sub?: string, tone = "") => <div className="rounded-2xl bg-white border border-slate-200/80 p-3 text-center"><div className="text-xs text-slate-400">{l}</div><div className={`text-lg font-medium tabular-nums ${tone}`}>{v}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
  const proj = project;
  const awaiting = orders.filter((o) => o.status === "requested").length;

  const ordersNode = !pid ? null : <div className="space-y-3">
        {canOrder && !of && <div><button className="btn btn-primary" onClick={() => startOrder()} disabled={!myVendors.length}>New order</button>{!myVendors.length && <span className="warn ml-2">No vendor is set up for this project yet.</span>}</div>}
        {of && <div className="card !p-3 space-y-3"><div className="font-medium">{of.id ? "Edit order" : "New order"} for {proj?.name}</div>
          <div className="grid gap-3 sm:grid-cols-3"><div><label className="lbl">Vendor</label><select className="inp" value={of.vendor_id} disabled={!!of.id} onChange={(e) => setOf({ ...of, vendor_id: e.target.value, lines: [{ product_id: products.find((p) => p.vendor_id === e.target.value && p.active)?.id ?? "", qty: "" }] })}>{myVendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label className="lbl">Needed by</label><input type="date" className="inp" min={today} value={of.needed_by} onChange={(e) => setOf({ ...of, needed_by: e.target.value })} /></div></div>
          <div className="space-y-2">{of.lines.map((l, i) => <div key={i} className="flex flex-wrap items-end gap-2"><div className="sm:min-w-48 sm:flex-1"><label className="lbl">{i === 0 ? "Product" : ""}</label><select className="inp" value={l.product_id} onChange={(e) => setOf({ ...of, lines: of.lines.map((x, k) => (k === i ? { ...x, product_id: e.target.value } : x)) })}>{ofProducts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.capacity ? ` (${p.capacity})` : ""}</option>)}</select></div>
            <div><label className="lbl">{i === 0 ? "Cylinders" : ""}</label><input className="inp !w-28" inputMode="numeric" value={l.qty} onChange={(e) => setOf({ ...of, lines: of.lines.map((x, k) => (k === i ? { ...x, qty: e.target.value.replace(/\D/g, "") } : x)) })} /></div>
            {of.lines.length > 1 && <button className="btn btn-sm" onClick={() => setOf({ ...of, lines: of.lines.filter((_, k) => k !== i) })}>Remove</button>}</div>)}
            <button className="btn btn-sm" onClick={() => setOf({ ...of, lines: [...of.lines, { product_id: ofProducts[0]?.id ?? "", qty: "" }] })}>+ Add another product</button></div>
          <div><label className="lbl">Note (optional)</label><input className="inp" value={of.note} onChange={(e) => setOf({ ...of, note: e.target.value })} placeholder="e.g. deliver to the east gate" /></div>
          {noticeWarn && <p className="warn">{noticeWarn}</p>}{freeWarn && <p className="warn">{freeWarn}</p>}
          <div className="flex gap-2 form-actions"><button className="btn btn-primary" disabled={busy} onClick={saveOrder}>{busy ? "Saving…" : of.id ? "Save changes" : money ? "Place order" : "Send for approval"}</button><button className="btn" onClick={() => setOf(null)}>Cancel</button></div></div>}
        {!orders.length && !of && <p className="text-sm text-slate-500">No orders for this project yet.</p>}
        {orders.map((o) => { const mine = o.requested_by === userId; const total = money ? orderTotal(o) : 0; return (
          <div key={o.id} className="card !p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2"><b>{o.order_no}</b>{badge(o.status)}<span className="text-xs text-slate-400 sm:ml-auto">raised {dmy(o.created_at)} by {who(o.requested_by)}</span></div>
            <ul className="text-sm space-y-0.5">{o.gas_order_lines.map((l) => { const got = received(o, l.product_id); const pr = money ? priceOf(l) : undefined; return <li key={l.id}>{l.qty} × {prodLabel(l.product_id)}{["approved", "sent", "partly_delivered", "delivered", "closed"].includes(o.status) && <span className="text-slate-500"> · delivered {got} of {l.qty}</span>}{pr && <span className="text-slate-500"> · ₹{inr(pr.rate)} + {pr.gst_pct}% GST</span>}</li>; })}</ul>
            <div className="text-xs text-slate-500">{vName(o.vendor_id)}{o.needed_by ? ` · needed by ${dmy(o.needed_by)}` : ""}{o.note ? ` · ${o.note}` : ""}{total > 0 ? ` · order total ₹${inr(total)} incl. GST` : ""}{(() => { const t = money ? termsOf(o.vendor_id) : undefined; if (!t || !(t.transport_per_trip > 0)) return null; const per = t.transport_per_trip; const n = countTrips(live.filter((m) => m.order_id === o.id)); return <span className="text-amber-800"> · plus transport ₹{inr(per)} per trip, no GST, not in the total{n > 0 ? `; ${n} trip${n === 1 ? "" : "s"} so far = ₹${inr(n * per)}` : ""}</span>; })()}</div>
            {o.status === "rejected" && <p className="text-xs text-rose-700">Rejected by {who(o.decided_by)}: {o.reject_reason}</p>}
            {(o.status === "approved" || o.status === "sent" || o.status === "partly_delivered" || o.status === "delivered" || o.status === "closed") && o.decided_by && <p className="text-xs text-slate-400">Approved by {who(o.decided_by)}{o.decided_at ? ` on ${dmy(o.decided_at)}` : ""}</p>}
            <div className="flex flex-wrap gap-2">
              {o.status === "requested" && (mine || money) && canOrder && <button className="btn btn-sm" onClick={() => startOrder(o)}>Edit</button>}
              {o.status === "requested" && (mine || money) && canOrder && <button className="btn btn-sm btn-danger" onClick={() => cancel(o)}>Cancel order</button>}
              {mayAct && o.status === "requested" && <><button className="btn btn-sm btn-primary" onClick={() => setStatus(o, "approved")}>Approve</button><button className="btn btn-sm" onClick={() => reject(o)}>Reject</button></>}
              {mayAct && o.status === "approved" && <button className="btn btn-sm" onClick={() => setStatus(o, "sent")}>Mark as sent to vendor</button>}
              {mayAct && ["approved", "sent", "partly_delivered", "delivered"].includes(o.status) && <button className="btn btn-sm" onClick={() => setStatus(o, "closed")}>Close order</button>}
              {mayAct && ["approved", "sent"].includes(o.status) && <button className="btn btn-sm btn-danger" onClick={() => cancel(o)}>Cancel order</button>}
              {money && !["requested", "rejected", "cancelled"].includes(o.status) && <a className="btn btn-sm" href={`/api/gas/po?order=${o.id}`} target="_blank" rel="noreferrer">Purchase order PDF</a>}
            </div></div>); })}
      </div>;
  const moveForm = !showMove ? null : <div className="card !p-3 space-y-3"><div className="font-medium">A truck came, or a cylinder was lost or damaged</div>
          <div className="grid gap-3 sm:grid-cols-4"><div className="sm:col-span-2"><label className="lbl">What happened</label><select className="inp" value={mf.kind} onChange={(e) => setMf({ ...mf, kind: e.target.value })}>{Object.entries({ ...FORM_KIND, ...(mayAct ? { opening: OPENING_KIND } : {}) }).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="lbl">Date</label><input type="date" className="inp" max={today} value={mf.moved_on} onChange={(e) => setMf({ ...mf, moved_on: e.target.value })} /></div>
            <div><label className="lbl">Vendor's challan no.</label><input className="inp" value={mf.challan_no} onChange={(e) => setMf({ ...mf, challan_no: e.target.value })} /></div>
            {mf.kind === "trip" && <div className="sm:col-span-2"><label className="lbl">For order (optional)</label><select className="inp" value={mf.order_id} onChange={(e) => setMf({ ...mf, order_id: e.target.value })}><option value="">Not linked to an order</option>{openOrders.map((o) => <option key={o.id} value={o.id}>{o.order_no}</option>)}</select></div>}
            {mf.kind === "trip" && <div className="sm:col-span-2"><label className="lbl">Brought by</label><select className="inp" value={mf.carrier} onChange={(e) => setMf({ ...mf, carrier: e.target.value as Carrier })}>{(Object.keys(CARRIER) as Carrier[]).filter((c) => c !== "own" || tVehicles.some((v) => v.active)).map((c) => <option key={c} value={c}>{CARRIER[c]}</option>)}</select></div>}
            {mf.kind === "trip" && mf.carrier === "own" && <div className="sm:col-span-2"><label className="lbl">Which vehicle</label><select className="inp" value={mf.vehicle_id} onChange={(e) => setMf({ ...mf, vehicle_id: e.target.value })}><option value="">Choose…</option>{tVehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}{v.operator ? ` · ${v.operator}` : ""}</option>)}</select></div>}
            {mf.kind === "trip" && mf.carrier !== "vendor" && <p className="sm:col-span-4 text-xs text-slate-500">{mf.carrier === "own" ? "The gas vendor's trip charge is not counted. An errand is added on this vehicle under Transport; Operations or the Admin enter its amount." : "No trip charge from anyone."}</p>}
            <div className={mf.kind === "trip" ? "sm:col-span-2" : "sm:col-span-4"}><label className="lbl">Challan photo (optional)</label><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></div></div>
          {mf.kind === "trip" ? <div className="space-y-2">
            <p className="text-xs text-slate-500">One trip: the new cylinders coming in and the empties going back on the same visit. Enter both here. When the vendor brings it, their trip charge is counted once per challan, however many products are on it, and the pick-up is part of the trip.</p>
            <div className="hidden sm:grid grid-cols-[1fr_8rem_8rem] gap-2 text-xs font-semibold text-slate-600"><span>Product</span><span>New (full) in</span><span>Empties out</span></div>
            {moveProducts.map((p) => { const t = tr[p.id] ?? { inQ: "", outQ: "", sIn: "", sOut: "" }; const up = (k: "inQ" | "outQ" | "sIn" | "sOut", v: string) => setTr({ ...tr, [p.id]: { ...t, [k]: v } }); return (
              <div key={p.id} className="rounded-lg border border-slate-200 p-2 space-y-2"><div className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem] items-center"><div className="text-sm font-medium">{prodLabel(p.id)}<div className="text-xs font-normal text-slate-400">{vName(p.vendor_id)} · {held.get(p.id)?.qty ?? 0} here now</div></div>
                <div><label className="lbl sm:hidden">New (full) in</label><input className="inp" inputMode="numeric" placeholder="0" value={t.inQ} onChange={(e) => up("inQ", e.target.value.replace(/\D/g, ""))} /></div>
                <div><label className="lbl sm:hidden">Empties out</label><input className="inp" inputMode="numeric" placeholder="0" value={t.outQ} onChange={(e) => up("outQ", e.target.value.replace(/\D/g, ""))} /></div></div>
                <details className="text-xs text-slate-500"><summary className="cursor-pointer text-blue-700">Serial numbers (optional)</summary><div className="mt-1 grid gap-2 sm:grid-cols-2"><textarea className="inp" rows={2} placeholder="New cylinders in: comma or space separated" value={t.sIn} onChange={(e) => up("sIn", e.target.value)} /><textarea className="inp" rows={2} placeholder="Empties out: comma or space separated" value={t.sOut} onChange={(e) => up("sOut", e.target.value)} /></div></details></div>); })}</div>
          : <div className="grid gap-3 sm:grid-cols-4"><div className="sm:col-span-3"><label className="lbl">Product</label><select className="inp" value={mf.product_id} onChange={(e) => setMf({ ...mf, product_id: e.target.value })}>{moveProducts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.capacity ? ` (${p.capacity})` : ""} · {vName(p.vendor_id)}</option>)}</select></div>
            <div><label className="lbl">Cylinders</label><input className="inp" inputMode="numeric" value={mf.qty} onChange={(e) => setMf({ ...mf, qty: e.target.value.replace(/\D/g, "") })} /></div>
            <div className="sm:col-span-4"><label className="lbl">Cylinder serial numbers (optional)</label><textarea className="inp" rows={2} value={mf.serials} onChange={(e) => setMf({ ...mf, serials: e.target.value })} placeholder="Separate with commas, spaces or new lines" /></div></div>}
          <div><label className="lbl">Note (optional)</label><input className="inp" value={mf.note} onChange={(e) => setMf({ ...mf, note: e.target.value })} /></div>
          <div className="flex gap-2 form-actions"><button className="btn btn-primary" disabled={busy} onClick={mf.kind === "trip" ? saveTrip : saveMove}>{busy ? "Saving…" : mf.kind === "trip" ? "Save trip" : "Save"}</button><button className="btn" onClick={() => setShowMove(false)}>Close</button></div></div>;
  // a trip brought by our own vehicle: its errand's amount is entered once, on the first entry of the trip
  const tripFirst = useMemo(() => { const f = new Map<string, Move>(); [...moves].filter((m) => m.trip_ref && !m.voided_at).sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach((m) => { if (!f.has(m.trip_ref!)) f.set(m.trip_ref!, m); }); return f; }, [moves]);
  const tVName = (id: string | null | undefined) => tVehicles.find((v) => v.id === id)?.name ?? "our vehicle";
  async function setErrandAmount(x: TripErrand) {
    const amount = parseFloat(errAmt[x.id] || ""); if (!(amount > 0)) { setErr("Enter the amount the transport vendor charges for this trip."); return; }
    const { error } = await supabase().from("transport_errands").update({ amount }).eq("id", x.id); if (error) { setErr(error.message); return; }
    setErrAmt((s) => ({ ...s, [x.id]: "" })); note(`Errand amount saved: ₹${inr(amount)}, added to ${tVName(moves.find((m) => m.trip_ref === x.gas_trip_ref)?.vehicle_id)}'s dues under Transport ✓`); loadProject();
  }
  const carrierNode = (m: Move) => {
    if (!m.carrier || m.carrier === "vendor" || (m.kind !== "delivery" && m.kind !== "return")) return null;
    if (m.carrier === "none") return <div className="text-xs text-slate-500">Collected: no trip charge</div>;
    const x = m.trip_ref ? tripErrands.find((e) => e.gas_trip_ref === m.trip_ref && !e.voided_at) : undefined; const first = m.trip_ref && tripFirst.get(m.trip_ref)?.id === m.id;
    return <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">Brought by {tVName(m.vehicle_id)} (our transport)
      {money && first && x && (x.amount != null ? <span>· errand ₹{inr(x.amount)}</span> : mayAct ? <span className="inline-flex items-center gap-1">· <span className="text-amber-700">errand needs amount</span><input className="inp !w-24 !py-0.5 text-xs" inputMode="decimal" placeholder="₹" aria-label="Errand amount" value={errAmt[x.id] ?? ""} onChange={(e) => setErrAmt((s) => ({ ...s, [x.id]: e.target.value.replace(/[^\d.]/g, "") }))} /><button className="tlink" onClick={() => setErrandAmount(x)}>Save</button></span> : <span className="text-amber-700">· errand needs amount</span>)}</div>;
  };
  // ---------- Admin: correct a logged entry in place (2026-11-gas-edit.sql) ----------
  const startEdit = (m: Move) => { setErr(""); setEf({ m, moved_on: m.moved_on, challan_no: m.challan_no, carrier: (m.carrier as Carrier) || "vendor", vehicle_id: m.vehicle_id ?? "", product_id: m.product_id, qty: String(m.qty), order_id: m.order_id ?? "", note: m.note, reason: "", photo: null }); };
  async function saveEdit() {
    if (!ef) return; const m = ef.m; const qty = parseInt(ef.qty, 10); const isTrip = m.kind === "delivery" || m.kind === "return";
    if (!(qty > 0)) { setErr("Enter how many cylinders."); return; } if (isTrip && ef.carrier === "own" && !ef.vehicle_id) { setErr("Choose which of our vehicles brought it."); return; }
    setBusy(true); setErr(""); const sb = supabase(); const fail = (msg: string) => { setBusy(false); setErr(/gas_trip_edit|gas_movement_edit|schema cache|could not find/i.test(msg) ? "Correcting entries needs 2026-11-gas-edit.sql to be run first." : msg); };
    let photo = m.photo_path; if (ef.photo) { const fd = new FormData(); fd.set("file", await prepareUpload(ef.photo)); fd.set("projectId", pid); const r = await fetch("/api/gas/upload", { method: "POST", body: fd }); if (!r.ok) { fail(await r.text()); return; } photo = (await r.json()).path; }
    const tripChanged = ef.moved_on !== m.moved_on || ef.challan_no.trim() !== m.challan_no.trim() || photo !== m.photo_path || (isTrip && (ef.carrier !== ((m.carrier as Carrier) || "vendor") || (ef.carrier === "own" && ef.vehicle_id !== (m.vehicle_id ?? ""))));
    const rowChanged = ef.product_id !== m.product_id || qty !== m.qty || (ef.order_id || null) !== (m.order_id || null) || ef.note.trim() !== m.note.trim();
    if (!tripChanged && !rowChanged) { setBusy(false); setEf(null); return; }
    if (tripChanged) { const { error } = await sb.rpc("gas_trip_edit", { p_movement: m.id, p_moved_on: ef.moved_on, p_challan: ef.challan_no.trim(), p_photo: photo, p_carrier: isTrip ? ef.carrier : "vendor", p_vehicle: isTrip && ef.carrier === "own" ? ef.vehicle_id : null, p_reason: ef.reason.trim() }); if (error) { fail(error.message); return; } }
    if (rowChanged) { const { error } = await sb.rpc("gas_movement_edit", { p_movement: m.id, p_product: ef.product_id, p_qty: qty, p_order: m.kind === "delivery" ? ef.order_id || null : null, p_note: ef.note.trim(), p_reason: ef.reason.trim() }); if (error) { fail(tripChanged ? `The date / challan / who brought it were saved, but not the rest: ${error.message}` : error.message); loadProject(); return; } }
    setBusy(false); setEf(null); note(tripChanged && moves.filter((x) => !x.voided_at && x.id !== m.id && ((m.trip_ref && x.trip_ref === m.trip_ref) || (!m.trip_ref && x.moved_on === m.moved_on && x.challan_no.trim() === m.challan_no.trim() && x.photo_path === m.photo_path && (x.kind === "delivery" || x.kind === "return")))).length ? "Corrected ✓ The date, challan and who brought it were changed for every entry of this visit." : "Corrected ✓"); loadProject();
  }
  const FIELD: Record<string, string> = { moved_on: "date", challan_no: "challan", photo_path: "photo", carrier: "brought by", vehicle_id: "vehicle", product_id: "product", qty: "quantity", order_id: "order", note: "note" };
  const showVal = (k: string, v: unknown): string => v === null || v === undefined || v === "" ? "—" : k === "moved_on" ? dmy(String(v)) : k === "product_id" ? prodLabel(String(v)) : k === "vehicle_id" ? tVName(String(v)) : k === "order_id" ? orders.find((o) => o.id === v)?.order_no ?? "an order" : k === "carrier" ? CARRIER[v as Carrier] ?? String(v) : k === "photo_path" ? "a photo" : String(v);
  const historyNode = (m: Move) => { const h = edits.filter((e) => e.movement_id === m.id); if (!h.length) return null; return <details className="text-xs text-slate-500"><summary className="cursor-pointer text-amber-700">Edited {h.length === 1 ? "once" : `${h.length} times`} · last by {who(h[h.length - 1].edited_by)} on {dmy(h[h.length - 1].edited_at)}</summary>
    <ul className="mt-1 space-y-0.5">{h.map((e) => <li key={e.id}>{dmy(e.edited_at)} · {who(e.edited_by)}: {Object.entries(e.changes).map(([k, [a, b]]) => `${FIELD[k] ?? k} ${showVal(k, a)} → ${showVal(k, b)}`).join("; ")}{e.reason ? ` (${e.reason})` : ""}</li>)}</ul></details>; };
  const editNode = (m: Move) => { if (!ef || ef.m.id !== m.id) return null; const isTrip = m.kind === "delivery" || m.kind === "return"; const set = (p: Partial<EditForm>) => setEf({ ...ef, ...p }); return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/40 p-2 space-y-2" data-gas-edit>
      <div className="text-xs font-semibold text-slate-600">The whole visit{isTrip ? " (every entry with this date and challan)" : ""}</div>
      <div className="grid gap-2 sm:grid-cols-4">
        <div><label className="lbl">Date</label><input type="date" className="inp" max={today} value={ef.moved_on} onChange={(e) => set({ moved_on: e.target.value })} /></div>
        <div><label className="lbl">Challan no.</label><input className="inp" value={ef.challan_no} onChange={(e) => set({ challan_no: e.target.value })} /></div>
        {isTrip && <div><label className="lbl">Brought by</label><select className="inp" value={ef.carrier} onChange={(e) => set({ carrier: e.target.value as Carrier })}>{(Object.keys(CARRIER) as Carrier[]).map((c) => <option key={c} value={c}>{CARRIER[c]}</option>)}</select></div>}
        {isTrip && ef.carrier === "own" && <div><label className="lbl">Which vehicle</label><select className="inp" value={ef.vehicle_id} onChange={(e) => set({ vehicle_id: e.target.value })}><option value="">Choose…</option>{tVehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.active ? "" : " (inactive)"}</option>)}</select></div>}
        <div className="sm:col-span-4"><label className="lbl">Replace challan photo (optional)</label><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => set({ photo: e.target.files?.[0] ?? null })} /></div>
      </div>
      <div className="text-xs font-semibold text-slate-600">This entry</div>
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="sm:col-span-2"><label className="lbl">Product</label><select className="inp" value={ef.product_id} onChange={(e) => set({ product_id: e.target.value })}>{products.filter((p) => p.vendor_id === m.vendor_id).map((p) => <option key={p.id} value={p.id}>{prodLabel(p.id)}</option>)}</select></div>
        <div><label className="lbl">Cylinders</label><input className="inp" inputMode="numeric" value={ef.qty} onChange={(e) => set({ qty: e.target.value.replace(/\D/g, "") })} /></div>
        {m.kind === "delivery" && <div><label className="lbl">For order</label><select className="inp" value={ef.order_id} onChange={(e) => set({ order_id: e.target.value })}><option value="">Not linked</option>{orders.filter((o) => o.vendor_id === m.vendor_id && !["requested", "rejected", "cancelled"].includes(o.status)).map((o) => <option key={o.id} value={o.id}>{o.order_no}</option>)}</select></div>}
        <div className="sm:col-span-4"><label className="lbl">Note</label><input className="inp" value={ef.note} onChange={(e) => set({ note: e.target.value })} /></div>
        <div className="sm:col-span-4"><label className="lbl">Reason for the correction</label><input className="inp" value={ef.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="e.g. challan number typed wrong" /></div>
      </div>
      <div className="flex gap-2"><button className="btn btn-sm btn-primary" disabled={busy} onClick={saveEdit}>{busy ? "Saving…" : "Save correction"}</button><button className="btn btn-sm" onClick={() => setEf(null)}>Cancel</button></div>
      <p className="text-[11px] text-slate-400">Counts, the order, the Inventory entry and the transport errand follow the correction. It is kept in this entry's history.</p>
    </div>); };
  const logItems = moves.map((m) => { const gb = gasBillOf(m); return { key: m.id, date: m.moved_on, stamp: m.created_at, kind: "gas" as const, node: <div className={`py-2.5 text-sm ${m.voided_at ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-2"><b className={m.voided_at ? "line-through" : ""}>{KIND[m.kind]}: {m.qty} × {prodLabel(m.product_id)}</b>{m.voided_at && <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">void</span>}<span className="text-xs text-slate-400 sm:ml-auto">{dmy(m.moved_on)} · entered by {who(m.entered_by)}</span></div>
          <div className="text-xs text-slate-500">{vName(m.vendor_id)}{m.challan_no ? ` · challan ${m.challan_no}` : ""}{m.order_id ? ` · ${orders.find((o) => o.id === m.order_id)?.order_no ?? "order"}` : ""}{m.note ? ` · ${m.note}` : ""}</div>
          {carrierNode(m)}
          {m.gas_movement_serials.length > 0 && <div className="text-xs text-slate-500">Serials: {m.gas_movement_serials.map((s) => s.serial).join(", ")}</div>}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">{m.photo_path && <a className="tlink" href={`/api/gas/file?path=${encodeURIComponent(m.photo_path)}`} target="_blank" rel="noreferrer">Challan photo</a>}{!m.voided_at && isAdmin && !(ef && ef.m.id === m.id) && <button className="tlink" onClick={() => startEdit(m)}>Edit</button>}{!m.voided_at && <button className="tlink tlink-danger" onClick={() => voidMove(m)}>Void</button>}
          {!m.voided_at && gb && (gb.jsl_wanted ? <a className={`tlink text-[11px] rounded-full px-2 py-0.5 ${JSL_LABEL[gb.jsl_status].cls}`} href={`/inventory?project=${pid}&bill=${gb.id}`}>{JSL_LABEL[gb.jsl_status].text} →</a> : <a className="tlink" href={`/inventory?project=${pid}&bill=${gb.id}`}>Send to the JSL portal →</a>)}</div>{historyNode(m)}{editNode(m)}</div> }; });
  const setupNode = !money ? null : <div className="space-y-4">
        <div className="card !p-3 space-y-3"><div className="font-medium">Vendors for {proj?.name ?? "this project"}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">{vendors.map((v) => <label key={v.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={links.some((l) => l.project_id === pid && l.vendor_id === v.id)} disabled={!pid} onChange={(e) => toggleLink(v.id, e.target.checked)} />{v.name}{!v.active && <span className="text-xs text-slate-400">(inactive)</span>}</label>)}{!vendors.length && <span className="text-sm text-slate-400">Add a vendor below first.</span>}</div>
          <p className="text-xs text-slate-400">Tick the vendors that supply this project. Site Engineers can only order from these.</p></div>
        <div className="card !p-3 space-y-3"><div className="font-medium">Add a vendor</div>
          <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Name</label><input className="inp !w-52" value={vf.name} onChange={(e) => setVf({ ...vf, name: e.target.value })} /></div><div><label className="lbl">Contact person</label><input className="inp !w-40" value={vf.contact} onChange={(e) => setVf({ ...vf, contact: e.target.value })} /></div><div><label className="lbl">Phone</label><input className="inp !w-36" value={vf.phone} onChange={(e) => setVf({ ...vf, phone: e.target.value })} /></div><div><label className="lbl">GSTIN</label><input className="inp !w-44" value={vf.gstin} onChange={(e) => setVf({ ...vf, gstin: e.target.value })} /></div><div><label className="lbl">Address</label><input className="inp !w-64" value={vf.address} onChange={(e) => setVf({ ...vf, address: e.target.value })} /></div><button className="btn btn-primary" onClick={addVendor}>Add vendor</button></div>
          {vendors.map((v) => <div key={v.id} className="border-t border-slate-100 pt-2 space-y-1"><div className="flex flex-wrap items-center gap-2"><b>{v.name}</b><span className="text-xs text-slate-400">{[v.contact, v.phone, v.gstin, v.address].filter(Boolean).join(" · ")}</span><button className="btn btn-sm sm:ml-auto" onClick={() => setActive("gas_vendors", v.id, !v.active)}>{v.active ? "Make inactive" : "Make active"}</button></div>
            {admin && <PayeeBank kind="gas_vendor" refId={v.id} label="Vendor bank details" />}
            <ul className="text-sm space-y-0.5">{products.filter((p) => p.vendor_id === v.id).map((p) => { const r = rateNow(p.id); return <li key={p.id} className="flex flex-wrap gap-2 items-center">{p.name}{p.capacity ? ` · ${p.capacity}` : ""} <span className="text-slate-500">{p.deposit_per_cylinder > 0 ? `deposit ₹${inr(p.deposit_per_cylinder)} · ` : ""}{r ? `₹${inr(r.rate)} + ${r.gst_pct}% GST (from ${dmy(r.valid_from)})` : <span className="text-amber-700">no rate yet</span>}</span>{!p.active && <span className="text-xs text-slate-400">(inactive)</span>}<button className="tlink" onClick={() => setActive("gas_products", p.id, !p.active)}>{p.active ? "make inactive" : "make active"}</button></li>; })}</ul></div>)}
        </div>
        <div className="card !p-3 space-y-3"><div className="font-medium">Add a product</div>
          <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Vendor</label><select className="inp !w-52" value={pf.vendor_id} onChange={(e) => setPf({ ...pf, vendor_id: e.target.value })}><option value="">Choose…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div><div><label className="lbl">Product</label><input className="inp !w-52" placeholder="e.g. Industrial oxygen" value={pf.name} onChange={(e) => setPf({ ...pf, name: e.target.value })} /></div><div><label className="lbl">Capacity (optional)</label><input className="inp !w-28" placeholder="e.g. 7 m3" value={pf.capacity} onChange={(e) => setPf({ ...pf, capacity: e.target.value })} /></div><div><label className="lbl">Deposit per cylinder (₹, refundable)</label><input className="inp !w-40" inputMode="decimal" value={pf.deposit} onChange={(e) => setPf({ ...pf, deposit: e.target.value.replace(/[^\d.]/g, "") })} /></div><button className="btn btn-primary" onClick={addProduct}>Add product</button></div></div>
        <div className="card !p-3 space-y-3"><div className="font-medium">Rates</div>
          <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Product</label><select className="inp !w-64" value={rf.product_id} onChange={(e) => setRf({ ...rf, product_id: e.target.value })}><option value="">Choose…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.capacity ? ` (${p.capacity})` : ""} · {vName(p.vendor_id)}</option>)}</select></div><div><label className="lbl">Rate per cylinder (₹, before GST)</label><input className="inp !w-40" inputMode="decimal" value={rf.rate} onChange={(e) => setRf({ ...rf, rate: e.target.value.replace(/[^\d.]/g, "") })} /></div><div><label className="lbl">GST %</label><input className="inp !w-20" inputMode="decimal" value={rf.gst_pct} onChange={(e) => setRf({ ...rf, gst_pct: e.target.value.replace(/[^\d.]/g, "") })} /></div><div><label className="lbl">From</label><input type="date" className="inp" value={rf.valid_from} onChange={(e) => setRf({ ...rf, valid_from: e.target.value })} /></div><button className="btn btn-primary" onClick={addRate}>Save rate</button></div>
          <p className="text-xs text-slate-400">A new rate applies to orders approved on or after its date. Orders already approved keep the rate that was locked on them.</p>
          {rates.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-blue-700">Rate history</summary><ul className="mt-1 space-y-0.5">{rates.map((r) => <li key={r.id}>{prodLabel(r.product_id)} · ₹{inr(r.rate)} + {r.gst_pct}% GST · from {dmy(r.valid_from)}</li>)}</ul></details>}</div>
        <div className="card !p-3 space-y-3"><div className="font-medium">Terms</div>
          <div><label className="lbl">Vendor</label><select className="inp !w-64" value={tfV} onChange={(e) => pickTerms(e.target.value)}><option value="">Choose…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
          {tf && <><div className="flex flex-wrap gap-3">{num("transport_per_trip", "Transport per delivery trip (₹)")}{num("loss_charge_per_cylinder", "Lost cylinder charge (₹ each)")}{num("damage_charge_per_cylinder", "Valve + cap damaged (₹ each)")}{num("charges_gst_pct", "GST on lost and damaged charges (%)")}{num("due_day_first_half", "Pay 1st–15th bills by day")}{num("due_day_second_half", "Pay 16th–end bills by day (next month)")}</div>
            <div><label className="lbl">Wording printed on the purchase order (optional)</label><textarea className="inp" rows={2} value={tf.terms_note} onChange={(e) => setTf({ ...tf, terms_note: e.target.value })} /></div>
            <button className="btn btn-primary" onClick={saveTerms}>Save terms</button></>}</div>
      </div>;
  const todayNode = !pid ? null : <section className="space-y-3"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold sm:mr-auto">Gas cylinders</h2>{canOrder && myVendors.length > 0 && <button className="btn btn-sm" onClick={() => { go("orders"); startOrder(); }}>New order</button>}</div>
    {!projectProducts.length && <p className="text-sm text-slate-500">No gas vendor is set up for {proj?.name ?? "this project"} yet.{money ? " Add one under Setup." : " Ask Operations or the Admin."}</p>}
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">{projectProducts.map((p) => { const h = held.get(p.id); const t = totals(p.id); const full = h?.full ?? 0, empty = h?.empty ?? 0; return (
      <div key={p.id} className="card !p-3 space-y-1" data-gas-card><div className="font-medium">{p.name}{p.capacity ? ` · ${p.capacity}` : ""}</div>
        <div className="text-2xl font-semibold tabular-nums">{full}<span className="text-sm font-normal text-slate-500"> full</span>{empty > 0 && <span className="ml-3 text-lg text-amber-700">{empty}<span className="text-sm font-normal"> empty</span></span>}</div>
        <div className="text-xs text-slate-500">{h?.qty ?? 0} at the site{t.o ? ` (${t.o} opening stock)` : ""} · {t.d} refills in · {t.r} empties out{t.l ? ` · ${t.l} lost` : ""}{t.g ? ` · ${t.g} damaged` : ""}</div>
        {!viewer && full > 0 && <button type="button" className="tlink text-xs" disabled={busy} onClick={() => markEmpty(p.id)}>1 went empty</button>}{!viewer && !(h?.qty) && money && !t.o && <div className="text-[11px] text-slate-400">Already had some here? Add opening stock under "A truck came".</div>}</div>); })}</div>
    {orders.some((o) => ["approved", "sent", "partly_delivered"].includes(o.status)) && <div className="card !p-3"><div className="text-sm font-medium mb-1">Expected deliveries</div><ul className="text-sm space-y-0.5">{orders.filter((o) => ["approved", "sent", "partly_delivered"].includes(o.status)).map((o) => <li key={o.id}><b>{o.order_no}</b> · {o.gas_order_lines.map((l) => `${l.qty} ${prodLabel(l.product_id)}`).join(", ")}{o.needed_by ? ` · needed by ${dmy(o.needed_by)}` : ""} {badge(o.status)}</li>)}</ul></div>}
    {projectProducts.length > 0 && !showMove && <button className="btn btn-primary w-full sm:w-auto justify-center !min-h-14 !text-base !font-semibold" onClick={() => { setShowMove(true); setMf((f) => ({ ...f, product_id: f.product_id || moveProducts[0]?.id || "" })); }}>+ A truck came: cylinders in / out</button>}
    {moveForm}</section>;
  const depositsNode = !money || !pid ? null : <GasDeposits projectId={pid} vendors={vendors.filter((v) => links.some((l) => l.project_id === pid && l.vendor_id === v.id))} products={depositProducts} />;
  const billVendors = vendors.filter((v) => links.some((l) => l.project_id === pid && l.vendor_id === v.id));
  return { err, msg, loading, money, awaiting, todayNode, ordersNode, setupNode, depositsNode, logItems, compute, billVendors, costCard: money && pid ? <GasCostCard projectId={pid} /> : null, hasVendor: projectProducts.length > 0, closeForms: () => { setOf(null); setShowMove(false); } };
}
