"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { MEALS, STATUS_LABEL, STATUS_SHORT, addDays, dayName, daysWorked, effectiveStatus, istToday, rateFor, toISO, type AttRow, type MealRate, type Person, type Status, type Vendor } from "@/lib/attendance";
import { inr } from "@/lib/quote";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const VDOT = ["bg-blue-600", "bg-orange-500", "bg-violet-600", "bg-teal-600", "bg-pink-600"];   // one colour per vendor, same order as the daily sheet
const CELL: Record<Status, string> = { present: "bg-green-100 text-green-800", absent: "bg-red-100 text-red-800", half: "bg-amber-100 text-amber-800", off: "bg-slate-100 text-slate-500" };

// One person's month as a calendar: status per day, three dots for breakfast / lunch / dinner, tap a day for the details.
function PersonCalendar({ person, days, byDate, vendors, today }: { person: Person; days: string[]; byDate: Record<string, AttRow>; vendors: Vendor[]; today: string }) {
  const [pick, setPick] = useState<string | null>(null);
  const lead = new Date(days[0] + "T00:00:00").getDay();   // Sunday-first
  const vName = (id: string | null) => vendors.find((v) => v.id === id)?.name ?? "none";
  const dot = (id: string | null) => (id ? VDOT[Math.max(0, vendors.findIndex((v) => v.id === id)) % VDOT.length] : "bg-slate-300");
  const statusOf = (d: string) => (d < (person.join_date ?? "") ? null : effectiveStatus(person, d, byDate[d]));
  const pr = pick ? byDate[pick] : undefined, ps = pick ? statusOf(pick) : null;
  return (
    <div className="pt-3 space-y-2">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-400">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
        {days.map((d) => { const r = byDate[d]; const st = statusOf(d); return (
          <button key={d} type="button" onClick={() => setPick(pick === d ? null : d)} aria-label={`${dayName(d)} ${+d.slice(8)}: ${st ? STATUS_LABEL[st] : "not marked"}`}
            className={`rounded-lg min-h-12 flex flex-col items-center justify-center gap-0.5 touch-manipulation border-2 ${pick === d ? "border-[#1e4fa3]" : "border-transparent"} ${st ? CELL[st] : "bg-slate-50 text-slate-300"}`}>
            <span className="text-[10px] leading-none opacity-70">{+d.slice(8)}</span>
            <span className="text-sm font-medium leading-none">{st ? STATUS_SHORT[st] : d > today ? "" : "·"}</span>
            <span className="flex gap-0.5 h-1.5">{r && st && st !== "absent" && MEALS.map((m) => <span key={m.key} className={`w-1.5 h-1.5 rounded-full ${dot(r[m.col])}`} />)}</span>
          </button>); })}
      </div>
      {pick && <div className="text-sm rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 space-y-0.5">
        <div className="font-medium">{dayName(pick)} {+pick.slice(8)} — {ps ? STATUS_LABEL[ps] : "not marked"}</div>
        {pr ? MEALS.map((m) => <div key={m.key} className="text-slate-600"><span className="inline-block w-20 text-slate-400">{m.label}</span>{vName(pr[m.col])}</div>) : <div className="text-slate-400">No attendance saved for this day.</div>}
      </div>}
      <p className="text-[11px] text-slate-400">P present · A absent · ½ half-day · W weekly off. Dots under a day: breakfast, lunch, dinner — coloured by vendor, grey = none. Tap a day for details.</p>
    </div>
  );
}

// A month at a glance: person × day grid, days worked, and meal counts and cost per vendor.
export default function AttendanceMonth({ projectId, projectName, vendors, rates }: { projectId: string; projectName: string; vendors: Vendor[]; rates: MealRate[] }) {
  const [month, setMonth] = useState(istToday().slice(0, 7)); const [people, setPeople] = useState<Person[]>([]); const [rows, setRows] = useState<AttRow[]>([]); const [loading, setLoading] = useState(true); const [showGrid, setShowGrid] = useState(false); const [openId, setOpenId] = useState<string | null>(null); const [err, setErr] = useState("");
  const first = `${month}-01`; const lastDay = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate(); const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const days = Array.from({ length: lastDay }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);

  useEffect(() => { (async () => {
    setLoading(true); setErr(""); const sb = supabase();
    const { data: ppl, error } = await sb.rpc("attendance_roster", { p_project: projectId, p_from: first, p_to: last });
    if (error) { setErr(error.message); setLoading(false); return; } setPeople((ppl || []) as Person[]);
    const all: AttRow[] = []; for (let from = 0; ; from += 1000) {   // the server returns at most 1000 rows per request
      const { data, error: e } = await sb.from("attendance").select("*").eq("project_id", projectId).gte("work_date", first).lte("work_date", last).order("work_date").range(from, from + 999);
      if (e) { setErr(e.message); break; } all.push(...((data || []) as AttRow[])); if (!data || data.length < 1000) break;
    }
    setRows(all); setLoading(false);
  })(); }, [projectId, month]);

  const vName = (id: string | null) => vendors.find((v) => v.id === id)?.name ?? "";
  const calc = useMemo(() => {
    const byPerson: Record<string, Record<string, AttRow>> = {}; rows.forEach((r) => { (byPerson[r.employee_id] ??= {})[r.work_date] = r; });
    let missing = false; const rate = (r: AttRow, m: (typeof MEALS)[number]) => { const v = r[m.col]; if (!v) return 0; const x = rateFor(rates, v, m.key, r.work_date); if (x === null) { missing = true; return 0; } return x; };
    const per = people.map((p) => { const mine = Object.values(byPerson[p.employee_id] || {}); const meals = MEALS.map((m) => mine.filter((r) => r[m.col]).length); const cost = mine.reduce((s, r) => s + MEALS.reduce((t, m) => t + rate(r, m), 0), 0);
      return { p, mine, worked: daysWorked(mine), absent: mine.filter((r) => r.status === "absent").length, meals, cost }; });
    const vend = vendors.map((v) => { const counts = MEALS.map((m) => rows.filter((r) => r[m.col] === v.id).length); const cost = rows.reduce((s, r) => s + MEALS.reduce((t, m) => t + (r[m.col] === v.id ? rate(r, m) : 0), 0), 0); return { v, counts, cost }; }).filter((x) => x.counts.some(Boolean));
    return { byPerson, per, vend, missing, totalCost: per.reduce((s, x) => s + x.cost, 0) };
  }, [people, rows, rates, vendors]);

  const thisYear = +istToday().slice(0, 4); const years = Array.from({ length: 6 }, (_, i) => String(thisYear - 4 + i)); if (!years.includes(month.slice(0, 4))) years.push(month.slice(0, 4));
  const shift = (n: number) => { const d = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1); setMonth(toISO(d).slice(0, 7)); };
  const dl = (name: string, table: (string | number)[][]) => { const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + table.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" })); a.download = `${projectName} - ${name} ${month}.csv`; a.click(); };
  const totalsCsv = () => dl("attendance totals", [["Name", "Emp no.", "Days worked", "Absent days", "Breakfasts", "Lunches", "Dinners", "Meal cost"], ...calc.per.map((x) => [x.p.full_name, x.p.emp_no ?? "", x.worked, x.absent, ...x.meals, x.cost])]);
  const detailCsv = () => dl("attendance daily", [["Name", "Emp no.", "Date", "Status", "Breakfast", "Lunch", "Dinner"], ...rows.map((r) => { const p = people.find((x) => x.employee_id === r.employee_id); return [p?.full_name ?? "", p?.emp_no ?? "", r.work_date, r.status, vName(r.breakfast_vendor_id), vName(r.lunch_vendor_id), vName(r.dinner_vendor_id)]; })]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2"><button type="button" className="btn !px-4 touch-manipulation" onClick={() => shift(-1)} aria-label="Previous month">←</button>
          <select className="inp flex-1 min-w-0" aria-label="Month" value={month.slice(5, 7)} onChange={(e) => setMonth(`${month.slice(0, 4)}-${e.target.value}`)}>{MONTH_NAMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, "0")}>{n}</option>)}</select>
          <select className="inp !w-24 shrink-0" aria-label="Year" value={month.slice(0, 4)} onChange={(e) => setMonth(`${e.target.value}-${month.slice(5, 7)}`)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <button type="button" className="btn !px-4 touch-manipulation" onClick={() => shift(1)} aria-label="Next month">→</button></div>
        <div className="flex justify-center gap-6 text-sm sm:hidden"><button className="text-blue-700 disabled:text-slate-300 min-h-11" onClick={totalsCsv} disabled={!people.length}>↓ Totals CSV</button><button className="text-blue-700 disabled:text-slate-300 min-h-11" onClick={detailCsv} disabled={!rows.length}>↓ Daily CSV</button></div>
        <div className="hidden sm:flex gap-2"><button className="btn justify-center sm:ml-auto" onClick={totalsCsv} disabled={!people.length}>⬇ Totals CSV</button><button className="btn justify-center" onClick={detailCsv} disabled={!rows.length}>⬇ Daily CSV</button></div>
      </div>
      {err && <p className="warn">{err}</p>}
      {loading && <p className="card text-center text-sm text-slate-500">Loading…</p>}
      {!loading && !err && !people.length && <p className="card text-center text-sm text-slate-500">Nobody on this project for this month.</p>}
      {!loading && people.length > 0 && <>
        {/* phones: a card per person with the month's totals; the day-by-day grid is one tap away */}
        <div className="space-y-2 md:hidden">
          <p className="text-xs text-slate-400">Tap a person to see their month.</p>
          {calc.per.map((x) => { const open = openId === x.p.employee_id; return (
            <div key={x.p.employee_id} className="rounded-2xl bg-white border border-slate-200/80 overflow-hidden">
              <button type="button" className="w-full text-left p-3 space-y-1 touch-manipulation" aria-expanded={open} onClick={() => setOpenId(open ? null : x.p.employee_id)}>
                <div className="flex items-baseline gap-2"><span className="text-[15px] font-medium text-slate-900 min-w-0 flex-1 truncate">{x.p.full_name}</span><span className="text-lg font-medium tabular-nums">{x.worked}<span className="text-xs font-normal text-slate-400"> days</span></span><span className="text-slate-400 text-sm" aria-hidden>{open ? "▲" : "▼"}</span></div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500"><span>Absent <b className="font-medium text-slate-700">{x.absent}</b></span><span>Breakfast <b className="font-medium text-slate-700">{x.meals[0]}</b></span><span>Lunch <b className="font-medium text-slate-700">{x.meals[1]}</b></span><span>Dinner <b className="font-medium text-slate-700">{x.meals[2]}</b></span>{x.cost > 0 && <span>Meals ₹<b className="font-medium text-slate-700">{inr(x.cost)}</b></span>}</div>
              </button>
              {open && <div className="px-3 pb-3 border-t border-slate-100"><PersonCalendar person={x.p} days={days} byDate={calc.byPerson[x.p.employee_id] || {}} vendors={vendors} today={istToday()} /></div>}
            </div>); })}
          <button type="button" className="btn w-full justify-center touch-manipulation" onClick={() => setShowGrid(!showGrid)} aria-expanded={showGrid}>{showGrid ? "Hide everyone\u2019s grid ▲" : "Show everyone\u2019s grid (swipe sideways) ▼"}</button>
          {showGrid && <div className="overflow-x-auto border-t border-slate-100">

          <table className="text-xs border-collapse"><thead className="bg-slate-50 text-slate-500"><tr><th className="sticky left-0 bg-slate-50 text-left p-2 min-w-40 z-10">Name</th>{days.map((d) => <th key={d} className={`p-1 w-7 font-medium ${dayName(d) === "Sunday" ? "text-red-500" : ""}`}><div>{+d.slice(8)}</div><div className="text-[9px] font-normal">{dayName(d)[0]}</div></th>)}<th className="p-2">Days</th><th className="p-2">Abs</th><th className="p-2">B</th><th className="p-2">L</th><th className="p-2">D</th></tr></thead>
            <tbody>{calc.per.map((x) => <tr key={x.p.employee_id} className="border-t border-slate-100"><td className="sticky left-0 bg-white p-2 font-medium whitespace-nowrap z-10">{x.p.full_name}</td>
              {days.map((d) => { const r = calc.byPerson[x.p.employee_id]?.[d]; const st = d < (x.p.join_date ?? "") ? null : effectiveStatus(x.p, d, r); return <td key={d} className="p-0.5 text-center"><span title={r ? [vName(r.breakfast_vendor_id), vName(r.lunch_vendor_id), vName(r.dinner_vendor_id)].filter(Boolean).join(" / ") : ""} className={`inline-block w-6 rounded py-0.5 ${st ? CELL[st] : d > istToday() ? "" : "text-slate-300"}`}>{st ? STATUS_SHORT[st] : d > istToday() ? "" : "·"}</span></td>; })}
              <td className="p-2 text-center font-semibold">{x.worked}</td><td className="p-2 text-center">{x.absent}</td>{x.meals.map((n, i) => <td key={i} className="p-2 text-center">{n}</td>)}</tr>)}</tbody></table>
          </div>}
        </div>
        <div className="card !p-0 overflow-x-auto hidden md:block">

          <table className="text-xs border-collapse"><thead className="bg-slate-50 text-slate-500"><tr><th className="sticky left-0 bg-slate-50 text-left p-2 min-w-40 z-10">Name</th>{days.map((d) => <th key={d} className={`p-1 w-7 font-medium ${dayName(d) === "Sunday" ? "text-red-500" : ""}`}><div>{+d.slice(8)}</div><div className="text-[9px] font-normal">{dayName(d)[0]}</div></th>)}<th className="p-2">Days</th><th className="p-2">Abs</th><th className="p-2">B</th><th className="p-2">L</th><th className="p-2">D</th></tr></thead>
            <tbody>{calc.per.map((x) => <tr key={x.p.employee_id} className="border-t border-slate-100"><td className="sticky left-0 bg-white p-2 font-medium whitespace-nowrap z-10">{x.p.full_name}</td>
              {days.map((d) => { const r = calc.byPerson[x.p.employee_id]?.[d]; const st = d < (x.p.join_date ?? "") ? null : effectiveStatus(x.p, d, r); return <td key={d} className="p-0.5 text-center"><span title={r ? [vName(r.breakfast_vendor_id), vName(r.lunch_vendor_id), vName(r.dinner_vendor_id)].filter(Boolean).join(" / ") : ""} className={`inline-block w-6 rounded py-0.5 ${st ? CELL[st] : d > istToday() ? "" : "text-slate-300"}`}>{st ? STATUS_SHORT[st] : d > istToday() ? "" : "·"}</span></td>; })}
              <td className="p-2 text-center font-semibold">{x.worked}</td><td className="p-2 text-center">{x.absent}</td>{x.meals.map((n, i) => <td key={i} className="p-2 text-center">{n}</td>)}</tr>)}</tbody></table>
        </div>
        <p className="text-xs text-slate-400">P present · A absent · ½ half-day · W weekly off · · not marked. Days = present + ½ per half-day. B / L / D = breakfasts, lunches, dinners taken.</p>
        <div className="card space-y-2"><h3 className="font-semibold">Meals by vendor</h3>
          {calc.vend.length ? <div className="overflow-x-auto"><table className="text-sm w-full"><thead className="text-left text-slate-500"><tr><th className="py-1">Vendor</th>{MEALS.map((m) => <th key={m.key} className="text-right">{m.label}</th>)}<th className="text-right">Cost</th></tr></thead>
            <tbody>{calc.vend.map((x) => <tr key={x.v.id} className="border-t border-slate-100"><td className="py-1.5 font-medium">{x.v.name}</td>{x.counts.map((n, i) => <td key={i} className="text-right">{n}</td>)}<td className="text-right font-medium">{x.cost ? `₹${inr(x.cost)}` : "—"}</td></tr>)}
              <tr className="border-t border-slate-200 font-semibold"><td className="py-1.5">Total</td>{MEALS.map((m, i) => <td key={m.key} className="text-right">{calc.vend.reduce((s, x) => s + x.counts[i], 0)}</td>)}<td className="text-right">{calc.totalCost ? `₹${inr(calc.totalCost)}` : "—"}</td></tr></tbody></table></div> : <p className="text-sm text-slate-400">No meals recorded this month.</p>}
          {calc.missing && <p className="warn">Some meals have no price set for their date, so they aren't in the cost. Enter prices under Settings → Food vendors.</p>}
        </div>
      </>}
    </div>
  );
}
