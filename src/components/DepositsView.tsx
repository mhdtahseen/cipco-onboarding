"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { todayISO } from "@/lib/format";
import { inr } from "@/lib/quote";
import { depositState, type RentalTerms } from "@/lib/rentals";
import type { ExpProject } from "@/lib/expensesData";

// The Deposits tab of Expenses (Operations and Admin): money handed over that is meant to come back. A deposit is held money, not an expense, so it never
// counts in Spent while it is held; only what the holder KEEPS is a cost, and that is posted to Spent automatically (Deposits kept back).
// Three kinds sit here: deposits typed in (water, electricity, anything), a rented item's deposit (Site supplies → Rented), and a gas cylinder deposit (Site supplies → Gas).
type Manual = { id: string; project_id: string; holder: string; purpose: string; amount: number; paid_on: string; reference: string; refunded_amount: number; refunded_on: string | null; kept_amount: number; kept_note: string; note: string; voided_at: string | null };
type Row = { key: string; kind: "manual" | "rental" | "gas"; project_id: string; holder: string; purpose: string; paid: number; refunded: number; kept: number; held: number; on: string; note: string; m?: Manual };
const num = (v: string) => v.replace(/[^\d.]/g, "");
const dmy = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const KIND = { manual: "Typed in", rental: "Rented item", gas: "Gas cylinders" } as const;

export default function DepositsView({ projects, project, onChanged }: { projects: ExpProject[]; project: string; onChanged: () => void }) {
  const today = todayISO(); const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [add, setAdd] = useState(false); const [f, setF] = useState({ project_id: "", holder: "", purpose: "", amount: "", paid_on: today, reference: "", note: "" });
  const [sf, setSf] = useState<{ id: string; refunded: string; kept: string; on: string; note: string } | null>(null); const [busy, setBusy] = useState(false); const [showVoid, setShowVoid] = useState(false);
  const pName = (id: string) => projects.find((p) => p.id === id)?.name ?? "—";
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(async () => {
    const sb = supabase(); const out: Row[] = [];
    const [d, rt, rs, vs, gd] = await Promise.all([
      sb.from("deposits").select("*").order("paid_on", { ascending: false }),
      sb.from("rental_terms").select("*"), sb.from("rentals").select("id, project_id, vendor_id, delivered_on, returned_on, voided_at"),
      sb.from("gas_vendors").select("id, name"), sb.from("gas_deposits").select("vendor_id, project_id, kind, amount, on_date, voided_at"),
    ]);
    if (d.error) { setErr(/deposits|schema cache|does not exist/i.test(d.error.message) ? "Deposits need the 2026-11-deposits.sql migration to be run first." : d.error.message); setLoading(false); return; }
    const vn = (id: string) => ((vs.data || []) as { id: string; name: string }[]).find((v) => v.id === id)?.name ?? "Vendor";
    ((d.data || []) as Manual[]).forEach((x) => { const m = { ...x, amount: Number(x.amount), refunded_amount: Number(x.refunded_amount), kept_amount: Number(x.kept_amount) };
      out.push({ key: "m" + m.id, kind: "manual", project_id: m.project_id, holder: m.holder, purpose: m.purpose, paid: m.amount, refunded: m.refunded_amount, kept: m.kept_amount, held: m.voided_at ? 0 : m.amount - m.refunded_amount - m.kept_amount, on: m.paid_on, note: m.note, m }); });
    const rentals = (rs.data || []) as { id: string; project_id: string; vendor_id: string; delivered_on: string; returned_on: string | null; voided_at: string | null }[];
    ((rt.data || []) as RentalTerms[]).forEach((t0) => { const r = rentals.find((x) => x.id === t0.rental_id); if (!r || r.voided_at) return;
      const t = { ...t0, deposit: Number(t0.deposit), deduction: Number(t0.deduction), refund_amount: t0.refund_amount === null ? null : Number(t0.refund_amount) }; const s = depositState(r as never, t); if (!s.paid) return;
      out.push({ key: "r" + r.id, kind: "rental", project_id: r.project_id, holder: vn(r.vendor_id), purpose: "Rented items" + (r.returned_on ? ", returned " + dmy(r.returned_on) : ""), paid: s.paid, refunded: s.refunded, kept: t.deduction, held: s.held, on: t.deposit_paid_on ?? r.delivered_on, note: "" }); });
    const g = new Map<string, { vendor_id: string; project_id: string; paid: number; back: number; on: string }>();
    ((gd.data || []) as { vendor_id: string; project_id: string; kind: string; amount: number; on_date: string; voided_at: string | null }[]).filter((x) => !x.voided_at).forEach((x) => { const k = x.project_id + "|" + x.vendor_id; const e = g.get(k) ?? { vendor_id: x.vendor_id, project_id: x.project_id, paid: 0, back: 0, on: x.on_date };
      if (x.kind === "paid") e.paid += Number(x.amount); else e.back += Number(x.amount); if (x.on_date < e.on) e.on = x.on_date; g.set(k, e); });
    g.forEach((e, k) => out.push({ key: "g" + k, kind: "gas", project_id: e.project_id, holder: vn(e.vendor_id), purpose: "Cylinder deposits", paid: e.paid, refunded: e.back, kept: 0, held: e.paid - e.back, on: e.on, note: "" }));
    setRows(out.sort((a, b) => b.on.localeCompare(a.on))); setErr(""); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => rows.filter((r) => (!project || r.project_id === project) && (showVoid || !r.m?.voided_at)), [rows, project, showVoid]);
  const live = shown.filter((r) => !r.m?.voided_at); const sum = (k: "paid" | "refunded" | "kept" | "held") => live.reduce((s, r) => s + r[k], 0);

  const openAdd = () => { setErr(""); setF({ project_id: project || (projects.filter((p) => p.status === "active").length === 1 ? projects.find((p) => p.status === "active")!.id : ""), holder: "", purpose: "", amount: "", paid_on: today, reference: "", note: "" }); setAdd(true); };
  async function save() {
    const a = parseFloat(f.amount); if (!f.project_id || !f.holder.trim() || !(a > 0)) { setErr("Choose the project, say who holds the deposit and enter the amount."); return; }
    setBusy(true); setErr(""); const { error } = await supabase().from("deposits").insert({ project_id: f.project_id, holder: f.holder.trim(), purpose: f.purpose.trim(), amount: a, paid_on: f.paid_on, reference: f.reference.trim(), note: f.note.trim() });
    setBusy(false); if (error) { setErr(error.message); return; } setAdd(false); note("Deposit saved ✓ It is held, not an expense."); await load();
  }
  async function settle() {
    if (!sf) return; const m = rows.find((r) => r.m?.id === sf.id)?.m; if (!m) return; const re = parseFloat(sf.refunded) || 0, ke = parseFloat(sf.kept) || 0;
    if (re + ke > m.amount) { setErr(`Refunded and kept back together cannot be more than the ₹${inr(m.amount)} paid.`); return; }
    setBusy(true); setErr(""); const { error } = await supabase().from("deposits").update({ refunded_amount: re, kept_amount: ke, refunded_on: re > 0 || ke > 0 ? sf.on || today : null, kept_note: sf.note.trim(), updated_at: new Date().toISOString() }).eq("id", sf.id);
    setBusy(false); if (error) { setErr(error.message); return; } setSf(null); note(ke > 0 ? `Saved ✓ ₹${inr(ke)} kept back is now in Spent as a cost.` : "Saved ✓"); await load(); onChanged();
  }
  async function voidIt(id: string) {
    if (!confirm("Void this deposit? It stays in the list, marked void, and any kept-back cost is taken out of Spent.")) return;
    const { error } = await supabase().from("deposits").update({ voided_at: new Date().toISOString() }).eq("id", id); if (error) { setErr(error.message); return; } note("Voided ✓"); await load(); onChanged();
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><p className="text-sm text-slate-500 flex-1 min-w-[14rem]">Money handed over that should come back. It is not an expense while it is held; only what the holder keeps becomes a cost.</p>
        <label className="text-xs text-slate-500 flex items-center gap-1"><input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} />Show void</label>
        <button className="btn btn-primary" onClick={openAdd}>+ Add deposit</button></div>
      {err && <p className="warn" role="alert">{err}</p>}{msg && <p className="text-sm text-green-700" role="status">{msg}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{([["Held now", sum("held"), "to get back"], ["Paid in total", sum("paid"), "all deposits"], ["Refunded", sum("refunded"), "came back"], ["Kept back", sum("kept"), "a real cost, in Spent"]] as [string, number, string][]).map(([l, v, s]) =>
        <div key={l} className="card !p-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l}</div><div className="text-xl font-semibold tabular-nums">₹{inr(v)}</div><div className="text-xs text-slate-400">{s}</div></div>)}</div>

      {add && <div className="card !p-3 space-y-2"><div className="font-medium text-sm">Add a deposit</div>
        <p className="text-xs text-slate-500">For anything handed over to be returned: a water connection, an electricity meter, a gate pass. Rented items and gas cylinders have their deposit in Site supplies and show here by themselves.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className="lbl">Project</label><select className="inp !w-44" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">Choose…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label className="lbl">Who holds it</label><input className="inp !w-48" placeholder="e.g. Mundra water supply" value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} /></div>
          <div><label className="lbl">What for</label><input className="inp !w-52" placeholder="e.g. Water connection deposit" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></div>
          <div><label className="lbl">Amount (₹)</label><input className="inp !w-28" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: num(e.target.value) })} /></div>
          <div><label className="lbl">Paid on</label><input type="date" className="inp" max={today} value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></div>
          <div><label className="lbl">Receipt / reference</label><input className="inp !w-36" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div></div>
        <div><label className="lbl">Note (optional)</label><input className="inp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <div className="flex gap-2"><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save deposit"}</button><button className="btn" onClick={() => setAdd(false)}>Cancel</button></div>
        <p className="text-xs text-slate-400">The monthly bills for the same service are not deposits: they are recorded as expenses on the Spent tab.</p></div>}

      {!shown.length ? <p className="card !p-4 text-sm text-slate-500">No deposits yet{project ? " for this project" : ""}. Use “Add deposit” for a water or electricity deposit, for example.</p> :
        <ul className="space-y-2">{shown.map((r) => { const m = r.m, voided = !!m?.voided_at; return (
          <li key={r.key} className={`card !p-3 space-y-2 ${voided ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center gap-2"><b className={voided ? "line-through" : ""}>{r.holder}</b><span className="text-sm text-slate-600">{r.purpose}</span>
              <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{KIND[r.kind]}</span>{voided && <span className="text-[11px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">void</span>}
              <span className="text-xs text-slate-500 sm:ml-auto">{pName(r.project_id)} · paid {dmy(r.on)}{m?.reference ? ` · ${m.reference}` : ""}</span></div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm"><span>Paid <b>₹{inr(r.paid)}</b></span><span>Refunded <b>₹{inr(r.refunded)}</b></span>{r.kept > 0 && <span className="text-rose-700">Kept back <b>₹{inr(r.kept)}</b></span>}<span className={r.held > 0 && !voided ? "text-amber-700" : "text-slate-500"}>Held <b>₹{inr(r.held)}</b></span></div>
            {r.note && <p className="text-xs text-slate-500">{r.note}</p>}
            {m && !voided && (sf?.id === m.id ? <div className="rounded-lg bg-slate-50 p-2 space-y-2"><div className="flex flex-wrap items-end gap-2">
                <div><label className="lbl">Refunded (₹)</label><input className="inp !w-28" inputMode="decimal" value={sf.refunded} onChange={(e) => setSf({ ...sf, refunded: num(e.target.value) })} /></div>
                <div><label className="lbl">Kept back (₹)</label><input className="inp !w-28" inputMode="decimal" value={sf.kept} onChange={(e) => setSf({ ...sf, kept: num(e.target.value) })} /></div>
                <div><label className="lbl">On</label><input type="date" className="inp" max={today} value={sf.on} onChange={(e) => setSf({ ...sf, on: e.target.value })} /></div>
                <div><label className="lbl">Why it was kept (optional)</label><input className="inp !w-56" value={sf.note} onChange={(e) => setSf({ ...sf, note: e.target.value })} /></div></div>
                <div className="flex gap-2"><button className="btn btn-primary btn-sm" disabled={busy} onClick={settle}>{busy ? "Saving…" : "Save"}</button><button className="btn btn-sm" onClick={() => setSf(null)}>Cancel</button></div>
                <p className="text-xs text-slate-400">Enter the totals so far. What is kept back is posted to Spent as a cost; the rest stays held until it is refunded.</p></div>
              : <div className="flex gap-3 text-sm"><button className="tlink" onClick={() => { setErr(""); setSf({ id: m.id, refunded: m.refunded_amount ? String(m.refunded_amount) : "", kept: m.kept_amount ? String(m.kept_amount) : "", on: m.refunded_on ?? today, note: m.kept_note }); }}>Record refund / kept back</button>
                <button className="text-rose-700 hover:underline" onClick={() => voidIt(m.id)}>Void</button></div>)}
            {r.kind !== "manual" && <a className="tlink text-sm" href="/site-supplies">{r.kind === "rental" ? "Change it under Site supplies → Rented" : "Change it under Site supplies → Gas"}</a>}
          </li>); })}</ul>}
    </div>
  );
}
