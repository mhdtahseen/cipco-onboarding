"use client";
import { useEffect, useState } from "react";
import { digits } from "@/lib/employeeList";

export type SlipPerson = { lineId: string; name: string; phone: string | null };
type Lang = "en" | "hi" | "both";
const SENT_KEY = (run: string) => `cipco_slips_sent_${run}`, LANG_KEY = "cipco_slip_lang";
const first = (n: string) => n.trim().split(/\s+/)[0] || n;
const messageFor = (lang: Lang, name: string, month: string, project: string, url: string, days: number) => {
  const en = `Hello ${first(name)}, your salary slip for ${month} (${project}) from Chandrika Industrial Projects Company: ${url}\n(This private link works for ${days} days. For any query, please contact the office.)`;
  const hi = `नमस्ते ${first(name)}, चंद्रिका इंडस्ट्रियल प्रोजेक्ट्स कंपनी की ओर से ${month} (${project}) की आपकी वेतन पर्ची: ${url}\n(यह निजी लिंक ${days} दिन तक चालू रहेगा। किसी भी प्रश्न के लिए कृपया कार्यालय से संपर्क करें।)`;
  return lang === "en" ? en : lang === "hi" ? hi : `${en}\n\n${hi}`;
};

// After a payroll run is approved: send each person their salary slip on WhatsApp the same way the self-fill form link is sent. Send opens a WhatsApp chat with that person's number and the
// message already written, with a private link to their slip in it; you just press send. The link needs no login, is different for every person, and stops working after a few days.
// Which slips were sent is remembered on this device only.
export default function SlipSender({ runId, month, project, people }: { runId: string; month: string; project: string; people: SlipPerson[] }) {
  const [open, setOpen] = useState(false); const [links, setLinks] = useState<Record<string, string> | null>(null); const [days, setDays] = useState(7); const [err, setErr] = useState(""); const [sent, setSent] = useState<Record<string, string>>({}); const [lang, setLang] = useState<Lang>("en"); const [copied, setCopied] = useState("");
  useEffect(() => { try { setSent(JSON.parse(localStorage.getItem(SENT_KEY(runId)) || "{}")); const l = localStorage.getItem(LANG_KEY); if (l === "en" || l === "hi" || l === "both") setLang(l); } catch { /* storage unavailable */ } }, [runId]);
  // the links are made when the panel is opened (each carries its own expiry)
  useEffect(() => {
    if (!open || links) return; let live = true;
    (async () => { try { const r = await fetch(`/api/payslips/links?run=${runId}`); const j = await r.json(); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); if (live) { setLinks(j.links); setDays(j.days || 7); } } catch (e: any) { if (live) setErr(e?.message || "Couldn't make the links."); } })();
    return () => { live = false; };
  }, [open, links, runId]);
  const keep = (next: Record<string, string>) => { setSent(next); try { localStorage.setItem(SENT_KEY(runId), JSON.stringify(next)); } catch { /* ignore */ } };
  const mark = (p: SlipPerson) => keep({ ...sent, [p.lineId]: new Date().toISOString() });
  const unmark = (p: SlipPerson) => { const n = { ...sent }; delete n[p.lineId]; keep(n); };
  const text = (p: SlipPerson) => messageFor(lang, p.name, month, project, links?.[p.lineId] ?? "", days);
  const wa = (p: SlipPerson) => (links?.[p.lineId] && digits(p.phone).length === 10 ? `https://wa.me/91${digits(p.phone)}?text=${encodeURIComponent(text(p))}` : "");
  async function copy(p: SlipPerson) { try { await navigator.clipboard.writeText(text(p)); setCopied(p.lineId); setTimeout(() => setCopied(""), 2000); } catch { setErr("Couldn't copy: select the link and copy it by hand."); } }

  const done = people.filter((p) => sent[p.lineId]).length;
  return (
    <details className="card !p-3" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-medium">Send salary slips on WhatsApp{done > 0 ? ` · ${done} of ${people.length} sent` : ""}</summary>
      <div className="mt-2 space-y-3">
        <p className="text-xs text-slate-500">Send opens WhatsApp on that person's number with the message and a private link to their salary slip already written: you just press send. Each link is different, needs no login, and stops working after {days} days.</p>
        <div className="flex flex-wrap items-center gap-2"><label className="text-xs text-slate-500 flex items-center gap-2">Message language<select className="inp !w-auto !py-1" value={lang} onChange={(e) => { const v = e.target.value as Lang; setLang(v); try { localStorage.setItem(LANG_KEY, v); } catch { /* ignore */ } }}><option value="en">English</option><option value="hi">हिन्दी</option><option value="both">Both</option></select></label>
          {open && !links && !err && <span className="text-xs text-slate-400">Making the links…</span>}</div>
        {err && <p className="warn" role="alert">{err}</p>}
        <ul className="divide-y divide-slate-100">{people.map((p) => { const okPhone = digits(p.phone).length === 10; const isSent = !!sent[p.lineId]; const link = wa(p); return (
          <li key={p.lineId} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{p.name}</div><div className="text-xs text-slate-400">{okPhone ? `+91 ${digits(p.phone)}` : <span className="text-amber-700">No valid phone number</span>}{isSent && <span className="text-green-700"> · sent {new Date(sent[p.lineId]).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span>}</div></div>
            <div className="flex flex-wrap gap-2">
              {link ? <a className={`btn btn-sm ${isSent ? "" : "btn-primary"}`} href={link} target="_blank" rel="noreferrer" onClick={() => mark(p)}>{isSent ? "Send again" : "Send on WhatsApp"}</a> : <button className="btn btn-sm" disabled>{links ? "Send on WhatsApp" : "Preparing…"}</button>}
              <button className="btn btn-sm" disabled={!links} onClick={() => copy(p)}>{copied === p.lineId ? "Copied ✓" : "Copy message"}</button>
              {isSent ? <button className="btn btn-sm" onClick={() => unmark(p)}>Unmark</button> : <button className="btn btn-sm" onClick={() => mark(p)} title="Mark as sent if you sent it another way">Mark sent</button>}</div>
          </li>); })}</ul>
      </div>
    </details>
  );
}
