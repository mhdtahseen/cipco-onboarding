"use client";
import { useEffect, useRef } from "react";
import type { Employee } from "@/lib/types";
import ResumeCard from "./ResumeCard";
import InviteCard from "./InviteCard";
import NotesCard from "./NotesCard";
import { Icon } from "./NavIcons";

/**
 * Resume, self-fill link and notes in a slide-over, so the form keeps the full page width.
 * It stays mounted while closed (just hidden): notes save when a box loses focus, so unmounting could drop a half-typed note.
 */
export default function CandidatePanel({ emp, onChange, open, onClose, showInvite, onApplied }: { emp: Employee; onChange: (e: Employee) => void; open: boolean; onClose: () => void; showInvite: boolean; onApplied: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // blur first so a note being typed is saved before the panel is hidden
  const close = () => { (document.activeElement as HTMLElement | null)?.blur?.(); onClose(); };
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { (document.activeElement as HTMLElement | null)?.blur?.(); onClose(); } };
    window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  return (
    <div className="overlay z-40" data-open={open} role="dialog" aria-modal="true" aria-label="Resume, self-fill link and notes">
      <div className="overlay-bg bg-slate-900/30" onClick={close} />
      <div ref={ref} tabIndex={-1} className="overlay-panel from-right absolute right-0 top-0 h-full w-full max-w-md bg-slate-50 shadow-xl overflow-y-auto p-4 space-y-4 outline-none">
        <div className="flex items-center gap-2"><h2 className="font-semibold text-base flex-1 truncate">{emp.full_name}</h2>
          <button type="button" className="btn btn-sm" onClick={close} aria-label="Close panel"><Icon name="x" className="h-4 w-4" />Close</button></div>
        <ResumeCard emp={emp} />
        {showInvite && <InviteCard emp={emp} onChange={onChange} onApplied={onApplied} />}
        <NotesCard emp={emp} onChange={onChange} compact />
      </div>
    </div>
  );
}
