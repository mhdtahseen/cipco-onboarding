"use client";
import { useState } from "react";
import { digits } from "@/lib/employeeList";

/** View / Download / Share for one issued letter or salary slip. Share makes a private link that expires in 7 days, then offers WhatsApp, email, the phone's own share
 *  sheet, or copying it. Nothing is sent by the app itself: the link goes wherever you choose. */
export default function ShareDoc({ kind, id, view, download, title, phone, email, name }: { kind: "letter" | "slip"; id: string; view: string; download?: string; title: string; phone: string | null; email: string | null; name: string }) {
  const [url, setUrl] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [copied, setCopied] = useState(false);
  async function make() {
    if (url) { setUrl(""); return; }
    setBusy(true); setErr("");
    const r = await fetch(`/api/doc-link?kind=${kind}&id=${id}`); const j = await r.json().catch(() => ({}));
    setBusy(false); if (!r.ok) { setErr(j.error || "Could not make the link."); return; } setUrl(j.url);
  }
  const first = name.split(/\s+/)[0] || "";
  const msg = `Hello ${first}, your ${title.toLowerCase()} from CIPCO is ready: ${url}  (this private link works for 7 days)`;
  const wa = digits(phone).length === 10 ? `https://wa.me/91${digits(phone)}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  const mail = `mailto:${email || ""}?subject=${encodeURIComponent(`Your ${title} – CIPCO`)}&body=${encodeURIComponent(msg)}`;
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <a className="text-blue-700 underline" href={view} target="_blank" rel="noreferrer">View</a>
      {download && <a className="text-blue-700 underline" href={download}>Download</a>}
      <button type="button" className="text-blue-700 underline" disabled={busy} onClick={make} aria-expanded={!!url}>{busy ? "…" : url ? "Hide share" : "Share"}</button>
      {url && <span className="basis-full flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
        <a className="btn btn-sm" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="btn btn-sm" href={mail}>Email</a>
        {canShare && <button type="button" className="btn btn-sm" onClick={() => navigator.share({ title, text: msg, url }).catch(() => {})}>More…</button>}
        <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>{copied ? "Copied ✓" : "Copy link"}</button>
      </span>}
      {err && <span className="basis-full text-red-700">{err}</span>}
    </span>
  );
}
