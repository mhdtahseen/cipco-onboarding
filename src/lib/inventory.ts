// Inventory: pure types and sums, shared by the page and its components. One bill = one project expense = one MRR on the JSL portal.
import { JSL_UNITS } from "./units";
/** draft: being entered. submitted: waiting for Operations or an Admin to review. returned: sent back to be reworked. recorded: approved (its items are received and its amount, if any, is in expenses). */
export type BillStatus = "draft" | "submitted" | "returned" | "recorded";
export type NoteField = "" | "vendor" | "gstin" | "bill_no" | "date" | "total" | "other_charges" | "photo" | "reason" | "amount";
export type ReviewNote = { id: string; bill_id: string; item_id: string | null; item_name: string; field: NoteField; note: string; state: "open" | "done"; created_at: string; resolved_at: string | null };
export type BillEvent = { id: string; bill_id: string; kind: "submitted" | "returned" | "approved" | "recorded" | "reopened" | "voided"; note: string; created_at: string };
export type JslStatus = "none" | "authorized" | "sending" | "submitting" | "submitted" | "failed" | "needs_check";
export type InvBill = { id: string; project_id: string; vendor_name: string; vendor_gstin: string; bill_no: string; bill_date: string; bill_total: number; other_charges: number; bill_path: string | null; note: string; status: BillStatus; kind: "bill" | "no_bill" | "gas"; source: string | null; submitted_by: string | null; submitted_at: string | null; jsl_status: JslStatus; jsl_wanted: boolean; jsl_authorized_at: string | null; jsl_ref: string | null; jsl_error: string | null; jsl_submitted_at: string | null; created_at: string; voided_at: string | null; void_reason: string | null };
export type InvItem = { id: string; bill_id: string; line_no: number; name: string; hsn: string; qty: number; unit: string; rate: number; gst_pct: number; amount: number };
export type Gatepass = { wo_no: string; received_by: "hand" | "vehicle"; person_source: "employee" | "other"; person_employee_id: string | null; person_name: string; person_id_type: string; person_id_no: string; vehicle_no: string; driver_name: string; driver_dl_no: string; codriver_name: string; codriver_id_type: string; codriver_id_no: string };
export type ProjectPerson = { employee_id: string; full_name: string; designation: string | null; aadhaar_last4: string | null; is_default: boolean };
export type ProjectWo = { wo_no: string; title: string };
export const BLANK_GATEPASS: Gatepass = { wo_no: "", received_by: "hand", person_source: "employee", person_employee_id: null, person_name: "", person_id_type: "", person_id_no: "", vehicle_no: "", driver_name: "", driver_dl_no: "", codriver_name: "", codriver_id_type: "", codriver_id_no: "" };

export const ID_TYPES = ["Aadhaar", "Voter ID"];
/** The units the JSL portal accepts (capitals matter: "mm" and "MT" are different units). The database checks the same list. */
export const UNITS = JSL_UNITS;
export const ROUND_OFF_LIMIT = 1;   // the same ₹1 the database allows when recording a bill

export const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const lineAmount = (qty: number, rate: number) => money2(qty * rate);

/** What the item lines add up to, next to the total printed on the bill. For the sample SMB bill: 12,765.00 + 2,297.70 = 15,062.70 against 15,063.00, a 0.30 round off. */
export function billSums(items: Pick<InvItem, "amount" | "gst_pct">[], otherCharges: number, billTotal: number) {
  const taxable = money2(items.reduce((s, i) => s + Number(i.amount), 0));
  const tax = money2(items.reduce((s, i) => s + (Number(i.amount) * Number(i.gst_pct)) / 100, 0));
  const computed = money2(taxable + tax + Number(otherCharges || 0));
  const diff = money2(Number(billTotal) - computed);
  return { taxable, tax, computed, diff, matches: items.length > 0 && Math.abs(diff) <= ROUND_OFF_LIMIT };
}

/** What the site still has to enter before an Admin can authorize. The database checks the same rules in inventory_authorize_jsl; the WO is the office's, so it is not on this list. */
export function gatepassGaps(g: Gatepass | null, people: ProjectPerson[]): string[] {
  if (!g) return ["JSL details"];
  const blank = (s: string) => !s.trim(); const out: string[] = [];
  if (g.received_by === "hand" && g.person_source === "employee") {
    const p = people.find((x) => x.employee_id === g.person_employee_id);
    if (!p) out.push("who is bringing the material");
    else if (!p.aadhaar_last4) out.push(`${p.full_name}'s Aadhaar on their employee record`);
  } else if (g.received_by === "hand") {
    if (blank(g.person_name)) out.push("person's name");
    if (blank(g.person_id_type)) out.push("ID type");
    if (blank(g.person_id_no)) out.push("ID number");
    else if (g.person_id_type === "Aadhaar" && !/^\d{12}$/.test(g.person_id_no.trim())) out.push("a 12-digit Aadhaar number");
  } else {
    if (blank(g.vehicle_no)) out.push("vehicle number");
    if (blank(g.driver_name)) out.push("driver name");
    if (blank(g.driver_dl_no)) out.push("driver's licence number");
    if (!blank(g.codriver_name) && blank(g.codriver_id_type)) out.push("co-driver ID type");
    if (!blank(g.codriver_name) && blank(g.codriver_id_no)) out.push("co-driver ID number");
    else if (!blank(g.codriver_name) && g.codriver_id_type === "Aadhaar" && !/^\d{12}$/.test(g.codriver_id_no.trim())) out.push("a 12-digit co-driver Aadhaar number");
  }
  return out;
}

/** How a gas product is named on an Inventory entry and on the JSL portal: LPG with capacity 19kg is "LPG CYLINDER 19KG". The database builds the same name (inventory_gas_name). */
export const gasItemName = (name: string, capacity?: string | null) => `${name.trim().toUpperCase()} CYLINDER${capacity && capacity.trim() ? ` ${capacity.trim().toUpperCase()}` : ""}`;

export const maskLast4 = (last4: string) => `••••••••${last4}`;
export const maskId = (s: string) => (s.length > 4 ? "•".repeat(s.length - 4) + s.slice(-4) : s);

export const JSL_LABEL: Record<JslStatus, { text: string; cls: string }> = {
  none: { text: "Not sent to JSL", cls: "bg-slate-100 text-slate-600" },
  authorized: { text: "Authorized for JSL", cls: "bg-blue-50 text-blue-800" },
  sending: { text: "Sending to JSL", cls: "bg-blue-50 text-blue-800" },
  submitting: { text: "Saving on JSL", cls: "bg-blue-50 text-blue-800" },
  submitted: { text: "On JSL portal", cls: "bg-green-50 text-green-800" },
  failed: { text: "JSL send failed", cls: "bg-red-50 text-red-800" },
  needs_check: { text: "Check on JSL portal", cls: "bg-amber-50 text-amber-800" },
};

export type StockRow = { key: string; name: string; unit: string; qty: number; minRate: number; maxRate: number; bills: number };
/** Everything received on the project's recorded bills, the same item and unit added together. Differences in capitals and extra spaces are ignored. */
export function stockFrom(items: InvItem[], recordedBillIds: Set<string>): StockRow[] {
  const map = new Map<string, StockRow & { billSet: Set<string> }>();
  for (const i of items) {
    if (!recordedBillIds.has(i.bill_id)) continue;
    const name = i.name.trim().replace(/\s+/g, " "); const unit = i.unit.trim(); const key = `${name.toLowerCase()}|${unit.toLowerCase()}`; const rate = Number(i.rate);
    const r = map.get(key) ?? { key, name, unit, qty: 0, minRate: rate, maxRate: rate, bills: 0, billSet: new Set<string>() };
    r.qty += Number(i.qty); r.minRate = Math.min(r.minRate, rate); r.maxRate = Math.max(r.maxRate, rate); r.billSet.add(i.bill_id); r.bills = r.billSet.size; map.set(key, r);
  }
  return [...map.values()].map(({ billSet: _b, ...r }) => r).sort((a, b) => a.name.localeCompare(b.name));
}

/** What the list and the screen call an entry's stage. */
export function stageOf(b: Pick<InvBill, "status" | "voided_at"> & Partial<Pick<InvBill, "kind" | "bill_total">>): { key: string; text: string; cls: string } {
  if (b.voided_at) return { key: "void", text: "Void", cls: "bg-slate-100 text-slate-600" };
  if (b.status === "submitted") return { key: "submitted", text: "Waiting for review", cls: "bg-blue-50 text-blue-800" };
  if (b.status === "returned") return { key: "returned", text: "Sent back", cls: "bg-red-50 text-red-700" };
  if (b.status === "draft") return { key: "draft", text: "Draft", cls: "bg-amber-50 text-amber-800" };
  return { key: "recorded", text: b.kind && b.kind !== "bill" && !(Number(b.bill_total) > 0) ? "Received" : "In expenses", cls: "bg-green-50 text-green-800" };   // an entry with no amount adds nothing to expenses: it is only received
}

/** The parts of an entry a reviewer can mark, in the words the reviewer sees. */
export const NOTE_FIELDS: Record<Exclude<NoteField, "">, string> = { vendor: "Vendor", gstin: "GSTIN", bill_no: "Bill number", date: "Date", total: "Total", other_charges: "Freight or discount", photo: "Photo", reason: "Reason", amount: "Amount paid" };
export const noteTitle = (n: Pick<ReviewNote, "field" | "item_id" | "item_name">) => (n.item_id || n.item_name ? n.item_name || "An item" : n.field ? NOTE_FIELDS[n.field] : "The entry");
