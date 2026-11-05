import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { loadForecast } from "@/lib/forecastData";

export const dynamic = "force-dynamic";

// The measured starting point of the expense forecast. Admin only: it shows personal funding, so it is closed to Operations and the Viewer too.
export async function GET(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { data: admin } = await sb.rpc("is_admin"); if (!admin) return new NextResponse("Not allowed", { status: 403 });
  const project = req.nextUrl.searchParams.get("project") || ""; if (project && !/^[0-9a-f-]{36}$/.test(project)) return new NextResponse("Bad request", { status: 400 });
  try { return NextResponse.json(await loadForecast(sb, project || undefined)); } catch (e: any) { return new NextResponse(e?.message || "Could not load", { status: 500 }); }
}
