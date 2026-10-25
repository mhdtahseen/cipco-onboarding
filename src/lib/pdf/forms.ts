import { PDFDocument } from "pdf-lib";
import { COMPANY } from "../company";
import { dmyParts, fmtDateDMY, fmtDateLong, todayISO } from "../format";
import type { Employee } from "../types";
import { Fonts, blank, circle, drawPhotoBox, drawStamp, embedFonts, newDoc, put, readAsset, tick, wrapPlain } from "./common";

const groups = (s?: string | null, n = 4) => (s || "").replace(/\s+/g, "").replace(new RegExp(`(.{${n}})(?=.)`, "g"), "$1 ").trim();
const centered = (page: any, f: any, text: string, cx: number, base: number, size = 9) => text && put(page, f, text, cx - f.widthOfTextAtSize(text, size) / 2, base, size);

async function load(name: string) {
  const doc = await PDFDocument.load(await readAsset("templates", name));
  doc.registerFontkit((await import("@pdf-lib/fontkit")).default);
  const f = await embedFonts(doc);
  return { doc, f };
}

// ------------------------------------------------------------------ Joining form (1 page)
export async function fillJoiningForm(e: Employee, withSeal: boolean, photo?: Uint8Array | null): Promise<Uint8Array> {
  const { doc, f } = await load("joining_form.pdf"); const p = doc.getPage(0); const r = f.reg;
  await drawPhotoBox(doc, p, { x: 472, top: 30, w: 90, h: 112 }, photo);   // top-right corner, ~32 x 40 mm
  put(p, r, e.full_name, 178, 178, 9.5, 258);
  put(p, r, e.father_spouse_name, 168, 196, 9.5, 258);
  const d = dmyParts(e.dob);
  centered(p, r, d.dd, 200.3, 213.7); centered(p, r, d.mm, 230, 213.7); centered(p, r, d.yyyy, 270.3, 213.7);
  if (e.gender === "Male") circle(p, 358, 210.7, 16, 7.5);
  if (e.gender === "Female") circle(p, 393.3, 210.7, 19, 7.5);
  if (e.gender === "Other") circle(p, 429.8, 210.7, 16, 7.5);
  put(p, r, e.permanent_address, 150, 231.5, 8.5, 378);
  put(p, r, e.current_address || e.permanent_address, 166, 249.2, 8.5, 357);
  put(p, r, e.phone, 137, 266.9, 9, 110); put(p, r, e.alt_phone, 325, 266.9, 9, 85);
  put(p, r, groups(e.aadhaar), 184, 330.9, 9, 106); put(p, r, (e.pan || "").toUpperCase(), 460, 330.9, 9, 100);
  put(p, r, e.account_no, 184, 380.3, 9, 106); put(p, r, (e.ifsc || "").toUpperCase(), 460, 380.3, 9, 100);
  put(p, r, [e.bank_name, e.bank_branch].filter(Boolean).join(", "), 184, 429.8, 9, 106); put(p, r, e.uan, 460, 429.8, 9, 100);
  put(p, r, e.nominee_name, 151, 500.7, 9.5, 258);
  put(p, r, e.nominee_relation, 176, 518.5, 9, 142); put(p, r, e.nominee_age_dob, 381, 518.5, 9, 80);
  put(p, r, e.emergency_name, 181, 536.2, 9, 138); put(p, r, e.emergency_phone, 378, 536.2, 9, 85);
  if (withSeal) await drawStamp(doc, p, { x: 352, top: 634, signW: 80, signMaxH: 34, sealW: 56, sealDx: 92, sealDy: 0 });
  return doc.save();
}

// ------------------------------------------------------------------ PF Form 11 (1 page)
export async function fillForm11(e: Employee, withSeal: boolean): Promise<Uint8Array> {
  const { doc, f } = await load("form_11.pdf"); const p = doc.getPage(0); const r = f.reg; const X = 374;
  put(p, r, e.emp_no, 426, 55, 9, 120); put(p, r, COMPANY.name.replace("Company", "Co."), 421, 78, 8, 130);
  put(p, r, e.full_name, X, 121, 9, 190);
  put(p, r, e.father_spouse_name, X, 141, 9, 190);
  tick(p, f.bold, e.father_spouse_type === "Spouse" ? 219.4 : 141.4, 129, 7);
  const d = dmyParts(e.dob); centered(p, r, d.dd, 402, 160.5); centered(p, r, d.mm, 462, 160.5); centered(p, r, d.yyyy, 527.5, 160.5);
  put(p, r, e.gender, X, 175.5, 9);
  const ms: Record<string, string> = { Single: "Unmarried", Married: "Married", Widow: "Widow", Widower: "Widow", Divorced: "Divorce" };
  put(p, r, ms[e.marital_status || ""] || e.marital_status, X, 188.5, 9);
  put(p, r, e.email, X, 204, 8.5, 190); put(p, r, e.phone, X, 217, 9, 190);
  const earlier = !!(e.uan || e.prev_pf_no);
  for (const top of [224.3, 236.3]) tick(p, f.bold, earlier ? 444.2 : 517.2, top, 6);
  put(p, r, groups(e.uan, 4), X, 267.5, 9, 190);
  put(p, r, e.prev_pf_no, X, 283.5, 8, 190);
  tick(p, f.bold, 517.2, 339.3, 6); put(p, r, "India", X, 356, 9);
  put(p, r, [e.account_no && `A/C ${e.account_no}`, e.ifsc && `IFSC ${e.ifsc.toUpperCase()}`].filter(Boolean).join("   "), X, 405, 8.5, 190);
  put(p, r, groups(e.aadhaar), X, 424, 9.5, 190); put(p, r, (e.pan || "").toUpperCase(), X, 441, 9.5, 190);
  // employer declaration
  put(p, r, e.full_name, 177, 577, 8, 60);
  put(p, r, fmtDateDMY(e.join_date), 299, 577, 7, 38);
  if (withSeal) { put(p, r, fmtDateDMY(todayISO()), 88, 765.5, 8.5); await drawStamp(doc, p, { x: 398, top: 728, signW: 70, signMaxH: 30, sealW: 44, sealDx: 108, sealDy: 17 }); }
  return doc.save();
}

// ------------------------------------------------------------------ Gratuity Form F (2 pages)
export async function fillGratuity(e: Employee, withSeal: boolean): Promise<Uint8Array> {
  const { doc, f } = await load("gratuity_form_f.pdf"); const [p1, p2] = doc.getPages(); const r = f.reg;
  blank(p1, 124, 129.5, 100, 11.5); put(p1, r, COMPANY.addressOneLine, 128, 137.5, 8.5, 390);
  blank(p1, 243, 157, 120, 11); put(p1, r, e.full_name, 246, 165, 10, 200);
  // nominee table (one nominee; more can be typed by hand)
  if (e.nominee_name) {
    const col1 = [e.nominee_name, e.nominee_address].filter(Boolean).join(", ");
    wrapPlain(r, col1, 7.5, 88).slice(0, 7).forEach((ln, i) => put(p1, r, ln, 101, 540 + i * 9, 7.5));
    put(p1, r, e.nominee_relation, 202, 540, 8.5, 98); put(p1, r, e.nominee_age_dob, 312, 540, 8.5, 98); put(p1, r, "100%", 424, 540, 8.5, 98);
  }
  const SX = 356, sx = (y: number, t?: string | null) => put(p1, r, t, SX, y + 9, 9.5, 170);
  sx(641, e.full_name); sx(655, e.gender); sx(669, e.religion);
  const ms: Record<string, string> = { Single: "Unmarried", Married: "Married", Widow: "Widow", Widower: "Widower", Divorced: "Divorced" };
  sx(683, ms[e.marital_status || ""] || e.marital_status); sx(696, e.department);
  put(p2, r, e.designation, 338, 82, 9.5, 180);
  put(p2, r, fmtDateLong(e.join_date), 240, 96, 9.5, 200);
  wrapPlain(r, e.permanent_address || "", 8.5, 285).slice(0, 2).forEach((ln, i) => put(p2, r, ln, 232, 110 + i * 10, 8.5));
  put(p2, r, e.district || e.city, 276, 150, 8.5, 74); put(p2, r, e.state, 385, 150, 8.5, 80);
  put(p2, r, COMPANY.city, 124, 205, 9);
  if (withSeal) {
    put(p2, r, fmtDateDMY(todayISO()), 122, 495, 9);
    await drawStamp(doc, p2, { x: 408, top: 452, signW: 82, signMaxH: 36, sealW: 60, sealDx: -142, sealDy: 78 });
  }
  return doc.save();
}

// ------------------------------------------------------------------ Joining kit = joining form + Form 11 + Form F
export async function buildKit(e: Employee, withSeal: boolean, photo?: Uint8Array | null): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of [await fillJoiningForm(e, withSeal, photo), await fillForm11(e, withSeal), await fillGratuity(e, withSeal)]) {
    const src = await PDFDocument.load(bytes); const pages = await out.copyPages(src, src.getPageIndices()); pages.forEach((pg) => out.addPage(pg));
  }
  return out.save();
}
