"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { itemFor } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/roles";

// Admin only: when each person actually had the app open (2026-11-usage-activity.sql). A session is a stretch of the app being open and on screen; a gap of
// over 5 minutes starts a new one. One month is kept.
type Person = { user_id: string; email: string; full_name: string; role: string | null };
type Sess = { id: string; user_id: string; device: string; ip: string; started_at: string; last_seen_at: string; active_seconds: number; pages: Record<string, number>; last_path: string;
  start_lat: number | null; start_lng: number | null; start_acc: number | null; last_lat: number | null; last_lng: number | null; last_acc: number | null; geo_status: string };
type Ev = { id: string; user_id: string; kind: string; at: string; by_user: string | null; device: string; ip: string; detail: string };
const EV: Record<string, string> = { sign_in: "Signed in", sign_out: "Signed out", signed_out_by_admin: "Signed out by an Admin", login_disabled: "Login disabled", login_enabled: "Login enabled" };
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const dur = (s: number) => { const m = Math.round(s / 60); return m < 1 ? "<1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`; };
const istMin = (iso: string) => { const [h, m] = time(iso).split(":").map(Number); return h * 60 + m; };
const istDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toLocaleDateString("sv-SE"); };
const pageName = (p: string) => itemFor(p.replace(/:id|:n/g, "x"))?.label ?? (p || "?");
const mapLink = (lat: number | null, lng: number | null, acc: number | null) => lat != null && lng != null ? <a className="text-blue-700 underline" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">{lat.toFixed(4)}, {lng.toFixed(4)}{acc ? ` (±${Math.round(acc)} m)` : ""}</a> : null;

export default function ActivityTab({ people }: { people: Person[] }) {
  const [view, setView] = useState<"day" | "7" | "30">("day"); const [date, setDate] = useState(istToday()); const [sess, setSess] = useState<Sess[] | null>(null); const [evs, setEvs] = useState<Ev[]>([]);
  const [online, setOnline] = useState<Sess[]>([]); const [open, setOpen] = useState<string | null>(null); const [missing, setMissing] = useState(false);
  const from = view === "day" ? date : addDays(istToday(), -(Number(view) - 1)), to = view === "day" ? date : istToday();
  const load = useCallback(async () => {
    const sb = supabase(); const a = `${from}T00:00:00+05:30`, b = `${addDays(to, 1)}T00:00:00+05:30`;
    const [s, e, o] = await Promise.all([
      sb.from("usage_sessions").select("*").gte("last_seen_at", a).lt("started_at", b).order("started_at"),
      sb.from("usage_events").select("*").gte("at", a).lt("at", b).order("at"),
      sb.from("usage_sessions").select("*").gte("last_seen_at", new Date(Date.now() - 2 * 60_000).toISOString()).order("last_seen_at", { ascending: false }),
    ]);
    if (s.error) { setMissing(true); setSess([]); return; }
    setMissing(false); setSess((s.data || []) as Sess[]); setEvs((e.data || []) as Ev[]); setOnline((o.data || []) as Sess[]);
  }, [from, to]);
  useEffect(() => { setSess(null); load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const nameOf = (id: string | null) => { const p = people.find((x) => x.user_id === id); return p ? p.full_name || p.email : "someone"; };
  const byUser = useMemo(() => { const m = new Map<string, Sess[]>(); (sess || []).forEach((x) => m.set(x.user_id, [...(m.get(x.user_id) ?? []), x])); return m; }, [sess]);
  const days = useMemo(() => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }, [from, to]);
  if (missing) return <p className="warn !text-sm">Activity is not switched on yet: run 2026-11-usage-activity.sql in the Supabase SQL editor.</p>;

  const rows = people.map((p) => { const s = byUser.get(p.user_id) ?? []; return { p, s, total: s.reduce((t, x) => t + x.active_seconds, 0), first: s[0]?.started_at, last: s.reduce<string | undefined>((m, x) => (!m || x.last_seen_at > m ? x.last_seen_at : m), undefined) }; })
    .sort((a, b) => b.total - a.total || (a.p.full_name || a.p.email).localeCompare(b.p.full_name || b.p.email));
  const onlineUsers = [...new Map(online.map((x) => [x.user_id, x])).values()];

  return (
    <div className="space-y-4" data-activity>
      <div className="card space-y-2">
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /><h3 className="font-semibold">Online now</h3><span className="text-xs text-slate-500">app open and on screen in the last 2 minutes · refreshes every minute</span></div>
        {onlineUsers.length ? <ul className="text-sm grid gap-x-6 sm:grid-cols-2">{onlineUsers.map((x) => <li key={x.user_id}><b className="font-medium">{nameOf(x.user_id)}</b> <span className="text-slate-500">on {pageName(x.last_path)} · {x.device} · since {time(x.started_at)}</span></li>)}</ul> : <p className="text-sm text-slate-500">Nobody has the app open right now.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["day", "7", "30"] as const).map((v) => <button key={v} type="button" className={`chip ${view === v ? "chip-on" : ""}`} aria-pressed={view === v} onClick={() => setView(v)}>{v === "day" ? "One day" : `Last ${v} days`}</button>)}
        {view === "day" && <><button type="button" className="btn btn-sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button><input type="date" className="inp !w-auto" max={istToday()} min={addDays(istToday(), -31)} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /><button type="button" className="btn btn-sm" disabled={date >= istToday()} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button></>}
        <span className="text-xs text-slate-500 sm:ml-auto">One month of history is kept.</span>
      </div>

      {!sess ? <div className="card"><div className="skeleton h-24 w-full" /></div> : view === "day" ? (
        <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 bg-slate-50"><tr><th className="px-4 py-2 font-medium">Person</th><th className="px-3 py-2 font-medium min-w-72">When the app was open <span className="font-normal text-slate-400">(00–24 h)</span></th><th className="px-3 py-2 font-medium">First</th><th className="px-3 py-2 font-medium">Last</th><th className="px-3 py-2 font-medium text-right">Active</th><th className="px-3 py-2 font-medium text-right">Sessions</th></tr></thead>
          <tbody>{rows.map(({ p, s, total, first, last }) => <Fragment key={p.user_id}>
            <tr className={`border-t border-slate-100 ${s.length ? "cursor-pointer hover:bg-slate-50" : "text-slate-400"}`} onClick={() => s.length && setOpen(open === p.user_id ? null : p.user_id)}>
              <td className="px-4 py-2"><div className="font-medium">{p.full_name || p.email}</div><div className="text-xs text-slate-400">{ROLE_LABEL[p.role ?? "none"] ?? p.role}</div></td>
              <td className="px-3 py-2"><div className="relative h-4 rounded bg-slate-100" aria-label={`${s.length} sessions`}>
                {[6, 12, 18].map((h) => <span key={h} className="absolute top-0 h-full border-l border-slate-200" style={{ left: `${(h / 24) * 100}%` }} />)}
                {s.map((x) => { const a = istDay(x.started_at) < date ? 0 : istMin(x.started_at), b = istDay(x.last_seen_at) > date ? 1440 : istMin(x.last_seen_at) + 1; return <span key={x.id} title={`${time(x.started_at)}–${time(x.last_seen_at)} · ${dur(x.active_seconds)}`} className="absolute top-0 h-full rounded bg-blue-600" style={{ left: `${(a / 1440) * 100}%`, width: `${Math.max(0.4, ((b - a) / 1440) * 100)}%` }} />; })}
              </div></td>
              <td className="px-3 py-2 tabular-nums">{first ? time(first) : "—"}</td><td className="px-3 py-2 tabular-nums">{last ? time(last) : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{s.length ? dur(total) : "—"}</td><td className="px-3 py-2 text-right tabular-nums">{s.length || ""}</td>
            </tr>
            {open === p.user_id && <tr><td colSpan={6} className="px-4 pb-3"><Detail s={s} evs={evs.filter((e) => e.user_id === p.user_id)} nameOf={nameOf} /></td></tr>}
          </Fragment>)}</tbody>
        </table></div>
      ) : (
        <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 bg-slate-50"><tr><th className="px-4 py-2 font-medium sticky left-0 bg-slate-50">Person</th>{days.map((d) => <th key={d} className="px-1 py-2 font-medium text-center whitespace-nowrap">{new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</th>)}<th className="px-3 py-2 font-medium text-right">Total</th></tr></thead>
          <tbody>{rows.map(({ p, s, total }) => <tr key={p.user_id} className="border-t border-slate-100">
            <td className="px-4 py-1.5 sticky left-0 bg-white whitespace-nowrap">{p.full_name || p.email}</td>
            {days.map((d) => { const t = s.filter((x) => istDay(x.started_at) === d).reduce((a, x) => a + x.active_seconds, 0); const m = Math.round(t / 60);
              return <td key={d} className="px-1 py-1.5 text-center"><span title={t ? dur(t) : "not opened"} className={`inline-block min-w-8 rounded px-1 text-xs tabular-nums ${!m ? "text-slate-300" : m < 15 ? "bg-blue-50 text-blue-800" : m < 60 ? "bg-blue-200 text-blue-900" : "bg-blue-600 text-white"}`}>{m ? (m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h`) : "·"}</span></td>; })}
            <td className="px-3 py-1.5 text-right tabular-nums">{total ? dur(total) : "—"}</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Detail({ s, evs, nameOf }: { s: Sess[]; evs: Ev[]; nameOf: (id: string | null) => string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3 text-xs">
      <ul className="space-y-2">{s.map((x) => <li key={x.id} className="space-y-0.5">
        <div className="text-sm"><b className="font-medium tabular-nums">{time(x.started_at)}–{time(x.last_seen_at)}</b> <span className="text-slate-500">· {dur(x.active_seconds)} active · {x.device}{x.ip ? ` · ${x.ip}` : ""}</span></div>
        <div className="text-slate-600">{Object.entries(x.pages || {}).sort((a, b) => b[1] - a[1]).map(([pg, sec]) => `${pageName(pg)} ${dur(sec)}`).join(" · ") || `${pageName(x.last_path)}`}</div>
        <div className="text-slate-500">Location: {x.start_lat != null ? <>at start {mapLink(x.start_lat, x.start_lng, x.start_acc)}{x.last_lat != null && (x.last_lat !== x.start_lat || x.last_lng !== x.start_lng) && <>, latest {mapLink(x.last_lat, x.last_lng, x.last_acc)}</>}</> : x.geo_status === "denied" ? "the phone refused location" : "not available (location not allowed yet, or no signal)"}</div>
      </li>)}</ul>
      {evs.length > 0 && <div><div className="font-semibold text-slate-600 mb-0.5">Sign-ins and sign-outs</div><ul className="space-y-0.5">{evs.map((e) => <li key={e.id}>{time(e.at)} · {EV[e.kind] ?? e.kind}{e.by_user ? ` by ${nameOf(e.by_user)}` : ""}{e.device ? ` · ${e.device}` : ""}{e.ip ? ` · ${e.ip}` : ""}{e.detail ? ` · ${e.detail}` : ""}</li>)}</ul></div>}
    </div>
  );
}
