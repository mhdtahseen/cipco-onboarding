"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Kind = "food_vendor" | "vehicle" | "room" | "gas_vendor" | "equipment_vendor";
type B = { holder: string; bank: string; branch: string; account_no: string; ifsc: string; upi: string };
const BLANK: B = { holder: "", bank: "", branch: "", account_no: "", ifsc: "", upi: "" };

// Admin only: where to send the money for a vendor, a vehicle's operator or a room's landlord. Shown in the Payments due report.
// Closed until opened, and the details are fetched only then.
export default function PayeeBank({ kind, refId, label = "Bank details" }: { kind: Kind; refId: string; label?: string }) {
  const [open, setOpen] = useState(false); const [b, setB] = useState<B>(BLANK); const [had, setHad] = useState<boolean | null>(null); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  async function toggle(o: boolean) {
    setOpen(o); if (!o || had !== null) return;
    const { data, error } = await supabase().from("payee_bank").select("holder, bank, branch, account_no, ifsc, upi").eq("kind", kind).eq("ref_id", refId).maybeSingle();
    if (error) { setMsg(/payee_bank|schema cache/i.test(error.message) ? "Bank details need the latest SQL migration (2026-11-payee-bank.sql)." : error.message); return; }
    setHad(!!data); if (data) setB({ ...BLANK, ...(data as B) });
  }
  async function save() {
    setBusy(true); setMsg(""); const clean = { ...b, ifsc: b.ifsc.trim().toUpperCase(), account_no: b.account_no.replace(/\s/g, "") };
    const { error } = await supabase().from("payee_bank").upsert({ kind, ref_id: refId, ...Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, v.trim()])), updated_at: new Date().toISOString() }, { onConflict: "kind,ref_id" });
    setBusy(false); if (error) { setMsg(error.message); return; } setHad(true); setB(clean); setMsg("Saved ✓"); setTimeout(() => setMsg(""), 3000);
  }
  const f = (k: keyof B, l: string, w = "!w-44", extra: Record<string, unknown> = {}) => <div><label className="lbl">{l}</label><input className={`inp ${w}`} value={b[k]} onChange={(e) => setB({ ...b, [k]: e.target.value })} autoComplete="off" {...extra} /></div>;
  return (
    <details className="text-xs" onToggle={(e) => toggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-blue-700 underline decoration-dotted">{label}{had === false ? " (not added)" : ""}</summary>
      {open && <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 border border-slate-200/70 p-2">
        {f("holder", "Account holder")}{f("bank", "Bank")}{f("branch", "Branch")}{f("account_no", "Account no.", "!w-44", { inputMode: "numeric" })}{f("ifsc", "IFSC", "!w-32", { maxLength: 11 })}{f("upi", "UPI ID (optional)")}
        <button className="btn btn-primary !py-1" disabled={busy} onClick={save}>Save</button>{msg && <span className={msg.includes("✓") ? "text-green-700" : "text-rose-700"}>{msg}</span>}
      </div>}
    </details>
  );
}
