"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Employee } from "@/lib/types";

const BOXES = [
  { key: "call_notes", label: "Call notes", ph: "Availability, expected salary, notice period, first impression…" },
  { key: "interview_notes", label: "Interview notes", ph: "Panel feedback, skills, concerns, recommendation…" },
  { key: "notes", label: "General notes", ph: "Anything else worth remembering" },
] as const;

export default function NotesCard({ emp, onChange }: { emp: Employee; onChange: (e: Employee) => void }) {
  const [saved, setSaved] = useState(""); const [err, setErr] = useState("");
  async function save(key: string, value: string) {
    if (value === ((emp as any)[key] ?? "")) return;
    setErr(""); setSaved("");
    const { data, error } = await supabase().from("employees").update({ [key]: value || null, updated_at: new Date().toISOString() }).eq("id", emp.id).select().single();
    if (error) { setErr(error.message + " — has the latest SQL migration been run?"); return; }
    onChange(data as Employee); setSaved(BOXES.find((b) => b.key === key)!.label + " saved ✓"); setTimeout(() => setSaved(""), 2000);
  }
  const has = BOXES.some((b) => (emp as any)[b.key]);
  return (
    <details className="card !py-3" open={has}>
      <summary className="cursor-pointer text-sm font-semibold">Notes <span className="font-normal text-slate-400">— call, interview &amp; general</span>{saved && <span className="ml-3 text-xs font-normal text-green-700">{saved}</span>}</summary>
      <div className="grid gap-3 mt-3 md:grid-cols-3">
        {BOXES.map((b) => (
          <div key={b.key}><label className="lbl">{b.label}</label>
            <textarea className="inp" rows={5} placeholder={b.ph} defaultValue={(emp as any)[b.key] ?? ""} onBlur={(e) => save(b.key, e.target.value)} /></div>))}
      </div>
      {err && <p className="warn">{err}</p>}
    </details>
  );
}
