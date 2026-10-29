"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "./NavIcons";
import type { SortDir, SortOption, SortState } from "@/lib/sorting";

/** The chosen sort, remembered in this browser per list. Falls back to the default if the saved key no longer exists. */
export function useSortState<K extends string>(storeKey: string, def: SortState<K>, options: SortOption<K>[]) {
  const [sort, set] = useState<SortState<K>>(def);
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(storeKey) || "null"); if (s && options.some((o) => o.key === s.key) && (s.dir === "asc" || s.dir === "desc")) set(s); } catch { /* storage unavailable */ } }, [storeKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setSort = useCallback((s: SortState<K>) => { set(s); try { localStorage.setItem(storeKey, JSON.stringify(s)); } catch { /* ignore */ } }, [storeKey]);
  return [sort, setSort] as const;
}

/** "Sort by" menu with a direction button. Choosing a different field starts in its natural direction (newest, largest, A to Z). */
export default function SortControl<K extends string>({ options, value, onChange }: { options: SortOption<K>[]; value: SortState<K>; onChange: (s: SortState<K>) => void }) {
  const flip = (d: SortDir): SortDir => (d === "asc" ? "desc" : "asc");
  const cur = options.find((o) => o.key === value.key);
  return (
    <div className="flex items-center gap-1">
      <select className="inp !w-44" aria-label="Sort by" value={value.key} onChange={(e) => { const o = options.find((x) => x.key === e.target.value)!; onChange({ key: o.key, dir: o.dir }); }}>
        {options.map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
      </select>
      <button type="button" className="btn !px-2" onClick={() => onChange({ ...value, dir: flip(value.dir) })} aria-label={`${cur?.label ?? "Sort"}: ${value.dir === "asc" ? "ascending" : "descending"}. Click to reverse`} title={value.dir === "asc" ? "Ascending, click to reverse" : "Descending, click to reverse"}>
        <Icon name={value.dir === "asc" ? "arrow-up" : "arrow-down"} className="h-4 w-4" />
      </button>
    </div>
  );
}
