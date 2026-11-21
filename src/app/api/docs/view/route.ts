import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { serveStored } from "@/lib/fileServe";

type SB = Awaited<ReturnType<typeof serverClient>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who may open a stored file, decided by where it is stored (not only "signed in"):
 *  - <employee id>/…  an employee's documents (Aadhaar, bank…): only someone the database lets read that employee.
 *  - bundles/<user>/…  a Bills download made by one person: that person only.
 *  - inv-<project>/…, gas/<project>/…, proj-<project>/projdoc/…  site entries and project documents: anyone who works on that project.
 *  - proj-, sbill-, vbill- (money), company/… and anything else: Operations, Admin and Viewer. */
async function mayOpen(sb: SB, userId: string, path: string): Promise<boolean> {
  const first = path.split("/")[0];
  if (UUID.test(first)) { const { data } = await sb.from("employees").select("id").eq("id", first).maybeSingle(); return !!data; }
  if (first === "bundles") return path.split("/")[1] === userId;
  const site = first.match(/^inv-([0-9a-f-]{36})$/i)?.[1] ?? (first === "gas" ? path.split("/")[1] : null)
    ?? (path.split("/")[1] === "projdoc" ? first.match(/^proj-([0-9a-f-]{36})$/i)?.[1] : null);   // a project's own documents (PO, drawings): its site team too
  if (site && UUID.test(site)) { const { data } = await sb.rpc("can_attend", { p_project: site }); if (data) return true; }   // else: Operations, Admin, Viewer below
  const [{ data: staff }, { data: viewer }] = await Promise.all([sb.rpc("is_staff"), sb.rpc("is_viewer")]);
  return !!staff || !!viewer;
}
// Opens one stored file (a new tab, the in-app viewer with meta=1, or the bytes with raw=1 for the scanner's "Fix": see lib/fileServe.ts).
export async function GET(req: NextRequest) {
  const sb = await serverClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return new NextResponse("Unauthorized", { status: 401 });
  const path = req.nextUrl.searchParams.get("path") || "";
  if (!path || path.includes("..")) return new NextResponse("Bad request", { status: 400 });
  if (!(await mayOpen(sb, u.user.id, path))) return new NextResponse("You do not have access to this file.", { status: 403 });
  return serveStored(req, path);
}
