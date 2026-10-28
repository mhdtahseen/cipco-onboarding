"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { todayISO } from "@/lib/format";
import { inr } from "@/lib/quote";
import type { Employee, ExpenseCategory, Project, ProjectExpense } from "@/lib/types";

const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const BLANK = { expense_date: "", category_id: "", amount: "", description: "", employee_id: "" };

// Expense entries for one project: quick add (with optional bill and employee tag), edit, delete, filter, CSV.
export default function ProjectExpenses({ project, cats, setCats, expenses, people, reload, openSignal }: { openSignal?: number; project: Project; cats: ExpenseCategory[]; setCats: (c: ExpenseCategory[]) => void; expenses: ProjectExpense[]; people: Employee[]; reload: () => void }) {
  const [f, setF] = useState({ ...BLANK, expense_date: todayISO() }); const [bill, setBill] = useState<File | null>(null); const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false); useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);   // form stays hidden until asked for
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [catF, setCatF] = useState(""); const [monthF, setMonthF] = useState("");
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? "—";
  const personName = (id: string | null) => people.find((p) => p.id === id)?.full_name;
  const months = useMemo(() => [...new Set(expenses.map((e) => e.expense_date.slice(0, 7)))].sort().reverse(), [expenses]);
  const shown = expenses.filter((e) => (!catF || e.category_id === catF) && (!monthF || e.expense_date.startsWith(monthF)));
  const total = shown.reduce((s, e) => s + Number(e.amount), 0);
  const set = (p: Partial<typeof BLANK>) => setF((x) => ({ ...x, ...p }));
  const reset = () => { setF({ ...BLANK, expense_date: todayISO() }); setBill(null); setEditId(null); setOpen(false); };

  async function addCategory() {
    const name = prompt("New expense category (it will be available on every project):")?.trim(); if (!name) return;
    const ex = cats.find((c) => c.name.toLowerCase() === name.toLowerCase()); if (ex) { set({ category_id: ex.id }); return; }
    const { data, error } = await supabase().from("expense_categories").insert({ name, sort_order: Math.max(0, ...cats.map((c) => c.sort_order)) + 10 }).select().single();
    if (error) { setMsg(error.message); return; } setCats([...cats, data as ExpenseCategory]); set({ category_id: (data as ExpenseCategory).id });
  }
  async function save() {
    const amount = Number(f.amount); setMsg("");
    if (!f.category_id) { setMsg("Choose a category."); return; } if (!(amount > 0)) { setMsg("Enter an amount greater than zero."); return; } if (!f.expense_date) { setMsg("Choose the date."); return; }
    setBusy(true);
    let bill_path: string | undefined;
    if (bill) {
      const file = await prepareUpload(bill);
      if (file.size > MAX_UPLOAD) { setMsg("The bill is larger than 5 MB — please send a smaller photo or compressed PDF."); setBusy(false); return; }
      const fd = new FormData(); fd.set("file", file); fd.set("employeeId", `proj-${project.id}`); fd.set("docType", "expense");
      const r = await fetch("/api/docs/upload", { method: "POST", body: fd });
      if (!r.ok) { setMsg(await r.text()); setBusy(false); return; } bill_path = (await r.json()).path;
    }
    const row = { project_id: project.id, category_id: f.category_id, expense_date: f.expense_date, amount, description: f.description.trim(), employee_id: f.employee_id || null, ...(bill_path ? { bill_path } : {}), updated_at: new Date().toISOString() };
    const { error } = editId ? await supabase().from("project_expenses").update(row).eq("id", editId) : await supabase().from("project_expenses").insert(row);
    setBusy(false);
    if (error) { setMsg(error.message + " — has the project-expenses SQL migration been run?"); return; }
    setMsg(editId ? "Saved ✓" : "Expense added ✓"); reset(); reload();
  }
  function edit(e: ProjectExpense) { setOpen(true); setEditId(e.id); setBill(null); setF({ expense_date: e.expense_date, category_id: e.category_id, amount: String(e.amount), description: e.description, employee_id: e.employee_id ?? "" }); window.scrollTo({ top: document.getElementById("expense-form")?.offsetTop ?? 0, behavior: "smooth" }); }
  async function del(e: ProjectExpense) { if (!confirm(`Delete this ₹${inr(Number(e.amount))} ${catName(e.category_id)} expense?`)) return; await supabase().from("project_expenses").delete().eq("id", e.id); if (editId === e.id) reset(); reload(); }
  function csv() {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Date", "Category", "Description", "Employee", "Amount"], ...shown.map((e) => [e.expense_date, catName(e.category_id), e.description, personName(e.employee_id) ?? "", e.amount])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" })); a.download = `${project.name} - expenses.csv`; a.click();
  }

  return (
    <div className="card space-y-4" id="expense-form">
      <div className="flex items-center gap-3"><h3 className="font-semibold">Expenses</h3><span className="hidden sm:inline text-xs text-slate-400">Meal and transport payments post here by themselves: <a className="underline" href="/vendors">meal payments</a> · <a className="underline" href="/transport">transport</a></span>{!open && <button className="btn btn-primary ml-auto" onClick={() => setOpen(true)}>+ Add expense</button>}{!open && msg && <span className="text-sm text-green-700">{msg}</span>}</div>
      {open && <div className="rounded-xl border border-slate-200 p-3 space-y-3">
        <div className="text-sm font-medium">{editId ? "Edit expense" : "Add an expense"}</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><label className="lbl">Date</label><input className="inp" type="date" value={f.expense_date} onChange={(e) => set({ expense_date: e.target.value })} /></div>
          <div><label className="lbl">Category</label><select className="inp" value={f.category_id} onChange={(e) => (e.target.value === "__new" ? addCategory() : set({ category_id: e.target.value }))}><option value=""></option>{cats.filter((c) => c.active || c.id === f.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new">+ Add new category…</option></select></div>
          <div><label className="lbl">Amount (₹)</label><input className="inp" type="number" inputMode="decimal" min="0" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></div>
          <div><label className="lbl">For one person? <span className="font-normal text-slate-400">(optional)</span></label><select className="inp" value={f.employee_id} onChange={(e) => set({ employee_id: e.target.value })}><option value="">Whole project</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
          <div className="sm:col-span-2 lg:col-span-3"><label className="lbl">Description / vendor</label><input className="inp" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Maruti Hotel, October rent" /></div>
          <div><label className="lbl">Bill <span className="font-normal text-slate-400">(optional)</span></label><label className="btn cursor-pointer w-full justify-center truncate">{bill ? bill.name : editId ? "Replace bill" : "Attach bill"}<input type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => { setBill(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label></div>
        </div>
        <div className="flex flex-wrap items-center gap-3"><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : editId ? "Save changes" : "+ Add expense"}</button><button className="btn" onClick={reset}>Cancel</button>{msg && <span className="text-sm text-slate-600">{msg}</span>}</div>
      </div>}

      <div className="flex flex-wrap items-center gap-2">
        <select className="inp !w-auto" aria-label="Filter by category" value={catF} onChange={(e) => setCatF(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="inp !w-auto" aria-label="Filter by month" value={monthF} onChange={(e) => setMonthF(e.target.value)}><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</option>)}</select>
        <span className="text-sm text-slate-500 sm:ml-auto">{shown.length} entr{shown.length === 1 ? "y" : "ies"} · <b>₹{inr(total)}</b></span>
        <button className="btn" onClick={csv} disabled={!shown.length}>⬇ CSV</button>
      </div>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full text-sm"><thead className="text-left text-slate-500 border-b"><tr><th className="py-2 pr-3">Date</th><th className="pr-3">Category</th><th className="pr-3">Description</th><th className="pr-3 text-right">Amount</th><th></th></tr></thead>
          <tbody>{shown.map((e) => (
            <tr key={e.id} className="border-b border-slate-100 align-top">
              <td className="py-2 pr-3 whitespace-nowrap">{fmt(e.expense_date)}</td><td className="pr-3 whitespace-nowrap">{catName(e.category_id)}</td>
              <td className="pr-3">{e.description || <span className="text-slate-400">—</span>}{personName(e.employee_id) && <div className="text-xs text-slate-500">for {personName(e.employee_id)}</div>}</td>
              <td className="pr-3 text-right whitespace-nowrap font-medium">₹{inr(Number(e.amount))}</td>
              <td className="py-1 whitespace-nowrap text-right">{e.bill_path && <a className="btn !py-0.5 !px-2 !text-xs" href={`/api/docs/view?path=${encodeURIComponent(e.bill_path)}`} target="_blank">Bill</a>} {e.source ? <a className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200" href={e.source === "vendor_payment" ? "/vendors" : "/transport"} title="This expense came from a payment. Void the payment to remove it.">From payment</a> : <><button className="btn !py-0.5 !px-2 !text-xs" onClick={() => edit(e)}>Edit</button> <button className="btn btn-danger !py-0.5 !px-2 !text-xs" onClick={() => del(e)} aria-label="Delete expense">✕</button></>}</td>
            </tr>))}
            {!shown.length && <tr><td colSpan={5} className="py-6 text-center text-slate-500">{expenses.length ? "Nothing matches the filters." : "No expenses recorded for this project yet."}</td></tr>}</tbody></table>
      </div>
    </div>
  );
}
