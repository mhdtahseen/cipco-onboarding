import JSZip from "jszip";
import { rgb } from "pdf-lib";
import { COMPANY } from "../company";
import { fmtDateDMY, todayISO } from "../format";
import { cleanName } from "../billsData";
import { A4, appendFile } from "./attach";
import { embedFonts, newDoc } from "./common";

// The Bills download (Expenses → Bills, /api/bills/bundle): several bills as one PDF with a cover list, or as a ZIP of the original files.
// items and files line up (files[i] is null when that bill had no file or could not be read); items are already in date order.
export type BundleItem = { name?: string; date?: string; section?: string; payee?: string; ref?: string; amount?: number };
const inr = (n: number) => "Rs " + Math.round(n).toLocaleString("en-IN");   // the PDF's built-in font has no ₹ sign in every viewer, so "Rs"
const label = (it: BundleItem) => cleanName(it.name || [it.date, it.payee, it.ref].filter(Boolean).join(" ") || "bill");

export async function buildBillsZip(items: BundleItem[], files: (Uint8Array | null)[], exts: string[]): Promise<Uint8Array> {
  const zip = new JSZip(); const used = new Set<string>();
  items.forEach((it, i) => {
    const f = files[i]; if (!f) return; const e = exts[i] ? `.${exts[i]}` : "";
    let n = `${label(it)}${e}`; for (let k = 2; used.has(n.toLowerCase()); k++) n = `${label(it)} (${k})${e}`;
    used.add(n.toLowerCase()); zip.file(n, f);
  });
  const missing = items.filter((_, i) => !files[i]).map(label);
  if (missing.length) zip.file("_not included.txt", `These bills could not be added (no file, or no access):\r\n${missing.join("\r\n")}\r\n`);
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });   // photos and PDFs are already compressed
}

export async function buildBillsPdf(items: BundleItem[], files: (Uint8Array | null)[]): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc); doc.setTitle(`Bills (${items.length})`);
  const placed: { it: BundleItem; page: number; ok: boolean }[] = [];
  for (let i = 0; i < items.length; i++) {
    const page = doc.getPageCount() + 1;
    const r = await appendFile(doc, f, `${i + 1}. ${label(items[i])}${items[i].section ? ` · ${items[i].section}` : ""}`, files[i]);
    placed.push({ it: items[i], page, ok: r.ok });
  }
  // the cover list goes in front; its length is known first, so the page numbers it prints are right
  const per = 30, covers = Math.ceil(placed.length / per), W = A4[0], M = 40;
  const grey = rgb(0.42, 0.45, 0.5), ink = rgb(0.1, 0.12, 0.16), line = rgb(0.86, 0.88, 0.91), bad = rgb(0.75, 0.2, 0.15);
  const sum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  for (let c = 0; c < covers; c++) {
    const p = doc.insertPage(c, A4); let y = A4[1] - 50;
    const t = (s: string, x: number, size: number, bold = false, color = ink, maxW?: number) => {
      const font = bold ? f.bold : f.reg; let z = size; if (maxW) while (z > 6 && font.widthOfTextAtSize(s, z) > maxW) z -= 0.25;
      p.drawText(s, { x, y, size: z, font, color });
    };
    if (c === 0) { t("Bills", M, 18, true); y -= 18; t(`${COMPANY.name} · ${items.length} bill${items.length === 1 ? "" : "s"} · total ${inr(sum)} · prepared ${fmtDateDMY(todayISO())}`, M, 9, false, grey, W - 2 * M); y -= 26; }
    const cols = [M, M + 22, M + 82, M + 190, M + 330, M + 410, W - M - 34];
    ["#", "Date", "Section", "Payee", "Ref", "Amount", "Page"].forEach((h, k) => t(h, cols[k], 8, true, grey)); y -= 6;
    p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line }); y -= 14;
    placed.slice(c * per, (c + 1) * per).forEach((r, k) => {
      t(String(c * per + k + 1), cols[0], 8.5); t(r.it.date ? fmtDateDMY(r.it.date) : "", cols[1], 8.5);
      t(r.it.section || "", cols[2], 8.5, false, ink, 104); t(r.it.payee || "", cols[3], 8.5, false, ink, 136);
      t(r.it.ref || "", cols[4], 8.5, false, ink, 76); t(r.it.amount ? inr(Number(r.it.amount)) : "", cols[5], 8.5, false, ink, 70);
      t(r.ok ? String(r.page + covers) : "missing", cols[6], 8.5, !r.ok, r.ok ? ink : bad);
      y -= 6; p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.3, color: line }); y -= 14;
    });
    if (c === covers - 1) { y -= 4; t("Total", cols[4], 9, true); t(inr(sum), cols[5], 9, true); }
    p.drawText(`List page ${c + 1} of ${covers}`, { x: W - M - 70, y: 30, size: 7.5, font: f.reg, color: grey });
  }
  return doc.save();
}
