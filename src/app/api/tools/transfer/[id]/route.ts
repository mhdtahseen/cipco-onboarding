import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { buildToolChallan } from "@/lib/pdf/toolChallan";
import type { ToolItem, Transfer } from "@/lib/tools";

export const runtime = "nodejs";

// A transfer's challan PDF (src/lib/pdf/toolChallan.ts). Anyone who can see the register can print it.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser(); if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params; if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Bad request", { status: 400 });
  const { data: t } = await sb.from("tool_transfers").select("*, tool_transfer_lines(*)").eq("id", id).maybeSingle(); if (!t) return new NextResponse("Not found", { status: 404 });
  const tr = t as Transfer;
  const [{ data: ps }, { data: its }] = await Promise.all([
    sb.from("projects").select("id, name, location, client_id").in("id", [tr.from_project, tr.to_project]),
    sb.from("tool_items").select("*").in("id", tr.tool_transfer_lines.map((l) => l.item_id)),
  ]);
  // "To": the receiving site's client (name and address), else the project's own name and location
  const dest = (ps || []).find((x: { id: string }) => x.id === tr.to_project) as { name: string; location: string | null; client_id: string | null } | undefined;
  const { data: cl } = dest?.client_id ? await sb.from("clients").select("name, address").eq("id", dest.client_id).maybeSingle() : { data: null };
  const to = cl?.name ? { name: cl.name as string, address: String(cl.address ?? "").split(/\n/).map((x) => x.trim()).filter(Boolean) } : { name: dest?.name ?? "?", address: dest?.location ? [dest.location] : [] };
  const item = (iid: string) => (its || []).find((x: { id: string }) => x.id === iid) as ToolItem | undefined;

  const bytes = await buildToolChallan(tr, to, item);
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Delivery Challan ${(tr.dc_no || tr.transfer_no).replace(/\//g, "-")}.pdf"` } });
}
