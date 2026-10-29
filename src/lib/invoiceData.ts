import { supabase } from "./supabase/client";
import { istToday } from "./attendance";
import { addDays, COMPANY_STATE_CODE } from "./invoice";
import { swrDrop } from "./swr";

export const fmtD = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/**
 * Start the next running bill for a work order: a draft with every line of the order at "nothing more billed yet" (to date = earlier).
 * If a draft already exists it is reused, so "billed earlier" can never be out of step with an unfinished bill.
 */
export async function createDraftBill(woId: string): Promise<{ id?: string; error?: string }> {
  const sb = supabase();
  const { data: wo, error: e1 } = await sb.from("work_orders").select("*").eq("id", woId).single();
  if (e1 || !wo) return { error: e1?.message ?? "Work order not found." };
  if (wo.status !== "active") return { error: "This work order is not active. Set it back to Active to raise a bill." };
  const { data: bills, error: e2 } = await sb.from("invoices").select("id,status,bill_no").eq("work_order_id", woId).neq("status", "cancelled");
  if (e2) return { error: e2.message };
  const open = (bills || []).find((b) => b.status === "draft"); if (open) return { id: open.id };
  const issued = (bills || []).filter((b) => b.status === "issued");
  const { data: items, error: e3 } = await sb.from("work_order_items").select("*").eq("work_order_id", woId).order("sort");
  if (e3) return { error: e3.message };
  if (!(items || []).length) return { error: "Add the items of the work order first (the bill of quantities)." };
  const prev: Record<string, number> = {};
  if (issued.length) { const { data: lines } = await sb.from("invoice_items").select("work_order_item_id,qty").in("invoice_id", issued.map((b) => b.id)); (lines || []).forEach((l) => { if (l.work_order_item_id) prev[l.work_order_item_id] = (prev[l.work_order_item_id] || 0) + Number(l.qty); }); }
  // For work on a site the place of supply is the SITE's state, so tax (CGST + SGST vs IGST) follows the project. Without a state we would be guessing the tax.
  let supply = COMPANY_STATE_CODE;
  if (wo.project_id) {
    const { data: proj } = await sb.from("projects").select("name,state_code").eq("id", wo.project_id).maybeSingle();
    if (!proj?.state_code) return { error: `Set the state of the site on the project ${proj?.name ? `"${proj.name}" ` : ""}first (Projects, open it, Edit), so the right GST applies.` };
    supply = proj.state_code;
  }
  const today = istToday();
  const { data: inv, error: e4 } = await sb.from("invoices").insert({ work_order_id: woId, client_id: wo.client_id, project_id: wo.project_id, bill_no: Math.max(0, ...(bills || []).map((b) => b.bill_no)) + 1, invoice_date: today, due_date: addDays(today, Number(wo.payment_days)), sac: wo.sac, gst_rate: wo.gst_rate, place_of_supply_code: supply, retention_pct: wo.retention_pct, tds_pct: wo.tds_pct }).select("id").single();
  if (e4 || !inv) return { error: e4?.message ?? "Could not start the bill." };
  const { error: e5 } = await sb.from("invoice_items").insert((items || []).map((i) => ({ invoice_id: inv.id, work_order_item_id: i.id, sort: i.sort, description: i.description, unit: i.unit, rate: i.rate, prev_qty: prev[i.id] || 0, cum_qty: prev[i.id] || 0, qty: 0, amount: 0 })));
  if (e5) { await sb.from("invoices").delete().eq("id", inv.id); return { error: e5.message }; }
  swrDrop("invoices", "workorders");
  return { id: inv.id };
}
