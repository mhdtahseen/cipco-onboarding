// Tools & equipment register: what the company owns and where it is. Pure (no database), shared by the page and the challan PDF.
// Stock is never typed in: it is the sum of movements (2026-11-tools-register.sql), split into good and damaged, per site.

export type ToolItem = { id: string; category: string; name: string; spec: string; unit: string; kind: "tool" | "consumable"; note: string; active: boolean; sort_order: number };
export type StockRow = { item_id: string; project_id: string; ok: number; damaged: number };
export type MoveKind = "opening" | "received" | "used" | "damaged" | "repaired" | "lost" | "written_off" | "count" | "transfer_out" | "transfer_in";
export type ToolMove = { id: string; item_id: string; project_id: string; kind: MoveKind; d_ok: number; d_damaged: number; moved_on: string; transfer_id: string | null; note: string; created_by: string | null; created_at: string; voided_at: string | null; void_reason: string };
export type TransferStatus = "in_transit" | "received" | "cancelled";
export type TransferLine = { id: string; transfer_id: string; item_id: string; condition: "ok" | "damaged"; qty: number; qty_received: number | null };
export type Transfer = { id: string; transfer_no: string; from_project: string; to_project: string; status: TransferStatus; dispatched_on: string; vehicle_no: string; carried_by: string; note: string; dc_no: string; order_ref: string; declared_value: number | null; created_by: string | null; created_at: string; received_on: string | null; received_by: string | null; received_note: string; cancel_reason: string; tool_transfer_lines: TransferLine[] };

export const UNITS = ["Nos", "Sets", "Pairs", "Mtr", "Kg", "Pkt", "Box", "Ltr"];
export const MOVE_LABEL: Record<MoveKind, string> = {
  opening: "Opening stock", received: "Received (purchase)", used: "Used up", damaged: "Marked damaged", repaired: "Repaired", lost: "Lost",
  written_off: "Written off", count: "Recount", transfer_out: "Sent out", transfer_in: "Received from another site",
};
export const TRANSFER_STATUS: Record<TransferStatus, [string, string]> = {
  in_transit: ["In transit", "bg-amber-50 text-amber-800"], received: ["Received", "bg-emerald-50 text-emerald-700"], cancelled: ["Cancelled", "bg-slate-100 text-slate-600"],
};

export const itemLabel = (i: Pick<ToolItem, "name" | "spec"> | undefined) => (i ? (i.spec ? `${i.name} ${i.spec}` : i.name) : "?");
export const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("en-IN", { maximumFractionDigits: 3 }));

/** Stock of every item at every site, as a lookup: stockAt(item, site) → { ok, damaged }. */
export function stockIndex(rows: StockRow[]) {
  const m = new Map<string, { ok: number; damaged: number }>();
  rows.forEach((r) => m.set(`${r.item_id}|${r.project_id}`, { ok: Number(r.ok), damaged: Number(r.damaged) }));
  return (item: string, site: string) => m.get(`${item}|${site}`) ?? { ok: 0, damaged: 0 };
}

/** Items grouped by category, in catalogue order. */
export function byCategory<T extends ToolItem>(items: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  [...items].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name) || a.spec.localeCompare(b.spec, "en", { numeric: true })).forEach((i) => { const l = out.get(i.category) ?? []; l.push(i); out.set(i.category, l); });
  return [...out.entries()];
}

/** Does an item match the search box? Every word must appear in its category, name, spec or note. */
export const itemMatches = (i: ToolItem, q: string) => { const t = `${i.category} ${i.name} ${i.spec} ${i.note}`.toLowerCase(); return q.trim().toLowerCase().split(/\s+/).every((w) => !w || t.includes(w)); };
