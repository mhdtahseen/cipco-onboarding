import type { SupabaseClient } from "@supabase/supabase-js";
import { buildVars, renderSections, salaryFor, type AcceptMode } from "./clauses";
import { renderTemplate } from "./format";
import { annexureNotes, annexureRows } from "./salary";
import type { AnnexureSnapshot, Clause, Employee, Section } from "./types";

export type LetterRequest = {
  employee_id: string; kind: "offer" | "appointment"; clause_ids: string[];
  overrides?: Record<string, Section>; extra_sections?: Section[]; with_seal?: boolean;
  include_annexure?: boolean; annexure_notes?: string[]; preview?: boolean; accept_mode?: AcceptMode;
};

/** Turns the picked clauses (+ per-letter edits, custom sections, annexure) into a final letter snapshot. */
export async function prepareLetter(sb: SupabaseClient, body: LetterRequest) {
  const { data: e } = await sb.from("employees").select("*").eq("id", body.employee_id).single();
  if (!e) throw new Error("employee not found");
  const emp = e as Employee;
  const calc = salaryFor(emp);
  const annexureOn = !!body.include_annexure && !!calc;
  const vars = buildVars(emp, { annexure: annexureOn, accept_mode: body.accept_mode === "signed" ? "signed" : "email" });
  const { data: cl } = await sb.from("clauses").select("*").eq("letter_type", body.kind).in("id", body.clause_ids || []);
  const clauses = ((cl || []) as Clause[]).filter((c) => c.active);
  const { data: coreCl } = await sb.from("clauses").select("*").eq("letter_type", body.kind).eq("is_core", true).eq("active", true);
  const all = new Map<string, Clause>(); [...(coreCl || []), ...clauses].forEach((c: any) => all.set(c.id, c));
  const sections: Section[] = renderSections([...all.values()], vars, body.overrides || {});
  (body.extra_sections || []).forEach((s) => s?.title && s?.body && sections.push({ title: renderTemplate(s.title, vars), body: renderTemplate(s.body, vars) }));
  let annexure: AnnexureSnapshot | null = null;
  if (annexureOn && calc) {
    const tfa = [...all.values()].some((c) => c.key === "site_allowances");
    annexure = { rows: annexureRows(calc), notes: body.annexure_notes ?? annexureNotes(calc, tfa), name: emp.full_name, designation: emp.designation || "", department: emp.department || "" };
  }
  return { emp, vars, sections, annexure };
}
