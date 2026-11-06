// Inventory CSV import: one bill per file, one row per item, the bill's own columns repeated on every row.
// Pure (no React, no database) so the same code can be tested. The template and the Gemini prompt live here too, so they cannot drift from what the parser accepts.
import { billSums, lineAmount, UNITS } from "./inventory";

export const CSV_COLUMNS = ["vendor_name", "vendor_gstin", "bill_no", "bill_date", "bill_total", "other_charges", "item_name", "hsn", "hsn_guessed", "qty", "unit", "rate", "gst_pct"] as const;
const BILL_COLUMNS = ["vendor_name", "vendor_gstin", "bill_no", "bill_date", "bill_total", "other_charges"] as const;
export const MAX_ROWS = 500;

export type ImportBill = { vendor_name: string; vendor_gstin: string; bill_no: string; bill_date: string; bill_total: number; other_charges: number };
export type ImportItem = { line: number; name: string; hsn: string; hsnGuessed: boolean; qty: number; unit: string; rate: number; gst_pct: number; amount: number };
export type ImportResult = { bill: ImportBill | null; items: ImportItem[]; errors: string[]; warnings: string[]; sums: ReturnType<typeof billSums> | null };

/** Reads CSV text into rows of cells: quoted cells, doubled quotes, commas or line breaks inside quotes, CRLF, a BOM, and a semicolon instead of a comma (Excel in some regions). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const sep = !firstLine.includes(",") && firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; continue; }
    if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const csvCell = (v: string | number) => { const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

// What a bill may say for a unit, and the portal unit it becomes. The portal's own spellings are accepted as they are; anything else is converted and shown to the admin.
const UNIT_ALIASES: Record<string, string> = {
  pcs: "Pcs", pc: "Pcs", piece: "Pcs", pieces: "Pcs",
  nos: "No", no: "No", "no.": "No", each: "No", set: "No", sets: "No", pair: "No", pairs: "No", lot: "No",
  ft: "FT", feet: "FT", foot: "FT",
  inch: "Inch", inches: "Inch", in: "Inch",
  mtr: "Meter", mtrs: "Meter", meter: "Meter", meters: "Meter", metre: "Meter", metres: "Meter", m: "Meter",
  mm: "mm", millimeter: "mm", millimetre: "mm",
  kg: "Kg", kgs: "Kg", kilogram: "Kg", kilograms: "Kg",
  mt: "MT", ton: "MT", tons: "MT", tonne: "MT", tonnes: "MT",
};
function portalUnit(raw: string): { unit: string; converted: boolean } | null {
  const t = raw.trim();
  if (UNITS.includes(t)) return { unit: t, converted: false };
  const u = UNIT_ALIASES[t.toLowerCase()];
  return u ? { unit: u, converted: true } : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Accepts 2026-11-03, 03/11/2026, 3-11-26 and 3-Nov-26 (day first, as on Indian bills) and returns the ISO date, or null if it is not a real date. */
export function parseDate(raw: string): string | null {
  const t = raw.trim(); let y: number, m: number, d: number; let g: RegExpMatchArray | null;
  if ((g = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +g[1]; m = +g[2]; d = +g[3]; }
  else if ((g = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) { d = +g[1]; m = +g[2]; y = +g[3]; }
  else if ((g = t.match(/^(\d{1,2})[-/ .]([A-Za-z]{3})[A-Za-z]*[-/ .,]*(\d{2}|\d{4})$/)) && MONTHS.includes(g[2].toLowerCase())) { d = +g[1]; m = MONTHS.indexOf(g[2].toLowerCase()) + 1; y = +g[3]; }
  else return null;
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const num = (s: string) => { const t = s.replace(/[₹,\s]/g, "").replace(/%$/, ""); return t === "" ? NaN : Number(t); };
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

export function parseBillCsv(text: string): ImportResult {
  const errors: string[] = []; const warnings: string[] = []; const fail = (): ImportResult => ({ bill: null, items: [], errors, warnings, sums: null });
  const all = parseCsv(text);
  if (!all.length || all.every((r) => r.every((c) => !c.trim()))) { errors.push("The file is empty."); return fail(); }
  const header = all[0].map((h) => h.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) { errors.push(`These columns are missing from the first row: ${missing.join(", ")}. Use the template's header exactly.`); return fail(); }
  const extra = header.filter((h) => h && !(CSV_COLUMNS as readonly string[]).includes(h));
  if (extra.length) warnings.push(`Ignored columns: ${extra.join(", ")}.`);
  const at = (r: string[], col: string) => (r[header.indexOf(col)] ?? "").trim();
  const data = all.slice(1).map((r, i) => ({ r, n: i + 2 })).filter(({ r }) => r.some((c) => c.trim()));
  if (!data.length) { errors.push("There are no item rows under the header."); return fail(); }
  if (data.length > MAX_ROWS) { errors.push(`More than ${MAX_ROWS} items in one file.`); return fail(); }

  // the bill: the first row's values, which every other row must repeat
  const first = data[0].r;
  for (const { r, n } of data.slice(1)) for (const c of BILL_COLUMNS) {
    const a = at(first, c), b = at(r, c);
    const same = c === "bill_total" || c === "other_charges" ? (num(a) || 0) === (num(b) || 0) : c === "bill_date" ? (parseDate(a) ?? a) === (parseDate(b) ?? b) : a.toLowerCase() === b.toLowerCase();
    if (!same) { errors.push(`Row ${n}: ${c} is "${b}" but the first row says "${a}". Every row must repeat the same bill details.`); break; }
  }
  const vendor_name = at(first, "vendor_name").replace(/\s+/g, " "), bill_no = at(first, "bill_no"), date = parseDate(at(first, "bill_date")), total = num(at(first, "bill_total")), other = at(first, "other_charges") === "" ? 0 : num(at(first, "other_charges"));
  const gstin = at(first, "vendor_gstin").toUpperCase().replace(/\s+/g, "");
  if (!vendor_name) errors.push("vendor_name is empty."); if (!bill_no) errors.push("bill_no is empty.");
  if (!date) errors.push(`bill_date "${at(first, "bill_date")}" is not a date. Write it as YYYY-MM-DD, for example 2026-11-03.`);
  if (!(total > 0)) errors.push("bill_total must be a number above zero."); if (!Number.isFinite(other)) errors.push("other_charges must be a number (0 if none).");
  if (gstin && !GSTIN.test(gstin)) warnings.push(`The GSTIN "${gstin}" does not look like a GSTIN. Check it against the bill.`);

  const items: ImportItem[] = []; const converted = new Map<string, string>(); let guessed = 0;
  for (const { r, n } of data) {
    const bad = (m: string) => errors.push(`Row ${n}: ${m}`);
    const name = at(r, "item_name").replace(/\s+/g, " "), qty = num(at(r, "qty")), rate = num(at(r, "rate")), gst = num(at(r, "gst_pct")), rawUnit = at(r, "unit");
    let ok = true;
    if (!name) { bad("item_name is empty."); ok = false; }
    if (!(qty > 0)) { bad(`qty "${at(r, "qty")}" must be a number above zero.`); ok = false; }
    if (!(rate >= 0)) { bad(`rate "${at(r, "rate")}" must be a number (the price before GST).`); ok = false; }
    if (!(gst >= 0 && gst <= 40)) { bad(`gst_pct "${at(r, "gst_pct")}" must be a number from 0 to 40.`); ok = false; }
    const pu = rawUnit ? portalUnit(rawUnit) : null;
    if (!pu) { bad(rawUnit ? `unit "${rawUnit}" is not one the portal accepts (${UNITS.join(", ")}).` : "unit is empty."); ok = false; }
    else if (pu.converted) converted.set(rawUnit, pu.unit);
    let hsn = at(r, "hsn").replace(/[\s.-]/g, "");
    if (hsn && !/^\d{4,8}$/.test(hsn)) { warnings.push(`Row ${n}: the HSN "${at(r, "hsn")}" is not 4 to 8 digits, so it was left out.`); hsn = ""; }
    const hsnGuessed = /^(y|yes|true|1)$/i.test(at(r, "hsn_guessed")); if (hsnGuessed) guessed++;
    if (ok && pu) items.push({ line: n, name, hsn, hsnGuessed, qty, unit: pu.unit, rate, gst_pct: gst, amount: lineAmount(qty, rate) });
  }
  if (converted.size) warnings.push(`Units converted to the portal's: ${[...converted].map(([a, b]) => `${a} to ${b}`).join(", ")}.`);
  if (guessed) warnings.push(`${guessed} HSN code${guessed === 1 ? " was" : "s were"} suggested by Gemini, not printed on the bill: check them.`);
  const seen = new Set<string>(); for (const i of items) { const k = `${i.name}|${i.qty}|${i.unit}|${i.rate}`.toLowerCase(); if (seen.has(k)) { warnings.push(`Row ${i.line}: "${i.name}" appears twice with the same quantity and rate. Check that the bill really lists it twice.`); } seen.add(k); }

  if (errors.length || !date) return { bill: null, items, errors, warnings, sums: null };
  const bill: ImportBill = { vendor_name, vendor_gstin: gstin, bill_no, bill_date: date, bill_total: total, other_charges: other };
  const sums = billSums(items.map((i) => ({ amount: i.amount, gst_pct: i.gst_pct })), other, total);
  if (!sums.matches) warnings.push(`The items come to ₹${sums.computed.toFixed(2)} but the bill says ₹${total.toFixed(2)} (${Math.abs(sums.diff).toFixed(2)} ${sums.diff > 0 ? "short" : "over"}). It can still be imported as a draft; the bill cannot be recorded until the difference is fixed.`);
  return { bill, items, errors, warnings, sums };
}

// The worked example: the SMB Trading Corporation invoice 3349/26-27. Everything here is as printed on that bill, so the template doubles as a test.
const SMB = ["SMB Trading Corporation", "24ABZFS9705N1Z4", "3349/26-27", "2026-11-03", "15063.00", "0"];
const SMB_ITEMS: [string, string, number, string, number, number][] = [
  ["EAR PLUG", "39269099", 5, "Pcs", 15, 18], ["JALI", "73144290", 2, "FT", 30, 18], ["LEATHER APRON", "42034010", 5, "Pcs", 480, 18], ["LPG REGULATOR", "84811000", 1, "Pcs", 850, 18],
  ["HOSE CLAMP", "73182990", 6, "Pcs", 10, 18], ["OXYGEN CYLINDER KEY", "85151100", 4, "Pcs", 40, 18], ["GAS LIGHTER", "96132000", 2, "Pcs", 30, 18], ["INDUSTRIAL PLUG 16 AMP 3 POLE", "85362090", 5, "Pcs", 180, 18],
  ["PLUG", "85369090", 5, "Pcs", 80, 18], ['PU WHEEL 6"', "83023090", 4, "Pcs", 700, 18], ['PU WHEEL 6" WITH BRACKET', "83021010", 4, "Pcs", 750, 18], ["CABLE CONNECTOR", "85443000", 5, "No", 40, 18],
  ["SAFETY GUARD FOR GRINDER", "65061010", 5, "Pcs", 250, 18], ["SAFETY GUARD FOR GRINDER", "65061010", 1, "Pcs", 450, 18], ["NOZZLE CLEANER", "84689000", 1, "Pcs", 100, 18],
];
export const TEMPLATE_CSV = toCsv([[...CSV_COLUMNS], ...SMB_ITEMS.map(([name, hsn, qty, unit, rate, gst]) => [...SMB, name, hsn, "no", qty, unit, rate.toFixed(2), gst])]);

export const GEMINI_PROMPT = `You are a careful data-entry assistant. I will give you a photo or PDF of an Indian purchase / tax invoice. Read it and give me ONE CSV that I can import into our inventory system.

OUTPUT
1. First, a single code block that contains only the CSV: the header row, then one row per invoice line. Nothing else inside the block.
2. After the block, a short "Check list" (described at the end).

HEADER (exactly this, in this order)
${CSV_COLUMNS.join(",")}

ROWS
One row per invoice line, in invoice order. Never merge or split lines, and keep repeated items as separate rows. The first six columns describe the whole bill, so repeat them identically on every row.

BILL COLUMNS
- vendor_name: the SELLER who issued the invoice (not the buyer / "Bill to"). Write it as a normal name: no bracketed year such as "(25-26)", no dots in initials (S.M.B. becomes SMB), and not all capitals. Example: "S.M.B. TRADING CORPORATION (25-26)" becomes "SMB Trading Corporation".
- vendor_gstin: the seller's 15-character GSTIN, in capitals with no spaces. Empty if none is printed.
- bill_no: the invoice number exactly as printed, for example 3349/26-27.
- bill_date: the invoice date as YYYY-MM-DD. Two-digit years are 20xx: 3-Nov-26 becomes 2026-11-03.
- bill_total: the grand total payable, including all taxes and round off, as a plain number such as 15063.00.
- other_charges: freight, packing, loading, transport or similar charges printed OUTSIDE the item lines, as a positive number; a discount as a negative number. 0 if there are none. Do NOT include GST here, and do NOT include "round off".

ITEM COLUMNS
- item_name: the description as printed, in CAPITALS, on one line, with the same spelling and sizes (6", 19KG). No serial number in front of it.
- hsn: the HSN/SAC printed for that line, digits only. If the invoice has no HSN for the line, or it cannot be read, supply the most likely Indian GST HSN code for that product yourself: 8 digits if you are confident, otherwise the 4-digit heading. If you really cannot suggest one, leave it empty.
- hsn_guessed: "no" when the HSN was printed on the invoice. "yes" when you supplied it or left it empty because it was missing.
- qty: the quantity as a plain number (5 or 2.5). No unit in this cell.
- unit: exactly one of ${UNITS.join(", ")}. Convert what the invoice says to the closest one: PCS / PC / PIECE becomes Pcs; NOS / NO / SET / PAIR / EACH / LOT becomes No; FEET / FT / FOOT becomes FT; INCH / IN becomes Inch; MTR / METER / METRE / M becomes Meter; MM becomes mm; KG / KGS becomes Kg; MT / TON / TONNE becomes MT. Never write any other unit.
- rate: the price per unit BEFORE GST, as in the invoice's Rate column. If the invoice only shows prices that include GST, divide the GST out and say so in the check list.
- gst_pct: the TOTAL GST percentage on that line: the IGST %, or CGST % plus SGST % added together (9 + 9 = 18). A plain number such as 18.

RULES
- Never invent a number. If a quantity, rate or total cannot be read, leave that cell empty and mention it in the check list.
- Plain numbers only: a dot for decimals, no thousands separators, no currency symbols, no % signs.
- Comma-separated, UTF-8. Wrap any cell that contains a comma or a double quote in double quotes, and double any quote inside it: PU WHEEL 6" is written "PU WHEEL 6""".
- The seller is never our company. Our company is the buyer ("Bill to").

FORMAT EXAMPLE (two rows, for the format only)
${CSV_COLUMNS.join(",")}
SMB Trading Corporation,24ABZFS9705N1Z4,3349/26-27,2026-11-03,15063.00,0,EAR PLUG,39269099,no,5,Pcs,15.00,18
SMB Trading Corporation,24ABZFS9705N1Z4,3349/26-27,2026-11-03,15063.00,0,JALI,73144290,no,2,FT,30.00,18

CHECK LIST (after the code block, as short bullets)
1. How many invoice lines you read.
2. The arithmetic: the sum of (qty x rate), plus GST, plus other_charges, against bill_total. Show the figures and the difference. A difference under 1 rupee is round off and is fine.
3. Every unit you converted (invoice unit to the unit you used).
4. Every HSN you supplied yourself (row number, item, code).
5. Anything unreadable, uncertain or left empty.

Now read the invoice I have attached.`;
