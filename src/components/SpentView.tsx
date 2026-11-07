"use client";
import { useEffect, useMemo, useState } from "react";
import GasCostCard from "@/components/GasCostCard";
import { supabase } from "@/lib/supabase/client";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { todayISO } from "@/lib/format";
import { inr } from "@/lib/quote";
import { SOURCE_LABEL, sourceHref, sourceKind, type ExpProject, type SourceKind } from "@/lib/expensesData";
import type { ExpenseCategory, ProjectExpense } from "@/lib/types";

type Group = "date" | "category" | "project";
const SOURCES: SourceKind[] = ["typed", "payment", "bill"];
const BLANK = { expense_date: "", category_id: "", project_id: "", amount: "", description: "", employee_id: "" };
const dmy = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const dayLong = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const monthLabel = (ym: string) => new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });

// The Spent tab of Expenses: every expense across the projects, with filters, grouping, and one panel to add or edit an entry.
// Typed-in entries can be edited and deleted here; entries posted from a payment or an Inventory bill are locked and link back to where they came from.
export default function SpentView({ projects, cats, setCats, exps, reload, project, setProject, openAdd, onAddClosed }: {
  projects: ExpProject[]; cats: ExpenseCategory[]; setCats: (c: ExpenseCategory[]) => void; exps: ProjectExpense[]; reload: () => Promise<void> | void;
  project: string; setProject: (id: string) => void; openAdd: boolean; onAddClosed: () => void;
}) {
  const cur = todayISO().slice(0, 7);
  const [month, setMonth] = useState(cur); const [cat, setCat] = useState(""); const [q, setQ] = useState(""); const [group, setGroup] = useState<Group>("date");
  const [src, setSrc] = useState<Record<SourceKind, boolean>>({ typed: true, payment: true, bill: true });
  const [panel, setPanel] = useState(false); const [editId, setEditId] = useState<string | null>(null); const [f, setF] = useState({ ...BLANK, expense_date: todayISO() });
  const [bill, setBill] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [note, setNote] = useState("");
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([]); const [newCat, setNewCat] = useState<string | null>(null);

  const pName = (id: string) => projects.find((p) => p.id === id)?.name ?? "—"; const cName = (id: string) => cats.find((c) => c.id === id)?.name ?? "—";
  const set = (p: Partial<typeof BLANK>) => setF((x) => ({ ...x, ...p }));
  const months = useMemo(() => { const m = new Set(exps.map((e) => e.expense_date.slice(0, 7))); m.add(cur); return [...m].sort().reverse(); }, [exps, cur]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exps.filter((e) => (!project || e.project_id === project) && (!month || e.expense_date.startsWith(month)) && (!cat || e.category_id === cat) && src[sourceKind(e)]
      && (!needle || `${e.description} ${cName(e.category_id)} ${pName(e.project_id)}`.toLowerCase().includes(needle)));
  }, [exps, project, month, cat, src, q, cats, projects]);   // eslint-disable-line react-hooks/exhaustive-deps
  const total = shown.reduce((s, e) => s + Number(e.amount), 0);
  const by = SOURCES.map((k) => [k, shown.filter((e) => sourceKind(e) === k).reduce((s, e) => s + Number(e.amount), 0)] as const);
  const groups = useMemo(() => {
    const m = new Map<string, ProjectExpense[]>();
    shown.forEach((e) => { const k = group === "date" ? e.expense_date : group === "category" ? e.category_id : e.project_id; m.set(k, [...(m.get(k) ?? []), e]); });
    const list = [...m.entries()].map(([k, rows]) => ({ k, rows, sum: rows.reduce((s, e) => s + Number(e.amount), 0), title: group === "date" ? dayLong(k) : group === "category" ? cName(k) : pName(k) }));
    return group === "date" ? list.sort((a, b) => b.k.localeCompare(a.k)) : list.sort((a, b) => b.sum - a.sum);
  }, [shown, group, cats, projects]);   // eslint-disable-line react-hooks/exhaustive-deps

  // who the expense can be tagged to: the people on the chosen project
  useEffect(() => {
    if (!panel || !f.project_id) { setPeople([]); return; } let live = true;
    supabase().from("employees").select("id, full_name").eq("project_id", f.project_id).neq("stage", "rejected").order("full_name").then(({ data }) => { if (live) setPeople((data || []) as { id: string; full_name: string }[]); });
    return () => { live = false; };
  }, [panel, f.project_id]);

  const openNew = () => { setEditId(null); setBill(null); setMsg(""); setF({ ...BLANK, expense_date: todayISO(), project_id: project || (projects.filter((p) => p.status === "active").length === 1 ? projects.find((p) => p.status === "active")!.id : ""), category_id: f.category_id }); setPanel(true); };
  useEffect(() => { if (openAdd) { openNew(); onAddClosed(); } }, [openAdd]);   // eslint-disable-line react-hooks/exhaustive-deps
  function edit(e: ProjectExpense) { setEditId(e.id); setBill(null); setMsg(""); setF({ expense_date: e.expense_date, category_id: e.category_id, project_id: e.project_id, amount: String(e.amount), description: e.description, employee_id: e.employee_id ?? "" }); setPanel(true); }
  const close = () => { setPanel(false); setEditId(null); setBill(null); setMsg(""); setNewCat(null); };

  async function addCategory() {
    const name = (newCat ?? "").trim(); if (!name) { setNewCat(null); return; }
    const ex = cats.find((c) => c.name.toLowerCase() === name.toLowerCase()); if (ex) { set({ category_id: ex.id }); setNewCat(null); return; }
    const { data, error } = await supabase().from("expense_categories").insert({ name, sort_order: Math.max(0, ...cats.map((c) => c.sort_order)) + 10 }).select().single();
    if (error) { setMsg(error.message); return; } setCats([...cats, data as ExpenseCategory]); set({ category_id: (data as ExpenseCategory).id }); setNewCat(null);
  }
  async function save(again: boolean) {
    const amount = Number(f.amount); setMsg("");
    if (!(amount > 0)) { setMsg("Enter an amount greater than zero."); return; } if (!f.category_id) { setMsg("Choose a category."); return; }
    if (!f.project_id) { setMsg("Choose the project."); return; } if (!f.expense_date) { setMsg("Choose the date."); return; }
    setBusy(true); let bill_path: string | undefined;
    if (bill) {
      const file = await prepareUpload(bill);
      if (file.size > MAX_UPLOAD) { setMsg("The bill is larger than 5 MB — please send a smaller photo or compressed PDF."); setBusy(false); return; }
      const fd = new FormData(); fd.set("file", file); fd.set("employeeId", `proj-${f.project_id}`); fd.set("docType", "expense");
      const r = await fetch("/api/docs/upload", { method: "POST", body: fd }); if (!r.ok) { setMsg(await r.text()); setBusy(false); return; } bill_path = (await r.json()).path;
    }
    const row = { project_id: f.project_id, category_id: f.category_id, expense_date: f.expense_date, amount, description: f.description.trim(), employee_id: f.employee_id || null, ...(bill_path ? { bill_path } : {}), updated_at: new Date().toISOString() };
    const { error } = editId ? await supabase().from("project_expenses").update(row).eq("id", editId) : await supabase().from("project_expenses").insert(row);
    setBusy(false); if (error) { setMsg(error.message); return; }
    setNote(editId ? "Saved ✓" : `Added ₹${inr(amount)} to ${pName(f.project_id)} ✓`); setTimeout(() => setNote(""), 3000);
    await reload();
    if (again && !editId) { setBill(null); setF((x) => ({ ...BLANK, expense_date: x.expense_date, project_id: x.project_id, category_id: x.category_id })); } else close();
  }
  async function del(e: ProjectExpense) { if (!confirm(`Delete this ₹${inr(Number(e.amount))} ${cName(e.category_id)} expense?`)) return; await supabase().from("project_expenses").delete().eq("id", e.id); await reload(); }
  function csv() {
    const qt = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Date", "Project", "Category", "Description", "Source", "Amount"], ...shown.map((e) => [e.expense_date, pName(e.project_id), cName(e.category_id), e.description, SOURCE_LABEL[sourceKind(e)], e.amount])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(qt).join(",")).join("\n")], { type: "text/csv" })); a.download = `expenses ${month || "all"}${project ? " - " + pName(project) : ""}.csv`; a.click();
  }

  const row = (e: ProjectExpense) => { const k = sourceKind(e);
    return (
      <div key={e.id} className="grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_5rem_7rem_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2.5 border-t border-slate-100 first:border-t-0 text-sm hover:bg-slate-50">
        <div className="min-w-0"><div className="font-medium truncate">{e.description || cName(e.category_id)}</div><div className="md:hidden text-xs text-slate-500 truncate">{pName(e.project_id)} · {cName(e.category_id)} · {dmy(e.expense_date)}</div></div>
        <div className="hidden md:block text-slate-500 truncate">{pName(e.project_id)}</div><div className="hidden md:block text-slate-500 truncate">{cName(e.category_id)}</div><div className="hidden md:block text-slate-500 tabular-nums">{dmy(e.expense_date)}</div>
        <div className="text-right font-semibold tabular-nums">₹{inr(Number(e.amount))}</div>
        <div className="col-span-2 md:col-span-1 flex items-center justify-end gap-1.5 whitespace-nowrap">
          {e.bill_path && <a className="btn btn-sm" href={`/api/docs/view?path=${encodeURIComponent(e.bill_path)}`} target="_blank">Bill</a>}
          {k === "typed" ? <><button className="btn btn-sm" onClick={() => edit(e)}>Edit</button><button className="btn btn-sm btn-danger" onClick={() => del(e)} aria-label="Delete expense">✕</button></>
            : <a className="pill hover:opacity-80" href={sourceHref(e)} title={k === "bill" ? "This expense came from a bill in Inventory. Reopen or void the bill to change it." : "This expense came from a payment. Void the payment to remove it."}>🔒 {SOURCE_LABEL[k]}</a>}
        </div>
      </div>); };

  return (
    <div className="space-y-3">
      {project && <GasCostCard projectId={project} />}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <select className="inp" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        <select className="inp" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="inp col-span-2" type="search" aria-label="Search expenses" placeholder="Search description, category or project" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {SOURCES.map((k) => <button key={k} type="button" aria-pressed={src[k]} className={`chip ${src[k] ? "chip-on" : ""}`} onClick={() => setSrc((s) => ({ ...s, [k]: !s[k] }))}>{k !== "typed" && "🔒 "}{SOURCE_LABEL[k]}</button>)}
        <span className="flex-1" />
        <div role="group" aria-label="Group by" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">{([["date", "Date"], ["category", "Category"], ["project", "Project"]] as [Group, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={group === k} onClick={() => setGroup(k)} className={`px-3 min-h-9 rounded-md ${group === k ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-500"}`}>{l}</button>)}</div>
        <button className="btn" onClick={csv} disabled={!shown.length}>⬇ CSV</button>
      </div>
      {note && <p role="status" className="text-sm text-emerald-700">{note}</p>}

      {!shown.length ? <div className="card text-center text-sm text-slate-500">{exps.length ? "No expenses match these filters." : "No expenses recorded yet."}</div> : groups.map((g) => (
        <section key={g.k}>
          <div className="flex items-baseline justify-between px-1 py-1.5"><h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.title}</h3><span className="text-xs text-slate-500 tabular-nums">₹{inr(g.sum)}</span></div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">{g.rows.map(row)}</div>
        </section>))}

      {shown.length > 0 && <div className="rounded-xl bg-slate-100 px-4 py-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
        <span><b className="text-base tabular-nums">₹{inr(total)}</b> across {shown.length} entr{shown.length === 1 ? "y" : "ies"}</span>
        <span className="text-xs text-slate-500 tabular-nums">{by.map(([k, v]) => `${SOURCE_LABEL[k]} ₹${inr(v)}`).join(" + ")} = ₹{inr(total)}</span></div>}

      <div className="md:hidden fixed right-4 z-30 bottom-[calc(var(--bottom-nav-h,0px)+1rem)]"><button className="btn btn-primary shadow-lg" onClick={openNew}>+ Add expense</button></div>

      {panel && <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end" role="dialog" aria-modal="true" aria-label={editId ? "Edit expense" : "Add expense"}>
        <div className="absolute inset-0 bg-slate-900/40" onClick={close} />
        <div className="relative w-full md:w-[26rem] max-h-[92vh] md:max-h-none flex flex-col bg-white rounded-t-2xl md:rounded-none shadow-xl pt-[env(safe-area-inset-top)] md:pt-0 fade-in">
          <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 shrink-0"><h2 className="font-semibold">{editId ? "Edit expense" : "Add expense"}</h2><button className="btn btn-sm" onClick={close} aria-label="Close">✕</button></div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div><label className="lbl" htmlFor="sp-amt">Amount (₹)</label><input id="sp-amt" autoFocus className="inp !text-2xl !font-semibold tabular-nums" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></div>
            <div><span className="lbl">Category</span><div className="flex flex-wrap gap-1.5">{cats.filter((c) => c.active || c.id === f.category_id).map((c) => <button key={c.id} type="button" aria-pressed={f.category_id === c.id} className={`chip ${f.category_id === c.id ? "chip-on" : ""}`} onClick={() => set({ category_id: c.id })}>{c.name}</button>)}
              {newCat === null ? <button type="button" className="chip" onClick={() => setNewCat("")}>+ New</button> : <span className="flex gap-1"><input className="inp !w-40 !py-1" autoFocus placeholder="Category name" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCategory()} /><button type="button" className="btn btn-sm" onClick={addCategory}>Add</button></span>}</div></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="lbl" htmlFor="sp-proj">Project</label><select id="sp-proj" className="inp" value={f.project_id} onChange={(e) => set({ project_id: e.target.value, employee_id: "" })}><option value="">Choose…</option>{projects.filter((p) => p.status === "active" || p.id === f.project_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><label className="lbl" htmlFor="sp-date">Date</label><input id="sp-date" className="inp" type="date" value={f.expense_date} onChange={(e) => set({ expense_date: e.target.value })} /></div></div>
            <div><label className="lbl" htmlFor="sp-desc">What was it for</label><input id="sp-desc" className="inp" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Binding wire, 40 kg" /></div>
            <div><label className="lbl" htmlFor="sp-emp">For one person? <span className="font-normal text-slate-400">(optional)</span></label><select id="sp-emp" className="inp" value={f.employee_id} onChange={(e) => set({ employee_id: e.target.value })}><option value="">Whole project</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
            <div><span className="lbl">Bill <span className="font-normal text-slate-400">(optional)</span></span><label className="btn cursor-pointer w-full justify-center truncate">{bill ? bill.name : editId ? "Replace bill" : "📷 Attach bill"}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setBill(e.target.files?.[0] ?? null)} /></label></div>
            {msg && <p className="warn" role="alert">{msg}</p>}
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-slate-100 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button className="btn btn-primary" disabled={busy} onClick={() => save(false)}>{busy ? "Saving…" : editId ? "Save changes" : "Save"}</button>
            {!editId && <button className="btn" disabled={busy} onClick={() => save(true)}>Save and add another</button>}
          </div>
        </div>
      </div>}
    </div>
  );
}
