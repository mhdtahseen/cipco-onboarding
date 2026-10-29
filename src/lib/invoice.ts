import type { QItem } from "./quote";

// Invoicing: types and the money maths. Pure (no React, no database) so it can be tested and used by both the screens and the PDF.
// A bill is a running-account (RA) bill against a work order: each line is billed by the quantity done to date, less what earlier bills already charged.

export type Client = { id: string; name: string; short_name: string | null; address: string | null; state_code: string; gstin: string | null; pan: string | null; contact_person: string | null; email: string | null; phone: string | null; active: boolean };
export type WorkOrder = { id: string; client_id: string; project_id: string | null; wo_no: string; wo_date: string | null; title: string; sac: string; gst_rate: number; retention_pct: number; tds_pct: number; payment_days: number; status: "active" | "completed" | "closed"; notes: string | null };
export type WoItem = { id: string; work_order_id: string; sort: number; description: string; unit: string; qty: number; rate: number };
export type InvoiceStatus = "draft" | "issued" | "cancelled";
export type Invoice = {
  id: string; invoice_no: string | null; work_order_id: string; client_id: string; project_id: string | null; bill_no: number; status: InvoiceStatus; invoice_date: string; period_from: string | null; period_to: string | null; due_date: string | null;
  sac: string; gst_rate: number; place_of_supply_code: string; taxable: number; cgst: number; sgst: number; igst: number; round_off: number; total: number; retention_pct: number; retention: number; other_deduction: number; other_deduction_note: string | null; payable: number; tds_pct: number; notes: string | null;
  issued_at: string | null; cancelled_at: string | null; cancel_reason: string | null; created_at: string;
};
export type InvoiceItem = { id: string; invoice_id: string; work_order_item_id: string | null; sort: number; description: string; unit: string; rate: number; prev_qty: number; cum_qty: number; qty: number; amount: number };
export type Receipt = { id: string; invoice_id: string; received_on: string; amount: number; tds_amount: number; reference: string | null; note: string | null; voided_at: string | null };

export const COMPANY_STATE_CODE = "27";   // Maharashtra: where we are registered (the GSTIN starts with it)
/** GST state codes. The place of supply for work on a site is the SITE's state: ours (27) gives CGST + SGST, any other gives IGST. */
export const STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
export const STATE_OPTIONS = Object.entries(STATES).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
export const stateName = (code: string) => STATES[code] ?? `State ${code}`;
/** Guess the GST state from a location typed as text ("Mundra, Gujarat" → 24). Empty when no state name is in it. */
export const guessState = (location: string) => { const l = (location || "").toLowerCase(); return Object.entries(STATES).find(([, name]) => l.includes(name.toLowerCase()))?.[0] ?? ""; };
export const taxKind = (supplyCode: string) => (supplyCode === COMPANY_STATE_CODE ? "CGST + SGST" : "IGST");

/** Round to paise without the 1.005 → 1.00 floating-point slip. */
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const money = (n: number) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const qtyText = (n: number) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Financial year (April to March) of a date, as "26-27". */
export function fyOf(iso: string): string { const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)); const s = m >= 4 ? y : y - 1; return `${String(s % 100).padStart(2, "0")}-${String((s + 1) % 100).padStart(2, "0")}`; }
export const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const daysBetween = (from: string, to: string) => Math.round((new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) / 86400000);

export type Totals = { taxable: number; cgst: number; sgst: number; igst: number; roundOff: number; total: number; retention: number; payable: number; tds: number };
/**
 * Money for one bill. GST is on the full taxable value; retention and other deductions only reduce what is payable now.
 * Same state as us → CGST + SGST (half each); another state → IGST. The total is rounded to the whole rupee, with the difference shown as round-off.
 */
export function calcInvoice(lines: { qty: number; rate: number }[], o: { gstRate: number; retentionPct: number; otherDeduction: number; tdsPct: number; supplyCode: string }): Totals {
  const taxable = r2(lines.reduce((s, l) => s + r2(Number(l.qty || 0) * Number(l.rate || 0)), 0));
  const inter = o.supplyCode !== COMPANY_STATE_CODE;
  const cgst = inter ? 0 : r2((taxable * o.gstRate) / 200), sgst = inter ? 0 : r2((taxable * o.gstRate) / 200), igst = inter ? r2((taxable * o.gstRate) / 100) : 0;
  const gross = r2(taxable + cgst + sgst + igst); const total = Math.round(gross); const roundOff = r2(total - gross);
  const retention = r2((taxable * o.retentionPct) / 100); const payable = r2(total - retention - Number(o.otherDeduction || 0));
  return { taxable, cgst, sgst, igst, roundOff, total, retention, payable, tds: r2((taxable * o.tdsPct) / 100) };
}
export const lineAmount = (qty: number, rate: number) => r2(Number(qty || 0) * Number(rate || 0));

/** What a receipt settles: the money received plus the tax the client deducted. */
export const settledOf = (receipts: Receipt[]) => r2(receipts.filter((r) => !r.voided_at).reduce((s, r) => s + Number(r.amount) + Number(r.tds_amount), 0));
export const receivedOf = (receipts: Receipt[]) => r2(receipts.filter((r) => !r.voided_at).reduce((s, r) => s + Number(r.amount), 0));
export const tdsOf = (receipts: Receipt[]) => r2(receipts.filter((r) => !r.voided_at).reduce((s, r) => s + Number(r.tds_amount), 0));
export const outstandingOf = (inv: Pick<Invoice, "total" | "status">, receipts: Receipt[]) => (inv.status === "issued" ? Math.max(0, r2(Number(inv.total) - settledOf(receipts))) : 0);
/** The part of what is outstanding that is only retention being held (released later). */
export const retentionHeld = (inv: Pick<Invoice, "retention" | "total" | "status">, receipts: Receipt[]) => Math.min(outstandingOf(inv, receipts), Number(inv.retention || 0));

export type Aging = "not_due" | "d0_30" | "d31_60" | "d61_90" | "d90";
export const AGING_LABEL: Record<Aging, string> = { not_due: "Not yet due", d0_30: "1–30 days late", d31_60: "31–60 days late", d61_90: "61–90 days late", d90: "Over 90 days late" };
export function agingOf(dueDate: string | null, today: string): Aging { if (!dueDate) return "not_due"; const late = daysBetween(dueDate, today); return late <= 0 ? "not_due" : late <= 30 ? "d0_30" : late <= 60 ? "d31_60" : late <= 90 ? "d61_90" : "d90"; }

/** A quotation's lines as order lines: a lump-sum line becomes 1 Lot at that amount, and lines with no description are dropped. */
export function rowsFromQuote(items: QItem[]): { description: string; unit: string; qty: number; rate: number }[] {
  const n = (s: string) => { const v = Number(String(s ?? "").replace(/,/g, "")); return Number.isFinite(v) ? v : 0; };
  return (items || []).filter((i) => (i.desc || "").trim()).map((i) => (i.lump ? { description: i.desc.trim(), unit: "Lot", qty: 1, rate: n(i.amount) } : { description: i.desc.trim(), unit: (i.unit || "Nos").trim(), qty: n(i.qty), rate: n(i.rate) }));
}
/** Match a typed client name against the client list: ignores case, punctuation and trailing commas ("Man Industries (India) Ltd," = "Man Industries (India) Ltd"). */
export const normName = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Cumulative quantity must not go backwards, and should not pass the order's quantity. Returns what is wrong, or "". */
export function checkLine(cum: number, prev: number, orderQty: number | null): string {
  if (cum < prev) return "Less than already billed";
  if (orderQty !== null && cum > orderQty + 1e-9) return `More than the order (${qtyText(orderQty)})`;
  return "";
}
