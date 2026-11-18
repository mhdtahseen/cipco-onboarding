"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Dash, DashAlert } from "@/lib/dashboardData";
import { Columns, DASH_CSS, DataTable, Legend, Meter, Rows, shortNum, type Series } from "./Charts";

// Dashboard (the plain address, Admin only; everyone else is sent to their landing page by the route guard). One call (/api/dashboard) brings everything;
// the site picker filters on the page. Order: the day's headline numbers, what needs attention, today at each site, then attendance, money, people,
// and the dates and checks that keep the company compliant. Every block links to the page where the work is done.
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const monthWord = (ym: string, long = false) => new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: long ? "long" : "short" });
const addMonths = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const STAGES: [string, string][] = [["resume", "Resume"], ["call", "Call"], ["interview", "Interview"], ["offer", "Offer"], ["appointment", "Appointment"], ["forms", "Forms"]];
const ATT: Series[] = [{ key: "present", label: "Present", color: "var(--s1)" }, { key: "half", label: "Half day", color: "var(--s2)" }, { key: "absent", label: "Absent", color: "var(--mute)" }];
const DUE: Series[] = [{ key: "overdue", label: "Overdue", color: "var(--s2)" }, { key: "rest", label: "Due, not late", color: "var(--s1)" }];
const ONE: Series[] = [{ key: "v", label: "Amount", color: "var(--s1)" }];
const LEVEL: Record<DashAlert["level"], { dot: string; word: string }> = { bad: { dot: "bg-rose-600", word: "Urgent" }, warn: { dot: "bg-amber-500", word: "Soon" }, info: { dot: "bg-sky-500", word: "Note" } };

function Card({ title, href, link, children, className = "" }: { title: string; href?: string; link?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card !p-4 space-y-3 min-w-0 ${className}`}>
      <div className="flex items-baseline gap-2"><h2 className="font-semibold flex-1">{title}</h2>{href && <Link href={href} className="text-xs text-blue-700 hover:underline shrink-0">{link ?? "Open"} →</Link>}</div>
      {children}
    </section>);
}
function Tile({ label, value, sub, href, bad }: { label: string; value: string; sub: string; href: string; bad?: boolean }) {
  return (
    <Link href={href} className="card !p-3 min-w-0 hover:bg-slate-50 block">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums leading-tight ${bad ? "text-rose-700" : ""}`}>{value}</div>
      <div className="text-xs text-slate-500 truncate">{sub}</div>
    </Link>);
}

export default function DashboardView({ d, busy, onRefresh }: { d: Dash; busy: boolean; onRefresh: () => void }) {
  const [site, setSite] = useState("");

  const v = useMemo(() => {
    if (!d) return null;
    const inSite = (p?: string | null) => !site || p === site; const month = d.today.slice(0, 7), prev = addMonths(month, -1);
    const sites = d.sites.filter((s) => inSite(s.id));
    const people = sites.reduce((s, x) => s + x.people, 0), worked = sites.reduce((s, x) => s + x.worked, 0), unmarked = sites.reduce((s, x) => s + x.unmarked, 0);
    // attendance, last 30 days: one column a day
    const days = Array.from({ length: 30 }, (_, i) => addDays(d.today, i - 29));
    const att = days.map((day) => { const rows = d.att.filter((a) => a.d === day && inSite(a.p)); const s = (k: "present" | "half" | "absent") => rows.reduce((t, r) => t + r[k], 0);
      return { label: dmy(day), tip: new Date(day + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }), v: { present: s("present"), half: s("half"), absent: s("absent") } }; });
    const attTot = att.reduce((t, a) => ({ p: t.p + a.v.present + a.v.half * 0.5, all: t.all + a.v.present + a.v.half + a.v.absent }), { p: 0, all: 0 });
    // money
    const dues = d.dues.filter((x) => inSite(x.p)); const overdue = dues.reduce((s, x) => s + x.overdue, 0), pending = dues.reduce((s, x) => s + x.pending, 0);
    const byCat = new Map<string, { label: string; overdue: number; rest: number }>();
    dues.forEach((x) => { const c = byCat.get(x.cat) ?? { label: x.label, overdue: 0, rest: 0 }; c.overdue += x.overdue; c.rest += Math.max(0, x.pending - x.overdue); byCat.set(x.cat, c); });
    const payees = d.payees.filter((x) => inSite(x.p)).slice(0, 5);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
    const spend = d.spend.filter((x) => inSite(x.p)); const spentIn = (m: string) => spend.filter((x) => x.m === m).reduce((s, x) => s + x.amt, 0);
    const spendCols = months.map((m) => ({ label: monthWord(m), tip: `${monthWord(m, true)} ${m.slice(0, 4)}`, v: { v: spentIn(m) } }));
    const cat = new Map<string, number>(); spend.filter((x) => x.m === month).forEach((x) => cat.set(x.c, (cat.get(x.c) ?? 0) + x.amt));
    const catRows = [...cat.entries()].sort((a, b) => b[1] - a[1]).map(([id, amt]) => ({ label: d.cats.find((c) => c.id === id)?.name ?? "Other", v: { v: amt } }));
    const spent = spentIn(month), spentPrev = spentIn(prev);
    // people
    const emps = d.emps.filter((e) => inSite(e.p) || (!site && true));
    const active = emps.filter((e) => e.stage === "onboarded" && (!e.left || e.left > d.today));
    const joined = active.filter((e) => e.join?.startsWith(month)).length, left = emps.filter((e) => e.stage === "onboarded" && e.left?.startsWith(month) && e.left <= d.today).length;
    const headRows = [...d.projects.map((p) => ({ label: p.name, n: active.filter((e) => e.p === p.id && !e.ho).length })), { label: "Head office", n: active.filter((e) => e.ho).length }, { label: "No site yet", n: active.filter((e) => !e.p && !e.ho).length }]
      .filter((r) => r.n > 0).map((r) => ({ label: r.label, v: { v: r.n } }));
    const pipeline = STAGES.map(([k, label]) => ({ label, v: { v: d.emps.filter((e) => e.stage === k).length } }));
    const miss = new Map<string, number>(); d.docsMissing.filter((x) => inSite(x.p)).forEach((x) => miss.set(x.label, (miss.get(x.label) ?? 0) + 1));
    const alerts = d.alerts.filter((a) => a.p === undefined || a.p === null || inSite(a.p));
    // the month's usual filing dates, the next one first
    const dayNo = Number(d.today.slice(8, 10)), lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const deadlines = ([["GSTR-1 (sales return)", 11], ["PF and ESI deposit", 15], ["GSTR-3B (GST payment)", 20], ["Professional tax", lastDay]] as [string, number][])
      .map(([what, on]) => { const next = on >= dayNo; const m = next ? month : addMonths(month, 1); const date = `${m}-${String(next || what !== "Professional tax" ? on : new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
        return { what, date, days: Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(d.today + "T00:00:00Z")) / 86400000) }; }).sort((a, b) => a.days - b.days);
    const payroll = d.projects.filter((p) => inSite(p.id)).map((p) => ({ name: p.name, status: d.payroll.find((r) => r.p === p.id && r.month === prev)?.status ?? "none" }));
    return { month, prev, sites, people, worked, unmarked, att, attPct: attTot.all ? Math.round((attTot.p / attTot.all) * 100) : null, overdue, pending, overduePayees: d.payees.filter((x) => inSite(x.p) && x.overdue > 0.5).length,
      dueRows: [...byCat.values()].sort((a, b) => b.overdue + b.rest - (a.overdue + a.rest)).map((c) => ({ label: c.label, v: { overdue: c.overdue, rest: c.rest } })), payees, spendCols, catRows, spent, spentPrev,
      active: active.length, joined, left, headRows, pipeline, inPipeline: pipeline.reduce((s, r) => s + r.v.v, 0), miss: [...miss.entries()], alerts, deadlines, payroll };
  }, [d, site]);

  if (!v) return null;
  const change = v.spentPrev > 0 ? Math.round(((v.spent - v.spentPrev) / v.spentPrev) * 100) : null;
  const dateWord = new Date(d.today + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="dash space-y-4">
      <style>{DASH_CSS}</style>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]"><h1 className="text-xl font-semibold">Dashboard</h1><p className="text-sm text-slate-500">{dateWord}</p></div>
        <select className="inp !w-52" aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)}><option value="">All sites</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button type="button" className="btn" onClick={onRefresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
      </div>
      {d.warnings.length > 0 && <p className="warn">Some numbers could not be read and are left out: {d.warnings.join("; ")}</p>}

      {/* ---------- the day's headline numbers ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="On site today" value={`${v.worked} / ${v.people}`} sub={!v.people ? "no one is posted" : v.unmarked ? `${v.unmarked} not marked yet` : "everyone is marked"} href="/attendance" />
        <Tile label="Overdue" value={inr(v.overdue)} sub={v.overdue > 0.5 ? `to ${v.overduePayees} payee${v.overduePayees === 1 ? "" : "s"}` : "nothing is late"} href="/expenses?tab=due" bad={v.overdue > 0.5} />
        <Tile label="Owed now" value={inr(v.pending)} sub="billed and unpaid, overdue included" href="/expenses?tab=due" />
        <Tile label={`Spent in ${monthWord(v.month, true)}`} value={inr(v.spent)} sub={change === null ? `${monthWord(v.prev, true)}: ${inr(v.spentPrev)}` : `${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on ${monthWord(v.prev, true)}`} href="/expenses?tab=spent" />
        <Tile label="On the rolls" value={String(v.active)} sub={`${v.joined} joined, ${v.left} left this month`} href="/employees" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ---------- what needs attention ---------- */}
        <Card title={`Needs attention${v.alerts.length ? ` (${v.alerts.length})` : ""}`} className="lg:row-span-2">
          {!v.alerts.length ? <p className="text-sm text-slate-500">Nothing needs you right now.</p> :
            <ul className="-mx-1">{v.alerts.map((a, i) => <li key={i}><Link href={a.href} className="flex items-start gap-2.5 rounded-lg px-1 py-2 text-sm hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
              <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${LEVEL[a.level].dot}`} aria-hidden /><span className="flex-1 min-w-0"><span className="sr-only">{LEVEL[a.level].word}: </span>{a.text}</span><span className="text-slate-400" aria-hidden>→</span></Link></li>)}</ul>}
          <div className="flex gap-3 text-[11px] text-slate-500 pt-1">{(["bad", "warn", "info"] as const).map((l) => <span key={l} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${LEVEL[l].dot}`} />{LEVEL[l].word}</span>)}</div>
        </Card>

        {/* ---------- today at each site ---------- */}
        <Card title="Today at the sites" href="/attendance" link="Attendance" className="lg:col-span-2">
          {!v.sites.length ? <p className="text-sm text-slate-500">No active site.</p> :
            <div className="grid gap-3 sm:grid-cols-2">{v.sites.map((s) => { const state = s.verifiedAt ? ["Checked", "bg-emerald-50 text-emerald-800"] : s.submittedAt ? ["Submitted, to check", "bg-sky-50 text-sky-800"] : !s.people ? ["No one posted", "bg-slate-100 text-slate-600"] : s.unmarked === s.people ? ["Not started", "bg-rose-50 text-rose-700"] : s.unmarked ? ["In progress", "bg-amber-50 text-amber-800"] : ["Marked, not submitted", "bg-amber-50 text-amber-800"];
              return (
                <div key={s.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center gap-2"><span className="font-medium flex-1 truncate">{s.name}</span><span className={`rounded-full px-2 text-[11px] ${state[1]}`}>{state[0]}</span></div>
                  <div><div className="flex justify-between text-xs text-slate-500 mb-1"><span>Attendance marked</span><span className="tabular-nums">{s.marked} of {s.people}</span></div><Meter value={s.marked} of={s.people} /></div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div><div className="font-semibold text-sm tabular-nums">{s.worked}</div><div className="text-slate-500">at work</div></div>
                    <div><div className="font-semibold text-sm tabular-nums">{s.meals.breakfast + s.meals.lunch + s.meals.dinner}</div><div className="text-slate-500">meals</div></div>
                    <div><div className="font-semibold text-sm tabular-nums">{s.legsRecorded}/{s.legsExpected}</div><div className="text-slate-500">trips logged</div></div>
                  </div>
                  {!s.hasSupervisor && s.people > 0 && <div className="text-xs text-rose-700">No supervisor assigned</div>}
                </div>); })}</div>}
        </Card>

        {/* ---------- attendance, 30 days ---------- */}
        <Card title="Attendance, last 30 days" href="/attendance" link="Attendance" className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><Legend series={ATT} /><span className="flex-1" />{v.attPct !== null && <span className="text-xs text-slate-500">Average attendance <b className="text-slate-800 tabular-nums">{v.attPct}%</b> (a half day counts as half)</span>}</div>
          <Columns data={v.att} series={ATT} fmt={(n) => String(Math.round(n))} />
          <DataTable head={["Day", "Present", "Half day", "Absent"]} rows={v.att.filter((a) => a.v.present + a.v.half + a.v.absent > 0).map((a) => [a.tip, a.v.present, a.v.half, a.v.absent])} />
        </Card>
      </div>

      {/* ---------- money ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Spending, last 6 months" href="/expenses?tab=spent" link="Expenses">
          <Columns data={v.spendCols} series={ONE} fmt={inr} tickFmt={(n) => "₹" + shortNum(n)} tickEvery={1} height={170} />
          <DataTable head={["Month", "Spent"]} rows={v.spendCols.map((c) => [c.tip, inr(c.v.v)])} />
        </Card>
        <Card title={`Where ${monthWord(v.month, true)}'s money went`} href="/expenses?tab=spent" link="Expenses">
          <Rows rows={v.catRows} series={ONE} fmt={inr} empty="Nothing spent yet this month." />
        </Card>
        <Card title="Owed now, by kind" href="/expenses?tab=due" link="Payments due">
          <Legend series={DUE} />
          <Rows rows={v.dueRows} series={DUE} fmt={inr} empty="Nothing is owed right now." />
          {v.payees.length > 0 && <div className="pt-1"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Largest to pay</div>
            <ul className="text-sm">{v.payees.map((p, i) => <li key={i} className="flex items-baseline gap-2 py-1 border-t border-slate-100 first:border-t-0"><span className="flex-1 truncate">{p.name} <span className="text-xs text-slate-400">{p.label}</span></span>{p.overdue > 0.5 && <span className="rounded-full bg-rose-50 text-rose-700 px-1.5 text-[11px]">overdue</span>}<span className="tabular-nums font-medium">{inr(p.pending)}</span></li>)}</ul></div>}
        </Card>
      </div>

      {/* ---------- people ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="People on the rolls, by site" href="/employees" link="Employees">
          <Rows rows={v.headRows} series={ONE} fmt={(n) => String(n)} empty="No one is on the rolls yet." />
        </Card>
        <Card title={`Hiring pipeline${v.inPipeline ? ` (${v.inPipeline})` : ""}`} href="/employees" link="Employees">
          <Rows rows={v.pipeline} series={ONE} fmt={(n) => String(n)} empty="No candidates in the pipeline." />
          <p className="text-[11px] text-slate-400">Candidates at each step, before they are on the rolls. Not filtered by site.</p>
        </Card>
        <Card title="Missing documents" href="/employees" link="Employees">
          {!v.miss.length ? <p className="text-sm text-slate-500">Everyone on the rolls has an Aadhaar, PAN and bank document.</p> :
            <ul className="text-sm">{v.miss.map(([label, n]) => <li key={label} className="flex items-baseline gap-2 py-1.5 border-t border-slate-100 first:border-t-0"><span className="flex-1">{label}</span><span className="tabular-nums font-medium">{n} {n === 1 ? "person" : "people"}</span></li>)}</ul>}
          <p className="text-[11px] text-slate-400">People on the rolls without the document uploaded or marked received.</p>
        </Card>
      </div>

      {/* ---------- compliance and the app ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Dates coming up">
          <ul className="text-sm">{v.deadlines.map((x) => <li key={x.what} className="flex items-baseline gap-2 py-1.5 border-t border-slate-100 first:border-t-0"><span className="flex-1">{x.what}</span><span className="text-xs text-slate-500">{dmy(x.date)}</span><span className={`tabular-nums text-xs rounded-full px-2 ${x.days <= 3 ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{x.days === 0 ? "today" : `in ${x.days} day${x.days === 1 ? "" : "s"}`}</span></li>)}
            {d.docs.map((x) => <li key={x.title} className="flex items-baseline gap-2 py-1.5 border-t border-slate-100"><Link href="/company" className="flex-1 hover:underline">{x.title}</Link><span className="text-xs text-slate-500">{dmy(x.validUntil)}</span><span className={`tabular-nums text-xs rounded-full px-2 ${x.days <= 7 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>{x.days < 0 ? "expired" : x.days === 0 ? "today" : `in ${x.days} days`}</span></li>)}</ul>
          <p className="text-[11px] text-slate-400">The usual monthly filing dates; confirm on the portals. Company documents appear here 45 days before they expire.</p>
        </Card>
        <Card title={`Payroll for ${monthWord(v.prev, true)}`} href="/payroll" link="Payroll">
          <ul className="text-sm">{v.payroll.map((p) => <li key={p.name} className="flex items-center gap-2 py-1.5 border-t border-slate-100 first:border-t-0"><span className="flex-1 truncate">{p.name}</span><span className={`rounded-full px-2 text-[11px] ${p.status === "approved" ? "bg-emerald-50 text-emerald-800" : p.status === "draft" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{p.status === "approved" ? "Approved" : p.status === "draft" ? "Draft, not approved" : "Not started"}</span></li>)}</ul>
          <div className="pt-1 border-t border-slate-100"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">JSL portal</div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">{([["To review", d.jsl.toReview], ["Authorized", d.jsl.authorized], ["Failed", d.jsl.failed], ["To check", d.jsl.needsCheck]] as [string, number][]).map(([l, n]) => <Link key={l} href="/inventory" className="rounded-lg hover:bg-slate-50 py-1"><div className={`font-semibold text-sm tabular-nums ${n && (l === "Failed" || l === "To check") ? "text-rose-700" : ""}`}>{n}</div><div className="text-slate-500">{l}</div></Link>)}</div></div>
        </Card>
        <Card title="The app" href="/users" link="Users">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div><div className="font-semibold text-lg tabular-nums">{d.app.activeToday}<span className="text-slate-400 text-sm"> / {d.app.users}</span></div><div className="text-slate-500">people used it today</div></div>
            <div><div className={`font-semibold text-lg tabular-nums ${d.app.siteUsersNoDevice ? "text-rose-700" : ""}`}>{d.app.siteUsersNoDevice}</div><div className="text-slate-500">site logins with no phone for reminders</div></div>
            <Link href="/expenses?tab=bills" className="rounded-lg hover:bg-slate-50"><div className={`font-semibold text-lg tabular-nums ${d.billsNoFile ? "text-amber-700" : ""}`}>{d.billsNoFile}</div><div className="text-slate-500">payments without a bill (90 days)</div></Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
