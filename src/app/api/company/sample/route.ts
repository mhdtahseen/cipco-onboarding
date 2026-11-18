import { NextResponse } from "next/server";
import { rgb } from "pdf-lib";
import { companyAdmin } from "@/lib/companyAdmin";
import { forgetCompany } from "@/lib/companyServer";
import { COMPANY, BANK, companyPan } from "@/lib/company";
import { drawStamp, embedFonts, newDoc } from "@/lib/pdf/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A one-page sample with the letterhead, the bank block and the seal and signature as they print now: to check the Company page's details before relying on them.
export async function GET() {
  const a = await companyAdmin(); if ("res" in a) return a.res;
  forgetCompany();   // the details just saved, not the remembered ones
  const doc = await newDoc(); const f = await embedFonts(doc); const p = doc.addPage([595.28, 841.89]); const H = 841.89, M = 48;
  const ink = rgb(0.1, 0.12, 0.16), grey = rgb(0.42, 0.45, 0.5), brand = rgb(0.12, 0.31, 0.64);
  const t = (s: string, x: number, top: number, size: number, bold = false, color = ink) => p.drawText(s, { x, y: H - top, size, font: bold ? f.bold : f.reg, color, maxWidth: 595.28 - 2 * M });
  t(COMPANY.headline1, M, 60, 22, true, brand); t(COMPANY.headline2, M, 80, 13, true, brand);
  t(COMPANY.line1, M, 100, 9, false, grey); t(COMPANY.line2, M, 113, 9, false, grey); t(COMPANY.line3, M, 126, 9, false, grey);
  p.drawRectangle({ x: M, y: H - 136, width: 595.28 - 2 * M, height: 1.5, color: brand });
  t("Sample: how the company details and the seal and signature print", M, 170, 12, true);
  const rows: [string, string][] = [["Company", COMPANY.name], ["One-line address (forms)", COMPANY.addressOneLine], ["GSTIN", COMPANY.gstin], ["PAN", companyPan()], ["Udyam", COMPANY.udyam],
    ["Bank", `${BANK.bank}, ${BANK.branch}`], ["Account", `${BANK.accountName} · ${BANK.accountNo} · IFSC ${BANK.ifsc}`], ["Signs quotations", COMPANY.quoteSignatory]];
  rows.forEach(([k, v], i) => { t(k, M, 200 + i * 20, 9.5, false, grey); t(v, M + 150, 200 + i * 20, 9.5); });
  await drawStamp(doc, p, { x: 380, top: 420, signW: 90, signMaxH: 40, sealW: 64, sealDx: 70 });
  t(COMPANY.signatoryLabel, 380, 500, 9.5); t(COMPANY.signatoryDept, 380, 513, 9, false, grey);
  t(`For ${COMPANY.name}`, M, 420, 10);
  return new NextResponse(Buffer.from(await doc.save()), { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=\"Company sample.pdf\"", "cache-control": "private, no-store" } });
}
