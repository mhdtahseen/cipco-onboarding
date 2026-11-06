"use client";
import { useState } from "react";
import { inr } from "@/lib/inventory";

// What the reviewer (Operations or an Admin) does with an entry that is waiting: send it back with a message, or approve it. Only an Admin may also send an approved entry on to the JSL portal.
// variant "card" sits beside the entries on a laptop; "bar" sticks to the bottom of a phone.
export default function ReviewBar({ variant, ready, readyMsg, admin, busy, amount, itemCount, openNotes, onReturn, onApprove }: { variant: "card" | "bar"; ready: boolean; readyMsg: string; admin: boolean; busy: boolean; amount: number; itemCount: number; openNotes: number; onReturn: (message: string) => Promise<void>; onApprove: (portal: boolean) => Promise<void> }) {
  const [panel, setPanel] = useState<"" | "return" | "approve">(""); const [msg, setMsg] = useState("");
  const wrap = variant === "card" ? "card !p-3 space-y-3 hidden lg:block" : "lg:hidden sticky bottom-[var(--bottom-nav-h,0px)] z-10 -mx-3 px-3 py-2 border-t border-slate-200 bg-white/95 backdrop-blur space-y-2 rounded-b-xl";
  return (
    <section className={wrap} aria-label="Review">
      {variant === "card" && <h2 className="text-sm font-semibold">Review this entry</h2>}
      {panel === "return" && <div className="space-y-2">
        <label className="lbl" htmlFor={`ret-${variant}`}>Message for whoever entered it</label>
        <textarea id={`ret-${variant}`} className="inp !min-h-24" placeholder="What needs to be fixed. The corrections you marked go back with it." value={msg} onChange={(e) => setMsg(e.target.value)} />
        <div className="flex gap-2"><button className="btn btn-primary flex-1 justify-center" disabled={busy || !msg.trim()} onClick={async () => { await onReturn(msg.trim()); setMsg(""); setPanel(""); }}>Send back</button><button className="btn" onClick={() => setPanel("")}>Cancel</button></div></div>}
      {panel === "approve" && <div className="space-y-2">
        <p className="text-sm text-slate-600">Approving counts {itemCount} item{itemCount === 1 ? "" : "s"} as received{amount > 0 ? ` and adds ₹${inr(amount)} to the project's expenses` : ""}.{openNotes > 0 && <span className="text-amber-700"> {openNotes} correction{openNotes === 1 ? " is" : "s are"} still marked open.</span>}</p>
        <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={async () => { await onApprove(false); setPanel(""); }}>Approve: keep as an inventory entry</button>
        {admin ? <button className="btn w-full justify-center" disabled={busy} onClick={async () => { await onApprove(true); setPanel(""); }}>Approve and also send to the JSL portal</button> : <p className="text-xs text-slate-500">Only an Admin can send an entry to the JSL portal.</p>}
        <button className="btn btn-sm" onClick={() => setPanel("")}>Cancel</button></div>}
      {panel === "" && <>
        {!ready && <p className="text-xs text-amber-700">{readyMsg}</p>}
        <div className="flex gap-2"><button className="btn flex-1 justify-center" disabled={busy} onClick={() => setPanel("return")}>Send back</button><button className="btn btn-primary flex-1 justify-center" disabled={busy || !ready} onClick={() => setPanel("approve")}>Approve…</button></div></>}
    </section>
  );
}
