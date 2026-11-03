import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { loadPaymentsDue } from "@/lib/paymentsDueData";

// What the Payments due page shows: who is owed what, project by project. Admin only: it reads payroll and bank details.
export async function GET() {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: admin } = await sb.rpc("is_admin"); if (!admin) return new NextResponse("Not allowed", { status: 403 });
  try { return NextResponse.json(await loadPaymentsDue(sb)); } catch (e: any) { return new NextResponse(e?.message || "Could not load", { status: 500 }); }
}
