"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import Logo from "@/components/Logo";
import { PageLoader } from "@/components/Loader";
import type { Run, TransportRate, Vehicle } from "@/lib/attendance";
import { fmtDay, inr, vehicleSummary, type TErrand, type TPay } from "@/lib/transportCalc";

// Public page for a vehicle's operator: the link plus a PIN. Talks to the database only through the vendor_* functions (one vehicle, nothing else),
// with no app sign-in, so a signed-in staff member opening it on the same phone changes nothing.
type Data = { today: string; vehicle: Vehicle; project: string | null; rates: TransportRate[]; runs: Run[]; errands: TErrand[]; payments: TPay[]; askers: string[] };
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const keyOf = (t: string) => `cipco_vendor_${t.slice(0, 16)}`;
const readSession = (t: string) => { try { return localStorage.getItem(keyOf(t)) || ""; } catch { return ""; } };
const writeSession = (t: string, s: string) => { try { if (s) localStorage.setItem(keyOf(t), s); else localStorage.removeItem(keyOf(t)); } catch { /* private window: the PIN is asked each time */ } };
const monthLabel = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const shiftMonth = (m: string, by: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const daysBefore = (d: string, n: number) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const OTHER = "__other";

export default function VendorPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"loading" | "gone" | "pin" | "ready">("loading"); const [d, setD] = useState<Data | null>(null);
  const [pin, setPin] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [note, setNote] = useState("");
  const [month, setMonth] = useState(""); const [adding, setAdding] = useState(false); const [showTrips, setShowTrips] = useState(false);
  const [f, setF] = useState({ date: "", description: "", amount: "", asker: "", other: "" });

  async function load() {
    const session = readSession(token); if (!session) { setState("pin"); return; }
    const { data, error } = await db().rpc("vendor_get", { p_token: token, p_session: session });
    if (error) { setErr("Could not load. Check your internet and try again."); setState("pin"); return; }
    if (!data?.ok) { if (data?.gone) { writeSession(token, ""); setState("gone"); } else { writeSession(token, ""); setState("pin"); } return; }
    const x = data as Data & { ok: true };
    setD({ ...x, rates: x.rates.map((r) => ({ ...r, price: Number(r.price) })),
      errands: x.errands.map((e) => ({ ...e, pending: e.amount == null && e.approval === "approved", amount: Number(e.amount ?? 0), quoted_amount: e.quoted_amount == null ? null : Number(e.quoted_amount) })),
      payments: x.payments.map((p) => ({ ...p, amount: Number(p.amount) })) });
    setMonth((m) => m || x.today.slice(0, 7)); setF((s) => ({ ...s, date: s.date || x.today })); setState("ready");
  }
  useEffect(() => { document.title = "CIPCO · Vehicle"; load(); }, [token]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function signIn(e: React.FormEvent) {
    e.preventDefault(); if (!/^\d{4,6}$/.test(pin)) { setErr("Enter the 4 to 6 digit PIN."); return; }
    setBusy(true); setErr(""); const { data, error } = await db().rpc("vendor_login", { p_token: token, p_pin: pin }); setBusy(false);
    if (error) { setErr("Could not check the PIN. Check your internet and try again."); return; }
    if (!data?.ok) { if (data?.gone) setState("gone"); setErr(data?.error || "That PIN is not right."); return; }
    writeSession(token, data.session); setPin(""); setState("loading"); load();
  }
  async function signOut() { const s = readSession(token); writeSession(token, ""); if (s) await db().rpc("vendor_logout", { p_token: token, p_session: s }); setD(null); setState("pin"); }

  async function addErrand(e: React.FormEvent) {
    e.preventDefault(); setErr(""); const asked = f.asker === OTHER ? f.other.trim() : f.asker; const amount = parseFloat(f.amount);
    if (!f.description.trim()) { setErr("Say what the errand was for."); return; }
    if (!asked) { setErr("Choose who asked you to run it."); return; }
    if (!(amount > 0)) { setErr("Enter the amount you quoted."); return; }
    setBusy(true);
    const r = await fetch("/api/vendor/errand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, session: readSession(token), date: f.date, description: f.description.trim(), amount, asked_by: asked }) }).catch(() => null);
    setBusy(false); const j = r ? await r.json().catch(() => ({})) : { error: "Could not send. Check your internet and try again." };
    if (!r?.ok) { if (j.pin) { writeSession(token, ""); setState("pin"); } setErr(j.error || "Could not send."); return; }
    setF((s) => ({ ...s, description: "", amount: "", other: "" })); setAdding(false); setMonth(f.date.slice(0, 7));
    setNote("Sent. CIPCO will approve or reply; you will see it below."); setTimeout(() => setNote(""), 6000); load();
  }
  async function withdraw(x: TErrand) {
    if (!confirm(`Withdraw the ₹${inr(x.quoted_amount ?? 0)} errand of ${fmtDay(x.work_date)}?`)) return;
    const { error } = await db().rpc("vendor_withdraw_errand", { p_token: token, p_session: readSession(token), p_id: x.id });
    if (error) { if (/PIN again/.test(error.message)) { writeSession(token, ""); setState("pin"); } setErr(error.message); return; }
    load();
  }

  const sum = useMemo(() => d && month ? vehicleSummary(d.vehicle, d.runs, d.rates, d.errands, d.payments, month) : null, [d, month]);
  const monthErrands = useMemo(() => (d?.errands ?? []).filter((x) => x.work_date.startsWith(month)), [d, month]);
  const waiting = monthErrands.filter((x) => x.approval === "awaiting");
  const firstMonth = useMemo(() => { if (!d) return ""; const all = [...d.runs.map((r) => r.work_date), ...d.errands.map((x) => x.work_date), ...d.payments.map((p) => p.paid_on), d.today].sort(); return all[0].slice(0, 7); }, [d]);

  const shell = (body: React.ReactNode) => <main className="min-h-screen bg-slate-50 px-4 py-6"><div className="mx-auto max-w-lg space-y-4"><Logo className="h-8 w-auto" />{body}</div></main>;
  if (state === "loading") return shell(<PageLoader />);
  if (state === "gone") return shell(<div className="card space-y-1"><h1 className="text-lg font-semibold">This link is not active</h1><p className="text-sm text-slate-600">Ask the CIPCO office for a new link.</p></div>);
  if (state === "pin" || !d || !sum) return shell(
    <form className="card space-y-3" onSubmit={signIn}>
      <h1 className="text-lg font-semibold">Enter your PIN</h1>
      <p className="text-sm text-slate-600">The CIPCO office gave you a PIN with this link.</p>
      <input className="inp text-center text-2xl tracking-[0.5em] font-mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-label="PIN" autoFocus />
      {err && <p className="warn">{err}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Checking…" : "Open"}</button>
    </form>);

  const v = d.vehicle; const due = sum.due; const thisMonth = d.today.slice(0, 7);
  return shell(<>
    <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h1 className="text-xl font-semibold truncate">{v.name}</h1><p className="text-sm text-slate-500 truncate">{[v.operator, d.project].filter(Boolean).join(" · ")} · {v.billing === "monthly" ? "monthly hire" : "paid per trip"}</p></div><button className="text-xs text-slate-500 underline shrink-0" onClick={signOut}>Sign out</button></div>
    {note && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{note}</p>}
    {err && <p className="warn">{err}</p>}

    <section className="card space-y-1">
      <div className="text-xs text-slate-500">{due > 0.005 ? "CIPCO owes you" : due < -0.005 ? "Paid ahead" : "Balance"}</div>
      <div className={`text-3xl font-semibold tabular-nums ${due > 0.005 ? "text-amber-800" : ""}`}>₹{inr(Math.abs(due))}</div>
      <div className="text-xs text-slate-500 tabular-nums">All time: earned ₹{inr(sum.billed)} − paid ₹{inr(sum.paid)}{sum.unpriced > 0 && <span className="text-amber-700"> · {sum.unpriced} trip{sum.unpriced === 1 ? "" : "s"} without a price yet</span>}</div>
    </section>

    {!adding ? <button className="btn btn-primary w-full" onClick={() => { setErr(""); setAdding(true); }}>+ Add an errand</button>
    : <form className="card space-y-3" onSubmit={addErrand}>
      <div className="flex items-center"><h2 className="font-medium">Add an errand</h2><button type="button" className="ml-auto text-xs text-slate-500 underline" onClick={() => setAdding(false)}>Cancel</button></div>
      <p className="text-xs text-slate-500">An extra job you ran for CIPCO. It is paid once CIPCO approves it.</p>
      <div><label className="lbl" htmlFor="ve-date">Date</label><input id="ve-date" type="date" className="inp" min={daysBefore(d.today, 7)} max={d.today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
      <div><label className="lbl" htmlFor="ve-what">What was it for?</label><textarea id="ve-what" className="inp min-h-20" maxLength={300} placeholder="e.g. Took cement bags from the yard to Block C" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div><label className="lbl" htmlFor="ve-who">Who asked you?</label><select id="ve-who" className="inp" value={f.asker} onChange={(e) => setF({ ...f, asker: e.target.value })}><option value="">Choose…</option>{d.askers.map((n) => <option key={n} value={n}>{n}</option>)}<option value={OTHER}>Someone else</option></select>
        {f.asker === OTHER && <input className="inp mt-2" maxLength={80} placeholder="Their name" aria-label="Who asked" value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} />}</div>
      <div><label className="lbl" htmlFor="ve-amt">Your price (₹)</label><input id="ve-amt" className="inp" inputMode="decimal" placeholder="e.g. 600" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} /></div>
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Sending…" : "Send for approval"}</button>
    </form>}

    <section className="card space-y-3">
      <div className="flex items-center gap-2"><button className="btn !px-3" aria-label="Previous month" disabled={month <= firstMonth} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><h2 className="flex-1 text-center font-medium">{monthLabel(month)}</h2><button className="btn !px-3" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div>
      <div className="space-y-1 text-sm tabular-nums">
        <button type="button" className="flex w-full justify-between text-left" aria-expanded={showTrips} onClick={() => setShowTrips(!showTrips)}><span>{v.billing === "monthly" ? "Monthly hire" : "Trips"}{sum.how && <span className="text-slate-500"> · {sum.how}</span>} <span className="text-xs text-blue-700 underline">{showTrips ? "hide" : "details"}</span></span><span>₹{inr(sum.tripMonth)}</span></button>
        {showTrips && <ul className="rounded-xl bg-slate-50 p-2 text-xs divide-y divide-slate-200/70 max-h-64 overflow-y-auto">{sum.tripLines.length ? sum.tripLines.map((l, n) => <li key={n} className="flex gap-2 py-1"><span className="w-24 shrink-0 text-slate-600">{fmtDay(l.date)}</span><span className="flex-1 min-w-0">{l.label}</span><span>{l.amount === null ? "no price yet" : `₹${inr(l.amount)}`}</span></li>) : <li className="py-1 text-slate-500">No trips this month.</li>}</ul>}
        <div className="flex justify-between"><span>Errands approved{sum.erCount > 0 && <span className="text-slate-500"> · {sum.erCount}</span>}</span><span>₹{inr(sum.erMonth)}</span></div>
        <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Total for {monthLabel(month).split(" ")[0]}</span><span>₹{inr(sum.month)}</span></div>
        {waiting.length > 0 && <p className="text-xs text-amber-800">+ ₹{inr(waiting.reduce((s, x) => s + (x.quoted_amount ?? 0), 0))} in {waiting.length} errand{waiting.length === 1 ? "" : "s"} waiting for approval (not counted yet)</p>}
      </div>
      <div className="text-xs"><span className="text-emerald-700">✓ {sum.showed} showed up</span>{sum.missed > 0 && <span className="text-rose-700"> · ✗ {sum.missed} no-show{sum.missed === 1 ? "" : "s"}: {sum.noShows.join(", ")}</span>}
        {sum.missed > 0 && <p className="mt-1 text-slate-500">{v.billing === "per_trip" ? "No-show trips are not paid." : "No-show days may be raised with you by CIPCO."} If one is wrong, call the CIPCO office.</p>}</div>
    </section>

    <section className="card space-y-2"><h2 className="font-medium">Errands in {monthLabel(month)}</h2>
      {monthErrands.length ? <ul className="divide-y divide-slate-100">{monthErrands.map((x) => <li key={x.id} className="py-2 space-y-1 text-sm">
        <div className="flex items-baseline gap-2"><span className="text-slate-600 tabular-nums">{fmtDay(x.work_date)}</span>
          <span className={`ml-auto rounded-full px-2 text-xs ${x.approval === "awaiting" ? "bg-amber-100 text-amber-800" : x.approval === "rejected" ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}>{x.approval === "awaiting" ? "Waiting for approval" : x.approval === "rejected" ? "Not approved" : "Approved"}</span></div>
        <p className="break-words">{x.description}</p>
        <p className="text-xs text-slate-500 tabular-nums">{x.approval === "approved" ? (x.pending ? "Amount to be entered by the office" : <>₹{inr(x.amount)}{x.quoted_amount != null && x.quoted_amount !== x.amount && <> (you quoted ₹{inr(x.quoted_amount)})</>}</>) : <>You quoted ₹{inr(x.quoted_amount ?? 0)}</>}{x.asked_by && <> · asked by {x.asked_by}</>}{x.source === "staff" && <> · added by the office</>}</p>
        {x.decision_note && <p className="text-xs text-slate-700">CIPCO: “{x.decision_note}”</p>}
        {x.approval === "awaiting" && <button className="text-xs text-red-700 underline" onClick={() => withdraw(x)}>Withdraw</button>}
      </li>)}</ul> : <p className="text-sm text-slate-500">No errands this month.</p>}
    </section>

    <section className="card space-y-2"><div className="flex items-baseline"><h2 className="font-medium">Payments</h2><span className="ml-auto text-sm tabular-nums text-slate-500">₹{inr(sum.paid)} in all</span></div>
      {d.payments.length ? <ul className="divide-y divide-slate-100 text-sm">{d.payments.map((p) => <li key={p.id} className="py-2 flex gap-3"><span className="w-28 shrink-0 text-slate-600 tabular-nums">{fmtDay(p.paid_on)}</span><span className="flex-1 min-w-0 truncate text-xs text-slate-500 self-center">{p.reference}</span><span className="tabular-nums font-medium">₹{inr(p.amount)}</span></li>)}</ul> : <p className="text-sm text-slate-500">No payments yet.</p>}
    </section>
    <p className="text-center text-xs text-slate-400">Questions about a figure? Call the CIPCO office.</p>
  </>);
}
