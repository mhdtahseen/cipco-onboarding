"use client";
import { useMemo, useState } from "react";
import { analysis, baseScenario, forecast, type ForecastInput, type Scenario } from "@/lib/forecast";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${inr(Math.abs(n))}`;
const monthLong = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

// One project's forecast for next month: what you have put in, what is owed, what next month is likely to cost, and what happens if something changes.
// The what-ifs only change the sums on this screen, never your records, and start again when the page is reloaded.
export default function ForecastView({ input: i }: { input: ForecastInput }) {
  const start = useMemo(() => baseScenario(i), [i]); const [s, setS] = useState<Scenario>(start);
  const f = useMemo(() => forecast(i, s), [i, s]); const notes = useMemo(() => analysis(i, f, s), [i, f, s]);
  const diff = f.changed - f.likely, isChanged = Math.abs(diff) >= 1, maxLine = Math.max(1, ...f.lines.map((l) => Math.max(l.likely, l.changed)));
  const set = (k: keyof Scenario, v: number | boolean) => setS((c) => ({ ...c, [k]: v }));
  const tile = (label: string, value: string, sub: string, tone = "") => <div className="rounded-2xl bg-white border border-slate-200/80 p-3"><div className="text-xs text-slate-500">{label}</div><div className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</div><div className="text-[11px] text-slate-500">{sub}</div></div>;
  const stepper = (label: string, k: "addDaily" | "addSalaried" | "extraRooms", min: number) => <div><div className="lbl">{label}</div><div className="flex items-center gap-1"><button type="button" className="btn !px-3" aria-label={`Fewer: ${label}`} disabled={s[k] <= min} onClick={() => set(k, s[k] - 1)}>−</button><span className="w-10 text-center font-medium tabular-nums" aria-live="polite">{s[k] > 0 ? `+${s[k]}` : s[k]}</span><button type="button" className="btn !px-3" aria-label={`More: ${label}`} onClick={() => set(k, s[k] + 1)}>+</button></div></div>;
  const amount = (label: string, k: "dailyCost" | "salariedCost" | "mealPerPersonDay" | "roomRent" | "transport" | "other") => <div><label className="lbl">{label}</label><input className="inp !w-full" inputMode="numeric" value={s[k]} onChange={(e) => set(k, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)} /></div>;
  const month = monthLong(i.month), monthShort = month.split(" ")[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tile("Your money in so far", inr(i.spent + i.deposits), `${inr(i.spent)} expenses${i.deposits ? ` + ${inr(i.deposits)} refundable deposit` : ""}`)}
        {tile("Still owed now", inr(i.owedNow), "due now or this month", i.owedNow > 0 ? "text-rose-700" : "text-emerald-700")}
        {tile(`${monthShort} forecast`, inr(f.likely), `could be ${inr(f.low)} to ${inr(f.high)}`)}
        {tile("With your changes", isChanged ? inr(f.changed) : "No changes", isChanged ? `${signed(diff)} a month · ${f.peopleAfter} people` : "use What if below", isChanged ? (diff > 0 ? "text-rose-700" : "text-emerald-700") : "text-slate-400")}
      </div>

      <section className="card space-y-3"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">What if…</h2><span className="text-xs text-slate-500">{f.people} people now. These change the sums here only, never your records.</span>{isChanged && <button type="button" className="btn btn-sm sm:ml-auto" onClick={() => setS(start)}>Reset</button>}</div>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {stepper("Daily-wage workers", "addDaily", -i.daily.n)}{amount("Each costs, a month (₹)", "dailyCost")}{stepper("Salaried staff", "addSalaried", -i.salaried.n)}{amount("Each costs, a month (₹)", "salariedCost")}
          {stepper("Extra rooms by choice", "extraRooms", 0)}{amount("Rent per room (₹)", "roomRent")}{amount("Meals, per person a day (₹)", "mealPerPersonDay")}{amount("Transport, a month (₹)", "transport")}
          {s.includeOther && amount("Other costs, a month (₹)", "other")}
          <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={s.includeOther} onChange={(e) => set("includeOther", e.target.checked)} />Include other costs</label>
        </div>
        {f.bedsShort > 0 && <p className="text-sm text-amber-900 bg-amber-50 rounded-xl px-3 py-2">{f.peopleAfter} people need {f.bedsShort} more bed{f.bedsShort === 1 ? "" : "s"} than you have, so {f.roomsNeeded} more room{f.roomsNeeded === 1 ? " is" : "s are"} included at {inr(s.roomRent)} each.</p>}</section>

      <section className="card space-y-3"><h2 className="font-semibold">{month}, cost by cost</h2>
        <div className="hidden md:grid gap-x-4 md:grid-cols-[minmax(0,1fr)_7rem_11rem_7rem] text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 pb-1"><span>Cost</span><span className="text-right">Likely</span><span className="text-right">Could be</span><span className="text-right">With changes</span></div>
        <ul className="divide-y divide-slate-100">{f.lines.map((l) => { const moved = Math.abs(l.changed - l.likely) >= 1; return (
          <li key={l.key} className="py-2.5 grid gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1fr)_7rem_11rem_7rem] items-baseline">
            <div className="min-w-0"><div className="font-medium">{l.label}</div><div className="text-xs text-slate-500">{l.basis}</div><div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden" title={`${l.label}: ${inr(l.likely)}, ${Math.round((l.likely / Math.max(1, f.likely)) * 100)}% of the forecast`}><div className="h-full rounded-full bg-[#1e4fa3]" style={{ width: `${(l.likely / maxLine) * 100}%` }} /></div></div>
            <div className="flex md:block justify-between md:text-right"><span className="md:hidden text-xs text-slate-500">Likely</span><b className="tabular-nums">{inr(l.likely)}</b></div>
            <div className="flex md:block justify-between md:text-right text-xs text-slate-500 tabular-nums"><span className="md:hidden">Could be</span><span>{Math.abs(l.high - l.low) < 1 ? "fixed" : `${inr(l.low)} – ${inr(l.high)}`}</span></div>
            <div className="flex md:block justify-between md:text-right text-sm tabular-nums"><span className="md:hidden text-xs text-slate-500">With changes</span>{moved ? <span className={l.changed > l.likely ? "text-rose-700 font-medium" : "text-emerald-700 font-medium"}>{inr(l.changed)}</span> : <span className="text-slate-300">–</span>}</div></li>); })}
          <li className="py-2.5 grid gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1fr)_7rem_11rem_7rem] items-baseline font-semibold"><div>Total for {monthShort}</div><div className="flex md:block justify-between md:text-right"><span className="md:hidden text-xs font-normal text-slate-500">Likely</span><span className="tabular-nums">{inr(f.likely)}</span></div><div className="flex md:block justify-between md:text-right text-xs font-normal text-slate-500 tabular-nums"><span className="md:hidden">Could be</span><span>{inr(f.low)} – {inr(f.high)}</span></div><div className="flex md:block justify-between md:text-right text-sm tabular-nums"><span className="md:hidden text-xs font-normal text-slate-500">With changes</span>{isChanged ? <span className={diff > 0 ? "text-rose-700" : "text-emerald-700"}>{inr(f.changed)}</span> : <span className="text-slate-300 font-normal">–</span>}</div></li></ul></section>

      <section className="card space-y-2"><h2 className="font-semibold">What this tells you</h2><ul className="space-y-1.5 text-sm text-slate-700">{notes.map((n, k) => <li key={k} className="flex gap-2"><span className="text-slate-400">•</span><span>{n}</span></li>)}</ul></section>

      <p className="text-xs text-slate-500">How it is worked out: each cost comes from what causes it (people × rate × days, meals × price, rooms × rent, trips × rate), using the last {i.windowDays} days. "Could be" uses the lowest and highest of the last three weeks; for other costs, the low leaves out the largest kind of cost. The total's range assumes every line is low or high together, so the real figure should sit inside it. It assumes full pay, with no loss-of-pay days, and leaves out client income.</p>
    </div>
  );
}
