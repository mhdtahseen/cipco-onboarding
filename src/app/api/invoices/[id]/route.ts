import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildInvoice } from "@/lib/pdf/invoice";
import type { Client, Invoice, InvoiceItem, WorkOrder } from "@/lib/invoice";

// One invoice as a PDF (Admin only; the tables are behind the Admin rules too). A draft prints with a DRAFT mark, a cancelled one with CANCELLED.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: r } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).maybeSingle(); if (r?.role !== "admin") return new NextResponse("Forbidden", { status: 403 });
  const { id } = await ctx.params; if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Bad request", { status: 400 });
  const { data: inv } = await sb.from("invoices").select("*").eq("id", id).maybeSingle(); if (!inv) return new NextResponse("Not found", { status: 404 });
  const [{ data: items }, { data: client }, { data: wo }, { data: proj }] = await Promise.all([
    sb.from("invoice_items").select("*").eq("invoice_id", id).order("sort"),
    sb.from("clients").select("*").eq("id", inv.client_id).maybeSingle(),
    sb.from("work_orders").select("*").eq("id", inv.work_order_id).maybeSingle(),
    inv.project_id ? sb.from("projects").select("name").eq("id", inv.project_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!client || !wo) return new NextResponse("The client or work order is missing", { status: 404 });
  const num = (o: Record<string, any>, keys: string[]) => { const c = { ...o }; keys.forEach((k) => { c[k] = Number(c[k]); }); return c; };
  const invoice = num(inv, ["gst_rate", "taxable", "cgst", "sgst", "igst", "round_off", "total", "retention_pct", "retention", "other_deduction", "payable", "tds_pct", "bill_no"]) as Invoice;
  const lines = ((items || []) as any[]).map((i) => num(i, ["rate", "prev_qty", "cum_qty", "qty", "amount"])) as InvoiceItem[];
  const pdf = await buildInvoice({ inv: invoice, items: lines, client: client as Client, wo: num(wo, ["gst_rate", "retention_pct", "tds_pct", "payment_days"]) as WorkOrder, projectName: proj?.name ?? "" });
  const name = (invoice.invoice_no ?? `Draft bill ${invoice.bill_no}`).replace(/[^\w.\- ]/g, "-");
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Invoice ${name}.pdf"` } });
}
