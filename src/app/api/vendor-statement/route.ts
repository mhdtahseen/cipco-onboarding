import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildBreakdown, type MealRowLite, type Who } from "@/lib/mealStatement";
import { buildVendorStatement } from "@/lib/pdf/vendorStatement";
import { r2Get } from "@/lib/r2";
import type { MealRate } from "@/lib/attendance";

// The meal statement of one vendor for a stretch of days (usually the days of a bill), as a PDF to send to the vendor. It is worked out here from the database,
// so what is printed cannot be edited on the way. Staff and Admin only: meal prices are behind the staff rules.
const UUID = /^[0-9a-f-]{36}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: staff } = await sb.rpc("is_staff"); if (!staff) return new NextResponse("Not allowed", { status: 403 });
  const p = req.nextUrl.searchParams; const project = p.get("project") || "", vendor = p.get("vendor") || "", from = p.get("from") || "", to = p.get("to") || "", billId = p.get("bill") || "";
  if (!UUID.test(project) || !UUID.test(vendor) || !DATE.test(from) || !DATE.test(to) || (billId && !UUID.test(billId))) return new NextResponse("Bad request", { status: 400 });
  if (from > to) return new NextResponse("The first day is after the last day.", { status: 400 });
  if (Date.parse(to) - Date.parse(from) > 62 * 86400000) return new NextResponse("Choose at most two months.", { status: 400 });

  const [{ data: v }, { data: proj }, { data: rates }, { data: bill }, { data: days }] = await Promise.all([
    sb.from("food_vendors").select("id, name, project_id").eq("id", vendor).maybeSingle(), sb.from("projects").select("name").eq("id", project).maybeSingle(),
    sb.from("meal_rates").select("*").eq("vendor_id", vendor),
    billId ? sb.from("vendor_bills").select("vendor_id, bill_path, bill_no, bill_amount, bill_from, bill_to, voided_at").eq("id", billId).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("attendance_days").select("work_date, verified_incomplete").eq("project_id", project).gte("work_date", from).lte("work_date", to).not("verified_at", "is", null),
  ]);
  if (!v || v.project_id !== project) return new NextResponse("Not found", { status: 404 });
  if (billId && (!bill || bill.vendor_id !== vendor)) return new NextResponse("Not found", { status: 404 });

  const rows: MealRowLite[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from("attendance").select("employee_id, work_date, breakfast_vendor_id, lunch_vendor_id, dinner_vendor_id").eq("project_id", project).gte("work_date", from).lte("work_date", to).order("work_date").range(off, off + 999);
    if (error) return new NextResponse(error.message, { status: 500 }); rows.push(...((data || []) as MealRowLite[])); if (!data || data.length < 1000) break;
  }
  const ids = [...new Set(rows.filter((r) => [r.breakfast_vendor_id, r.lunch_vendor_id, r.dinner_vendor_id].includes(vendor)).map((r) => r.employee_id))];
  const people = new Map<string, Who>(); const names = p.get("names") === "1";
  if (names && ids.length) for (let i = 0; i < ids.length; i += 200) { const { data } = await sb.from("employees").select("id, full_name, emp_no").in("id", ids.slice(i, i + 200)); (data || []).forEach((e: any) => people.set(e.id, { name: e.full_name, emp_no: e.emp_no })); }

  const b = buildBreakdown({ vendorId: vendor, from, to, rows, rates: ((rates || []) as MealRate[]).map((r) => ({ ...r, price: Number(r.price) })), people });
  if (!b.count) return new NextResponse("No meals are recorded for this vendor on these days.", { status: 404 });
  // the vendor copy only says whether a day was signed off; the internal "verified though incomplete" note stays inside
  const verified = Object.fromEntries(((days || []) as { work_date: string }[]).map((d) => [d.work_date, "ok"] as const));
  const billFile = bill?.bill_path ? await r2Get(bill.bill_path) : null;
  const pdf = await buildVendorStatement({ vendorName: v.name, projectName: proj?.name ?? "", b, billNo: bill?.bill_no || undefined, billed: bill ? Number(bill.bill_amount) : undefined, verified, includeNames: names, billFile });
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${v.name} meal statement ${from} to ${to}.pdf"` } });
}
