"use client";
import { useState } from "react";
import { matchIn } from "@/lib/policeStations";

// A dropdown over a fixed list (states, police districts, police stations) with a way out: "Not in the list" turns it into a text box, and
// "Choose from the list" turns it back. A value already saved that is not in the list is kept and shown as it is. With no list (not loaded,
// or nothing for the state / district chosen) it is a plain text box, so nothing is ever blocked.
export default function ListPick({ id, value, options, onChange, other = "Not in the list (type it)", back = "Choose from the list", lang }: {
  id?: string; value: string | null | undefined; options: string[]; onChange: (v: string) => void; other?: string; back?: string; lang?: string }) {
  const [typing, setTyping] = useState(false);
  const v = String(value ?? ""); const hit = matchIn(options, v);
  if (!options.length || typing) return (
    <div className="space-y-1">
      <input id={id} className="inp" lang={lang} value={v} onChange={(e) => onChange(e.target.value)} />
      {options.length > 0 && <button type="button" className="text-xs text-blue-700 underline" onClick={() => { setTyping(false); if (!matchIn(options, v)) onChange(""); }}>{back}</button>}
    </div>);
  return (
    <select id={id} className="inp" value={hit || v} onChange={(e) => { if (e.target.value === "\u0000other") { setTyping(true); onChange(""); } else onChange(e.target.value); }}>
      <option value=""></option>
      {v && !hit && <option value={v}>{v}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value={"\u0000other"}>{other}</option>
    </select>);
}
