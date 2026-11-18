import type { SupabaseClient } from "@supabase/supabase-js";

// Every bill and receipt in the app, in one list (Expenses → Bills). Read with the signed-in person's own login, so the database rules decide what they see.
// Sources: inventory bills, manual expenses, site-supplies bills and payments, meals bills and payments, transport payments, rent payments and gas supplier invoices.
// Left out on purpose: gas delivery challans and photos, project documents, exit papers, voided entries, and expenses posted automatically from another section
// (an inventory bill, rent, payroll...), whose file is already listed from that section. One file used by several entries (a rent receipt for three rooms)
// is listed once, with the amounts added up. An entry with no file is listed too ("no bill yet"), except inventory entries made without a bill on purpose.
export type BillSrc = "inv" | "exp" | "sbill" | "spay" | "vbill" | "vpay" | "tpay" | "rpay" | "gas";
export type BillRow = {
  key: string; src: BillSrc; id: string; date: string; project_id: string | null; project: string; section: string; kind: "Bill" | "Receipt";
  payee: string; ref: string; amount: number; file: boolean; ext: string; covers: string[]; status: string; go: string; note: string;
};

/** Where each source keeps its file: the file route looks the row up again through the database rules before handing anything out.
 *  folder: where a bill uploaded from the Bills page is stored, the same place the section itself stores it, so the section's own viewer opens it too. */
export const SOURCES: Record<BillSrc, { table: string; idCol: string; pathCol: string; voided: boolean; folder: (project: string) => string }> = {
  inv: { table: "inventory_bills", idCol: "id", pathCol: "bill_path", voided: true, folder: (p) => `inv-${p}/bill/` },
  exp: { table: "project_expenses", idCol: "id", pathCol: "bill_path", voided: false, folder: (p) => `proj-${p}/expense/` },
  sbill: { table: "site_bills", idCol: "id", pathCol: "bill_path", voided: true, folder: (p) => `sbill-${p}/sitebill/` },
  spay: { table: "site_payments", idCol: "id", pathCol: "bill_path", voided: true, folder: (p) => `gas/${p}/` },
  vbill: { table: "vendor_bills", idCol: "id", pathCol: "bill_path", voided: true, folder: (p) => `vbill-${p}/vendorbill/` },
  vpay: { table: "vendor_payments", idCol: "id", pathCol: "bill_path", voided: true, folder: (p) => `proj-${p}/expense/` },
  tpay: { table: "transport_payments", idCol: "id", pathCol: "bill_path", voided: true, folder: (p) => `proj-${p}/expense/` },
  rpay: { table: "accommodation_payments", idCol: "id", pathCol: "bill_path", voided: true, folder: (p) => `proj-${p}/expense/` },
  gas: { table: "gas_runs", idCol: "run_ref", pathCol: "invoice_path", voided: false, folder: (p) => `gas/${p}/` },
};
export const isBillSrc = (s: string): s is BillSrc => s in SOURCES;

type Any = Record<string, any>;
async function all(q: () => any): Promise<Any[]> {
  const out: Any[] = [];
  for (let off = 0; ; off += 1000) { const { data, error } = await q().range(off, off + 999); if (error) throw new Error(error.message); out.push(...(data || [])); if (!data || data.length < 1000) return out; }
}
const extOf = (p?: string | null) => (p ? (/\.([a-z0-9]{2,4})$/i.exec(p)?.[1] || "").toLowerCase() : "");
const day = (s?: string | null) => (s ? String(s).slice(0, 10) : "");

export async function loadBills(sb: SupabaseClient): Promise<{ rows: BillRow[]; projects: { id: string; name: string }[]; warnings: string[] }> {
  const warnings: string[] = [];
  const safe = async (label: string, f: () => Promise<Any[]>) => { try { return await f(); } catch (e) { warnings.push(`${label}: ${(e as Error).message}`); return [] as Any[]; } };
  const [projects, cats, gasV, foodV, vehicles, rooms, landlords, inv, exp, sbill, spay, vbill, vpay, tpay, rpay, gas] = await Promise.all([
    safe("Projects", () => all(() => sb.from("projects").select("id, name").order("name"))),
    safe("Expense categories", () => all(() => sb.from("expense_categories").select("id, name"))),
    safe("Site-supplies vendors", () => all(() => sb.from("gas_vendors").select("id, name"))),
    safe("Meals vendors", () => all(() => sb.from("food_vendors").select("id, name"))),
    safe("Vehicles", () => all(() => sb.from("transport_vehicles").select("id, name, operator"))),
    safe("Rooms", () => all(() => sb.from("accommodation_rooms").select("id, name, landlord, landlord_id"))),
    safe("Landlords", () => all(() => sb.from("accommodation_landlords").select("id, name"))),
    safe("Inventory", () => all(() => sb.from("inventory_bills").select("id, project_id, vendor_name, bill_no, bill_date, bill_total, bill_path, status, kind, note, created_at").is("voided_at", null).or("kind.is.null,kind.eq.bill"))),
    safe("Expenses", () => all(() => sb.from("project_expenses").select("id, project_id, category_id, expense_date, amount, description, bill_path, source").or("source.is.null,source.in.(other,employee)"))),
    safe("Site-supplies bills", () => all(() => sb.from("site_bills").select("id, kind, vendor_id, project_id, bill_no, bill_date, bill_amount, bill_path, status, note").is("voided_at", null))),
    safe("Site-supplies payments", () => all(() => sb.from("site_payments").select("id, kind, vendor_id, project_id, paid_on, amount, reference, bill_path, note").is("voided_at", null))),
    safe("Meals bills", () => all(() => sb.from("vendor_bills").select("id, vendor_id, project_id, bill_month, bill_from, bill_to, bill_no, bill_amount, bill_path, status, note").is("voided_at", null))),
    safe("Meals payments", () => all(() => sb.from("vendor_payments").select("id, vendor_id, project_id, paid_on, amount, reference, bill_path, note").is("voided_at", null))),
    safe("Transport payments", () => all(() => sb.from("transport_payments").select("id, vehicle_id, project_id, paid_on, amount, reference, bill_path, note").is("voided_at", null))),
    safe("Rent payments", () => all(() => sb.from("accommodation_payments").select("id, room_id, project_id, for_month, paid_on, amount, reference, batch_id, bill_path, note").is("voided_at", null))),
    safe("Gas invoices", () => all(() => sb.from("gas_runs").select("run_ref, project_id, vendor_id, invoice_no, invoice_date, invoice_amount, invoice_path, note")).then((l) => l.filter((x) => x.invoice_path || x.invoice_no))),
  ]);
  const name = (list: Any[]) => new Map(list.map((x) => [x.id, x.name as string]));
  const P = name(projects), C = name(cats), GV = name(gasV), FV = name(foodV), L = name(landlords);
  const V = new Map(vehicles.map((v) => [v.id, v.operator ? `${v.name} (${v.operator})` : v.name]));
  const R = new Map(rooms.map((r) => [r.id, r]));
  const supplies = (k?: string) => (k === "gas" ? "Gas" : k ? `Site supplies · ${k[0].toUpperCase()}${k.slice(1)}` : "Site supplies");

  const raw: (Omit<BillRow, "key" | "project" | "file" | "ext" | "covers"> & { path: string | null; cover?: string; group?: string })[] = [];
  const push = (r: (typeof raw)[number]) => raw.push(r);
  inv.forEach((x) => push({ src: "inv", id: x.id, date: day(x.bill_date || x.created_at), project_id: x.project_id, section: "Inventory", kind: "Bill", payee: x.vendor_name || "", ref: x.bill_no || "", amount: Number(x.bill_total) || 0, path: x.bill_path, status: x.status === "recorded" ? "" : x.status || "", go: "/inventory", note: x.note || "" }));
  exp.forEach((x) => push({ src: "exp", id: x.id, date: day(x.expense_date), project_id: x.project_id, section: `Expenses · ${C.get(x.category_id) ?? "Other"}`, kind: "Bill", payee: x.description || "", ref: "", amount: Number(x.amount) || 0, path: x.bill_path, status: "", go: `/expenses?tab=spent&project=${x.project_id}`, note: "" }));
  sbill.forEach((x) => push({ src: "sbill", id: x.id, date: day(x.bill_date), project_id: x.project_id, section: supplies(x.kind), kind: "Bill", payee: GV.get(x.vendor_id) ?? "", ref: x.bill_no || "", amount: Number(x.bill_amount) || 0, path: x.bill_path, status: x.status === "received" ? "not approved" : "", go: "/site-supplies", note: x.note || "" }));
  spay.forEach((x) => push({ src: "spay", id: x.id, date: day(x.paid_on), project_id: x.project_id, section: supplies(x.kind), kind: "Receipt", payee: GV.get(x.vendor_id) ?? "", ref: x.reference || "", amount: Number(x.amount) || 0, path: x.bill_path, status: "", go: "/site-supplies", note: x.note || "" }));
  vbill.forEach((x) => push({ src: "vbill", id: x.id, date: day(x.bill_to || x.bill_month), project_id: x.project_id, section: "Meals", kind: "Bill", payee: FV.get(x.vendor_id) ?? "", ref: x.bill_no || "", amount: Number(x.bill_amount) || 0, path: x.bill_path, status: x.status === "received" ? "not approved" : "", go: "/meals", note: x.note || "" }));
  vpay.forEach((x) => push({ src: "vpay", id: x.id, date: day(x.paid_on), project_id: x.project_id, section: "Meals", kind: "Receipt", payee: FV.get(x.vendor_id) ?? "", ref: x.reference || "", amount: Number(x.amount) || 0, path: x.bill_path, status: "", go: "/meals", note: x.note || "" }));
  tpay.forEach((x) => push({ src: "tpay", id: x.id, date: day(x.paid_on), project_id: x.project_id, section: "Transport", kind: "Receipt", payee: V.get(x.vehicle_id) ?? "", ref: x.reference || "", amount: Number(x.amount) || 0, path: x.bill_path, status: "", go: "/transport", note: x.note || "" }));
  rpay.forEach((x) => { const room = R.get(x.room_id); push({ src: "rpay", id: x.id, date: day(x.paid_on), project_id: x.project_id, section: "Rent", kind: "Receipt", payee: (room?.landlord_id && L.get(room.landlord_id)) || room?.landlord || "", ref: x.reference || "", amount: Number(x.amount) || 0, path: x.bill_path, status: "", go: "/accommodation", note: x.note || "", cover: room?.name ? `Room ${room.name}` : undefined, group: x.batch_id || undefined }); });
  gas.forEach((x) => push({ src: "gas", id: x.run_ref, date: day(x.invoice_date), project_id: x.project_id, section: "Gas", kind: "Bill", payee: GV.get(x.vendor_id) ?? "", ref: x.invoice_no || "", amount: Number(x.invoice_amount) || 0, path: x.invoice_path, status: "", go: "/site-supplies", note: x.note || "" }));

  // one row per file (or per rent batch with no file yet); the first entry's id opens the file
  const by = new Map<string, BillRow>();
  for (const r of raw) {
    const k = r.path ? `f:${r.path}` : r.group ? `g:${r.src}:${r.group}` : `e:${r.src}:${r.id}`;
    const hit = by.get(k);
    if (hit) { hit.amount += r.amount; if (r.cover && !hit.covers.includes(r.cover)) hit.covers.push(r.cover); if (r.date > hit.date) hit.date = r.date; continue; }
    const { path, cover, group, ...rest } = r; void group;
    by.set(k, { ...rest, key: `${r.src}:${r.id}`, project: (r.project_id && P.get(r.project_id)) || "", file: !!path, ext: extOf(path), covers: cover ? [cover] : [] });
  }
  const rows = [...by.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.section.localeCompare(b.section)));
  return { rows, projects: projects.map((p) => ({ id: p.id, name: p.name })), warnings };
}

/** The stored file paths for some entries of one source, read through the signed-in person's own database rules. */
export async function pathsFor(sb: SupabaseClient, src: BillSrc, ids: string[]): Promise<Map<string, string>> {
  const s = SOURCES[src]; const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from(s.table).select(`${s.idCol}, ${s.pathCol}`).in(s.idCol, ids.slice(i, i + 200));
    ((data || []) as Any[]).forEach((x) => { const p = x[s.pathCol]; if (p && typeof p === "string" && !p.includes("..")) out.set(x[s.idCol], p); });
  }
  return out;
}

/** A file name that reads well in a folder: "2026-11-15 Ashapura General Store 116 ₹1575". */
export function billFileName(r: { date: string; payee: string; ref: string; amount: number }) {
  const t = [r.date, r.payee, r.ref, r.amount ? `₹${Math.round(r.amount)}` : ""].filter(Boolean).join(" ");
  return t.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "bill";
}
export const cleanName = (s: string) => s.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "bill";
