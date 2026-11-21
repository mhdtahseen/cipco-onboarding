"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import Logo from "@/components/Logo";
import type { Run, TransportRate, Vehicle } from "@/lib/attendance";
import { inr, vehicleSummary, type TErrand, type TPay } from "@/lib/transportCalc";
import { VENDOR_LANGS, isVLang, localeOf, makeVT, pinMessage, type VLang } from "@/lib/vendorI18n";

// Public page for a vehicle's operator: the link plus a PIN. Talks to the database only through the vendor_* functions (one vehicle, nothing else),
// with no app sign-in, so a signed-in staff member opening it on the same phone changes nothing.
// Built for a phone first: large targets (44px), body text at 14–16px, status always in words as well as colour, errors next to the field they are about,
// and live regions so a screen reader hears what changed. It refreshes itself when the operator comes back to it.
type Data = { today: string; vehicle: Vehicle; project: string | null; rates: TransportRate[]; runs: Run[]; errands: TErrand[]; payments: TPay[]; askers: string[] };
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const keyOf = (t: string) => `cipco_vendor_${t.slice(0, 16)}`;
const readSession = (t: string) => { try { return localStorage.getItem(keyOf(t)) || ""; } catch { return ""; } };
const writeSession = (t: string, s: string) => { try { if (s) localStorage.setItem(keyOf(t), s); else localStorage.removeItem(keyOf(t)); } catch { /* private window: the PIN is asked each time */ } };
const LANG_KEY = "cipco_vendor_lang";
const shiftMonth = (m: string, by: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const daysBefore = (d: string, n: number) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() - n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const OTHER = "__other";
const MAX_WHAT = 300;
type FieldErr = Partial<Record<"date" | "description" | "asker" | "amount" | "form", string>>;

// ---------- small inline icons (decorative: the words next to them carry the meaning) ----------
const I = ({ d, className = "h-5 w-5" }: { d: string; className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={d} /></svg>;
const IC = {
  left: "M15 18l-6-6 6-6", right: "M9 18l6-6-6-6", down: "M6 9l6 6 6-6", plus: "M12 5v14M5 12h14", lock: "M7 11V7a5 5 0 0110 0v4M5 11h14v10H5z",
  check: "M20 6L9 17l-5-5", clock: "M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z", x: "M18 6L6 18M6 6l12 12", refresh: "M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5",
  out: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9", phone: "M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z",
};
const STATUS = {
  awaiting: { text: "st.awaiting", cls: "bg-amber-50 text-amber-900 ring-amber-200", icon: IC.clock },
  approved: { text: "st.approved", cls: "bg-emerald-50 text-emerald-900 ring-emerald-200", icon: IC.check },
  rejected: { text: "st.rejected", cls: "bg-rose-50 text-rose-900 ring-rose-200", icon: IC.x },
} as const;

export default function VendorPage() {
  const { token } = useParams<{ token: string }>();
  // language: what they chose before, else the phone's language when it is Hindi or Gujarati, else English
  const [lang, setLangState] = useState<VLang>("en");
  useEffect(() => { let l: VLang = "en"; try { const s = localStorage.getItem(LANG_KEY); if (isVLang(s)) l = s; else { const n = (navigator.language || "").slice(0, 2); if (isVLang(n)) l = n; } } catch { /* storage off */ } setLangState(l); }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = (l: VLang) => { setLangState(l); try { localStorage.setItem(LANG_KEY, l); } catch { /* storage off */ } };
  const t = useMemo(() => makeVT(lang), [lang]); const loc = localeOf(lang);
  const monthLabel = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString(loc, { month: "long", year: "numeric" });
  const monthOnly = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString(loc, { month: "long" });
  const fmtD = (x: string) => new Date(x + "T00:00:00").toLocaleDateString(loc, { day: "numeric", month: "short" });
  const fmtDay = (x: string) => new Date(x + "T00:00:00").toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short" });
  const [state, setState] = useState<"loading" | "gone" | "pin" | "ready">("loading"); const [d, setD] = useState<Data | null>(null);
  const [pin, setPin] = useState(""); const [showPin, setShowPin] = useState(false); const [pinErr, setPinErr] = useState(""); const [pinWhy, setPinWhy] = useState<"" | "pin.again" | "pin.againErrand">("");
  const [busy, setBusy] = useState(false); const [refreshing, setRefreshing] = useState(false); const [note, setNote] = useState(""); const [pageErr, setPageErr] = useState("");
  const [month, setMonth] = useState(""); const [adding, setAdding] = useState(false); const [showTrips, setShowTrips] = useState(false);
  const [f, setF] = useState({ date: "", description: "", amount: "", asker: "", other: "" }); const [fe, setFe] = useState<FieldErr>({});
  const [confirmId, setConfirmId] = useState<string | null>(null); const [fresh, setFresh] = useState<string | null>(null);
  const addBtn = useRef<HTMLButtonElement>(null); const errandsRef = useRef<HTMLElement>(null);
  const tripsId = useId();

  const toPin = (why: "pin.again" | "pin.againErrand") => { writeSession(token, ""); setD(null); setPinWhy(why); setState("pin"); };
  const load = useCallback(async (quiet = false) => {
    const session = readSession(token); if (!session) { setState("pin"); return; }
    if (quiet) setRefreshing(true);
    const { data, error } = await db().rpc("vendor_get", { p_token: token, p_session: session }); setRefreshing(false);
    if (error) { if (quiet) setPageErr(t("net.refresh")); else { setPinErr(t("net.load")); setState("pin"); } return; }
    if (!data?.ok) { if (data?.gone) { writeSession(token, ""); setState("gone"); } else toPin("pin.again"); return; }
    const x = data as Data & { ok: true };
    setD({ ...x, rates: x.rates.map((r) => ({ ...r, price: Number(r.price) })),
      errands: x.errands.map((e) => ({ ...e, pending: e.amount == null && e.approval === "approved", amount: Number(e.amount ?? 0), quoted_amount: e.quoted_amount == null ? null : Number(e.quoted_amount) })),
      payments: x.payments.map((p) => ({ ...p, amount: Number(p.amount) })) });
    setPageErr(""); setMonth((m) => m || x.today.slice(0, 7)); setF((s) => ({ ...s, date: s.date || x.today })); setState("ready");
  }, [token, t]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  // coming back to the page (from WhatsApp, the lock screen…) shows the latest figures
  useEffect(() => {
    const on = () => { if (document.visibilityState === "visible" && readSession(token)) load(true); };
    document.addEventListener("visibilitychange", on); return () => document.removeEventListener("visibilitychange", on);
  }, [load, token]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault(); if (!/^\d{4,6}$/.test(pin)) { setPinErr(t("pin.bad")); return; }
    setBusy(true); setPinErr(""); const { data, error } = await db().rpc("vendor_login", { p_token: token, p_pin: pin }); setBusy(false);
    if (error) { setPinErr(t("net.pin")); return; }
    if (!data?.ok) { if (data?.gone) { setState("gone"); return; } setPinErr(pinMessage(data?.error || "", t) || t("pin.wrong", { n: 0 })); setPin(""); return; }
    writeSession(token, data.session); setPin(""); setPinWhy(""); setState("loading"); load();
  }
  async function signOut() { const s = readSession(token); writeSession(token, ""); setD(null); setPinWhy(""); setState("pin"); if (s) await db().rpc("vendor_logout", { p_token: token, p_session: s }); }

  const openForm = () => { setFe({}); setNote(""); setAdding(true); };
  const closeForm = () => { setAdding(false); setFe({}); setTimeout(() => addBtn.current?.focus(), 0); };
  async function addErrand(e: React.FormEvent) {
    e.preventDefault(); if (!d) return;
    const asked = f.asker === OTHER ? f.other.trim() : f.asker; const amount = parseFloat(f.amount); const errs: FieldErr = {};
    if (!f.date || f.date > d.today || f.date < daysBefore(d.today, 7)) errs.date = t("e.date");
    if (!f.description.trim()) errs.description = t("e.what");
    if (!asked) errs.asker = f.asker === OTHER ? t("e.whoName") : t("e.who");
    if (!(amount > 0)) errs.amount = t("e.price");
    setFe(errs); if (Object.keys(errs).length) { document.getElementById(`ve-${Object.keys(errs)[0]}`)?.focus(); return; }
    setBusy(true);
    const r = await fetch("/api/vendor/errand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, session: readSession(token), date: f.date, description: f.description.trim(), amount, asked_by: asked }) }).catch(() => null);
    setBusy(false); const j = r ? await r.json().catch(() => ({})) : { error: t("net.send") };
    if (!r?.ok) { if (j.pin) { toPin("pin.againErrand"); return; } setFe({ form: j.error || t("net.send") }); return; }
    setF((s) => ({ ...s, description: "", amount: "", other: "" })); setAdding(false); setMonth(f.date.slice(0, 7)); setFresh(f.date);
    setNote(t("sent")); setTimeout(() => setNote(""), 8000);
    await load(true); setTimeout(() => { errandsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); setFresh(null); }, 50);
  }
  async function withdraw(x: TErrand) {
    setBusy(true); const { error } = await db().rpc("vendor_withdraw_errand", { p_token: token, p_session: readSession(token), p_id: x.id }); setBusy(false); setConfirmId(null);
    if (error) { if (/PIN again/.test(error.message)) { toPin("pin.again"); return; } setPageErr(error.message); return; }
    setNote(t("withdrawn")); setTimeout(() => setNote(""), 5000); load(true);
  }

  const sum = useMemo(() => d && month ? vehicleSummary(d.vehicle, d.runs, d.rates, d.errands, d.payments, month) : null, [d, month]);
  const monthErrands = useMemo(() => (d?.errands ?? []).filter((x) => x.work_date.startsWith(month)).sort((a, b) => b.work_date.localeCompare(a.work_date)), [d, month]);
  const waiting = monthErrands.filter((x) => x.approval === "awaiting");
  const firstMonth = useMemo(() => { if (!d) return ""; const all = [...d.runs.map((r) => r.work_date), ...d.errands.map((x) => x.work_date), ...d.payments.map((p) => p.paid_on), d.today].sort(); return all[0].slice(0, 7); }, [d]);

  // ---------- the frame: a header with the logo (and, once signed in, refresh and sign out), then one column ----------
  const shell = (body: React.ReactNode, signedIn = false) => (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2">
          <Logo className="h-7 w-auto" /><span className="hidden sm:inline whitespace-nowrap border-l border-slate-200 pl-3 text-sm text-slate-600">{t("hdr.account")}</span>
          {signedIn && <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => load(true)} disabled={refreshing} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50" aria-label={refreshing ? t("refreshing") : t("refresh")} title={t("refresh")}><I d={IC.refresh} className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} /></button>
            <button type="button" onClick={signOut} className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"><I d={IC.out} className="h-4 w-4" />{t("signOut")}</button>
          </div>}
        </div>
      </header>
      <main className="mx-auto max-w-xl space-y-4 px-4 pt-3 [&_input]:scroll-mt-24 [&_select]:scroll-mt-24 [&_textarea]:scroll-mt-24 [&_button]:scroll-mt-24" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
        <div role="group" aria-label={t("lang")} className="flex justify-end gap-1">{VENDOR_LANGS.map((l) => <button key={l.code} type="button" lang={l.code} aria-pressed={lang === l.code} onClick={() => setLang(l.code)}
          className={`h-10 rounded-full px-3.5 text-sm font-medium ring-1 transition-colors ${lang === l.code ? "bg-blue-700 text-white ring-blue-700" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100"}`}>{l.native}</button>)}</div>
        {body}</main>
    </div>);

  if (state === "loading") return shell(<div className="space-y-4" aria-busy="true" aria-label={t("loading")}>{[28, 36, 48].map((h) => <div key={h} className="animate-pulse rounded-2xl bg-slate-200/70" style={{ height: `${h * 4}px` }} />)}<span className="sr-only" role="status">{t("loading")}</span></div>);
  if (state === "gone") return shell(
    <section className="card space-y-2 text-center !py-8"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500"><I d={IC.lock} /></div>
      <h1 className="text-lg font-semibold">{t("gone.t")}</h1><p className="text-[15px] text-slate-600">{t("gone.d")}</p></section>);
  if (state === "pin" || !d || !sum) return shell(
    <form className="card space-y-4 !p-6" onSubmit={signIn} noValidate>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700"><I d={IC.lock} /></div>
      <div className="space-y-1"><h1 className="text-xl font-semibold">{t("pin.t")}</h1><p className="text-[15px] text-slate-600">{t(pinWhy || "pin.d")}</p></div>
      <div><label htmlFor="ve-pin" className="lbl">{t("pin.label")}</label>
        <div className="relative"><input id="ve-pin" className="inp !h-14 !pr-20 text-center !text-2xl font-mono tracking-[0.5em]" type={showPin ? "text" : "password"} inputMode="numeric" pattern="[0-9]*" autoComplete="off" enterKeyHint="go" maxLength={6}
            value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); if (pinErr) setPinErr(""); }} aria-invalid={!!pinErr} aria-describedby={pinErr ? "ve-pin-err" : "ve-pin-hint"} autoFocus />
          <button type="button" className="absolute right-1 top-1/2 h-11 -translate-y-1/2 rounded-md px-3 text-sm font-medium text-blue-700 hover:bg-blue-50" onClick={() => setShowPin(!showPin)} aria-pressed={showPin}>{showPin ? t("pin.hide") : t("pin.show")}</button></div>
        {pinErr ? <p id="ve-pin-err" role="alert" className="mt-2 text-sm text-rose-700">{pinErr}</p> : <p id="ve-pin-hint" className="mt-2 text-sm text-slate-500">{t("pin.hint")}</p>}</div>
      <button className="btn btn-primary w-full justify-center !h-12 !text-base" disabled={busy}>{busy ? t("pin.checking") : t("pin.open")}</button>
      <p className="text-sm text-slate-500">{t("pin.forgot")}</p>
    </form>);

  const v = d.vehicle; const due = sum.due; const thisMonth = d.today.slice(0, 7); const owed = due > 0.005, ahead = due < -0.005;
  const shortMonth = monthOnly(month);
  // the trips line's "how": "39 × ₹450" stays as it is; the worded forms are said in the chosen language
  const how = (() => { const h = sum.how; if (!h) return ""; const m = h.match(/^(\d+) trips at (\d+) rates$/); if (m) return t("m.tripsRates", { n: m[1], k: m[2] }); if (/^monthly hire from/.test(h)) return t("m.hireFrom", { date: fmtD(sum.tripLines[0]?.date ?? month + "-01") }); return h; })();
  const noShows = d.runs.filter((r) => r.vehicle_id === v.id && r.status === "no_show" && r.work_date.startsWith(month)).sort((a, b) => a.work_date.localeCompare(b.work_date)).map((r) => `${fmtD(r.work_date)} ${t(r.leg === "pickup" ? "m.pickup" : "m.drop")}`);
  const lineLabel = (label: string, date: string) => (label === "Pickup" ? t("m.pickup") : label === "Drop" ? t("m.drop") : t("m.monthlyLine", { date: fmtD(date) }));
  return shell(<>
    {/* who this account is for */}
    <div className="space-y-1"><h1 className="text-2xl font-semibold leading-tight break-words">{v.name}</h1>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-slate-600"><span>{[v.operator, d.project].filter(Boolean).join(" · ")}</span>
        <span className="rounded-full bg-slate-200/70 px-2.5 py-0.5 text-xs font-medium text-slate-700">{v.billing === "monthly" ? t("bill.monthly") : t("bill.trip")}</span></p></div>

    <div aria-live="polite">{note && <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[15px] text-emerald-900 ring-1 ring-emerald-200"><I d={IC.check} className="mt-0.5 h-5 w-5 shrink-0" />{note}</p>}</div>
    {pageErr && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-[15px] text-rose-900 ring-1 ring-rose-200">{pageErr}</p>}

    {/* the balance */}
    <section className="card !p-5 space-y-3" aria-labelledby="ve-bal">
      <div><h2 id="ve-bal" className="text-sm font-medium text-slate-600">{owed ? t("bal.owed") : ahead ? t("bal.ahead") : t("bal.balance")}</h2>
        <p className={`mt-1 text-4xl font-semibold tabular-nums tracking-tight ${owed ? "text-amber-800" : ahead ? "text-emerald-800" : ""}`}>₹{inr(Math.abs(due))}</p>
        {owed && sum.oldest && <p className="mt-1 text-sm text-slate-600">{t("bal.since", { date: fmtD(sum.oldest) })}</p>}
        {!owed && !ahead && <p className="mt-1 text-sm text-slate-600">{t("bal.full")}</p>}</div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-slate-50 px-3 py-2"><dt className="text-slate-600">{t("bal.earned")}</dt><dd className="text-base font-semibold tabular-nums">₹{inr(sum.billed)}</dd></div>
        <div className="rounded-xl bg-slate-50 px-3 py-2"><dt className="text-slate-600">{t("bal.paid")}</dt><dd className="text-base font-semibold tabular-nums">₹{inr(sum.paid)}</dd></div></dl>
      {sum.unpriced > 0 && <p className="text-sm text-amber-800">{t("bal.unpriced", { n: sum.unpriced })}</p>}
    </section>

    {/* adding a trip (an errand, in the office screens) */}
    {!adding ? <button ref={addBtn} type="button" className="btn btn-primary w-full justify-center !h-12 !text-base" onClick={openForm}><I d={IC.plus} />{t("add.btn")}</button>
    : <form className="card !p-5 space-y-4" onSubmit={addErrand} noValidate aria-labelledby="ve-add">
      <div><h2 id="ve-add" className="text-lg font-semibold">{t("add.btn")}</h2><p className="text-sm text-slate-600">{t("add.d")}</p></div>
      <Field id="ve-date" label={t("f.date")} hint={t("f.dateHint")} err={fe.date}>
        <input id="ve-date" type="date" className="inp" min={daysBefore(d.today, 7)} max={d.today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} {...aria("ve-date", fe.date, true)} /></Field>
      <Field id="ve-description" label={t("f.what")} hint={`${f.description.length}/${MAX_WHAT}`} err={fe.description}>
        <textarea id="ve-description" className="inp min-h-24 resize-y" maxLength={MAX_WHAT} placeholder={t("f.whatPh")} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} autoFocus {...aria("ve-description", fe.description, true)} /></Field>
      <Field id="ve-asker" label={t("f.who")} err={fe.asker}>
        <select id="ve-asker" className="inp" value={f.asker} onChange={(e) => setF({ ...f, asker: e.target.value })} {...aria("ve-asker", fe.asker)}><option value="">{t("f.choose")}</option>{d.askers.map((n) => <option key={n} value={n}>{n}</option>)}<option value={OTHER}>{t("f.someone")}</option></select>
        {f.asker === OTHER && <input className="inp mt-2" maxLength={80} placeholder={t("f.theirName")} aria-label={t("f.whoAria")} autoComplete="off" value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} />}</Field>
      <Field id="ve-amount" label={t("f.price")} err={fe.amount}>
        <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true">₹</span>
          <input id="ve-amount" className="inp !pl-7 tabular-nums" inputMode="decimal" enterKeyHint="send" autoComplete="off" placeholder="600" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, "") })} {...aria("ve-amount", fe.amount)} /></div></Field>
      {fe.form && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-200">{fe.form}</p>}
      <div className="flex flex-col-reverse gap-2 min-[400px]:flex-row"><button type="button" className="btn justify-center !h-12 min-[400px]:flex-1" onClick={closeForm}>{t("cancel")}</button>
        <button className="btn btn-primary justify-center !h-12 !text-base min-[400px]:flex-[2]" disabled={busy}>{busy ? t("sending") : t("send")}</button></div>
    </form>}

    {/* the month */}
    <section className="card !p-5 space-y-4" aria-label={monthLabel(month)}>
      <div className="flex items-center gap-2">
        <button type="button" className="btn !h-11 !w-11 justify-center !p-0" aria-label={t("m.prev")} disabled={month <= firstMonth} onClick={() => setMonth(shiftMonth(month, -1))}><I d={IC.left} /></button>
        <h2 className="flex-1 text-center text-lg font-semibold" aria-live="polite">{monthLabel(month)}</h2>
        <button type="button" className="btn !h-11 !w-11 justify-center !p-0" aria-label={t("m.next")} disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}><I d={IC.right} /></button></div>
      <div className="text-[15px] tabular-nums">
        <button type="button" className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-2.5 text-left hover:bg-slate-50" aria-expanded={showTrips} aria-controls={tripsId} onClick={() => setShowTrips(!showTrips)}>
          <span className="min-w-0 flex-1">{v.billing === "monthly" ? t("m.monthly") : t("m.trips")}{how && <span className="block text-sm text-slate-600">{how}</span>}</span>
          <span className="font-medium">₹{inr(sum.tripMonth)}</span><I d={IC.down} className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${showTrips ? "rotate-180" : ""}`} /><span className="sr-only">{showTrips ? t("m.hide") : t("m.show")}</span></button>
        {showTrips && <ul id={tripsId} className="mb-2 max-h-72 divide-y divide-slate-200/70 overflow-y-auto rounded-xl bg-slate-50 px-3 text-sm">{sum.tripLines.length ? sum.tripLines.map((l, n) => <li key={n} className="flex gap-3 py-2"><span className="w-28 shrink-0 text-slate-600">{fmtDay(l.date)}</span><span className="min-w-0 flex-1">{lineLabel(l.label, l.date)}</span><span className="shrink-0">{l.amount === null ? <span className="text-amber-800">{t("m.noPrice")}</span> : `₹${inr(l.amount)}`}</span></li>) : <li className="py-2 text-slate-600">{t("m.noTrips")}</li>}</ul>}
        <div className="flex items-center justify-between py-2.5"><span>{t("m.erApproved")}{sum.erCount > 0 && <span className="text-slate-600"> · {sum.erCount}</span>}</span><span className="font-medium">₹{inr(sum.erMonth)}</span></div>
        <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base font-semibold"><span>{t("m.total", { month: shortMonth })}</span><span>₹{inr(sum.month)}</span></div>
        {waiting.length > 0 && <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-900"><I d={IC.clock} className="mt-0.5 h-4 w-4 shrink-0" />{t("m.waiting", { amt: inr(waiting.reduce((s, x) => s + (x.quoted_amount ?? 0), 0)), n: waiting.length })}</p>}
      </div>
      <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
        <p className="flex flex-wrap gap-x-4 gap-y-1"><span className="inline-flex items-center gap-1 text-emerald-800"><I d={IC.check} className="h-4 w-4" />{t("m.showed", { n: sum.showed })}</span>
          {sum.missed > 0 && <span className="inline-flex items-center gap-1 text-rose-800"><I d={IC.x} className="h-4 w-4" />{t("m.noshow", { n: sum.missed })}</span>}</p>
        {sum.missed > 0 && <><p className="text-slate-700">{t("m.noshows", { list: noShows.join(", ") })}</p><p className="text-slate-600">{v.billing === "per_trip" ? t("m.notPaid") : t("m.raised")} {t("m.wrong")}</p></>}
      </div>
    </section>

    {/* errands */}
    <section ref={errandsRef} className="card !p-5 space-y-3 scroll-mt-20" aria-labelledby="ve-errands">
      <h2 id="ve-errands" className="text-lg font-semibold">{t("er.t", { month: shortMonth })}</h2>
      {monthErrands.length ? <ul className="space-y-3">{monthErrands.map((x) => { const st = STATUS[x.approval ?? "approved"]; return (
        <li key={x.id} className={`rounded-xl border p-3 space-y-1.5 transition-colors ${fresh && x.work_date === fresh && x.approval === "awaiting" ? "border-blue-300 bg-blue-50/50" : "border-slate-200"}`}>
          <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-slate-700 tabular-nums">{fmtDay(x.work_date)}</span>
            <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${st.cls}`}><I d={st.icon} className="h-3.5 w-3.5" />{t(st.text)}</span></div>
          <p className="text-[15px] break-words">{x.description}</p>
          <p className="text-sm text-slate-600 tabular-nums">{x.approval === "approved" ? (x.pending ? t("er.officeAmt") : <><b className="font-semibold text-slate-900">₹{inr(x.amount)}</b>{x.quoted_amount != null && x.quoted_amount !== x.amount && <> ({t("er.youAskedSmall", { amt: inr(x.quoted_amount) })})</>}</>) : t("er.youAsked", { amt: inr(x.quoted_amount ?? 0) })}{x.asked_by && <> · {t("er.askedBy", { name: x.asked_by })}</>}{x.source === "staff" && <> · {t("er.byOffice")}</>}</p>
          {x.decision_note && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800"><span className="font-medium">{t("er.cipco")}</span> {x.decision_note}</p>}
          {x.approval === "awaiting" && (confirmId === x.id
            ? <div className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-2 text-sm ring-1 ring-rose-200" role="group" aria-label={t("er.confirmAria")}><span className="flex-1 min-w-[10rem] text-rose-900">{t("er.confirm")}</span>
                <button type="button" className="btn !h-11 border-rose-300 text-rose-800" disabled={busy} onClick={() => withdraw(x)}>{busy ? t("er.withdrawing") : t("er.yes")}</button><button type="button" className="btn !h-11" autoFocus onClick={() => setConfirmId(null)}>{t("er.keep")}</button></div>
            : <button type="button" className="-ml-2 inline-flex h-11 items-center rounded-lg px-2 text-sm font-medium text-rose-700 hover:bg-rose-50" onClick={() => setConfirmId(x.id)}>{t("er.withdraw")}</button>)}
        </li>); })}</ul> : <p className="text-[15px] text-slate-600">{t("er.none", { month: shortMonth })}</p>}
    </section>

    {/* payments */}
    <section className="card !p-5 space-y-3" aria-labelledby="ve-pay">
      <div className="flex items-baseline gap-2"><h2 id="ve-pay" className="text-lg font-semibold">{t("pay.t")}</h2><span className="ml-auto text-sm text-slate-600 tabular-nums">{t("pay.all", { amt: inr(sum.paid) })}</span></div>
      {d.payments.length ? <ul className="divide-y divide-slate-100">{d.payments.map((p) => <li key={p.id} className="flex items-start gap-3 py-2.5">
        <div className="min-w-0 flex-1"><div className="text-[15px] tabular-nums">{fmtDay(p.paid_on)}</div>{p.reference && <div className="text-sm text-slate-600 break-all">{p.reference}</div>}</div>
        <span className="shrink-0 text-[15px] font-semibold tabular-nums">₹{inr(p.amount)}</span></li>)}</ul> : <p className="text-[15px] text-slate-600">{t("pay.none")}</p>}
    </section>

    <p className="text-center text-sm text-slate-600"><I d={IC.phone} className="mr-1.5 inline h-4 w-4 align-[-3px]" />{t("foot")}</p>
  </>, true);
}

// a form field: label, the control, then either its error (announced) or a hint
function Field({ id, label, hint, err, children }: { id: string; label: string; hint?: string; err?: string; children: React.ReactNode }) {
  return <div><label htmlFor={id} className="lbl !text-sm">{label}</label>{children}
    {err ? <p id={`${id}-err`} className="mt-1.5 text-sm text-rose-700">{err}</p> : hint ? <p id={`${id}-hint`} className="mt-1.5 text-sm text-slate-500">{hint}</p> : null}</div>;
}
const aria = (id: string, err?: string, hint = false) => ({ "aria-invalid": !!err || undefined, "aria-describedby": err ? `${id}-err` : hint ? `${id}-hint` : undefined });
