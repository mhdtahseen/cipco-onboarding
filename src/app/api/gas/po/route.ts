import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildGasOrder } from "@/lib/pdf/gasOrder";

// The purchase order PDF for an approved gas order. It carries the locked rates, so it is for Operations and Admin only (checked here as well as by the database).
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: staff } = await sb.rpc("is_staff"); const { data: viewer } = await sb.rpc("is_viewer"); if (!staff && !viewer) return new NextResponse("Not allowed", { status: 403 });
  const id = req.nextUrl.searchParams.get("order") || ""; if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Bad request", { status: 400 });
  const { data: o, error } = await sb.from("gas_orders").select("*, projects(name, location), gas_vendors(name, contact, phone, gstin, address, notice_hours, free_delivery_min), gas_order_lines(id, qty, gas_products(name, capacity, deposit_per_cylinder))").eq("id", id).maybeSingle();
  if (error || !o) return new NextResponse(error?.message || "Order not found", { status: 404 });
  if (!["approved", "sent", "partly_delivered", "delivered", "closed"].includes(o.status)) return new NextResponse("The order has to be approved first: that is when its rates are locked.", { status: 409 });
  const lineIds = ((o as any).gas_order_lines as { id: string }[]).map((l) => l.id);
  const [{ data: pr }, { data: tm }] = await Promise.all([sb.from("gas_order_pricing").select("line_id, rate, gst_pct").in("line_id", lineIds), sb.from("gas_terms").select("*").eq("vendor_id", o.vendor_id).maybeSingle()]);
  const price = new Map(((pr || []) as { line_id: string; rate: number; gst_pct: number }[]).map((p) => [p.line_id, p]));
  const v = (o as any).gas_vendors, p = (o as any).projects;
  const lines = ((o as any).gas_order_lines as any[]).map((l) => ({ product: l.gas_products?.name ?? "", capacity: l.gas_products?.capacity ?? "", qty: l.qty as number, rate: Number(price.get(l.id)?.rate ?? 0), gst: Number(price.get(l.id)?.gst_pct ?? 0) }));
  const pdf = await buildGasOrder({
    orderNo: o.order_no, orderedOn: new Date(o.created_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" }), neededBy: o.needed_by, projectName: p?.name ?? "", projectLocation: p?.location ?? "",
    vendor: { name: v?.name ?? "", contact: v?.contact ?? "", phone: v?.phone ?? "", gstin: v?.gstin ?? "", address: v?.address ?? "" }, lines,
    terms: tm ? { deposits: [...new Map(((o as any).gas_order_lines as any[]).filter((l) => Number(l.gas_products?.deposit_per_cylinder) > 0).map((l) => [l.gas_products.name, Number(l.gas_products.deposit_per_cylinder)] as [string, number])).entries()].map(([product, amount]) => ({ product, amount })).concat(Number(tm.deposit_per_cylinder) > 0 && !((o as any).gas_order_lines as any[]).some((l) => Number(l.gas_products?.deposit_per_cylinder) > 0) ? [{ product: "Each", amount: Number(tm.deposit_per_cylinder) }] : []),
      loss: Number(tm.loss_charge_per_cylinder), damage: Number(tm.damage_charge_per_cylinder ?? 0), chargesGst: Number(tm.charges_gst_pct ?? 0), transport: Number(tm.transport_per_trip ?? 0), dueFirst: tm.due_day_first_half, dueSecond: tm.due_day_second_half, note: tm.terms_note || "", noticeHours: v?.notice_hours ?? 0, freeMin: v?.free_delivery_min ?? 0 } : null,
  });
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${o.order_no}.pdf"` } });
}
