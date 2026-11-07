"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase/client";
import type { ExpenseCategory, ProjectExpense } from "./types";

// Everything the Expenses page needs about money already spent, across all projects: the projects, the categories and every expense entry (newest first).
export type ExpProject = { id: string; name: string; status: string };
export type SourceKind = "typed" | "payment" | "bill";
export const SOURCE_LABEL: Record<SourceKind, string> = { typed: "Typed in", payment: "From payment", bill: "From bill" };
/** Where an expense came from: typed by a person, posted from a payment (meals, transport, rent, gas, equipment), or posted from an Inventory bill. Only typed ones can be edited here. */
export const sourceKind = (e: Pick<ProjectExpense, "source">): SourceKind => (!e.source ? "typed" : e.source === "inventory_bill" ? "bill" : "payment");
export const sourceHref = (e: Pick<ProjectExpense, "source">) => (e.source === "inventory_bill" ? "/inventory" : e.source === "vendor_payment" ? "/meals" : e.source === "room_payment" ? "/accommodation" : "/transport");

export function useExpenseData() {
  const [projects, setProjects] = useState<ExpProject[]>([]); const [cats, setCats] = useState<ExpenseCategory[]>([]); const [exps, setExps] = useState<ProjectExpense[]>([]);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState("");
  const reload = useCallback(async () => {
    const sb = supabase(); const rows: ProjectExpense[] = [];
    const [p, c] = await Promise.all([sb.from("projects").select("id, name, status").order("name"), sb.from("expense_categories").select("*").order("sort_order")]);
    for (let off = 0; ; off += 1000) {   // the database returns at most 1000 rows a request
      const x = await sb.from("project_expenses").select("*").order("expense_date", { ascending: false }).order("created_at", { ascending: false }).range(off, off + 999);
      if (x.error) { setErr(x.error.message + " — has the project-expenses SQL migration been run?"); setLoading(false); return; }
      rows.push(...((x.data || []) as ProjectExpense[])); if ((x.data || []).length < 1000) break;
    }
    if (p.error || c.error) { setErr((p.error || c.error)!.message); setLoading(false); return; }
    setErr(""); setProjects((p.data || []) as ExpProject[]); setCats((c.data || []) as ExpenseCategory[]); setExps(rows); setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { projects, cats, setCats, exps, loading, err, reload };
}
