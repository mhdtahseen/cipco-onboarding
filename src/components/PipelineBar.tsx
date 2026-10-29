"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { REJECT_REASONS, STAGES, stageIndex, stageLabel } from "@/lib/pipeline";
import type { Employee } from "@/lib/types";
import { Icon } from "./NavIcons";

export default function PipelineBar({ emp, onChange }: { emp: Employee; onChange: (e: Employee) => void }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(REJECT_REASONS[0]); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const rejected = emp.outcome === "rejected"; const cur = stageIndex(emp.stage);
  async function patch(p: Record<string, any>) {
    setBusy(true); setErr("");
    const { data, error } = await supabase().from("employees").update({ ...p, updated_at: new Date().toISOString() }).eq("id", emp.id).select().single();
    setBusy(false); if (error) { setErr(error.message + " — has the pipeline SQL migration been run?"); return false; }
    onChange(data as Employee); return true;
  }
  const next = !rejected ? STAGES[cur + 1] : undefined;
  // Moving one step forward is the normal case and needs no question; jumping or going back could be a slip of the finger, so ask first.
  const setStage = (k: string) => {
    if (rejected || k === emp.stage) return; const d = stageIndex(k) - cur;
    if (d !== 1 && !confirm(d < 0 ? `Move back from ${stageLabel(emp.stage)} to ${stageLabel(k)}?` : `Skip ahead from ${stageLabel(emp.stage)} to ${stageLabel(k)}? The steps in between will show as done.`)) return;
    patch({ stage: k });
  };
  const reject = async () => { if (await patch({ outcome: "rejected", closed_reason: reason, closed_note: note || null, closed_stage: emp.stage, closed_at: new Date().toISOString() })) { setOpen(false); setNote(""); } };
  const reopen = () => patch({ outcome: "active", closed_reason: null, closed_note: null, closed_stage: null, closed_at: null });

  return (
    <div className="card space-y-3">
      {rejected ? (
        <div className="flex flex-wrap items-center gap-3 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span className="font-semibold text-red-800">Closed — {emp.closed_reason}</span>
          <span className="text-red-700">at {stageLabel(emp.closed_stage)} stage{emp.closed_at ? ` · ${new Date(emp.closed_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : ""}</span>
          {emp.closed_note && <span className="text-red-700 w-full">“{emp.closed_note}”</span>}
          <button className="btn ml-auto" disabled={busy} onClick={reopen}>Reopen candidate</button>
        </div>
      ) : null}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1" role="list">
        {STAGES.map((s, i) => { const done = i < cur, on = i === cur; return (
          <button key={s.key} role="listitem" disabled={rejected || busy} onClick={() => setStage(s.key)} title={rejected ? "Reopen to change stage" : `Move to ${s.label}`}
            className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full text-sm whitespace-nowrap border ${rejected ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} ${on ? "bg-[#1e4fa3] text-white border-[#1e4fa3] font-semibold" : done ? "bg-blue-50 text-blue-800 border-blue-100" : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"}`}>
            <span className={`inline-grid place-items-center h-4 w-4 rounded-full text-[10px] ${on ? "bg-white text-[#1e4fa3]" : done ? "bg-[#1e4fa3] text-white" : "bg-slate-200 text-slate-600"}`}>{done ? "✓" : i + 1}</span>{s.label}
          </button>); })}
      </div>
      {!rejected && <div className="flex flex-wrap items-center gap-2">
        {next && <button className="btn btn-primary" disabled={busy} onClick={() => setStage(next.key)}>Move to {next.label}<Icon name="chevron-right" className="h-4 w-4" /></button>}
        {!next && <span className="text-sm text-emerald-700">✓ Onboarded — all steps done</span>}
        <details className="relative ml-auto">
          <summary className="btn list-none [&::-webkit-details-marker]:hidden" aria-label="More actions"><Icon name="more" className="h-4 w-4" /></summary>
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1 shadow-lg text-sm">
            <button className="w-full text-left rounded-lg px-3 py-2 text-red-700 hover:bg-red-50" onClick={(e) => { setOpen(true); e.currentTarget.closest("details")?.removeAttribute("open"); }}>Reject / declined…</button>
          </div>
        </details>
      </div>}
      {open && !rejected && (
        <div className="border border-red-200 bg-red-50/50 rounded-lg p-3 space-y-3">
          <p className="text-sm text-slate-600">Moves this candidate to the Rejected pile. Nothing is deleted — letters, documents and details stay saved, and you can reopen them any time.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="lbl">Reason</label><select className="inp" value={reason} onChange={(e) => setReason(e.target.value)}>{REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}</select></div>
            <div><label className="lbl">Note (optional)</label><input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. took another offer" /></div>
          </div>
          <div className="flex gap-2"><button className="btn btn-danger" disabled={busy} onClick={reject}>Move to rejected pile</button><button className="btn" onClick={() => setOpen(false)}>Cancel</button></div>
        </div>)}
      {err && <p className="warn">{err}</p>}
    </div>
  );
}
