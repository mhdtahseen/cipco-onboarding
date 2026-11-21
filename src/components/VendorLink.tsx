"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase/client";
import type { Vehicle } from "@/lib/attendance";

export type LiveLink = { vehicle_id: string; token: string; created_at: string; last_used_at: string | null; locked_until: string | null; devices: number };
const when = (t: string) => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
function ago(t: string) {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 2) return "just now"; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return d < 8 ? `${d} day${d === 1 ? "" : "s"} ago` : when(t);
}
const newPin = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(1000 + (a[0] % 9000)); };
const okPin = (p: string) => /^\d{4,6}$/.test(p);
const friendly = (m: string) => /Assign the vehicle to a project/i.test(m) ? "Put this vehicle on a project first, then make its link." : /PIN must be/i.test(m) ? "The PIN must be 4 to 6 digits." : m;

type Mode = "view" | "pin" | "replace" | "off";

// Admin only: the vehicle operator's private page (/vendor/<link>), where they enter errands and see their month and payments.
// link: undefined = the vendor-portal migration is not run yet; null = no live link.
// The table cell shows a small status button; everything else opens in a window so the vehicles table keeps its width.
export default function VendorLink({ vehicle, link, onChange }: { vehicle: Vehicle; link: LiveLink | null | undefined; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const locked = !!link?.locked_until;
  const status = link === undefined ? "needs migration" : link === null ? "not made" : locked ? "locked" : link.last_used_at ? `used ${ago(link.last_used_at)}` : "not opened yet";
  const dot = link === undefined || link === null ? "bg-slate-300" : locked ? "bg-rose-500" : link.last_used_at ? "bg-emerald-500" : "bg-amber-400";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50" aria-haspopup="dialog">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />Vendor link · {status}
      </button>
      {open && <Panel vehicle={vehicle} link={link} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

export function Panel({ vehicle, link, onChange, onClose }: { vehicle: Vehicle; link: LiveLink | null | undefined; onChange: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("view"); const [pin, setPin] = useState(() => newPin());
  const [shown, setShown] = useState<{ pin: string; fresh: boolean } | null>(null);   // the PIN just set, shown once; fresh = a new link to send
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false); const [copied, setCopied] = useState("");
  const who = vehicle.operator || "the operator";
  const url = link ? `${window.location.origin}/vendor/${link.token}` : "";

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key); const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [onClose]);

  async function call(fn: string, args: Record<string, unknown>, after: () => void) {
    setBusy(true); setMsg(""); const { error } = await supabase().rpc(fn, args); setBusy(false);
    if (error) { setMsg(friendly(error.message)); return; }
    after(); setMode("view"); onChange();
  }
  const go = (m: Mode) => { setMsg(""); setPin(newPin()); setMode(m); };
  const create = () => okPin(pin) ? call("vendor_link_create", { p_vehicle: vehicle.id, p_pin: pin }, () => setShown({ pin, fresh: true })) : setMsg("Enter a PIN of 4 to 6 digits.");
  const changePin = () => okPin(pin) ? call("vendor_link_set_pin", { p_vehicle: vehicle.id, p_pin: pin }, () => setShown({ pin, fresh: false })) : setMsg("Enter a PIN of 4 to 6 digits.");
  const revoke = () => call("vendor_link_revoke", { p_vehicle: vehicle.id }, () => setShown(null));
  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(""), 2000); } catch { setMsg("Copy did not work: select the text and copy it."); }
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(`CIPCO: your page for ${vehicle.name}. Enter the errands you run for us and see your trips and payments here:\n${url}\n\nThe CIPCO office will tell you the PIN on a call.`)}`;

  const pinField = (label: string, action: string, onGo: () => void, danger = false) => (
    <div className="space-y-2">
      <label className="lbl" htmlFor="vl-pin">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id="vl-pin" className="inp !w-32 font-mono text-lg tracking-[0.3em] text-center" inputMode="numeric" maxLength={6} value={pin} autoComplete="off" onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setMsg(""); }} />
        <button type="button" className="btn btn-sm" onClick={() => setPin(newPin())}>New number</button>
      </div>
      <p className="text-xs text-slate-500">4 to 6 digits. Pick one you can say on the phone.</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy || !okPin(pin)} onClick={onGo}>{busy ? "Saving…" : action}</button>
        {link && <button type="button" className="btn" disabled={busy} onClick={() => go("view")}>Cancel</button>}
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-end sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Vendor link for ${vehicle.name}`}>
      <div className="fade absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="pop-in !origin-center relative w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl text-sm">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-100 bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-semibold">Vendor link</h2>
            <p className="text-xs text-slate-500 truncate">{vehicle.name}{vehicle.operator ? ` · ${vehicle.operator}` : ""}</p>
          </div>
          <button type="button" className="ml-auto -mr-2 -mt-1 rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {link === undefined ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">Vendor links need the SQL migration 2026-11-transport-vendor-portal.sql.</p>

          : link === null ? <>
            <div className="space-y-2">
              <p>A private page on {who}&apos;s phone, opened with a PIN. On it they can:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-slate-600">
                <li>add errands they ran (who asked, what for, their price) for an Admin to approve</li>
                <li>see this vehicle&apos;s trips, no-shows and errands, month by month</li>
                <li>see what CIPCO has paid and still owes</li>
              </ul>
              <p className="text-xs text-slate-500">Nothing else in the app. Only approved errands count towards the payment.</p>
            </div>
            {pinField("PIN for the link", "Make link", create)}
          </>

          : <>
            {shown && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2 text-amber-950">
              <p className="font-medium">{shown.fresh ? "Link made. Two steps:" : "PIN changed. Every phone signs out and enters the new PIN."}</p>
              {shown.fresh && <p><b>1.</b> Send the link below on WhatsApp.<br /><b>2.</b> Call {who} and tell them the PIN. Don&apos;t put it in the same message.</p>}
              <div className="flex items-center gap-3"><span className="text-xs uppercase tracking-wide text-amber-800">PIN</span><b className="font-mono text-2xl tracking-[0.3em]">{shown.pin}</b>
                <button type="button" className="btn btn-sm ml-auto" onClick={() => copy(shown.pin, "pin")}>{copied === "pin" ? "Copied ✓" : "Copy"}</button></div>
              <p className="text-xs text-amber-800">This PIN is not shown again. If it is forgotten, set a new one here.</p>
            </div>}

            <div className="space-y-2">
              <label className="lbl" htmlFor="vl-url">Link</label>
              <input id="vl-url" readOnly className="inp font-mono text-xs" value={url} onFocus={(e) => e.currentTarget.select()} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" onClick={() => copy(url, "url")}>{copied === "url" ? "Copied ✓" : "Copy link"}</button>
                <a className="btn" href={wa} target="_blank" rel="noreferrer">Send on WhatsApp</a>
              </div>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <dt className="text-slate-500">Made</dt><dd>{when(link.created_at)}</dd>
              <dt className="text-slate-500">Last used</dt><dd>{link.last_used_at ? ago(link.last_used_at) : "not opened yet"}</dd>
              <dt className="text-slate-500">Signed in</dt><dd>{link.devices ? `${link.devices} phone${link.devices === 1 ? "" : "s"}` : "no phone"}</dd>
              {link.locked_until && <><dt className="text-rose-700">Locked</dt><dd className="text-rose-700">too many wrong PINs, until {when(link.locked_until)}. Setting a new PIN unlocks it.</dd></>}
            </dl>

            {mode === "view" && <div className="space-y-1 border-t border-slate-100 pt-3">
              <Row title="Change PIN" text="Signs every phone out. The link stays the same." onClick={() => go("pin")} />
              <Row title="Replace the link" text="For a lost or shared link. The old one stops working." onClick={() => go("replace")} />
              <Row title="Turn off" text="The page stops working at once. Errands already entered stay." onClick={() => go("off")} danger />
            </div>}
            {mode === "pin" && <div className="border-t border-slate-100 pt-3">{pinField("New PIN", "Change PIN", changePin)}</div>}
            {mode === "replace" && <div className="space-y-2 border-t border-slate-100 pt-3">
              <p className="text-slate-600">A new link and PIN. The old link stops working and every phone signs out; send {who} the new link.</p>
              {pinField("PIN for the new link", "Replace link", create)}
            </div>}
            {mode === "off" && <div className="space-y-3 border-t border-slate-100 pt-3">
              <p>Turn off {vehicle.name}&apos;s link? It stops working at once and every phone signs out. You can make a new link later.</p>
              <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-danger" disabled={busy} onClick={revoke}>{busy ? "Turning off…" : "Turn off"}</button><button type="button" className="btn" disabled={busy} onClick={() => go("view")}>Cancel</button></div>
            </div>}
          </>}

          {msg && <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800" role="alert">{msg}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Row({ title, text, onClick, danger }: { title: string; text: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50">
      <span className="min-w-0"><span className={`block font-medium ${danger ? "text-red-700" : ""}`}>{title}</span><span className="block text-xs text-slate-500">{text}</span></span>
      <span className="ml-auto text-slate-300" aria-hidden>›</span>
    </button>
  );
}
