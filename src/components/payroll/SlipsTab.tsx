"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadMe } from "@/lib/me";
import { digits } from "@/lib/employeeList";
import { monthName } from "@/lib/payroll";
import { useRole } from "@/lib/roles";
import type { usePayroll } from "@/lib/payrollData";
type P = ReturnType<typeof usePayroll>;

type Last = { status: "sent" | "failed" | "no_email"; error: string | null; sent_at: string } | null;
type Row = { lineId: string; name: string; email: string; ok: boolean; last: Last; wa: Last };
type Lang = "en" | "hi" | "both"; type Filter = "all" | "todo" | "failed" | "nocontact";
const LANG_KEY = "cipco_slip_lang", WA_KEY = (run: string) => `cipco_slips_sent_${run}`;   // the WhatsApp marks fall back to this device until the shared log table exists
const first = (n: string) => n.trim().split(/\s+/)[0] || n;
const messageFor = (lang: Lang, name: string, month: string, project: string, url: string, days: number) => {
  const en = `Hello ${first(name)}, your salary slip for ${month} (${project}) from Chandrika Industrial Projects Company: ${url}\n(This private link works for ${days} days. For any query, please contact the office.)`;
  const hi = `नमस्ते ${first(name)}, चंद्रिका इंडस्ट्रियल प्रोजेक्ट्स कंपनी की ओर से ${month} (${project}) की आपकी वेतन पर्ची: ${url}\n(यह निजी लिंक ${days} दिन तक चालू रहेगा। किसी भी प्रश्न के लिए कृपया कार्यालय से संपर्क करें।)`;
  return lang === "en" ? en : lang === "hi" ? hi : `${en}\n\n${hi}`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

// Salary slips: one list, one row per person, with the status of both channels (email and WhatsApp) side by side and a button for each.
export default function SlipsTab({ P, ym, projectName }: { P: P; ym: string; projectName: string }) {
  const { admin } = useRole(); const d = P.d!; const run = d.run; const approved = run?.status === "approved"; const month = monthName(ym);
  const [data, setData] = useState<{ configured: boolean; from: string | null; logged: boolean; people: Row[] } | null>(null); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string>(""); const [filter, setFilter] = useState<Filter>("all"); const [lang, setLang] = useState<Lang>("en");
  const [links, setLinks] = useState<Record<string, string> | null>(null); const [days, setDays] = useState(7); const [copied, setCopied] = useState("");
  const [local, setLocal] = useState<Record<string, string>>({}); const [done, setDone] = useState<Record<string, { status: "sent" | "failed" | "no_email"; error?: string }>>({});
  const [to, setTo] = useState(""); const [tBusy, setTBusy] = useState(false); const [tMsg, setTMsg] = useState(""); const [tErr, setTErr] = useState("");

  const load = useCallback(async () => {
    if (!run || !approved) { setData(null); return; } setErr("");
    const r = await fetch(`/api/payslips/email?run=${run.id}`); const j = await r.json().catch(() => ({})); if (!r.ok) { setErr(j.error || "Could not load."); return; } setData(j);
    const l = await fetch(`/api/payslips/links?run=${run.id}`); const lj = await l.json().catch(() => ({})); if (l.ok) { setLinks(lj.links); setDays(lj.days || 7); }
  }, [run, approved]);
  useEffect(() => { setDone({}); setMsg(""); load(); }, [load]);
  useEffect(() => { try { const l = localStorage.getItem(LANG_KEY); if (l === "en" || l === "hi" || l === "both") setLang(l); const k = localStorage.getItem("cipco_slip_test_to"); if (k) setTo(k); else loadMe().then((me) => { if (me?.email) setTo((x) => x || me.email); }).catch(() => { /* optional */ }); } catch { /* storage unavailable */ } }, []);
  useEffect(() => { if (!run) return; try { setLocal(JSON.parse(localStorage.getItem(WA_KEY(run.id)) || "{}")); } catch { setLocal({}); } }, [run]);

  const phones = useMemo(() => { const m = new Map<string, string | null>(); d.lines.forEach((l) => m.set(l.id, d.emps.find((e) => e.id === l.employee_id)?.phone ?? null)); return m; }, [d]);
  const rows = (data?.people ?? []).map((p) => ({ ...p, phone: digits(phones.get(p.lineId)), emailStatus: done[p.lineId]?.status ?? (!p.ok ? "no_email" : p.last?.status ?? "pending"), waAt: (data?.logged ? p.wa?.sent_at : local[p.lineId]) ?? null }));
  const view = rows.filter((r) => filter === "all" ? true : filter === "failed" ? r.emailStatus === "failed" : filter === "nocontact" ? (!r.ok && r.phone.length !== 10) : !(r.emailStatus === "sent" || r.waAt));
  const counts = { todo: rows.filter((r) => !(r.emailStatus === "sent" || r.waAt)).length, failed: rows.filter((r) => r.emailStatus === "failed").length, nocontact: rows.filter((r) => !r.ok && r.phone.length !== 10).length };
  const pendingEmail = rows.filter((r) => r.ok && r.emailStatus !== "sent"), failedEmail = rows.filter((r) => r.emailStatus === "failed");

  async function sendEmail(ids: string[] | null, what: string, key: string) {
    if (!run || !data) return; if (!confirm(`Email ${what} from ${data.from}? Each person receives only their own ${month} salary slip.`)) return;
    setBusy(key); setErr(""); setMsg("");
    const r = await fetch("/api/payslips/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run: run.id, lineIds: ids }) }); const j = await r.json().catch(() => ({}));
    setBusy(""); if (!r.ok) { setErr(j.error || "Sending failed."); return; }
    const res = j.results as { lineId: string; status: "sent" | "failed" | "no_email"; error?: string }[]; const m: typeof done = {}; res.forEach((x) => { m[x.lineId] = { status: x.status, error: x.error }; }); setDone((x) => ({ ...x, ...m }));
    const n = (s: string) => res.filter((x) => x.status === s).length; setMsg(`${n("sent")} emailed${n("failed") ? `, ${n("failed")} failed` : ""}${n("no_email") ? `, ${n("no_email")} without an email address` : ""}.`);
  }
  async function markWa(lineId: string, on: boolean) {
    if (!run) return; const next = { ...local }; if (on) next[lineId] = new Date().toISOString(); else delete next[lineId]; setLocal(next); try { localStorage.setItem(WA_KEY(run.id), JSON.stringify(next)); } catch { /* ignore */ }
    if (data?.logged) { await fetch("/api/payslips/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run: run.id, mark: { lineId, on } }) }).catch(() => null); load(); }
  }
  const text = (r: Row) => messageFor(lang, r.name, month, projectName, links?.[r.lineId] ?? "", days);
  const wa = (r: Row & { phone: string }) => (links?.[r.lineId] && r.phone.length === 10 ? `https://wa.me/91${r.phone}?text=${encodeURIComponent(text(r))}` : "");
  async function copy(r: Row) { try { await navigator.clipboard.writeText(text(r)); setCopied(r.lineId); setTimeout(() => setCopied(""), 2000); } catch { setErr("Couldn't copy: select the link by hand instead."); } }
  async function sendTest() {
    if (!run) return; setTBusy(true); setTErr(""); setTMsg(""); try { localStorage.setItem("cipco_slip_test_to", to.trim()); } catch { /* ignore */ }
    const r = await fetch("/api/payslips/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run: run.id, test: true, to: to.trim() }) }); const j = await r.json().catch(() => ({}));
    setTBusy(false); if (!r.ok) { setTErr(j.error || "The test could not be sent."); return; } setTMsg(`Test sent to ${j.to}${j.sample ? ` (using ${j.sample}'s slip)` : ""}. Check that inbox, and the spam folder.`);
  }

  if (!admin) return <p className="text-sm text-slate-500">Salary slips are sent by an Admin.</p>;
  if (!run) return <p className="text-sm text-slate-500">Calculate the payroll on the Payroll run tab first. Salary slips are sent after the run is approved.</p>;

  const testBox = (
    <details className="rounded-xl border border-dashed border-slate-300 p-2.5">
      <summary className="cursor-pointer text-xs font-medium text-slate-600">Send me a test email{!approved ? " (works on a draft)" : ""}</summary>
      <div className="mt-2 space-y-1.5"><p className="text-xs text-slate-500">Sends one slip to the address below. No employee is emailed and nothing is recorded.</p>
        <div className="flex flex-wrap items-center gap-2"><input className="inp !py-1.5 max-w-xs" type="email" aria-label="Send the test to" placeholder="you@cipcogroup.com" value={to} onChange={(e) => setTo(e.target.value)} /><button className="btn" disabled={tBusy || !to.trim()} onClick={sendTest}>{tBusy ? "Sending…" : "Send test"}</button></div>
        {tErr && <p className="warn">{tErr}</p>}{tMsg && <p className="text-sm text-green-700">{tMsg}</p>}</div>
    </details>);
  if (!approved) return <div className="space-y-3"><p className="text-sm text-slate-500">This run is still a draft. Approve it on the Payroll run tab to send salary slips to everyone. You can try the email now with a test.</p>{testBox}</div>;
  if (err && !data) return <p className="warn">{err}</p>; if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  const chip = (tone: string, text: string, title?: string) => <span className={`pill !text-[11px] ${tone}`} title={title}>{text}</span>;
  const emailChip = (r: (typeof rows)[number]) => r.emailStatus === "sent" ? chip("!bg-emerald-50 !text-emerald-800", "Email sent", r.last?.sent_at ? when(r.last.sent_at) : undefined) : r.emailStatus === "failed" ? chip("!bg-rose-50 !text-rose-800", "Email failed", done[r.lineId]?.error ?? r.last?.error ?? undefined) : r.emailStatus === "no_email" ? chip("!bg-amber-50 !text-amber-800", "No email") : chip("!bg-slate-100 !text-slate-600", "Email not sent");
  const waChip = (r: (typeof rows)[number]) => r.waAt ? chip("!bg-emerald-50 !text-emerald-800", "WhatsApp sent", when(r.waAt)) : r.phone.length !== 10 ? chip("!bg-amber-50 !text-amber-800", "No phone") : chip("!bg-slate-100 !text-slate-600", "WhatsApp not sent");
  const filters: [Filter, string, number | null][] = [["all", "All", rows.length], ["todo", "Not reached yet", counts.todo], ["failed", "Failed", counts.failed], ["nocontact", "No contact details", counts.nocontact]];

  return (
    <div className="space-y-3">
      <section className="card !p-3 space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h2 className="font-semibold text-sm">Salary slips · {month}</h2><p className="text-xs text-slate-500">{data.configured ? `Email goes from ${data.from}; a copy is kept in that mailbox.` : "Email is not set up yet."} WhatsApp opens one chat at a time for you to press send.{!data.logged && " Status is remembered on this device only."}</p></div>
          <div className="flex flex-wrap gap-2">
            {failedEmail.length > 0 && <button className="btn" disabled={!!busy || !data.configured} onClick={() => sendEmail(failedEmail.map((r) => r.lineId), `${failedEmail.length} failed slip${failedEmail.length === 1 ? "" : "s"}`, "failed")}>Re-send failed ({failedEmail.length})</button>}
            <button className="btn btn-primary" disabled={!!busy || !data.configured || !pendingEmail.length} onClick={() => sendEmail(null, `${pendingEmail.length === rows.filter((r) => r.ok).length ? "all" : "the remaining"} ${pendingEmail.length} salary slip${pendingEmail.length === 1 ? "" : "s"}`, "all")}>{busy === "all" ? "Sending…" : pendingEmail.length ? `Email all (${pendingEmail.length})` : "All emailed"}</button>
          </div>
        </div>
        {!data.configured && <p className="warn">Add <b>MAIL_USER</b> and <b>MAIL_PASSWORD</b> in the app settings, then reload.</p>}
        {err && <p className="warn" role="alert">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">{filters.map(([k, l, n]) => <button key={k} className={`btn btn-sm ${filter === k ? "btn-primary" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}{n !== null ? ` (${n})` : ""}</button>)}</div>
          <label className="text-xs text-slate-500 flex items-center gap-2">WhatsApp language<select className="inp !w-auto !py-1" value={lang} onChange={(e) => { const v = e.target.value as Lang; setLang(v); try { localStorage.setItem(LANG_KEY, v); } catch { /* ignore */ } }}><option value="en">English</option><option value="hi">हिन्दी</option><option value="both">Both</option></select></label>
        </div>
        {!view.length ? <p className="text-sm text-slate-500 py-3 text-center">{filter === "all" ? "No salary slips in this run." : "Nobody matches this filter."}</p> :
        <ul className="divide-y divide-slate-100">{view.map((r) => { const link = wa(r); return (
          <li key={r.lineId} className="py-2.5 grid gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_auto] items-center">
            <div className="min-w-0"><div className="text-sm font-medium truncate">{r.name}</div><div className="text-xs text-slate-400 break-all">{r.ok ? r.email : "no email"} · {r.phone.length === 10 ? `+91 ${r.phone}` : "no phone"}</div></div>
            <div className="flex flex-wrap gap-1.5">{emailChip(r)}{waChip(r)}</div>
            <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
              <button className="btn btn-sm" disabled={!!busy || !data.configured || !r.ok} title={r.ok ? "" : "No email address on the employee record"} onClick={() => sendEmail([r.lineId], `${r.name}'s salary slip`, r.lineId)}>{busy === r.lineId ? "Sending…" : r.emailStatus === "sent" ? "Email again" : "Email"}</button>
              {link ? <a className="btn btn-sm" href={link} target="_blank" rel="noreferrer" onClick={() => markWa(r.lineId, true)}>{r.waAt ? "WhatsApp again" : "WhatsApp"}</a> : <button className="btn btn-sm" disabled title={r.phone.length === 10 ? "Preparing the link…" : "No valid phone number"}>WhatsApp</button>}
              <a className="btn btn-sm" href={`/api/payslips/${r.lineId}`} target="_blank" rel="noreferrer">PDF</a>
            </div>
            <div className="md:col-span-3 flex flex-wrap gap-x-3 text-[11px] text-slate-400">
              <button className="underline disabled:no-underline" disabled={!links} onClick={() => copy(r)}>{copied === r.lineId ? "Copied ✓" : "Copy WhatsApp message"}</button>
              {r.waAt ? <button className="underline" onClick={() => markWa(r.lineId, false)}>Unmark WhatsApp</button> : <button className="underline" onClick={() => markWa(r.lineId, true)} title="Mark as sent if you sent it another way">Mark WhatsApp sent</button>}
            </div>
          </li>); })}</ul>}
      </section>
      {testBox}
    </div>
  );
}
