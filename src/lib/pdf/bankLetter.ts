import { rgb } from "pdf-lib";
import { COMPANY } from "../company";
import { fmtDateLong, numToWordsIN } from "../format";
import { embedFonts, newDoc, wrapPlain } from "./common";
import { H, INK, ML, W, Writer } from "./letters";

export type BankLetterRow = { name: string; amount: number; bank: string; branch: string; account: string; ifsc: string };
export type BankLetterInput = {
  refNo: string; date: string;                   // yyyy-mm-dd
  bankName: string; bankBranch: string; debitAccount: string;
  mode: string;                                   // NEFT, RTGS, IMPS or "transfer within the bank"
  valueDate: string | null;                       // yyyy-mm-dd, or null for "the earliest"
  payMonth: string; projectName: string;
  rows: BankLetterRow[];
};

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const words = (n: number) => { const r = Math.floor(n + 1e-9), p = Math.round((n - r) * 100); return `Rupees ${numToWordsIN(r)}${p ? ` and ${numToWordsIN(p)} Paise` : ""} Only`; };
const EMAIL = "sa.inamdar@cipcogroup.com";
const TX = 40, TW = W - 2 * TX;                   // the table is wider than the text margins so seven columns fit
const COLS = [{ k: "no", w: 20, r: false }, { k: "name", w: 120, r: false }, { k: "amount", w: 66, r: true }, { k: "bank", w: 86, r: false }, { k: "branch", w: 78, r: false }, { k: "account", w: 82, r: false }, { k: "ifsc", w: 63, r: false }] as const;
const HEAD: Record<string, string> = { no: "#", name: "Name (as per Aadhaar)", amount: "Amount (₹)", bank: "Bank name", branch: "Branch", account: "A/c no.", ifsc: "IFSC" };

/** The letter to the company's bank asking it to credit the month's salaries to the employees' accounts: the company's letterhead, the request, the beneficiary table and the closing.
 *  Deliberately without seal or signature images: it is signed by hand. */
export async function buildBankLetter(a: BankLetterInput): Promise<Uint8Array> {
  const doc = await newDoc(); const f = await embedFonts(doc); const w = new Writer(doc, f); await w.start();
  const total = a.rows.reduce((s, r) => s + r.amount, 0), n = a.rows.length;
  const when = a.valueDate ? `on ${fmtDateLong(a.valueDate)}` : "at the earliest";

  w.y += 6; w.text(`Ref. No.: ${a.refNo}`, ML, 10, f.bold); w.rightText(`Date: ${fmtDateLong(a.date)}`, 10, f.bold); w.y += 24;
  w.text("To,", ML, 10, f.reg); w.y += 14; w.text("The Branch Manager,", ML, 10, f.bold); w.y += 14; w.text(a.bankName || "[Bank name]", ML, 10, f.bold); w.y += 14; w.text(a.bankBranch ? `${a.bankBranch} Branch` : "[Branch]", ML, 10, f.reg); w.y += 22;
  await w.para(`**Subject: Request to process salary payments for ${a.payMonth} through ${a.mode}: ${n} beneficiar${n === 1 ? "y" : "ies"}, total ₹${money(total)}**`, { gap: 8 });
  w.y += 8; w.text("Dear Sir / Madam,", ML, 10, f.reg); w.y += 6;
  await w.para(`We, ${COMPANY.name}, maintain Current Account No. **${a.debitAccount || "[account number]"}** with your branch. We request you to kindly debit a total amount of **₹${money(total)}** (${words(total)}) from the above account, and credit the salaries for **${a.payMonth}**${a.projectName ? ` (${a.projectName})` : ""} to the beneficiary accounts listed below through **${a.mode}** ${when}.`, { gap: 8 });

  // ── table ──
  const SZ = 8, PAD = 3.5, LH = 9.6; const colX: number[] = []; COLS.reduce((x, c) => { colX.push(x); return x + c.w; }, TX);
  const cell = (c: (typeof COLS)[number], r: BankLetterRow, i: number) => c.k === "no" ? String(i + 1) : c.k === "amount" ? money(r.amount) : String((r as any)[c.k] || "–");
  const header = async () => {
    await w.ensure(26); const top = w.y; w.page.drawRectangle({ x: TX, y: H - top - 18, width: TW, height: 18, color: rgb(0.9, 0.93, 0.98) });
    COLS.forEach((c, i) => { const t = HEAD[c.k]; const tw = f.bold.widthOfTextAtSize(t, SZ); w.page.drawText(t, { x: c.r ? colX[i] + c.w - PAD - tw : colX[i] + PAD, y: H - top - 12, size: SZ, font: f.bold, color: INK }); });
    w.page.drawLine({ start: { x: TX, y: H - top }, end: { x: TX + TW, y: H - top }, thickness: 0.7, color: INK }); w.page.drawLine({ start: { x: TX, y: H - top - 18 }, end: { x: TX + TW, y: H - top - 18 }, thickness: 0.7, color: INK }); w.y = top + 18;
  };
  await header();
  for (let i = 0; i < a.rows.length; i++) {
    const r = a.rows[i]; const cells = COLS.map((c) => wrapPlain(c.k === "account" || c.k === "ifsc" ? f.reg : f.reg, cell(c, r, i), SZ, c.w - 2 * PAD)); const lines = Math.max(...cells.map((x) => x.length)); const h = lines * LH + 2 * PAD - 1;
    if (w.y + h > H - 90) { await w.newPage(); await header(); }
    const top = w.y; cells.forEach((ls, ci) => ls.forEach((l, li) => { const c = COLS[ci]; const tw = f.reg.widthOfTextAtSize(l, SZ); w.page.drawText(l, { x: c.r ? colX[ci] + c.w - PAD - tw : colX[ci] + PAD, y: H - top - PAD - 7 - li * LH, size: SZ, font: ci === 1 ? f.bold : f.reg, color: INK }); }));
    w.page.drawLine({ start: { x: TX, y: H - top - h }, end: { x: TX + TW, y: H - top - h }, thickness: 0.3, color: rgb(0.75, 0.77, 0.82) }); w.y = top + h;
  }
  await w.ensure(40); const t0 = w.y; w.page.drawLine({ start: { x: TX, y: H - t0 }, end: { x: TX + TW, y: H - t0 }, thickness: 0.7, color: INK }); w.y += 15;
  w.text("Total", colX[1] + PAD, 9, f.bold); const tt = money(total); w.page.drawText(tt, { x: colX[2] + COLS[2].w - PAD - f.bold.widthOfTextAtSize(tt, 9), y: H - w.y, size: 9, font: f.bold, color: INK }); w.text(`${n} beneficiar${n === 1 ? "y" : "ies"}`, colX[3] + PAD, 8.5, f.reg, INK); w.y += 6;
  w.page.drawLine({ start: { x: TX, y: H - w.y }, end: { x: TX + TW, y: H - w.y }, thickness: 0.7, color: INK }); w.y += 12;
  await w.para(`**Amount in words:** ${words(total)}`, { gap: 10 });

  // ── closing ──
  await w.ensure(150);
  await w.para(`Kindly process the above payments ${when}. The beneficiary names are as per their Aadhaar and the account details are as furnished by the employees. Bank charges, if any, may be debited to the same account. Please send the confirmation of credit, with the transaction reference numbers, to ${EMAIL}.`, { gap: 8 });
  await w.para("In case of any mismatch in a beneficiary's account details, please hold that payment and inform us before returning it. Kindly acknowledge receipt of this letter.", { gap: 10 });
  w.y += 6; w.text("Thanking you,", ML, 10, f.reg); w.y += 16; w.text("Yours faithfully,", ML, 10, f.reg); w.y += 15; w.text(`For ${COMPANY.name} (${COMPANY.short})`, ML, 10, f.bold); w.y += 46;
  w.text("_____________________________", ML, 10, f.reg); w.y += 14; w.text("Authorised Signatory", ML, 10, f.bold); w.y += 14; w.text("Proprietor", ML, 10, f.reg);

  const pages = doc.getPages(); pages.forEach((p, i) => { const t = `Page ${i + 1} of ${pages.length}`; p.drawText(t, { x: (W - f.reg.widthOfTextAtSize(t, 8)) / 2, y: 30, size: 8, font: f.reg, color: rgb(0.45, 0.47, 0.52) }); });
  return doc.save();
}
