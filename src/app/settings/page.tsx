"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Row = { id: string; name: string; active: boolean };
type Kind = { key: "departments" | "expense_categories" | "document_types"; tab: string; help: string; table: string; noun: string; sorted: boolean };
const KINDS: Kind[] = [
  { key: "departments", tab: "Departments", table: "departments", noun: "department", sorted: false, help: "The department dropdown on employees uses this list, so spellings stay uniform. Renaming updates everyone in that department. Hidden departments leave the dropdown but stay on people who have them." },
  { key: "expense_categories", tab: "Expense categories", table: "expense_categories", noun: "category", sorted: true, help: "Used when recording project expenses. Renaming changes it everywhere; hidden categories leave the dropdown but keep their past entries." },
  { key: "document_types", tab: "Document types", table: "document_types", noun: "type", sorted: true, help: "Used when filing documents on a project (letters, JSAs, POs…). Renaming changes it everywhere; hidden types leave the dropdown but keep their documents." },
];

// Dropdown lists used around the app, managed in one place.
export default function SettingsPage() {
  const [tab, setTab] = useState<Kind["key"]>("departments"); const k = KINDS.find((x) => x.key === tab)!;
  const [rows, setRows] = useState<(Row & { sort_order?: number })[]>([]); const [counts, setCounts] = useState<Record<string, number>>({}); const [name, setName] = useState(""); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  async function load() {
    setErr(""); const sb = supabase();
    const { data, error } = await sb.from(k.table).select("*").order(k.sorted ? "sort_order" : "name");
    if (error) { setErr(error.message + " — has the matching SQL migration been run?"); setRows([]); return; }
    setRows((data || []) as Row[]);
    if (tab === "departments") { const { data: e } = await sb.from("employees").select("department"); const c: Record<string, number> = {}; (e || []).forEach((r: any) => { if (r.department) c[r.department.toLowerCase()] = (c[r.department.toLowerCase()] || 0) + 1; }); setCounts(c); } else setCounts({});
  }
  useEffect(() => { setName(""); setMsg(""); load(); }, [tab]);

  const taken = (e: any) => /duplicate|unique/i.test(e.message) ? `That ${k.noun} already exists.` : e.message;
  async function add() {
    const n = name.trim(); if (!n) return;
    const { error } = await supabase().from(k.table).insert({ name: n, ...(k.sorted ? { sort_order: Math.max(0, ...rows.map((r) => r.sort_order ?? 0)) + 10 } : {}) });
    if (error) { setMsg(taken(error)); return; } setName(""); note("Added ✓"); load();
  }
  async function rename(r: Row) {
    const n = prompt(`Rename ${k.noun}`, r.name)?.trim(); if (!n || n === r.name) return;
    const { error } = await supabase().from(k.table).update({ name: n }).eq("id", r.id);
    if (error) { setMsg(taken(error)); return; }
    if (tab === "departments") await supabase().from("employees").update({ department: n }).eq("department", r.name);   // keep people's department in step with the rename
    note("Renamed ✓"); load();
  }
  async function toggle(r: Row) { await supabase().from(k.table).update({ active: !r.active }).eq("id", r.id); load(); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold">Settings</h1>{msg && <span className="text-sm text-green-700">{msg}</span>}</div>
      <p className="text-sm text-slate-500">The lists behind the dropdowns. You can also add an item on the spot from any dropdown with “+ Add new…”.</p>
      <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">{KINDS.map((x) => <button key={x.key} role="tab" aria-selected={tab === x.key} className={`tab ${tab === x.key ? "tab-on" : ""}`} onClick={() => setTab(x.key)}>{x.tab}</button>)}</div>
      <p className="text-sm text-slate-500">{k.help}</p>
      <div className="flex gap-2"><input className="inp !w-auto flex-1 sm:flex-none sm:!w-72" placeholder={`New ${k.noun}`} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /><button className="btn btn-primary" onClick={add}>+ Add</button></div>
      {err && <p className="warn">{err}</p>}
      <div className="card !p-0 divide-y divide-slate-100">
        {rows.map((r) => <div key={r.id} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${r.active ? "" : "opacity-60"}`}><span className="font-medium">{r.name}</span>{tab === "departments" && <span className="text-xs text-slate-400">{counts[r.name.toLowerCase()] || 0} people</span>}<button className="btn !py-1 sm:ml-auto" onClick={() => rename(r)}>Rename</button><button className="btn !py-1" onClick={() => toggle(r)}>{r.active ? "Hide" : "Show"}</button></div>)}
        {!rows.length && !err && <p className="p-4 text-center text-sm text-slate-500">Nothing here yet.</p>}
      </div>
    </div>
  );
}
