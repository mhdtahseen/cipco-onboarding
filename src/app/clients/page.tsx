"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { GSTIN_RE, stateName, type Client } from "@/lib/invoice";
import { swrDrop, swrGet, swrSet } from "@/lib/swr";

type Form = { id?: string; name: string; short_name: string; address: string; state_code: string; gstin: string; pan: string; contact_person: string; email: string; phone: string };
const BLANK: Form = { name: "", short_name: "", address: "", state_code: "27", gstin: "", pan: "", contact_person: "", email: "", phone: "" };
const nz = (s: string) => s.trim() || null;

// Admin: the parties we invoice. The legal name and GSTIN are printed on every invoice, and the client claims GST credit against them, so they must be exact.
type CSnap = { rows: Client[]; projs: { id: string; name: string; client_id: string | null }[]; nq: Record<string, number>; nw: Record<string, number> };

export default function ClientsPage() {
  const snap = swrGet<CSnap>("clients");   // last result, shown at once while a fresh one loads
  const [rows, setRows] = useState<Client[]>(snap?.rows ?? []); const [loading, setLoading] = useState(!snap); const [err, setErr] = useState(""); const [q, setQ] = useState(""); const [all, setAll] = useState(false);
  const [projs, setProjs] = useState<{ id: string; name: string; client_id: string | null }[]>(snap?.projs ?? []); const [nq, setNq] = useState<Record<string, number>>(snap?.nq ?? {}); const [nw, setNw] = useState<Record<string, number>>(snap?.nw ?? {});
  const [f, setF] = useState<Form | null>(null); const [busy, setBusy] = useState(false);
  const load = async () => {
    const sb = supabase(); const [{ data, error }, p, q, w] = await Promise.all([sb.from("clients").select("*").order("name"), sb.from("projects").select("id,name,client_id"), sb.from("quotations").select("client_id").not("client_id", "is", null), sb.from("work_orders").select("client_id")]);
    if (error) setErr(error.message + " — has the invoicing SQL migration been run?");
    const rw = (data || []) as Client[]; const pj = p.error ? [] : ((p.data || []) as any[]);   // empty until the client / project links migration has been run
    const count = (l: any[]) => l.reduce((m: Record<string, number>, x) => { m[x.client_id] = (m[x.client_id] || 0) + 1; return m; }, {}); const nq2 = count(q.data || []), nw2 = count(w.data || []);
    setRows(rw); setProjs(pj); setNq(nq2); setNw(nw2); setLoading(false);
    if (!error) swrSet("clients", { rows: rw, projs: pj, nq: nq2, nw: nw2 } satisfies CSnap);
  };
  useEffect(() => { load(); }, []);
  const shown = rows.filter((c) => (all || c.active) && (c.name + " " + (c.gstin || "") + " " + (c.short_name || "")).toLowerCase().includes(q.toLowerCase()));
  const set = (k: keyof Form, v: string) => setF((p) => {
    if (!p) return p; const n = { ...p, [k]: v };
    if (k === "gstin") { const g = v.trim().toUpperCase(); n.gstin = g; if (GSTIN_RE.test(g)) { n.state_code = g.slice(0, 2); if (!p.pan) n.pan = g.slice(2, 12); } }
    if (k === "pan") n.pan = v.toUpperCase(); return n;
  });
  async function save() {
    if (!f) return; setErr("");
    const g = f.gstin.trim().toUpperCase();
    if (!f.name.trim()) { setErr("Enter the client's legal name, exactly as on their GST registration."); return; }
    if (g && !GSTIN_RE.test(g)) { setErr("That GSTIN is not in the right format: 15 characters, like 27AAAAA0000A1Z5."); return; }
    setBusy(true);
    const row = { name: f.name.trim(), short_name: nz(f.short_name), address: nz(f.address), state_code: g ? g.slice(0, 2) : f.state_code, gstin: g || null, pan: nz(f.pan.toUpperCase()) ?? (g ? g.slice(2, 12) : null), contact_person: nz(f.contact_person), email: nz(f.email), phone: nz(f.phone) };
    const { error } = f.id ? await supabase().from("clients").update(row).eq("id", f.id) : await supabase().from("clients").insert(row);
    setBusy(false); if (error) { setErr(/clients_gstin_uq|duplicate/i.test(error.message) ? "A client with this GSTIN already exists." : error.message); return; }
    swrDrop("invoices", "quotations", "workorders", "projects");   // those lists carry the client list too
    setF(null); load();
  }
  async function toggle(c: Client) { const { error } = await supabase().from("clients").update({ active: !c.active }).eq("id", c.id); if (error) setErr(error.message); else { swrDrop("invoices", "quotations", "workorders", "projects"); load(); } }
  const field = (label: string, k: keyof Form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <div><label className="lbl">{label}</label><input className="inp" value={(f as any)?.[k] ?? ""} onChange={(e) => set(k, e.target.value)} {...props} /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold sm:mr-auto w-full sm:w-auto">Clients</h1>
        <input className="inp w-full sm:!w-64" placeholder="Search name or GSTIN…" aria-label="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show inactive</label>
        <button className="btn btn-primary" onClick={() => { setErr(""); setF({ ...BLANK }); }}>+ Add client</button></div>
      {err && <p className="warn">{err}</p>}
      {f && <section className="card space-y-3 fade-in"><h2 className="font-semibold">{f.id ? "Edit client" : "New client"}</h2>
        <div className="grid gap-3 sm:grid-cols-2">{field("Legal name *", "name", { autoFocus: true })}{field("Short name (for lists)", "short_name")}
          <div className="sm:col-span-2"><label className="lbl">Billing address</label><textarea className="inp" rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
          {field("GSTIN", "gstin", { maxLength: 15, placeholder: "27AAAAA0000A1Z5", autoCapitalize: "characters" })}{field("PAN", "pan", { maxLength: 10 })}
          {field("Contact person", "contact_person")}{field("Phone", "phone", { type: "tel" })}{field("Email", "email", { type: "email" })}</div>
        <p className="text-xs text-slate-500">State is taken from the GSTIN (currently {stateName(f.state_code)}, code {f.state_code}). A client with no GSTIN is invoiced as unregistered.</p>
        <div className="flex gap-2"><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save client"}</button><button className="btn" onClick={() => setF(null)}>Cancel</button></div></section>}
      <div className="space-y-2">
        {loading && <p className="card text-center text-sm text-slate-500">Loading…</p>}
        {!loading && !shown.length && !err && <p className="card text-center text-sm text-slate-500">{q ? "Nothing matches your search." : "No clients yet. Add the first one to start invoicing."}</p>}
        {shown.map((c) => (
          <div key={c.id} className={`card !p-3 flex flex-wrap items-center gap-x-4 gap-y-1 fade ${c.active ? "" : "opacity-60"}`}>
            <div className="min-w-0 flex-1 basis-64"><div className="font-semibold truncate">{c.name}{!c.active && <span className="ml-2 text-xs font-normal text-slate-500">inactive</span>}</div><div className="text-sm text-slate-600 truncate">{c.address || "No address"}</div></div>
            <div className="basis-full text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1 order-last">
              <span>{projs.filter((p) => p.client_id === c.id).length ? "Projects:" : "No projects linked"}</span>{projs.filter((p) => p.client_id === c.id).map((p) => <Link key={p.id} href={`/projects/${p.id}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-slate-200">{p.name}</Link>)}
              <span className="ml-auto">{nq[c.id] || 0} quotation{(nq[c.id] || 0) === 1 ? "" : "s"} · {nw[c.id] || 0} work order{(nw[c.id] || 0) === 1 ? "" : "s"}</span></div>
            <div className="text-sm w-40"><div className={c.gstin ? "tabular-nums" : "text-amber-700"}>{c.gstin || "No GSTIN"}</div><div className="text-xs text-slate-500">{stateName(c.state_code)} ({c.state_code})</div></div>
            <div className="flex gap-2"><button className="btn btn-sm" onClick={() => { setErr(""); setF({ id: c.id, name: c.name, short_name: c.short_name ?? "", address: c.address ?? "", state_code: c.state_code, gstin: c.gstin ?? "", pan: c.pan ?? "", contact_person: c.contact_person ?? "", email: c.email ?? "", phone: c.phone ?? "" }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button><button className="btn btn-sm" onClick={() => toggle(c)}>{c.active ? "Deactivate" : "Reactivate"}</button></div>
          </div>))}
      </div>
    </div>
  );
}
