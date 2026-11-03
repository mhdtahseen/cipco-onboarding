"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { useRole } from "@/lib/roles";
import { keepProject, rememberedProject } from "@/lib/lastProject";
import { chargeFor, dayCharge, hoursText, minutesOf, rateOn, type EqLog, type EqRate } from "@/lib/equipment";
import PayeeBank from "@/components/PayeeBank";
import SiteBills, { type Computed } from "@/components/SiteBills";

type Project = { id: string; name: string; location?: string | null };
type Vendor = { id: string; name: string; contact: string; phone: string; gstin: string; active: boolean; kind?: string };
type Item = { id: string; vendor_id: string; name: string; type: string; identifier: string; active: boolean };
type Log = EqLog & { id: string; project_id: string; vendor_id: string; breakdown: boolean; note: string; entered_by: string | null; entered_role: string | null; verified_by: string | null; created_at: string };
type Tab = "today" | "log" | "setup" | "bills";
const TYPE: Record<string, string> = { crane: "Crane", manlift: "Manlift", truck: "Truck", other: "Other" };
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const tm = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const istDate = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();

// Hired equipment (cranes, manlifts, trucks) on a project: the Supervisor taps Start and Stop (or adds a stretch afterwards), the Site Engineer verifies the hours,
// and Operations / Admin compare them with the vendor's bill. A booking is not needed: a machine called at short notice is simply logged.
// Supervisors and Site Engineers never see a rate; the rates are in tables only Operations and Admin can read.
export default function Equipment() {
  const { role, money, admin, userId } = useRole(); const today = istToday(); const canVerify = role === "site_engineer" || money;
  const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState(""); const [vendors, setVendors] = useState<Vendor[]>([]); const [items, setItems] = useState<Item[]>([]); const [links, setLinks] = useState<{ project_id: string; vendor_id: string }[]>([]);
  const [logs, setLogs] = useState<Log[]>([]); const [rates, setRates] = useState<(EqRate & { id: string })[]>([]); const [names, setNames] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("today"); const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false); const [now, setNow] = useState(Date.now()); const [month, setMonth] = useState(today.slice(0, 7));
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  async function load() {
    if (!role) return; const sb = supabase();
    const [pr, v, i, l] = await Promise.all([sb.from("projects").select("id, name, location").eq("status", "active").order("name"), sb.from("gas_vendors").select("*").order("name"), sb.from("equipment_items").select("*").order("name"), sb.from("gas_project_vendors").select("*")]);
    const x = pr.error || v.error || i.error || l.error; if (x) { setErr(x.message + (/equipment_|kind|schema cache|does not exist/i.test(x.message) ? ": the 2026-11-consumables.sql migration has not been run yet." : "")); setLoading(false); return; }
    const pl = (pr.data || []) as Project[]; setProjects(pl); setPid((c) => c || rememberedProject(pl) || pl[0]?.id || ""); setVendors(((v.data || []) as Vendor[]).filter((q) => q.kind === "equipment")); setItems((i.data || []) as Item[]); setLinks((l.data || []) as { project_id: string; vendor_id: string }[]);
    const { data: pf } = await sb.from("user_profiles").select("user_id, full_name"); setNames(Object.fromEntries(((pf || []) as { user_id: string; full_name: string }[]).map((r) => [r.user_id, r.full_name])));
    if (money) { const { data } = await sb.from("equipment_rates").select("*").order("valid_from", { ascending: false }); setRates(((data || []) as any[]).map((q) => ({ ...q, rate: Number(q.rate), min_hours: Number(q.min_hours), overtime_after_hours: q.overtime_after_hours === null ? null : Number(q.overtime_after_hours), overtime_rate: q.overtime_rate === null ? null : Number(q.overtime_rate), gst_pct: Number(q.gst_pct) }))); }
    setErr(""); setLoading(false);
  }
  useEffect(() => { load(); }, [role]);
  async function loadLogs() {
    if (!pid) return; const sb = supabase(); const all: Log[] = [];
    for (let from = 0; from < 5000; from += 1000) { const { data, error } = await sb.from("equipment_logs").select("*").eq("project_id", pid).order("start_at", { ascending: false }).range(from, from + 999); if (error) { setErr(error.message); return; } all.push(...((data || []) as Log[])); if (!data || data.length < 1000) break; }
    setLogs(all);
  }
  useEffect(() => { loadLogs(); }, [pid]);

  const who = (id: string | null) => (id && names[id]) || (id === userId ? "you" : "someone");
  const linkedVendors = useMemo(() => { const ids = new Set(links.filter((l) => l.project_id === pid).map((l) => l.vendor_id)); return vendors.filter((v) => ids.has(v.id)); }, [vendors, links, pid]);
  const projItems = useMemo(() => items.filter((i) => linkedVendors.some((v) => v.id === i.vendor_id) && (i.active || logs.some((l) => l.item_id === i.id && !l.end_at && !l.voided_at))), [items, linkedVendors, logs]);
  const item = (id: string) => items.find((i) => i.id === id); const iLabel = (id: string) => { const i = item(id); return i ? `${i.name}${i.identifier ? ` · ${i.identifier}` : ""}` : "?"; }; const vName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "?";
  const running = (itemId: string) => logs.find((l) => l.item_id === itemId && !l.end_at && !l.voided_at);
  const dayMinutes = (itemId: string, date: string) => logs.filter((l) => l.item_id === itemId && l.work_date === date && !l.voided_at).reduce((s, l) => s + minutesOf(l, now), 0);

  async function start(i: Item) { setErr(""); setBusy(true); const { error } = await supabase().from("equipment_logs").insert({ project_id: pid, item_id: i.id, start_at: new Date().toISOString() }); setBusy(false); if (error) { setErr(/one_running|duplicate key/i.test(error.message) ? `${i.name} is already running.` : error.message); loadLogs(); return; } note(`${i.name} started ✓`); loadLogs(); }
  async function stop(l: Log) { setErr(""); setBusy(true); const { error } = await supabase().from("equipment_logs").update({ end_at: new Date().toISOString() }).eq("id", l.id); setBusy(false); if (error) { setErr(error.message); return; } note(`${iLabel(l.item_id)} stopped ✓`); loadLogs(); }
  async function verify(l: Log) { const { error } = await supabase().from("equipment_logs").update({ verified_at: new Date().toISOString() }).eq("id", l.id); if (error) { setErr(error.message); return; } note("Verified ✓"); loadLogs(); }
  async function voidLog(l: Log) { if (!confirm(`Void this entry for ${iLabel(l.item_id)} (${tm(l.start_at)}${l.end_at ? `–${tm(l.end_at)}` : ""})? It stays in the list, marked void.`)) return; const { error } = await supabase().from("equipment_logs").update({ voided_at: new Date().toISOString() }).eq("id", l.id); if (error) { setErr(error.message); return; } note("Voided ✓"); loadLogs(); }

  // a stretch entered afterwards, or a correction of one
  const [mf, setMf] = useState<{ id: string | null; item_id: string; date: string; from: string; to: string; breakdown: boolean; note: string } | null>(null);
  const openManual = (l?: Log) => { setErr(""); setMf(l ? { id: l.id, item_id: l.item_id, date: l.work_date, from: hhmm(l.start_at), to: l.end_at ? hhmm(l.end_at) : "", breakdown: l.breakdown, note: l.note } : { id: null, item_id: projItems[0]?.id ?? "", date: today, from: "09:00", to: "12:00", breakdown: false, note: "" }); };
  async function saveManual() {
    if (!mf) return; if (!mf.item_id || !mf.from || !mf.to) { setErr("Choose the machine and enter the start and end times."); return; }
    let start_at = at(mf.date, mf.from), end_at = at(mf.date, mf.to); if (end_at <= start_at) { setErr("The end time must be after the start time (to cover midnight, enter two entries)."); return; } setBusy(true); setErr("");
    const sb = supabase(); const { error } = mf.id ? await sb.from("equipment_logs").update({ start_at, end_at, breakdown: mf.breakdown, note: mf.note.trim() }).eq("id", mf.id) : await sb.from("equipment_logs").insert({ project_id: pid, item_id: mf.item_id, start_at, end_at, breakdown: mf.breakdown, note: mf.note.trim() });
    setBusy(false); if (error) { setErr(error.message); return; } setMf(null); note(mf.id ? "Entry corrected (verification cleared) ✓" : "Entry saved ✓"); loadLogs();
  }

  // setup (Operations / Admin)
  const [vf, setVf] = useState({ name: "", contact: "", phone: "", gstin: "" }); const [itf, setItf] = useState({ vendor_id: "", name: "", type: "crane", identifier: "" });
  const [rf, setRf] = useState({ item_id: "", unit: "hour", rate: "", min_hours: "", round_minutes: "0", ot_after: "", ot_rate: "", gst_pct: "18", valid_from: today });
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string, after: () => void) => { setErr(""); const { error } = await fn(); if (error) { setErr(error.message); return; } note(ok); after(); };
  const addVendor = () => vf.name.trim() ? run(() => supabase().from("gas_vendors").insert({ name: vf.name.trim(), contact: vf.contact.trim(), phone: vf.phone.trim(), gstin: vf.gstin.trim().toUpperCase(), kind: "equipment" }), "Vendor added ✓", () => { setVf({ name: "", contact: "", phone: "", gstin: "" }); load(); }) : setErr("Enter the vendor's name.");
  const addItem = () => itf.vendor_id && itf.name.trim() ? run(() => supabase().from("equipment_items").insert({ vendor_id: itf.vendor_id, name: itf.name.trim(), type: itf.type, identifier: itf.identifier.trim() }), "Equipment added ✓", () => { setItf({ ...itf, name: "", identifier: "" }); load(); }) : setErr("Choose the vendor and enter the equipment's name.");
  const addRate = () => { const r = parseFloat(rf.rate); return rf.item_id && r >= 0 && rf.rate !== "" ? run(() => supabase().from("equipment_rates").insert({ item_id: rf.item_id, unit: rf.unit, rate: r, min_hours: parseFloat(rf.min_hours) || 0, round_minutes: parseInt(rf.round_minutes, 10) || 0, overtime_after_hours: rf.ot_after === "" ? null : parseFloat(rf.ot_after), overtime_rate: rf.ot_rate === "" ? null : parseFloat(rf.ot_rate), gst_pct: parseFloat(rf.gst_pct) || 0, valid_from: rf.valid_from }), "Rate saved: it applies to work from that date ✓", () => { setRf({ ...rf, rate: "" }); load(); }) : setErr("Choose the equipment and enter the rate."); };
  const toggleLink = (vendor_id: string, on: boolean) => run(() => on ? supabase().from("gas_project_vendors").insert({ project_id: pid, vendor_id }) : supabase().from("gas_project_vendors").delete().eq("project_id", pid).eq("vendor_id", vendor_id), "Saved ✓", load);
  const setActive = (table: "gas_vendors" | "equipment_items", id: string, active: boolean) => run(() => supabase().from(table).update({ active }).eq("id", id), "Saved ✓", load);
  const rateText = (itemId: string) => { const r = rateOn(rates, itemId, today); if (!r) return <span className="text-amber-700">no rate yet</span>; return <>₹{inr(r.rate)} per {r.unit}{r.min_hours > 0 ? ` · min ${r.min_hours} h` : ""}{r.round_minutes > 0 ? ` · rounded up to ${r.round_minutes} min` : ""}{r.overtime_after_hours !== null ? ` · overtime after ${r.overtime_after_hours} h at ₹${inr(r.overtime_rate ?? r.rate)}` : ""} + {r.gst_pct}% GST</>; };

  // for the bills tab: what a vendor's logged hours come to for the dates a bill covers
  const compute = (vendorId: string, from: string, to: string): Computed => {
    const mine = items.filter((i) => i.vendor_id === vendorId); const ids = new Set(mine.map((i) => i.id)); const t = chargeFor(logs, rates, ids, from, to); const lines: string[] = [];
    mine.forEach((i) => { const one = chargeFor(logs, rates, new Set([i.id]), from, to); if (one.days || one.running) lines.push(`${iLabel(i.id)}: ${one.days} day${one.days === 1 ? "" : "s"}, ${one.hours.toFixed(2)} billable hours → ₹${inr(one.amount)} + GST ₹${inr(one.gst)}`); });
    const warn = [t.unpriced ? `${t.unpriced} day${t.unpriced === 1 ? "" : "s"} of work have no rate set, so they are not counted` : "", t.unverifiedMinutes ? `${hoursText(t.unverifiedMinutes)} of the hours are not verified yet` : "", t.running ? `${t.running} machine${t.running === 1 ? " is" : "s are"} still running` : ""].filter(Boolean).join(" · ");
    return { amount: Math.round((t.amount + t.gst) * 100) / 100, lines, warn };
  };

  const TABS: [Tab, string][] = [["today", "Today"], ["log", "Log"], ...(money ? [["setup", "Equipment & rates"], ["bills", "Bills"]] as [Tab, string][] : [])];
  const proj = projects.find((p) => p.id === pid);
  const monthLogs = logs.filter((l) => l.work_date.startsWith(month)); const dates = [...new Set(monthLogs.map((l) => l.work_date))].sort().reverse();
  const entry = (l: Log) => { const min = minutesOf(l, now); const own = l.entered_by === userId; const may = canVerify || (own && role === "supervisor"); return (
    <div key={l.id} className={`py-2.5 space-y-1 ${l.voided_at ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"><span className={`font-medium ${l.voided_at ? "line-through" : ""}`}>{iLabel(l.item_id)}</span><span className="text-sm tabular-nums">{tm(l.start_at)} – {l.end_at ? tm(l.end_at) : <b className="text-green-700">running</b>}</span><span className="text-sm tabular-nums text-slate-500">{hoursText(min)}</span></div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">{l.breakdown && <span className="rounded-full bg-rose-50 text-rose-800 px-2 py-0.5">breakdown</span>}{l.voided_at ? <span className="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">void</span> : l.verified_at ? <span className="rounded-full bg-green-50 text-green-800 px-2 py-0.5">verified by {who(l.verified_by)}</span> : l.end_at ? <span className="rounded-full bg-amber-50 text-amber-800 px-2 py-0.5">not verified</span> : null}<span className="text-slate-400">by {who(l.entered_by)}{l.note ? ` · ${l.note}` : ""}</span></div>
      {!l.voided_at && (may || (l.end_at && canVerify)) && <div className="flex flex-wrap gap-2 pt-0.5">{l.end_at && !l.verified_at && canVerify && <button className="tlink" onClick={() => verify(l)}>Verify</button>}{l.end_at && may && <button className="tlink" onClick={() => openManual(l)}>Correct</button>}{may && <button className="tlink tlink-danger" onClick={() => voidLog(l)}>Void</button>}</div>}
    </div>); };

  return (
    <div className="space-y-4 mob">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Hired equipment</h1>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => { setPid(e.target.value); setMf(null); keepProject(e.target.value); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}</option>)}</select>}</div>
      <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto tabs-scroll">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab whitespace-nowrap ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}{loading && <p className="text-slate-500">Loading…</p>}
      {!loading && !projects.length && !err && <p className="text-slate-500">No active projects{role === "supervisor" || role === "site_engineer" ? " assigned to you" : ""}.</p>}

      {(tab === "today" || tab === "log") && mf && <div className="card !p-3 space-y-3"><div className="font-medium">{mf.id ? "Correct an entry" : "Add a stretch of work"}</div>
        <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Machine</label><select className="inp !w-56" value={mf.item_id} disabled={!!mf.id} onChange={(e) => setMf({ ...mf, item_id: e.target.value })}>{projItems.map((i) => <option key={i.id} value={i.id}>{iLabel(i.id)}</option>)}</select></div>
          <div><label className="lbl">Date</label><input type="date" className="inp" max={today} value={mf.date} disabled={!!mf.id} onChange={(e) => setMf({ ...mf, date: e.target.value })} /></div>
          <div><label className="lbl">Started</label><input type="time" className="inp" value={mf.from} onChange={(e) => setMf({ ...mf, from: e.target.value })} /></div><div><label className="lbl">Stopped</label><input type="time" className="inp" value={mf.to} onChange={(e) => setMf({ ...mf, to: e.target.value })} /></div></div>
        <div className="flex flex-wrap items-end gap-3"><div className="min-w-56 flex-1"><label className="lbl">Note (optional)</label><input className="inp" value={mf.note} onChange={(e) => setMf({ ...mf, note: e.target.value })} placeholder="e.g. lifting the boiler section" /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mf.breakdown} onChange={(e) => setMf({ ...mf, breakdown: e.target.checked })} />Machine broke down</label></div>
        <div className="flex gap-2 form-actions"><button className="btn btn-primary" disabled={busy} onClick={saveManual}>{busy ? "Saving…" : "Save"}</button><button className="btn" onClick={() => setMf(null)}>Cancel</button></div></div>}

      {tab === "today" && pid && <div className="space-y-3">
        {!projItems.length && !loading && <p className="text-sm text-slate-500">No equipment vendor is set up for {proj?.name ?? "this project"} yet.{money ? " Add one under Equipment & rates." : " Ask Operations or the Admin."}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{projItems.map((i) => { const r = running(i.id); const min = dayMinutes(i.id, today); return (
          <div key={i.id} className={`card !p-3 space-y-2 ${r ? "!border-green-300 !bg-green-50/40" : ""}`}><div><div className="font-medium">{i.name}{i.identifier ? ` · ${i.identifier}` : ""}</div><div className="text-xs text-slate-400">{TYPE[i.type]} · {vName(i.vendor_id)}</div></div>
            {r ? <div className="text-sm">Running since <b>{tm(r.start_at)}</b> · <b className="tabular-nums text-green-700">{hoursText(minutesOf(r, now))}</b></div> : <div className="text-sm text-slate-500">Not running</div>}
            <div className="text-xs text-slate-500">Today so far: <b className="text-slate-700">{hoursText(min)}</b></div>
            {r ? <button className="btn w-full justify-center !min-h-14 !text-lg !font-semibold !bg-rose-600 !border-rose-600 text-white hover:!bg-rose-700" disabled={busy} onClick={() => stop(r)}>■ Stop</button> : <button className="btn btn-primary w-full justify-center !min-h-14 !text-lg !font-semibold" disabled={busy || !i.active} onClick={() => start(i)}>▶ Start</button>}</div>); })}</div>
        {projItems.length > 0 && !mf && <button className="btn" onClick={() => openManual()}>Add a stretch afterwards</button>}
        <div className="card !p-3"><div className="text-sm font-medium mb-1">Today's entries</div>{logs.filter((l) => l.work_date === today).length ? <div className="divide-y divide-slate-100">{logs.filter((l) => l.work_date === today).map(entry)}</div> : <p className="text-sm text-slate-500">Nothing logged today.</p>}</div>
      </div>}

      {tab === "log" && pid && <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2"><label className="text-xs text-slate-500 flex items-center gap-2">Month<input type="month" className="inp !w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>{!mf && projItems.length > 0 && <button className="btn btn-sm" onClick={() => openManual()}>Add a stretch</button>}
          <span className="text-xs text-slate-500">{hoursText(monthLogs.filter((l) => !l.voided_at).reduce((s, l) => s + minutesOf(l, now), 0))} logged · {monthLogs.filter((l) => !l.voided_at && l.end_at && !l.verified_at).length} to verify</span></div>
        {!dates.length && <p className="text-sm text-slate-500">Nothing logged this month.</p>}
        {dates.map((d) => { const day = monthLogs.filter((l) => l.work_date === d); return <div key={d} className="card !p-3"><div className="text-sm font-medium mb-1">{dmy(d)}{money && <span className="ml-2 text-xs font-normal text-slate-500">{[...new Set(day.filter((l) => !l.voided_at && l.end_at).map((l) => l.item_id))].map((id) => { const r = rateOn(rates, id, d); return r ? `₹${inr(dayCharge(r, dayMinutes(id, d)).amount)} before GST` : ""; }).filter(Boolean).join(" · ")}</span>}</div><div className="divide-y divide-slate-100">{day.map(entry)}</div></div>; })}
      </div>}

      {tab === "setup" && money && <div className="space-y-4">
        <div className="card !p-3 space-y-2"><div className="font-medium">Vendors for {proj?.name ?? "this project"}</div><div className="flex flex-wrap gap-x-4 gap-y-1">{vendors.map((v) => <label key={v.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={links.some((l) => l.project_id === pid && l.vendor_id === v.id)} disabled={!pid} onChange={(e) => toggleLink(v.id, e.target.checked)} />{v.name}{!v.active && <span className="text-xs text-slate-400">(inactive)</span>}</label>)}{!vendors.length && <span className="text-sm text-slate-400">Add a vendor below first.</span>}</div><p className="text-xs text-slate-400">Tick the vendors whose machines may be logged on this project.</p></div>
        <div className="card !p-3 space-y-3"><div className="font-medium">Add an equipment vendor</div>
          <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Name</label><input className="inp !w-52" value={vf.name} onChange={(e) => setVf({ ...vf, name: e.target.value })} /></div><div><label className="lbl">Contact person</label><input className="inp !w-40" value={vf.contact} onChange={(e) => setVf({ ...vf, contact: e.target.value })} /></div><div><label className="lbl">Phone</label><input className="inp !w-36" value={vf.phone} onChange={(e) => setVf({ ...vf, phone: e.target.value })} /></div><div><label className="lbl">GSTIN</label><input className="inp !w-44" value={vf.gstin} onChange={(e) => setVf({ ...vf, gstin: e.target.value })} /></div><button className="btn btn-primary" onClick={addVendor}>Add vendor</button></div>
          {vendors.map((v) => <div key={v.id} className="border-t border-slate-100 pt-2 space-y-1"><div className="flex flex-wrap items-center gap-2"><b>{v.name}</b><span className="text-xs text-slate-400">{[v.contact, v.phone, v.gstin].filter(Boolean).join(" · ")}</span><button className="btn btn-sm sm:ml-auto" onClick={() => setActive("gas_vendors", v.id, !v.active)}>{v.active ? "Make inactive" : "Make active"}</button></div>
            {admin && <PayeeBank kind="equipment_vendor" refId={v.id} label="Vendor bank details" />}
            <ul className="text-sm space-y-0.5">{items.filter((i) => i.vendor_id === v.id).map((i) => <li key={i.id} className="flex flex-wrap gap-2 items-center">{i.name}{i.identifier ? ` · ${i.identifier}` : ""} <span className="text-xs text-slate-400">{TYPE[i.type]}</span><span className="text-slate-500">{rateText(i.id)}</span>{!i.active && <span className="text-xs text-slate-400">(inactive)</span>}<button className="tlink" onClick={() => setActive("equipment_items", i.id, !i.active)}>{i.active ? "make inactive" : "make active"}</button></li>)}</ul></div>)}</div>
        <div className="card !p-3 space-y-3"><div className="font-medium">Add equipment</div>
          <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Vendor</label><select className="inp !w-52" value={itf.vendor_id} onChange={(e) => setItf({ ...itf, vendor_id: e.target.value })}><option value="">Choose…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div><div><label className="lbl">Name</label><input className="inp !w-48" placeholder="e.g. 50T crane" value={itf.name} onChange={(e) => setItf({ ...itf, name: e.target.value })} /></div><div><label className="lbl">Type</label><select className="inp !w-36" value={itf.type} onChange={(e) => setItf({ ...itf, type: e.target.value })}>{Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div><div><label className="lbl">Number / ID (optional)</label><input className="inp !w-40" value={itf.identifier} onChange={(e) => setItf({ ...itf, identifier: e.target.value })} /></div><button className="btn btn-primary" onClick={addItem}>Add equipment</button></div></div>
        <div className="card !p-3 space-y-3"><div className="font-medium">Rates</div>
          <div className="flex flex-wrap items-end gap-2"><div><label className="lbl">Equipment</label><select className="inp !w-60" value={rf.item_id} onChange={(e) => setRf({ ...rf, item_id: e.target.value })}><option value="">Choose…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.identifier ? ` · ${i.identifier}` : ""} · {vName(i.vendor_id)}</option>)}</select></div>
            <div><label className="lbl">Billed per</label><select className="inp !w-28" value={rf.unit} onChange={(e) => setRf({ ...rf, unit: e.target.value })}><option value="hour">Hour</option><option value="day">Day</option></select></div>
            <div><label className="lbl">Rate (₹)</label><input className="inp !w-32" inputMode="decimal" value={rf.rate} onChange={(e) => setRf({ ...rf, rate: e.target.value.replace(/[^\d.]/g, "") })} /></div>
            {rf.unit === "hour" && <><div><label className="lbl">Minimum hours per day</label><input className="inp !w-28" inputMode="decimal" value={rf.min_hours} onChange={(e) => setRf({ ...rf, min_hours: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0" /></div><div><label className="lbl">Round up to (min)</label><select className="inp !w-28" value={rf.round_minutes} onChange={(e) => setRf({ ...rf, round_minutes: e.target.value })}><option value="0">Exact</option><option value="15">15</option><option value="30">30</option><option value="60">60</option></select></div></>}
            <div><label className="lbl">Overtime after (h/day)</label><input className="inp !w-28" inputMode="decimal" value={rf.ot_after} onChange={(e) => setRf({ ...rf, ot_after: e.target.value.replace(/[^\d.]/g, "") })} placeholder="none" /></div><div><label className="lbl">Overtime rate (₹/h)</label><input className="inp !w-28" inputMode="decimal" value={rf.ot_rate} onChange={(e) => setRf({ ...rf, ot_rate: e.target.value.replace(/[^\d.]/g, "") })} /></div>
            <div><label className="lbl">GST %</label><input className="inp !w-20" inputMode="decimal" value={rf.gst_pct} onChange={(e) => setRf({ ...rf, gst_pct: e.target.value.replace(/[^\d.]/g, "") })} /></div><div><label className="lbl">From</label><input type="date" className="inp" value={rf.valid_from} onChange={(e) => setRf({ ...rf, valid_from: e.target.value })} /></div><button className="btn btn-primary" onClick={addRate}>Save rate</button></div>
          <p className="text-xs text-slate-400">The amount for a day comes from the hours logged that day. Hourly: the day's time is rounded up, raised to the minimum, and hours past the overtime threshold use the overtime rate. Daily: one day's rate for any day with work, plus overtime hours. Anything else on a vendor's bill (mobilisation, operator, fuel) shows up as a difference you can approve.</p></div>
      </div>}

      {tab === "bills" && money && pid && <SiteBills kind="equipment" projectId={pid} vendors={linkedVendors} compute={compute} />}
    </div>
  );
}
