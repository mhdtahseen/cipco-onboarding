"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Project } from "@/lib/types";
import { MEALS, istToday, rateFor, type Meal, type MealRate, type Vendor } from "@/lib/attendance";

// Food vendors and what each meal costs. Vendors belong to a project: each project has its own vendors and prices, and a meal on the attendance sheet records which vendor the person ate with.
// A price change is saved with a date, so earlier days keep the price that applied then.
export default function VendorSettings({ projectId }: { projectId?: string } = {}) {   // with a projectId (the Meals page) the project is fixed; in Settings there is a selector
  const [vendors, setVendors] = useState<Vendor[]>([]); const [rates, setRates] = useState<MealRate[]>([]); const [inputs, setInputs] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(istToday()); const [name, setName] = useState(""); const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState(""); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };
  const key = (v: string, m: Meal) => `${v}:${m}`;
  async function load() {
    const sb = supabase(); const [v, r, pr] = await Promise.all([sb.from("food_vendors").select("*").order("sort_order"), sb.from("meal_rates").select("*"), sb.from("projects").select("*").order("name")]);
    if (v.error || r.error || pr.error) { setErr((v.error || r.error || pr.error)!.message + " — has the roles & attendance SQL migration been run?"); return; }
    const vs = (v.data || []) as Vendor[], rs = (r.data || []) as MealRate[]; setVendors(vs); setRates(rs); setErr(""); const pl = ((pr.data || []) as Project[]).sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1)); setProjects(pl); setPid((c) => projectId || c || pl[0]?.id || "");
    const t = istToday(); const inp: Record<string, string> = {}; vs.forEach((x) => MEALS.forEach((m) => { const p = rateFor(rs, x.id, m.key, t); inp[key(x.id, m.key)] = p === null ? "" : String(p); })); setInputs(inp);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (projectId) setPid(projectId); }, [projectId]);
  const taken = (e: any) => (/duplicate|unique/i.test(e.message) ? "That vendor already exists." : e.message);
  async function add() { const n = name.trim(); if (!n) return; const { error } = await supabase().from("food_vendors").insert({ project_id: pid, name: n, sort_order: Math.max(0, ...vendors.map((v) => v.sort_order)) + 10 }); if (error) { setMsg(taken(error)); return; } setName(""); note("Added ✓"); load(); }
  async function rename(v: Vendor) { const n = prompt("Rename vendor", v.name)?.trim(); if (!n || n === v.name) return; const { error } = await supabase().from("food_vendors").update({ name: n }).eq("id", v.id); if (error) { setMsg(taken(error)); return; } note("Renamed ✓"); load(); }
  async function assign(v: Vendor) { const { error } = await supabase().from("food_vendors").update({ project_id: pid }).eq("id", v.id); if (error) { setMsg(taken(error)); return; } note("Assigned ✓"); load(); }
  async function toggle(v: Vendor) { await supabase().from("food_vendors").update({ active: !v.active }).eq("id", v.id); load(); }
  async function savePrices(v: Vendor) {
    const t = istToday(); const rows = MEALS.flatMap((m) => { const raw = inputs[key(v.id, m.key)]?.trim(); if (!raw) return []; const price = Number(raw); const cur = rateFor(rates, v.id, m.key, from); return price >= 0 && price !== cur ? [{ vendor_id: v.id, meal: m.key, price, effective_from: from }] : []; });
    if (!rows.length) { note("No price changes."); return; }
    const { error } = await supabase().from("meal_rates").upsert(rows, { onConflict: "vendor_id,meal,effective_from" }); if (error) { setMsg(error.message); return; }
    note(`Saved ${rows.length} price${rows.length > 1 ? "s" : ""} from ${from} ✓`); load(); void t;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">The food vendors for a project, and the price of each meal. A meal on the attendance sheet records which vendor the person ate with, so add every place people eat (for example the accommodation mess and the site canteen) as a vendor of that project. Prices are optional — without them the attendance reports still count meals, they just can't show a cost.</p>
      {!projectId && projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => setPid(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === "closed" ? " (closed)" : ""}{p.location ? ` — ${p.location}` : ""}</option>)}</select>}
      <div className="flex flex-wrap items-center gap-2"><input className="inp !w-auto flex-1 sm:flex-none sm:!w-64" placeholder="New vendor for this project" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /><button className="btn btn-primary" onClick={add}>+ Add</button>
        <label className="flex items-center gap-2 text-sm text-slate-500 sm:ml-auto">Prices apply from<input className="inp !w-auto" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>{msg && <span className="text-sm text-green-700">{msg}</span>}</div>
      {err && <p className="warn">{err}</p>}
      {vendors.filter((v) => v.project_id === pid).map((v) => (
        <div key={v.id} className={`card !p-3 space-y-2 ${v.active ? "" : "opacity-60"}`}>
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{v.name}</span><button className="btn !py-1 sm:ml-auto" onClick={() => rename(v)}>Rename</button><button className="btn !py-1" onClick={() => toggle(v)}>{v.active ? "Hide" : "Show"}</button></div>
          <div className="flex flex-wrap items-end gap-3">{MEALS.map((m) => <div key={m.key}><label className="lbl">{m.label} (₹)</label><input className="inp !w-28" type="number" inputMode="decimal" min="0" step="0.01" value={inputs[key(v.id, m.key)] ?? ""} onChange={(e) => setInputs({ ...inputs, [key(v.id, m.key)]: e.target.value })} placeholder="not set" /></div>)}
            <button className="btn btn-primary" onClick={() => savePrices(v)}>Save prices</button></div>
        </div>))}
      {vendors.some((v) => !v.project_id) && <div className="card space-y-2 !p-3"><h3 className="font-semibold text-sm">Not assigned to a project yet</h3><p className="text-xs text-slate-500">These vendors came from before vendors were tied to projects. Assign each to the project it serves (the selected one above) to use it on the attendance sheet.</p>{vendors.filter((v) => !v.project_id).map((v) => <div key={v.id} className="flex items-center gap-2 text-sm"><span>{v.name}</span><button className="btn !py-1 ml-auto" onClick={() => assign(v)}>Assign to this project</button></div>)}</div>}
      {!vendors.some((v) => v.project_id === pid) && !err && <p className="card text-center text-sm text-slate-500">No vendors for this project yet. Add the first one above.</p>}
    </div>
  );
}
