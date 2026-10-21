"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Clause } from "@/lib/types";

const csv = (a?: string[]) => (a || []).join(", ");
const arr = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function ClausePage() {
  const [kind, setKind] = useState<"offer" | "appointment">("offer"); const [list, setList] = useState<Clause[]>([]); const [open, setOpen] = useState<string | null>(null); const [msg, setMsg] = useState("");
  async function load() { const { data } = await supabase().from("clauses").select("*").eq("letter_type", kind).order("sort_order"); setList((data || []) as Clause[]); }
  useEffect(() => { load(); }, [kind]);
  const upd = (id: string, p: Partial<Clause>) => setList((l) => l.map((c) => (c.id === id ? { ...c, ...p } : c)));
  async function save(c: Clause) {
    const { error } = await supabase().from("clauses").update({ title: c.title, body: c.body, is_core: c.is_core, default_on: c.default_on, active: c.active, sort_order: c.sort_order, rules: c.rules || {} }).eq("id", c.id);
    setMsg(error ? error.message : `Saved “${c.title}”`);
  }
  async function add() {
    const key = "custom_" + Date.now().toString(36);
    const { data, error } = await supabase().from("clauses").insert({ letter_type: kind, key, title: "New clause", body: "Write the clause wording here. Use {{designation}}, {{site_location}}, {{join_date}} etc.", sort_order: (list.at(-1)?.sort_order || 0) + 10 }).select().single();
    if (error) setMsg(error.message); else { await load(); setOpen((data as Clause).id); }
  }
  async function del(c: Clause) { if (!confirm(`Delete “${c.title}”? Letters already issued are not affected.`)) return; await supabase().from("clauses").delete().eq("id", c.id); await load(); }
  const rule = (c: Clause, k: "designations" | "departments" | "projects" | "employment_types", label: string) => (
    <div><label className="lbl">{label}</label><input className="inp" placeholder="comma separated, e.g. engineer, supervisor" value={csv(c.rules?.[k])} onChange={(e) => upd(c.id, { rules: { ...(c.rules || {}), [k]: arr(e.target.value) } })} /></div>);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><h1 className="text-xl font-bold mr-auto">Clause library</h1>
        {(["offer", "appointment"] as const).map((k) => <button key={k} className={`btn ${kind === k ? "btn-primary" : ""}`} onClick={() => setKind(k)}>{k === "offer" ? "Offer letter" : "Appointment letter"}</button>)}
        <button className="btn" onClick={add}>+ New clause</button></div>
      <p className="text-sm text-slate-500">Each clause is a section of the letter. <b>Rules</b> pre-tick a clause when the employee’s designation / department / project / type contains any listed word (all filled-in rule boxes must match). Empty rules = never auto-ticked unless “pre-ticked” is on. Formatting: <code>- </code> makes a bullet, <code>**bold**</code> makes bold, <code>{"{{placeholders}}"}</code> pull from the employee record.</p>
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {list.map((c) => (
        <div key={c.id} className={`card ${c.active ? "" : "opacity-60"}`}>
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <span className="text-xs text-slate-400 w-8">{c.sort_order}</span><span className="font-medium">{c.title}</span>
            {c.is_core && <span className="text-xs bg-blue-50 text-blue-700 rounded px-2">core</span>}{c.default_on && !c.is_core && <span className="text-xs bg-green-50 text-green-700 rounded px-2">pre-ticked</span>}
            <span className="ml-auto text-xs text-slate-400">{open === c.id ? "close" : "edit"}</span>
          </div>
          {open === c.id && (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_100px]"><div><label className="lbl">Heading</label><input className="inp" value={c.title} onChange={(e) => upd(c.id, { title: e.target.value })} /></div>
                <div><label className="lbl">Order</label><input className="inp" type="number" value={c.sort_order} onChange={(e) => upd(c.id, { sort_order: Number(e.target.value) })} /></div></div>
              <div><label className="lbl">Wording</label><textarea className="inp font-mono text-xs" rows={7} value={c.body} onChange={(e) => upd(c.id, { body: e.target.value })} /></div>
              <div className="flex flex-wrap gap-5 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={c.is_core} onChange={(e) => upd(c.id, { is_core: e.target.checked })} /> Core (always included)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={c.default_on} onChange={(e) => upd(c.id, { default_on: e.target.checked })} /> Pre-ticked for everyone</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={c.active} onChange={(e) => upd(c.id, { active: e.target.checked })} /> Active</label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">{rule(c, "designations", "Pre-tick when designation contains")}{rule(c, "departments", "…department contains")}{rule(c, "projects", "…project contains")}{rule(c, "employment_types", "…employment type contains")}</div>
              <div className="flex gap-2"><button className="btn btn-primary" onClick={() => save(c)}>Save clause</button><button className="btn btn-danger" onClick={() => del(c)}>Delete</button></div>
            </div>)}
        </div>))}
    </div>
  );
}
