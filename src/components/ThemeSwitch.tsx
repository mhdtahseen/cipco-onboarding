"use client";
import { useEffect, useState } from "react";
import { getMode, setMode, type ThemeMode } from "@/lib/theme";

// Appearance choice for the profile menu: System (default), Light or Dark.
const OPTIONS: { v: ThemeMode; label: string }[] = [{ v: "system", label: "System" }, { v: "light", label: "Light" }, { v: "dark", label: "Dark" }];

export default function ThemeSwitch() {
  const [mode, set] = useState<ThemeMode>("system");
  useEffect(() => { set(getMode()); }, []);
  const pick = (v: ThemeMode) => { set(v); setMode(v); };
  return (
    <div className="px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5" id="appearance-label">Appearance</div>
      <div role="radiogroup" aria-labelledby="appearance-label" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {OPTIONS.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={mode === o.v} onClick={() => pick(o.v)}
            className={`min-h-9 rounded-md text-xs font-medium touch-manipulation ${mode === o.v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}
