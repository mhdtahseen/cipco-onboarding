"use client";
import { DEFAULT_CFG, PRESETS, calcSalary, inr, type SalaryCfg } from "@/lib/salary";

const num = (v: string) => (v === "" ? 0 : Number(v));
export default function SalaryEditor({ value, gender, onChange }: { value: Partial<SalaryCfg>; gender?: string | null; onChange: (c: Partial<SalaryCfg>) => void }) {
  const cfg = { ...DEFAULT_CFG, ...value } as SalaryCfg;
  const set = (p: Partial<SalaryCfg>) => onChange({ ...cfg, ...p });
  const calc = calcSalary(cfg, gender);
  const basisBtn = (k: SalaryCfg["basis"], label: string, hint: string) => (
    <label className={`flex-1 min-w-44 border rounded-xl p-3 cursor-pointer ${cfg.basis === k ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}>
      <input type="radio" className="mr-2" checked={cfg.basis === k} onChange={() => set({ basis: k, period: k === "inhand" || k === "daily" ? "month" : cfg.period, ...(k === "daily" ? { employer_in_ctc: false, pf_cap: true } : {}) })} /><span className="font-medium text-sm">{label}</span>
      <div className="text-xs text-slate-500 mt-1">{hint}</div>
    </label>);
  const Row = ({ l, m, a, b }: { l: string; m: number; a: number; b?: boolean }) => (<tr className={b ? "font-semibold bg-slate-50" : ""}><td className="py-1 pr-3">{l}</td><td className="py-1 text-right pr-3">{inr(m)}</td><td className="py-1 text-right">{inr(a)}</td></tr>);
  return (
    <div className="card space-y-4">
      <div><h3 className="font-semibold">Salary</h3><p className="text-sm text-slate-500">Choose which number you fix — everything else is calculated from it and printed in the letter’s Annexure A.</p></div>
      <div className="flex flex-wrap gap-3">
        {basisBtn("ctc", "CTC", "Total cost to company (incl. employer PF / ESI). Salary components are worked out from it.")}
        {basisBtn("inhand", "Net in-hand", "Take-home after PF, ESI and PT. CTC and gross are worked out backwards.")}
        {basisBtn("gross", "Gross", "Gross monthly salary before deductions.")}
        {basisBtn("daily", "Daily wage", "For site workers paid per day worked: 6 working days a week, one weekly off.")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><label className="lbl">{cfg.basis === "ctc" ? "CTC (₹)" : cfg.basis === "inhand" ? "Net in-hand per month (₹)" : cfg.basis === "daily" ? "Daily wage (₹ per day)" : "Gross (₹)"}</label>
          <input className="inp" type="number" value={cfg.amount || ""} onChange={(e) => set({ amount: num(e.target.value) })} /></div>
        {cfg.basis === "daily" && <div><label className="lbl">Working days per month <span className="font-normal text-slate-400">(estimate)</span></label><input className="inp" type="number" min={1} max={31} value={cfg.days_per_month ?? 26} onChange={(e) => set({ days_per_month: num(e.target.value) })} /><p className="text-xs text-slate-400 mt-1">6-day week, 1 weekly off ≈ 26. Use 30 if the weekly off is paid.</p></div>}
        {cfg.basis !== "inhand" && cfg.basis !== "daily" && <div><label className="lbl">Amount is per</label><select className="inp" value={cfg.period} onChange={(e) => set({ period: e.target.value as any })}><option value="month">Month</option><option value="year">Year</option></select></div>}
      </div>
      <details className="border border-slate-200 rounded-xl p-3" open={!!cfg.amount}>
        <summary className="text-sm font-medium cursor-pointer">{cfg.basis === "daily" ? "Deductions" : "Salary structure (how it is split)"}</summary>
        <div className="mt-3 space-y-3">
          {cfg.basis !== "daily" && <div className="flex flex-wrap gap-2">{PRESETS.map((p) => <button key={p.key} type="button" className="btn !text-xs" onClick={() => set(p.cfg)}>{p.label}</button>)}</div>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cfg.basis !== "daily" && <><div><label className="lbl">Basic is</label><select className="inp" value={cfg.basic_mode} onChange={(e) => set({ basic_mode: e.target.value as any, basic_value: e.target.value === "fixed" ? 15000 : 50 })}><option value="pct_gross">% of gross</option><option value="pct_ctc">% of CTC</option><option value="fixed">Fixed ₹ per month</option></select></div>
            <div><label className="lbl">{cfg.basic_mode === "fixed" ? "Basic (₹/month)" : "Basic (%)"}</label><input className="inp" type="number" value={cfg.basic_value} onChange={(e) => set({ basic_value: num(e.target.value) })} /></div>
            <div><label className="lbl">HRA (% of basic)</label><input className="inp" type="number" value={cfg.hra_pct} onChange={(e) => set({ hra_pct: num(e.target.value) })} /></div>
            </>}
            <div><label className="lbl">Professional Tax override (₹/month)</label><input className="inp" type="number" placeholder="auto (Maharashtra)" value={cfg.pt_monthly ?? ""} onChange={(e) => set({ pt_monthly: e.target.value === "" ? null : num(e.target.value) })} /></div>
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.pf_applicable} onChange={(e) => set({ pf_applicable: e.target.checked })} /> PF applicable</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.pf_cap} onChange={(e) => set({ pf_cap: e.target.checked })} /> Cap PF wage at ₹15,000</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.employer_in_ctc} onChange={(e) => set({ employer_in_ctc: e.target.checked })} /> CTC includes employer PF / EDLI / ESI <span className="text-xs text-slate-500">(off = CTC equals gross)</span></label>
          </div>
        </div>
      </details>
      {calc ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <table className="text-sm w-full"><thead><tr className="text-left text-slate-500 border-b"><th className="py-1">Component</th><th className="text-right pr-3">Monthly</th><th className="text-right">Annual</th></tr></thead>
            <tbody>
              {calc.daily ? <Row b l={`Estimated wages (${calc.labels.basic.replace("Daily Wages ", "")})`} m={calc.monthly.gross} a={calc.annual.gross} /> : <><Row l={calc.labels.basic} m={calc.monthly.basic} a={calc.annual.basic} /><Row l={calc.labels.hra} m={calc.monthly.hra} a={calc.annual.hra} /><Row l="Special allowance (balancing)" m={calc.monthly.special} a={calc.annual.special} /><Row b l="Gross" m={calc.monthly.gross} a={calc.annual.gross} /></>}
              {cfg.pf_applicable && <Row l="Employee PF" m={calc.monthly.pf} a={calc.annual.pf} />}<Row l="Employee ESI" m={calc.monthly.esi} a={calc.annual.esi} /><Row l="Professional Tax" m={calc.monthly.pt} a={calc.annual.pt} />
              <Row b l="Net in-hand" m={calc.monthly.net} a={calc.annual.net} />
              {cfg.employer_in_ctc && <><Row l="Employer PF + EDLI/admin" m={calc.monthly.erPF + calc.monthly.erAdmin} a={calc.annual.erPF + calc.annual.erAdmin} /><Row l="Employer ESI" m={calc.monthly.erESI} a={calc.annual.erESI} /></>}
              <Row b l="CTC" m={calc.monthly.ctc} a={calc.annual.ctc} />
            </tbody></table>
          <div className="space-y-2">{calc.warnings.map((w, i) => <p key={i} className="warn !mt-0">⚠ {w}</p>)}<p className="text-xs text-slate-500">Whole-rupee rounding. Professional Tax uses the Maharashtra slab — please confirm current slabs with your CA.</p></div>
        </div>
      ) : <p className="text-sm text-slate-500">Enter an amount to see the break-up.</p>}
    </div>
  );
}
