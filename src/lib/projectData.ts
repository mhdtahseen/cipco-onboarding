"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase/client";
import { pileOf, STAGES } from "./pipeline";
import type { DocType, Employee, ExpenseCategory, Project, ProjectDocument, ProjectExpense } from "./types";

export const fmtD = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const tally = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);

// Everything one project's screens need (overview and report share this): the project, its people, expenses, documents and the derived numbers.
export function useProjectData(id: string) {
  const [p, setP] = useState<Project | null>(null); const [emps, setEmps] = useState<Employee[]>([]); const [err, setErr] = useState(""); const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<ExpenseCategory[]>([]); const [exps, setExps] = useState<ProjectExpense[]>([]); const [expErr, setExpErr] = useState("");
  const [dTypes, setDTypes] = useState<DocType[]>([]); const [pdocs, setPdocs] = useState<ProjectDocument[]>([]); const [docErr, setDocErr] = useState("");

  async function loadExpenses() {
    const sb = supabase(); const [c, x] = await Promise.all([sb.from("expense_categories").select("*").order("sort_order"), sb.from("project_expenses").select("*").eq("project_id", id).order("expense_date", { ascending: false }).order("created_at", { ascending: false })]);
    if (c.error || x.error) { setExpErr((c.error || x.error)!.message + " — has the project-expenses SQL migration been run?"); return; }
    setExpErr(""); setCats((c.data || []) as ExpenseCategory[]); setExps((x.data || []) as ProjectExpense[]);
  }
  async function loadDocs() {
    const sb = supabase(); const [t, d] = await Promise.all([sb.from("document_types").select("*").order("sort_order"), sb.from("project_documents").select("*").eq("project_id", id).order("doc_date", { ascending: false }).order("created_at", { ascending: false })]);
    if (t.error || d.error) { setDocErr((t.error || d.error)!.message + " — has the project-documents SQL migration been run?"); return; }
    setDocErr(""); setDTypes((t.data || []) as DocType[]); setPdocs((d.data || []) as ProjectDocument[]);
  }
  async function loadProject() {
    const sb = supabase(); const [pr, em] = await Promise.all([sb.from("projects").select("*").eq("id", id).single(), sb.from("employees").select("*").eq("project_id", id).order("join_date", { nullsFirst: false })]);
    if (pr.error) { setErr(pr.error.message); setLoading(false); return; }
    setP(pr.data as Project); setEmps((em.data || []) as Employee[]); setLoading(false);
  }
  useEffect(() => { loadProject(); loadExpenses(); loadDocs(); }, [id]);

  const r = useMemo(() => {
    const live = emps.filter((e) => pileOf(e) !== "rejected"), rejected = emps.length - live.length;
    const ctc = live.reduce((s, e) => s + (Number(e.monthly_ctc) || 0), 0), withCtc = live.filter((e) => Number(e.monthly_ctc) > 0).length;
    const joins = live.map((e) => e.join_date).filter(Boolean).sort() as string[];
    return { live, rejected, ctc, withCtc, first: joins[0] ?? null, last: joins.at(-1) ?? null,
      byDept: tally(live.map((e) => e.department || "No department")), byType: tally(live.map((e) => e.employment_type || "—")),
      byStage: STAGES.map((s) => [s.label, live.filter((e) => e.stage === s.key).length] as const).filter(([, n]) => n) };
  }, [emps]);

  const cost = useMemo(() => {
    const spent = exps.reduce((t, e) => t + Number(e.amount), 0);
    const end = p?.closed_on ? new Date(p.closed_on + "T00:00:00") : new Date();   // salary is estimated from each person's joining date to today (or the closing date)
    const salary = r.live.reduce((t, e) => { if (!e.join_date || !(Number(e.monthly_ctc) > 0)) return t; const days = (end.getTime() - new Date(e.join_date + "T00:00:00").getTime()) / 864e5; return days > 0 ? t + (days / 30.4375) * Number(e.monthly_ctc) : t; }, 0);
    const byCat = tally(exps.map((e) => e.category_id)).map(([cid]) => [cats.find((c) => c.id === cid)?.name ?? "—", exps.filter((e) => e.category_id === cid).reduce((t, e) => t + Number(e.amount), 0)] as const).sort((a, b) => b[1] - a[1]);
    const mo: Record<string, number> = {}; exps.forEach((e) => { const k = e.expense_date.slice(0, 7); mo[k] = (mo[k] || 0) + Number(e.amount); });
    const byMonth = Object.entries(mo).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [new Date(k + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" }), v] as const);
    return { spent, salary, total: spent + salary, byCat, byMonth };
  }, [exps, cats, r, p]);

  return { p, setP, emps, err, loading, cats, setCats, exps, expErr, dTypes, setDTypes, pdocs, docErr, r, cost, loadExpenses, loadDocs, loadProject };
}
