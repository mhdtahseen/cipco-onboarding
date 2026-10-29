"use client";
import { useState } from "react";
import { uploadBill } from "@/lib/billUpload";

// The bill on one payment: opens it, or attaches / replaces it afterwards. The bill also shows on the project's expense for the payment.
export default function PaymentBill({ path, projectId, onAttach, onError }: { path?: string | null; projectId: string; onAttach: (path: string) => unknown; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function pick(f: File | undefined) {
    if (!f) return; setBusy(true); const r = await uploadBill(f, projectId);
    if ("error" in r) onError(r.error); else await onAttach(r.path);
    setBusy(false);
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      {path && <a className="text-blue-700 underline" href={`/api/docs/view?path=${encodeURIComponent(path)}`} target="_blank" data-bill-link>Bill</a>}
      <label className="cursor-pointer underline text-slate-500">{busy ? "Uploading…" : path ? "Replace" : "Attach bill"}<input type="file" accept="image/*,application/pdf" className="hidden" aria-label="Attach bill" disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} /></label>
    </span>
  );
}
