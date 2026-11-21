"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { billFileName, type BillRow } from "@/lib/billsData";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { usePerms } from "@/lib/perms";
import { levelRank } from "@/lib/permissions";
import BillsReview, { billUrl, isImage } from "./BillsReview";

// Expenses → Bills: every bill and receipt in the app in one list (src/lib/billsData.ts, /api/bills).
//  - open, preview or download any one; tick several and download them as one PDF (with a cover list) or a ZIP (/api/bills/bundle)
//  - review mode: one bill at a time, full screen, with Next / Previous (BillsReview.tsx)
//  - an entry with no bill can be given one here (/api/bills/attach), by someone allowed to add on this tab
//  - possible duplicates: two bills (or two receipts) from the same vendor with the same bill number, or the same amount on the same day
//  - group by month, vendor or section with subtotals; sort by date or amount; export what is on show as CSV
type Period = "month" | "last" | "3m" | "year" | "all" | "custom";
type Group = "none" | "month" | "payee" | "section";
type Sort = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const ist = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
const monthStart = (iso: string, back = 0) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10); };
const monthEnd = (iso: string) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const monthWord = (iso: string) => new Date(iso.slice(0, 7) + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const base = (section: string) => section.split(" · ")[0];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const LIMIT = 200;
const svg = (d: React.ReactNode) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const I = {
  eye: svg(<><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>),
  open: svg(<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></>),
  download: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>),
  go: svg(<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>),
  upload: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></>),
  review: svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h6v6H9z" /></>),
  csv: svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h8" /></>),
};

export default function BillsView({ project }: { project: string }) {
  const perms = usePerms(); const mayAttach = levelRank(perms.level("expenses", "bills")) >= 2;
  const [rows, setRows] = useState<BillRow[] | null>(null); const [err, setErr] = useState(""); const [warn, setWarn] = useState<string[]>([]);
  const today = ist();
  const [period, setPeriod] = useState<Period>("3m"); const [from, setFrom] = useState(monthStart(today, 2)); const [to, setTo] = useState(today);
  const [sections, setSections] = useState<Set<string>>(new Set()); const [payee, setPayee] = useState(""); const [q, setQ] = useState("");
  const [missing, setMissing] = useState(false); const [dupOnly, setDupOnly] = useState(false);
  const [group, setGroup] = useState<Group>("none"); const [sort, setSort] = useState<Sort>("date-desc");
  const [sel, setSel] = useState<Set<string>>(new Set()); const [open, setOpen] = useState(""); const [busy, setBusy] = useState(""); const [msg, setMsg] = useState("");
  const [review, setReview] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/bills"); const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || `Could not load the bills (${r.status}).`); return; }
    setErr(""); setRows(j.rows); setWarn(j.warnings || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const choosePeriod = (p: Period) => {
    setPeriod(p);
    if (p === "month") { setFrom(monthStart(today)); setTo(monthEnd(today)); }
    if (p === "last") { setFrom(monthStart(today, 1)); setTo(monthEnd(monthStart(today, 1))); }
    if (p === "3m") { setFrom(monthStart(today, 2)); setTo(today); }
    if (p === "year") { const [y, m] = today.split("-").map(Number); const fy = m >= 4 ? y : y - 1; setFrom(`${fy}-04-01`); setTo(`${fy + 1}-03-31`); }   // India's financial year
    if (p === "all") { setFrom(""); setTo(""); }
  };

  // possible duplicates, over everything (not only what is on show): bills are compared with bills and receipts with receipts, so a bill and its own payment are not flagged.
  const dups = useMemo(() => {
    const groups = new Map<string, BillRow[]>();
    const add = (k: string, r: BillRow) => { const l = groups.get(k); if (l) l.push(r); else groups.set(k, [r]); };
    (rows ?? []).forEach((r) => {
      const p = norm(r.payee); if (!p) return;
      if (norm(r.ref)) add(`n|${r.kind}|${p}|${norm(r.ref)}`, r);
      if (r.amount > 0 && r.date) add(`a|${r.kind}|${p}|${r.date}|${Math.round(r.amount)}`, r);
    });
    const out = new Map<string, Map<string, "number" | "amount">>();
    groups.forEach((l, k) => { if (l.length < 2) return; const why = k.startsWith("n|") ? "number" : "amount";
      l.forEach((a) => l.forEach((b) => { if (a.key === b.key) return; const m = out.get(a.key) ?? new Map(); if (!m.has(b.key) || why === "number") m.set(b.key, why); out.set(a.key, m); })); });
    return out;
  }, [rows]);
  const byKey = useMemo(() => new Map((rows ?? []).map((r) => [r.key, r])), [rows]);
  const dupNote = useCallback((r: BillRow) => [...(dups.get(r.key) ?? new Map()).entries()].map(([k, why]) => { const o = byKey.get(k); return o ? `${why === "number" ? "same bill no. as" : "same amount and day as"} ${dmy(o.date)} ${base(o.section)} ${inr(o.amount)}` : ""; }).filter(Boolean).join("; "), [dups, byKey]);

  // filters other than the section and the payee, so their lists show what is in range
  const inRange = useMemo(() => (rows ?? []).filter((r) => (!project || r.project_id === project) && (!from || r.date >= from) && (!to || r.date <= to) && (!missing || !r.file) && (!dupOnly || dups.has(r.key))), [rows, project, from, to, missing, dupOnly, dups]);
  const sectionList = useMemo(() => [...new Set(inRange.map((r) => base(r.section)))].sort(), [inRange]);
  const payeeList = useMemo(() => [...new Set(inRange.map((r) => r.payee).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [inRange]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const l = inRange.filter((r) => (!sections.size || sections.has(base(r.section))) && (!payee || r.payee === payee)
      && (!s || [r.payee, r.ref, r.note, r.section, r.project, ...r.covers].join(" ").toLowerCase().includes(s)));
    const cmp: Record<Sort, (a: BillRow, b: BillRow) => number> = {
      "date-desc": (a, b) => b.date.localeCompare(a.date), "date-asc": (a, b) => a.date.localeCompare(b.date),
      "amount-desc": (a, b) => b.amount - a.amount, "amount-asc": (a, b) => a.amount - b.amount,
    };
    return l.sort(cmp[sort]);
  }, [inRange, sections, payee, q, sort]);
  // groups with subtotals; months run in the date order chosen, vendors and sections A to Z
  const groups = useMemo(() => {
    if (group === "none") return [{ k: "", title: "", rows: shown }];
    const keyOf = (r: BillRow) => (group === "month" ? r.date.slice(0, 7) : group === "payee" ? r.payee || "" : base(r.section));
    const m = new Map<string, BillRow[]>(); shown.forEach((r) => { const k = keyOf(r); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); });
    const keys = [...m.keys()].sort((a, b) => (group === "month" ? (sort === "date-asc" ? a.localeCompare(b) : b.localeCompare(a)) : a.localeCompare(b)));
    return keys.map((k) => ({ k, title: group === "month" ? (k ? monthWord(k) : "No date") : k || "No vendor", rows: m.get(k)! }));
  }, [shown, group, sort]);
  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const reviewable = useMemo(() => ordered.filter((r) => r.file), [ordered]);

  const total = shown.reduce((s, r) => s + r.amount, 0), noFile = shown.filter((r) => !r.file).length, dupCount = inRange.filter((r) => dups.has(r.key)).length;
  const picked = ordered.filter((r) => sel.has(r.key)), pickedSum = picked.reduce((s, r) => s + r.amount, 0);
  const allOn = reviewable.length > 0 && reviewable.every((r) => sel.has(r.key));
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (allOn) reviewable.forEach((r) => n.delete(r.key)); else reviewable.forEach((r) => n.add(r.key)); return n; });

  async function bundle(format: "pdf" | "zip") {
    if (!picked.length) return; if (picked.length > LIMIT) { setMsg(`Up to ${LIMIT} bills at a time: narrow the filter and download in parts.`); return; }
    setBusy(format); setMsg("");
    const items = picked.map((r) => ({ src: r.src, id: r.id, name: billFileName(r), date: r.date, section: r.section, payee: r.payee + (r.covers.length ? ` (${r.covers.join(", ")})` : ""), ref: r.ref, amount: r.amount }));
    const res = await fetch("/api/bills/bundle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items, format }) });
    const j = await res.json().catch(() => ({})); setBusy("");
    if (!res.ok) { setMsg(j.error || `Could not make the download (${res.status}).`); return; }
    window.location.assign(j.url);
    setMsg(j.missing ? `Downloading ${j.included} bill${j.included === 1 ? "" : "s"}. ${j.missing} could not be added (no file or no access)${format === "pdf" ? " and are marked \"missing\" on the cover list" : ""}.` : `Downloading ${j.included} bill${j.included === 1 ? "" : "s"} as ${format.toUpperCase()}.`);
  }

  async function attach(r: BillRow, picked: File | undefined) {
    if (!picked) return; setMsg("");
    const file = await prepareUpload(picked); if (file.size > MAX_UPLOAD) { setMsg("The bill is larger than 5 MB: please send a smaller photo or compressed PDF."); return; }
    setBusy(`attach:${r.key}`);
    const fd = new FormData(); fd.set("file", file); fd.set("src", r.src); fd.set("id", r.id);
    const res = await fetch("/api/bills/attach", { method: "POST", body: fd }); const j = await res.json().catch(() => ({}));
    setBusy(""); if (!res.ok) { setMsg(j.error || `Could not attach the bill (${res.status}).`); return; }
    setMsg(`Bill attached to ${r.payee || r.section}${r.ref ? ` #${r.ref}` : ""}${j.updated > 1 ? ` (all ${j.updated} rooms in that payment)` : ""}.`); await load();
  }

  function csv() {
    const qt = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Date", "Section", "Type", "Vendor / payee", "Bill no. / reference", "Project", "Amount", "Bill file", "Covers", "Status", "Possible duplicate", "Note"];
    const lines = ordered.map((r) => [r.date, r.section, r.kind, r.payee, r.ref, r.project, Math.round(r.amount * 100) / 100, r.file ? "yes" : "no", r.covers.join(", "), r.status, dupNote(r), r.note]);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + [head, ...lines].map((l) => l.map(qt).join(",")).join("\n")], { type: "text/csv" }));
    a.download = `bills ${from || "start"} to ${to || today}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  if (err) return <p className="warn">{err}</p>;
  if (!rows) return <div className="card text-sm text-slate-500">Loading the bills…</div>;

  const periodChip = (p: Period, label: string) => <button key={p} type="button" aria-pressed={period === p} className={`chip ${period === p ? "chip-on" : ""}`} onClick={() => choosePeriod(p)}>{label}</button>;
  const iconBtn = "btn btn-sm !px-1.5";
  const row = (r: BillRow) => { const dup = dups.has(r.key) ? dupNote(r) : ""; const at = busy === `attach:${r.key}`;
    return (
      <div key={r.key} className="border-t border-slate-100 first:border-t-0">
        <div className="flex items-start gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
          <input type="checkbox" className="mt-1 shrink-0" aria-label={`Select ${r.payee || r.section} ${r.ref}`} disabled={!r.file} checked={sel.has(r.key)} onChange={() => toggle(r.key)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"><span className="font-medium truncate">{r.payee || r.section}</span>{r.ref && <span className="text-slate-500 text-xs">#{r.ref}</span>}
              {!r.file && <span className="rounded-full bg-amber-50 text-amber-800 px-2 text-[11px]">no bill yet</span>}
              {dup && <span className="rounded-full bg-rose-50 text-rose-700 px-2 text-[11px] cursor-help" title={`Possible duplicate: ${dup}`}>possible duplicate</span>}
              {r.status && <span className="rounded-full bg-slate-100 text-slate-600 px-2 text-[11px]">{r.status}</span>}</div>
            <div className="text-xs text-slate-500 truncate">{dmy(r.date)} · {r.section} · {r.kind}{r.project ? ` · ${r.project}` : ""}{r.covers.length ? ` · covers ${r.covers.join(", ")}` : ""}</div>
            {dup && <div className="text-xs text-rose-700 truncate">{dup}</div>}
          </div>
          <div className="text-right shrink-0"><div className="font-semibold tabular-nums">{inr(r.amount)}</div>
            <div className="mt-1 flex justify-end gap-1">
              {r.file ? <>
                <button type="button" className={`${iconBtn} ${open === r.key ? "chip-on" : ""}`} aria-expanded={open === r.key} title={open === r.key ? "Hide preview" : "Preview here"} aria-label={open === r.key ? "Hide preview" : "Preview here"} onClick={() => setOpen(open === r.key ? "" : r.key)}>{I.eye}</button>
                <button type="button" className={iconBtn} title="Review full screen, with next and previous" aria-label="Review full screen" onClick={() => setReview(Math.max(0, reviewable.findIndex((x) => x.key === r.key)))}>{I.review}</button>
                <a className={iconBtn} href={billUrl(r)} target="_blank" rel="noreferrer" data-viewer="off" title="Open in a new tab" aria-label="Open in a new tab">{I.open}</a>
                <a className={iconBtn} href={billUrl(r, true)} title="Download this bill" aria-label="Download this bill">{I.download}</a>
              </> : mayAttach && <label className={`${iconBtn} cursor-pointer ${at ? "opacity-50 pointer-events-none" : ""}`} title="Attach the bill (photo or PDF)" aria-label="Attach the bill">
                {at ? <span className="text-xs px-1">…</span> : I.upload}<input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => { attach(r, e.target.files?.[0]); e.target.value = ""; }} /></label>}
              <a className={iconBtn} href={r.go} title={`Go to the entry in ${base(r.section)}`} aria-label={`Go to the entry in ${base(r.section)}`}>{I.go}</a>
            </div></div>
        </div>
        {open === r.key && <div className="px-3 pb-3">{isImage(r.ext)
          ? <img src={billUrl(r)} alt={`Bill from ${r.payee}`} className="max-h-[28rem] max-w-full rounded-lg border border-slate-200" />
          : r.ext === "pdf" ? <iframe src={billUrl(r)} title={`Bill from ${r.payee}`} className="w-full h-[28rem] rounded-lg border border-slate-200" />
          : <p className="text-sm text-slate-500">This file cannot be previewed here. Use Open or Download.</p>}</div>}
      </div>); };

  return (
    <div className="space-y-3 pb-20">
      {warn.length > 0 && <p className="warn">Some sections could not be read, so their bills are not listed: {warn.join("; ")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {periodChip("month", "This month")}{periodChip("last", "Last month")}{periodChip("3m", "Last 3 months")}{periodChip("year", "This financial year")}{periodChip("all", "All")}
        <span className="inline-flex items-center gap-1 text-sm"><input className="inp !w-36 !py-1" type="date" aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); setPeriod("custom"); }} />–<input className="inp !w-36 !py-1" type="date" aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); setPeriod("custom"); }} /></span>
      </div>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
        <input className="inp" type="search" aria-label="Search bills" placeholder="Search vendor, bill number, room or note" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp" aria-label="Vendor or payee" value={payee} onChange={(e) => setPayee(e.target.value)}><option value="">All vendors and payees</option>{payeeList.map((p) => <option key={p} value={p}>{p}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {sectionList.map((s) => <button key={s} type="button" aria-pressed={sections.has(s)} className={`chip ${sections.has(s) ? "chip-on" : ""}`} onClick={() => setSections((x) => { const n = new Set(x); n.has(s) ? n.delete(s) : n.add(s); return n; })}>{s}</button>)}
        <span className="flex-1" />
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} /> Without a bill</label>
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} /> Possible duplicates</label>
      </div>

      <div className="rounded-xl bg-slate-100 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span><b className="tabular-nums">{shown.length}</b> {missing ? "without a bill" : `entr${shown.length === 1 ? "y" : "ies"}`} · <b className="tabular-nums">{inr(total)}</b></span>
        {!missing && noFile > 0 && <button type="button" className="text-amber-700 underline text-xs" onClick={() => setMissing(true)}>{noFile} without a bill</button>}
        {!dupOnly && dupCount > 0 && <button type="button" className="text-rose-700 underline text-xs" onClick={() => setDupOnly(true)}>{dupCount} possible duplicate{dupCount === 1 ? "" : "s"}</button>}
        <span className="flex-1" />
        <select className="inp !w-auto !py-1 text-sm" aria-label="Group by" value={group} onChange={(e) => setGroup(e.target.value as Group)}><option value="none">No grouping</option><option value="month">Group by month</option><option value="payee">Group by vendor</option><option value="section">Group by section</option></select>
        <select className="inp !w-auto !py-1 text-sm" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="date-desc">Newest first</option><option value="date-asc">Oldest first</option><option value="amount-desc">Highest amount</option><option value="amount-asc">Lowest amount</option></select>
        <button type="button" className="btn btn-sm" disabled={!reviewable.length} onClick={() => setReview(0)} title="Go through the bills on show one at a time, full screen">{I.review} Review</button>
        <button type="button" className="btn btn-sm" disabled={!shown.length} onClick={csv} title="Download the list on show as a spreadsheet (CSV)">{I.csv} CSV</button>
        {reviewable.length > 0 && <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={allOn} onChange={toggleAll} /> Select all {reviewable.length}</label>}
      </div>
      {msg && <p role="status" className="text-sm text-slate-700">{msg}</p>}

      {!shown.length ? <div className="card text-center text-sm text-slate-500">{rows.length ? "No bills match these filters." : "No bills or receipts uploaded yet."}</div> : groups.map((g) => (
        <Fragment key={g.k || "all"}>
          {g.title && <div className="flex items-baseline justify-between px-1 pt-2"><h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.title}</h3><span className="text-xs text-slate-500 tabular-nums">{g.rows.length} · {inr(g.rows.reduce((s, r) => s + r.amount, 0))}</span></div>}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">{g.rows.map(row)}</div>
        </Fragment>))}

      {picked.length > 0 && <div className="fixed inset-x-0 bottom-[var(--bottom-nav-h,0px)] z-30 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3 md:pl-[calc(4rem+1rem)] xl:pl-[calc(16rem+1rem)] print:hidden">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3">
          <span className="text-sm"><b>{picked.length}</b> selected · <b className="tabular-nums">{inr(pickedSum)}</b>{picked.length > LIMIT && <span className="text-rose-700"> (up to {LIMIT} at a time)</span>}</span>
          <span className="flex-1" />
          <button className="btn" onClick={() => setSel(new Set())}>Clear</button>
          <button className="btn" disabled={!!busy || picked.length > LIMIT} onClick={() => bundle("zip")}>{busy === "zip" ? "Making the ZIP…" : "Download ZIP"}</button>
          <button className="btn btn-primary keep" disabled={!!busy || picked.length > LIMIT} onClick={() => bundle("pdf")}>{busy === "pdf" ? "Making the PDF…" : "Download as one PDF"}</button>
        </div></div>}

      {review !== null && reviewable.length > 0 && <BillsReview rows={reviewable} start={review} onClose={() => setReview(null)} dupNote={dupNote} />}
    </div>
  );
}
