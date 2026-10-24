"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { LibKind, QLib } from "@/lib/quote";

const KINDS: { key: LibKind; label: string; help: string }[] = [
  { key: "scope", label: "Scope of work", help: "Steps for a job type. Each step belongs to a job type, so you can add a whole set at once." },
  { key: "client_supply", label: "Client supplies", help: "“Client to supply the following free of cost”. Pre-ticked lines are added to every new quotation." },
  { key: "our_supply", label: "We provide", help: "“Chandrika will provide the following at the site”. Pre-ticked lines are added to every new quotation." },
  { key: "note", label: "Notes", help: "Reusable notes under the table. Use {{client}} for the client's short name." },
  { key: "payment_terms", label: "Payment terms", help: "Presets for the payment-terms row. One line per instalment." },
];

export default function QuoteLibraryPage() {
  const [kind, setKind] = useState<LibKind>("client_supply"); const [list, setList] = useState<QLib[]>([]); const [msg, setMsg] = useState(""); const [tagF, setTagF] = useState("");
  const k = KINDS.find((x) => x.key === kind)!;
  async function load() { const { data, error } = await supabase().from("quote_library").select("*").eq("kind", kind).order("tag", { nullsFirst: true }).order("sort_order"); if (error) setMsg(error.message + " — has the quotations SQL migration been run?"); setList((data || []) as QLib[]); }
  useEffect(() => { setTagF(""); load(); }, [kind]);
  const upd = (id: string, p: Partial<QLib>) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  async function save(x: QLib) { const { error } = await supabase().from("quote_library").update({ body: x.body, tag: x.tag?.trim() || null, default_on: x.default_on, active: x.active, sort_order: x.sort_order }).eq("id", x.id); setMsg(error ? error.message : "Saved ✓"); }
  async function add() { const { error } = await supabase().from("quote_library").insert({ kind, tag: kind === "scope" ? tagF || null : null, body: "New line — edit the wording", sort_order: Math.max(0, ...list.map((x) => x.sort_order)) + 10 }); if (error) setMsg(error.message); else load(); }
  async function del(x: QLib) { if (!confirm("Delete this line? Quotations already made are not affected.")) return; await supabase().from("quote_library").delete().eq("id", x.id); load(); }
  const tags = [...new Set(list.map((x) => x.tag).filter(Boolean))] as string[];
  const shown = kind === "scope" && tagF ? list.filter((x) => x.tag === tagF) : list;
  return (
    <div className="space-y-4">
      <Link href="/quotations" className="text-sm text-blue-700">← Quotations</Link>
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold sm:mr-auto w-full sm:w-auto">Quotation wording library</h1>
        <div className="flex gap-2 overflow-x-auto max-w-full">{KINDS.map((x) => <button key={x.key} className={`btn shrink-0 ${kind === x.key ? "btn-primary" : ""}`} onClick={() => setKind(x.key)}>{x.label}</button>)}</div></div>
      <p className="text-sm text-slate-500">{k.help} Editing a line here never changes quotations you've already made.</p>
      {kind === "scope" && <div className="flex flex-wrap items-center gap-2"><label className="lbl !mb-0">Job type</label><select className="inp !w-auto" value={tagF} onChange={(e) => setTagF(e.target.value)}><option value="">All</option>{tags.map((t) => <option key={t}>{t}</option>)}</select></div>}
      <button className="btn" onClick={add}>+ New line</button>{msg && <span className="ml-3 text-sm text-green-700">{msg}</span>}
      {shown.map((x) => (
        <div key={x.id} className={`card !p-3 space-y-2 ${x.active ? "" : "opacity-60"}`}>
          <textarea className="inp" rows={Math.max(2, Math.ceil(x.body.length / 100))} value={x.body} onChange={(e) => upd(x.id, { body: e.target.value })} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {kind === "scope" && <input className="inp !w-auto min-w-48" placeholder="Job type" list="lib-tags" value={x.tag ?? ""} onChange={(e) => upd(x.id, { tag: e.target.value })} />}
            <label className="flex items-center gap-1.5">Order <input className="inp !w-20" type="number" value={x.sort_order} onChange={(e) => upd(x.id, { sort_order: Number(e.target.value) })} /></label>
            {(kind === "client_supply" || kind === "our_supply" || kind === "note") && <label className="flex items-center gap-2"><input type="checkbox" checked={x.default_on} onChange={(e) => upd(x.id, { default_on: e.target.checked })} />Pre-add to new quotations</label>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={x.active} onChange={(e) => upd(x.id, { active: e.target.checked })} />Active</label>
            <button className="btn btn-primary !py-1 sm:ml-auto" onClick={() => save(x)}>Save</button><button className="btn btn-danger !py-1" onClick={() => del(x)}>Delete</button>
          </div>
        </div>))}
      <datalist id="lib-tags">{tags.map((t) => <option key={t} value={t} />)}</datalist>
      {!shown.length && <p className="card text-center text-sm text-slate-500">Nothing here yet.</p>}
    </div>
  );
}
