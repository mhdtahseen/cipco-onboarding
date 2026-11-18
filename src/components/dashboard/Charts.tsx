"use client";
import { useEffect, useRef, useState } from "react";

// The Dashboard's charts, drawn as plain SVG (no chart library). Shared rules: thin marks with a 2px gap between touching segments and a rounded data end,
// hairline grid, text in the ink colours (never the series colour), a legend whenever there are two or more series, a tooltip on hover or tap,
// and the same numbers available as a table under each chart. Series colours come from CSS variables set on .dash (light and dark picked separately).
export type Series = { key: string; label: string; color: string };
export const DASH_CSS = `
.dash { --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --mute:#9aa3b5; --grid:var(--line); --tip-bg:#1b2233; --tip-ink:#fff; }
html.dark .dash { --s1:#3987e5; --s2:#d95926; --s3:#199e70; --mute:#5b6680; --tip-bg:#e6eaf2; --tip-ink:#0e1420; }`;
export const shortNum = (n: number) => (n >= 1e7 ? `${+(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${+(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const niceMax = (v: number) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null); const [w, setW] = useState(typeof window === "undefined" ? 320 : 0);   // a width to draw with before the browser has measured
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect(); }, []);
  return [ref, w] as const;
}

export function Legend({ series }: { series: Series[] }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">{series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}</div>;
}

/** Columns over time; with several series they stack. data: one entry per column, values keyed by series. */
export function Columns({ data, series, height = 180, fmt = shortNum, tickFmt, tickEvery }: { data: { label: string; tip: string; v: Record<string, number> }[]; series: Series[]; height?: number; fmt?: (n: number) => string; tickFmt?: (n: number) => string; tickEvery?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>(); const [hot, setHot] = useState<number | null>(null);
  const axis = tickFmt ?? fmt, padL = 40, padB = 20, padT = 8, W = Math.max(w, 120), plotW = W - padL - 4, plotH = height - padB - padT;
  const totals = data.map((d) => series.reduce((s, x) => s + (d.v[x.key] || 0), 0)); const max = niceMax(Math.max(...totals, 0));
  const band = plotW / Math.max(data.length, 1), bw = Math.min(24, Math.max(3, band - 4));
  const every = tickEvery ?? Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 46))));
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  return (
    <div ref={ref} className="relative select-none" onMouseLeave={() => setHot(null)}>
      {w > 0 && <svg width={W} height={height} role="img" aria-label="Chart: the same numbers are in the table below">
        {[0, 0.5, 1].map((t) => <g key={t}><line x1={padL} x2={W - 4} y1={y(max * t)} y2={y(max * t)} stroke="var(--grid)" strokeWidth="1" /><text x={padL - 6} y={y(max * t) + 3.5} textAnchor="end" fontSize="10" fill="var(--ink2)">{axis(max * t)}</text></g>)}
        {data.map((d, i) => { const x = padL + i * band + (band - bw) / 2; let acc = 0; const top = series.filter((s) => (d.v[s.key] || 0) > 0).slice(-1)[0]?.key;
          return (
            <g key={i}>
              {hot === i && <rect x={padL + i * band} y={padT} width={band} height={plotH} fill="var(--hover)" />}
              {series.map((s) => { const v = d.v[s.key] || 0; if (v <= 0) return null; const y0 = y(acc), y1 = y(acc + v); acc += v; const h = Math.max(1, y0 - y1 - (s.key === top ? 0 : 2)), r = s.key === top ? Math.min(4, bw / 2, h) : 0;
                return <path key={s.key} fill={s.color} d={`M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + bw - r} Q${x + bw},${y0 - h} ${x + bw},${y0 - h + r} V${y0} Z`} />; })}
              {i % every === 0 && <text x={padL + i * band + band / 2} y={height - 5} textAnchor="middle" fontSize="10" fill="var(--ink2)">{d.label}</text>}
              <rect x={padL + i * band} y={0} width={band} height={height} fill="transparent" onMouseEnter={() => setHot(i)} onClick={() => setHot(hot === i ? null : i)} />
            </g>); })}
      </svg>}
      {hot !== null && data[hot] && <div className="pointer-events-none absolute z-10 rounded-lg px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap" style={{ background: "var(--tip-bg)", color: "var(--tip-ink)", top: 0, left: Math.min(Math.max(0, padL + hot * band + band / 2 - 70), Math.max(0, W - 150)) }}>
        <div className="font-semibold">{data[hot].tip}</div>
        {series.map((s) => <div key={s.key} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{series.length > 1 ? `${s.label}: ` : ""}{fmt(data[hot].v[s.key] || 0)}</div>)}
        {series.length > 1 && <div className="opacity-80">Total: {fmt(totals[hot])}</div>}
      </div>}
    </div>);
}

/** Horizontal bars, one row per item; with several series they stack. The value is written at the end of each row. */
export function Rows({ rows, series, fmt = shortNum, empty = "Nothing to show." }: { rows: { label: string; sub?: string; v: Record<string, number> }[]; series: Series[]; fmt?: (n: number) => string; empty?: string }) {
  const max = Math.max(...rows.map((r) => series.reduce((s, x) => s + (r.v[x.key] || 0), 0)), 0);
  if (!rows.length || max <= 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="space-y-2">{rows.map((r) => { const total = series.reduce((s, x) => s + (r.v[x.key] || 0), 0);
      return (
        <div key={r.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-x-3 text-sm" title={series.length > 1 ? series.map((s) => `${s.label}: ${fmt(r.v[s.key] || 0)}`).join(" · ") : undefined}>
          <div className="truncate"><span>{r.label}</span>{r.sub && <span className="text-xs text-slate-400"> {r.sub}</span>}</div>
          <div className="flex h-2.5 gap-[2px]">{series.map((s, i) => { const v = r.v[s.key] || 0; if (v <= 0) return null; const last = series.slice(i + 1).every((x) => !(r.v[x.key] > 0));
            return <span key={s.key} style={{ width: `${(v / max) * 100}%`, background: s.color, borderRadius: last ? "0 4px 4px 0" : 0, minWidth: 2 }} />; })}</div>
          <div className="tabular-nums font-medium text-right">{fmt(total)}</div>
        </div>); })}</div>);
}

/** A thin meter: how much of a whole is done. */
export function Meter({ value, of, color = "var(--s1)" }: { value: number; of: number; color?: string }) {
  const pct = of > 0 ? Math.min(100, (value / of) * 100) : 0;
  return <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--grid)" }} role="img" aria-label={`${value} of ${of}`}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>;
}

/** The numbers behind a chart, for anyone who prefers a table (and for screen readers). */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="text-xs text-slate-500"><summary className="cursor-pointer">Show as a table</summary>
      <div className="overflow-x-auto mt-1"><table className="w-full text-left"><thead><tr>{head.map((h) => <th key={h} className="py-1 pr-3 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="py-1 pr-3 tabular-nums">{c}</td>)}</tr>)}</tbody></table></div></details>);
}
