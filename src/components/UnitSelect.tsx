"use client";
import { UNITS } from "@/lib/units";

/** A unit dropdown. A unit already saved that is not in the list (an old "Nos" or "Lot") stays selectable, so opening an old record never changes it silently. */
export default function UnitSelect({ value, onChange, list = UNITS, blank, className = "inp", ariaLabel }: { value: string; onChange: (u: string) => void; list?: string[]; blank?: string; className?: string; ariaLabel?: string }) {
  const extra = value && !list.includes(value) ? [value] : [];
  return (
    <select className={className} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {(blank !== undefined || !value) && <option value="">{blank ?? "Select"}</option>}
      {[...list, ...extra].map((u) => <option key={u} value={u}>{u}</option>)}
    </select>
  );
}
