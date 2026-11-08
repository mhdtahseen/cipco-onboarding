"use client";
import { useCallback, useEffect, useState } from "react";
import { loadMe } from "@/lib/me";

type Person = { lineId: string; name: string; email: string; ok: boolean; last: { status: "sent" | "failed" | "no_email"; error: string | null; sent_at: string } | null };
type Result = { lineId: string; status: "sent" | "failed" | "no_email"; error?: string };

// After a payroll run is approved: email every person their own salary slip (PDF) from the payroll mailbox, see who got theirs, and re-send only the failures.
export default function SlipEmailer({ runId, monthLabel, approved }: { runId: string; monthLabel: string; approved: boolean }) {
  const [d, setD] = useState<{ configured: boolean; from: string | null; people: Person[] } | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState<Record<string, Result>>({}); const [msg, setMsg] = useState("");
  const [to, setTo] = useState(""); const [tBusy, setTBusy] = useState(false); const [tMsg, setTMsg] = useState(""); const [tErr, setTErr] = useState("");
  useEffect(() => { try { const k = localStorage.getItem("cipco_slip_test_to"); if (k) { setTo(k); return; } } catch { /* storage unavailable */ } loadMe().then((me) => { if (me?.email) setTo((x) => x || me.email); }).catch(() => { /* optional */ }); }, []);
  const load = useCallback(async () => { setErr(""); if (!approved) { setD({ configured: true, from: null, people: [] }); return; } const r = await fetch(`/api/payslips/email?run=${runId}`); const j = await r.json().catch(() => ({})); if (!r.ok) { setErr(j.error || "Could not load."); return; } setD(j); }, [runId, approved]);
  useEffect(() => { setD(null); setDone({}); setMsg(""); load(); }, [load]);
  if (err) return <p className="warn">{err}</p>; if (!d) return null;

  const status = (p: Person): "sent" | "failed" | "no_email" | "pending" => done[p.lineId]?.status ?? (!p.ok ? "no_email" : p.last?.status === "sent" ? "sent" : p.last?.status === "failed" ? "failed" : "pending");
  const withMail = d.people.filter((p) => p.ok), todo = withMail.filter((p) => status(p) !== "sent"), failed = d.people.filter((p) => status(p) === "failed"), nomail = d.people.filter((p) => !p.ok);
  async function send(ids: string[] | null, what: string) {
    if (!confirm(`Email ${what} from ${d!.from}? Each person receives only their own ${monthLabel} salary slip.`)) return;
    setBusy(true); setErr(""); setMsg("");
    const r = await fetch("/api/payslips/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run: runId, lineIds: ids }) }); const j = await r.json().catch(() => ({}));
    setBusy(false); if (!r.ok) { setErr(j.error || "Sending failed."); return; }
    const m: Record<string, Result> = {}; (j.results as Result[]).forEach((x) => { m[x.lineId] = x; }); setDone((x) => ({ ...x, ...m }));
    const n = (s: string) => (j.results as Result[]).filter((x) => x.status === s).length; setMsg(`${n("sent")} sent${n("failed") ? `, ${n("failed")} failed` : ""}${n("no_email") ? `, ${n("no_email")} without an email address` : ""}.`);
  }
  async function sendTest() {
    setTBusy(true); setTErr(""); setTMsg(""); try { localStorage.setItem("cipco_slip_test_to", to.trim()); } catch { /* ignore */ }
    const r = await fetch("/api/payslips/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run: runId, test: true, to: to.trim() }) }); const j = await r.json().catch(() => ({}));
    setTBusy(false); if (!r.ok) { setTErr(j.error || "The test could not be sent."); return; } setTMsg(`Test sent to ${j.to}${j.sample ? ` (using ${j.sample}'s slip)` : ""}. Check that inbox, and the spam folder.`);
  }
  const testBox = (
    <div className="rounded-xl border border-dashed border-slate-300 p-2.5 space-y-1.5">
      <div className="text-xs font-medium text-slate-600">Try it first: send one test slip to yourself. No employee is emailed and nothing is recorded.{!approved && " Works on a draft, no approval needed."}</div>
      <div className="flex flex-wrap items-center gap-2"><input className="inp !py-1.5 max-w-xs" type="email" aria-label="Send the test to" placeholder="you@cipcogroup.com" value={to} onChange={(e) => setTo(e.target.value)} /><button className="btn" disabled={tBusy || !to.trim() || !d!.configured} onClick={sendTest}>{tBusy ? "Sending…" : "Send me a test"}</button></div>
      {tErr && <p className="warn">{tErr}</p>}{tMsg && <p className="text-sm text-green-700">{tMsg}</p>}
    </div>);
  if (!approved) return <section className="card !p-3 space-y-2"><h3 className="font-semibold text-sm">Email salary slips</h3>{testBox}</section>;
  const chip = (s: ReturnType<typeof status>, title?: string) => s === "sent" ? <span className="pill !bg-emerald-50 !text-emerald-800">Sent</span> : s === "failed" ? <span className="pill !bg-rose-50 !text-rose-800" title={title}>Failed</span> : s === "no_email" ? <span className="pill !bg-amber-50 !text-amber-800">No email address</span> : <span className="pill !bg-slate-100 !text-slate-600">Not sent yet</span>;

  return (
    <section className="card !p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-semibold text-sm">Email salary slips</h3><p className="text-xs text-slate-500">{d.configured ? `From ${d.from}. A copy of each email is kept in that mailbox.` : "Email is not set up yet."} {withMail.length} of {d.people.length} people have an email address.</p></div>
        <div className="flex flex-wrap gap-2">
          {failed.length > 0 && <button className="btn" disabled={busy || !d.configured} onClick={() => send(failed.map((p) => p.lineId), `${failed.length} failed slip${failed.length === 1 ? "" : "s"}`)}>Re-send failed ({failed.length})</button>}
          <button className="btn btn-primary" disabled={busy || !d.configured || !todo.length} onClick={() => send(null, `${todo.length === withMail.length ? "all" : "the remaining"} ${todo.length} salary slip${todo.length === 1 ? "" : "s"}`)}>{busy ? "Sending…" : todo.length === withMail.length ? `Email ${todo.length} slips` : todo.length ? `Email remaining (${todo.length})` : "All sent"}</button>
        </div>
      </div>
      {testBox}
      {!d.configured && <p className="warn">Add <b>MAIL_USER</b> and <b>MAIL_PASSWORD</b> in the app settings, then reload.</p>}
      {nomail.length > 0 && <p className="text-xs text-amber-800">No email address for {nomail.map((p) => p.name).join(", ")}. Add it on their employee record, or use WhatsApp for them.</p>}
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
      <ul className="divide-y divide-slate-100 text-sm">{d.people.map((p) => <li key={p.lineId} className="flex items-center justify-between gap-3 py-1.5"><span className="min-w-0"><span className="font-medium">{p.name}</span> <span className="text-xs text-slate-500 break-all">{p.email}</span></span>{chip(status(p), done[p.lineId]?.error ?? p.last?.error ?? undefined)}</li>)}</ul>
    </section>
  );
}
