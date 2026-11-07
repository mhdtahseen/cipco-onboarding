import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { loadPaymentsDue } from "@/lib/paymentsDueData";
import { mayView } from "@/lib/permsServer";

// What the Payments due page shows: who is owed what, project by project. Whoever has Expenses → Due in the permission matrix (Admin and Viewer by default): it reads payroll and bank details.
export async function GET() {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await mayView(sb, "expenses", "due"))) return new NextResponse("Not allowed", { status: 403 });
  try { return NextResponse.json(await loadPaymentsDue(sb)); } catch (e: any) { return new NextResponse(e?.message || "Could not load", { status: 500 }); }
}
