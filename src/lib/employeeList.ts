import { pileOf } from "./pipeline";

// Only what the list shows. The full record (Aadhaar, PAN, bank…) is loaded on the employee's own page, not for everyone at once.
export const LIST_COLUMNS = "id,emp_no,full_name,designation,department,project,project_id,site_location,join_date,stage,outcome,closed_reason,closed_stage,phone,email,created_at,updated_at";
export type ListRow = {
  id: string; emp_no: string | null; full_name: string; designation: string | null; department: string | null; project: string | null; project_id: string | null; site_location: string | null;
  join_date: string | null; stage: string; outcome: "active" | "rejected"; closed_reason: string | null; closed_stage: string | null; phone: string | null; email: string | null; created_at: string; updated_at: string | null;
};
export type Pile = "process" | "onboarded" | "rejected";
export const PILES: { key: Pile; label: string }[] = [{ key: "process", label: "In process" }, { key: "onboarded", label: "Onboarded" }, { key: "rejected", label: "Rejected" }];
export type SortKey = "newest" | "name" | "role" | "project" | "join" | "stage" | "updated";
export const SORT_LABEL: Record<SortKey, string> = { newest: "Newest first", name: "Name", role: "Role", project: "Project", join: "Joining date", stage: "Stage", updated: "Last updated" };

export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
export const pileOfRow = (r: ListRow) => pileOf(r);
export const digits = (p: string | null | undefined) => { const d = (p || "").replace(/\D/g, ""); return d.length > 10 && d.startsWith("91") ? d.slice(-10) : d; };
export const telHref = (p: string | null | undefined) => (digits(p).length === 10 ? `tel:+91${digits(p)}` : "");
export const waHref = (p: string | null | undefined) => (digits(p).length === 10 ? `https://wa.me/91${digits(p)}` : "");

const day = (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const fmtShort = (iso: string | null, year = false) => (iso ? day(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", ...(year ? { year: "numeric" } : {}) }) : "—");

/** "Joins in 3 days" / "Joins today" / "Joining date passed 5 days ago" – only meaningful for people still in process. */
export function joinInfo(r: ListRow): { text: string; tone: "soon" | "late" | "plain" } | null {
  if (!r.join_date) return null;
  const diff = Math.round((day(r.join_date).getTime() - startOfToday().getTime()) / 86400000);
  if (diff === 0) return { text: "Joins today", tone: "soon" };
  if (diff > 0) return { text: `Joins in ${diff} day${diff === 1 ? "" : "s"}`, tone: diff <= 7 ? "soon" : "plain" };
  return { text: `Joining date passed ${-diff} day${diff === -1 ? "" : "s"} ago`, tone: "late" };
}
/** Days since the record was last changed – a hint that a candidate is stuck. Shown from 7 days. */
export function idleDays(r: ListRow): number | null {
  if (!r.updated_at) return null;
  const n = Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400000);
  return n >= 7 ? n : null;
}

const text = (r: ListRow) => [r.full_name, r.designation, r.department, r.project, r.site_location, r.emp_no, r.phone, r.email].filter(Boolean).join(" ").toLowerCase();
export const matches = (r: ListRow, q: string) => { const s = q.trim().toLowerCase(); if (!s) return true; const t = text(r); const sd = s.replace(/\D/g, ""); return s.split(/\s+/).every((w) => t.includes(w)) || (sd.length >= 4 && digits(r.phone).includes(sd)); };

const cmp = (a: string | null | undefined, b: string | null | undefined) => (a || "").localeCompare(b || "", "en", { sensitivity: "base" });
export function sortRows(rows: ListRow[], key: SortKey, dir: "asc" | "desc", stageOrder: (k: string) => number): ListRow[] {
  const m = dir === "asc" ? 1 : -1;
  const out = [...rows];
  out.sort((a, b) => {
    let c = 0;
    if (key === "name") c = cmp(a.full_name, b.full_name);
    else if (key === "role") c = cmp(a.designation, b.designation);
    else if (key === "project") c = cmp(a.project, b.project);
    else if (key === "stage") c = stageOrder(a.stage) - stageOrder(b.stage);
    else if (key === "join") { if (!a.join_date !== !b.join_date) return !a.join_date ? 1 : -1; c = (a.join_date || "").localeCompare(b.join_date || ""); }   // people without a date always last
    else if (key === "updated") c = (a.updated_at || "").localeCompare(b.updated_at || "");
    else c = a.created_at.localeCompare(b.created_at);
    return c * m || cmp(a.full_name, b.full_name);
  });
  return out;
}
