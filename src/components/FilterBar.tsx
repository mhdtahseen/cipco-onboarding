"use client";
import { useState } from "react";

/** A dropdown filter. It stands out when it is narrowing the list, so you can see at a glance what is applied. */
export function FilterSelect({ label, value, onChange, children, width = "!w-44", on }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; width?: string; on?: boolean }) {
  return <select className={`inp ${width} ${(on ?? !!value) ? "!border-[#1e4fa3] !bg-blue-50/60" : ""}`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>;
}

/**
 * The row of filters under a list's search box. On a phone it folds behind a "Filters" button, with the number applied.
 * Always says how many rows are showing out of how many, and offers one click to clear everything.
 */
export default function FilterBar({ active, onClear, shown, total, noun, children }: { active: number; onClear: () => void; shown: number; total: number; noun: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="sm:hidden"><button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>Filters{active > 0 ? ` (${active})` : ""}</button></div>
      <div className={`${open ? "flex" : "hidden"} sm:flex flex-wrap items-center gap-2`}>{children}</div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500" aria-live="polite"><span>Showing {shown} of {total} {noun}</span>{active > 0 && <button type="button" className="underline text-blue-700" onClick={onClear}>Clear filters</button>}</div>
    </div>
  );
}
