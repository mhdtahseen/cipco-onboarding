import { buildLetterPdf } from "./pdf/letters";
import { buildExitLetterPdf } from "./pdf/exitLetters";
import { EXIT_LETTER, isExitLetter, type SettlementRow } from "./offboarding";
import type { LetterRow } from "./types";

/** Any issued letter (offer, appointment or an exit letter) rebuilt as a PDF from its saved snapshot, with a file name. Server only. */
export async function issuedLetterPdf(l: LetterRow, seal: boolean): Promise<{ bytes: Uint8Array; file: string }> {
  const v = l.vars || {};
  if (isExitLetter(l.kind)) {
    let rows: SettlementRow[] | null = null; try { rows = v.rows ? (JSON.parse(v.rows) as SettlementRow[]) : null; } catch { rows = null; }
    const bytes = await buildExitLetterPdf({ subject: v.subject, to: v.to === "whom" ? "whom" : "person", name: v.name, address: (v.address || "").split("\n").filter(Boolean), paragraphs: (l.sections || []).map((s) => s.body),
      rows, ack: v.ack === "1", refNo: l.ref_no, issuedOn: l.issued_on, withSeal: seal, empNo: v.emp_no, designation: v.designation });
    return { bytes, file: `${EXIT_LETTER[l.kind].file} - ${v.full_name || "employee"}.pdf` };
  }
  const bytes = await buildLetterPdf({ kind: l.kind as "offer" | "appointment", sections: l.sections, vars: v, refNo: l.ref_no, issuedOn: l.issued_on, withSeal: seal, annexure: l.annexure });
  return { bytes, file: `${l.kind === "offer" ? "Offer Letter" : "Appointment Letter"} - ${v.full_name}.pdf` };
}
