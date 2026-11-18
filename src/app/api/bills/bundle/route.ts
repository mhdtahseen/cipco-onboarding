import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { isBillSrc, pathsFor, type BillSrc } from "@/lib/billsData";
import { r2Get, r2Put, r2SignedGetUrl } from "@/lib/r2";
import { buildBillsPdf, buildBillsZip, type BundleItem } from "@/lib/pdf/billsBundle";
import { todayISO } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Several bills in one download, from Expenses → Bills: one PDF (a cover list, then every bill in date order) or a ZIP of the original files.
// Each entry is read through the person's own database rules, so only bills they can see go in. The result can be larger than a web response may be,
// so it is saved to storage under bundles/<person>/ and a 10-minute download link is returned. (A storage rule that deletes bundles/ after a day keeps it tidy.)
type Item = BundleItem & { src: string; id: string };
const MAX_ITEMS = 200, MAX_BYTES = 150 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const sb = await serverClient(); const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { items?: Item[]; format?: string } | null;
  const format = body?.format === "zip" ? "zip" : "pdf";
  const items = (body?.items || []).filter((i) => isBillSrc(i.src) && /^[0-9a-f-]{36}$/i.test(i.id));
  if (!items.length) return NextResponse.json({ error: "Choose at least one bill." }, { status: 400 });
  if (items.length > MAX_ITEMS) return NextResponse.json({ error: `Up to ${MAX_ITEMS} bills at a time. Narrow the filter and download in parts.` }, { status: 400 });
  items.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  // the files, looked up through the person's own rules
  const paths = new Map<string, string>();
  for (const src of new Set(items.map((i) => i.src as BillSrc))) (await pathsFor(sb, src, items.filter((i) => i.src === src).map((i) => i.id))).forEach((p, id) => paths.set(`${src}:${id}`, p));
  const files: (Uint8Array | null)[] = new Array(items.length).fill(null); let total = 0, next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < items.length) {
      const i = next++; const p = paths.get(`${items[i].src}:${items[i].id}`); if (!p || total > MAX_BYTES) continue;
      const b = await r2Get(p); if (b) { files[i] = b; total += b.byteLength; }
    }
  }));
  if (total > MAX_BYTES) return NextResponse.json({ error: "These bills are too large to put in one download. Choose fewer and download in parts." }, { status: 413 });
  const ext = (i: number) => /\.([a-z0-9]{2,4})$/i.exec(paths.get(`${items[i].src}:${items[i].id}`) || "")?.[1]?.toLowerCase() || "";

  const exts = items.map((_, i) => ext(i));
  const bytes = format === "zip" ? await buildBillsZip(items, files, exts) : await buildBillsPdf(items, files);
  const type = format === "zip" ? "application/zip" : "application/pdf";
  const key = `bundles/${u.user.id}/${Date.now()}.${format}`;
  try { await r2Put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, type); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  const file = `Bills ${todayISO()} (${items.length}).${format}`;
  return NextResponse.json({ url: await r2SignedGetUrl(key, 600, file), file, included: files.filter(Boolean).length, missing: files.filter((x) => !x).length });
}
