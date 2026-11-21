"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { itemFor } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/roles";

// Admin only: when each person actually had the app open (2026-11-usage-activity.sql). A session is a stretch of the app being open and on screen; a gap of
// over 5 minutes starts a new one. One month is kept. Below the staff: the transport vendors' page (2026-11-vendor-activity.sql), one row per vehicle.
type Person = { user_id: string; email: string; full_name: string; role: string | null };
type Sess = { id: string; user_id: string; device: string; ip: string; started_at: string; last_seen_at: string; active_seconds: number; pages: Record<string, number>; last_path: string;
  start_lat: number | null; start_lng: number | null; start_acc: number | null; last_lat: number | null; last_lng: number | null; last_acc: number | null; geo_status: string };
type Ev = { id: string; user_id: string; kind: string; at: string; by_user: string | null; device: string; ip: string; detail: string };
type Board = { id: string; name: string; sub: string };
const VPAGE: Record<string, string> = { account: "Their account", "add-trip": "Adding a trip", "set-pin": "Choosing a PIN", "change-pin": "Changing their PIN" };
const vPageName = (p: string) => VPAGE[p] ?? (p || "?");
const EV: Record<string, string> = { wrong_pin: "Wrong PIN", locked_out: "Locked out (too many wrong PINs)", pin_set: "Set their PIN", sign_in: "Signed in", sign_out: "Signed out", signed_out_by_admin: "Signed out by an Admin", login_disabled: "Login disabled", login_enabled: "Login enabled" };
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
  const [online, setOnline] = useState<Sess[]>([]); const [missing, setMissing] = useState(false);
  const [vehicles, setVehicles] = useState<Board[]>([]); const [vSess, setVSess] = useState<Sess[] | null>(null); const [vEvs, setVEvs] = useState<Ev[]>([]); const [vOnline, setVOnline] = useState<Sess[]>([]); const [vMissing, setVMissing] = useState(false);
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
    // vendors: the same shape, with the vehicle in place of the person
    const asUser = <T extends { vehicle_id: string }>(r: T) => ({ ...r, user_id: r.vehicle_id, by_user: null });
    const [vs, ve, vo, vh, vl] = await Promise.all([
      sb.from("vendor_usage_sessions").select("*").gte("last_seen_at", a).lt("started_at", b).order("started_at"),
      sb.from("vendor_usage_events").select("*").gte("at", a).lt("at", b).order("at"),
      sb.from("vendor_usage_sessions").select("*").gte("last_seen_at", new Date(Date.now() - 2 * 60_000).toISOString()).order("last_seen_at", { ascending: false }),
      sb.from("transport_vehicles").select("id, name, operator"),
      sb.rpc("vendor_links_list"),
    ]);
    if (vs.error) { setVMissing(true); setVSess([]); return; }
    setVMissing(false);
    const vSessions = (vs.data || []).map(asUser) as unknown as Sess[]; const vEvents = (ve.data || []).map(asUser) as unknown as Ev[];
    type VRow = { id: string; name: string; operator: string | null };
    const seen = new Set([...vSessions.map((x) => x.user_id), ...vEvents.map((x) => x.user_id), ...((vl.data || []) as { vehicle_id: string }[]).map((l) => l.vehicle_id)]);   // a live link, or any activity in the period
    setVehicles(((vh.data || []) as VRow[]).filter((v) => seen.has(v.id)).map((v) => ({ id: v.id, name: v.name, sub: v.operator || "Vendor" })));
    setVSess(vSessions); setVEvs(vEvents); setVOnline((vo.data || []).map(asUser) as unknown as Sess[]);
  }, [from, to]);
  useEffect(() => { setSess(null); load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const nameOf = (id: string | null) => { const p = people.find((x) => x.user_id === id); return p ? p.full_name || p.email : "someone"; };
  const vNameOf = (id: string | null) => vehicles.find((x) => x.id === id)?.name ?? "a vehicle";
  const staff = useMemo<Board[]>(() => people.map((p) => ({ id: p.user_id, name: p.full_name || p.email, sub: ROLE_LABEL[p.role ?? "none"] ?? p.role ?? "" })), [people]);
  const days = useMemo(() => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }, [from, to]);
  if (missing) return <p className="warn !text-sm">Activity is not switched on yet: run 2026-11-usage-activity.sql in the Supabase SQL editor.</p>;

  const onlineUsers = [...new Map(online.map((x) => [x.user_id, x])).values()]; const onlineVendors = [...new Map(vOnline.map((x) => [x.user_id, x])).values()];

  return (
    <div className="space-y-4" data-activity>
      <div className="card space-y-2">
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden /><h3 className="font-semibold">Online now</h3><span className="text-xs text-slate-500">app open and on screen in the last 2 minutes · refreshes every minute</span></div>
        {onlineUsers.length || onlineVendors.length ? <ul className="text-sm grid gap-x-6 sm:grid-cols-2">{onlineUsers.map((x) => <li key={x.user_id}><b className="font-medium">{nameOf(x.user_id)}</b> <span className="text-slate-500">on {pageName(x.last_path)} · {x.device} · since {time(x.started_at)}</span></li>)}
          {onlineVendors.map((x) => <li key={x.user_id}><b className="font-medium">{vNameOf(x.user_id)}</b> <span className="text-slate-500">vendor page · {vPageName(x.last_path)} · {x.device} · since {time(x.started_at)}</span></li>)}</ul> : <p className="text-sm text-slate-500">Nobody has the app open right now.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["day", "7", "30"] as const).map((v) => <button key={v} type="button" className={`chip ${view === v ? "chip-on" : ""}`} aria-pressed={view === v} onClick={() => setView(v)}>{v === "day" ? "One day" : `Last ${v} days`}</button>)}
        {view === "day" && <><button type="button" className="btn btn-sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button><input type="date" className="inp !w-auto" max={istToday()} min={addDays(istToday(), -31)} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /><button type="button" className="btn btn-sm" disabled={date >= istToday()} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button></>}
        <span className="text-xs text-slate-500 sm:ml-auto">One month of history is kept.</span>
      </div>

      <Table who="Person" rows={staff} sess={sess} evs={evs} view={view} date={date} days={days} nameOf={nameOf} page={pageName} />

      <div className="space-y-2 pt-2">
        <div><h3 className="font-semibold">Vendors</h3><p className="text-xs text-slate-500">The transport vendors&apos; page: when it was open, for how long, and where (only if the vendor allowed location). Wrong PINs and lock-outs are listed in each vehicle&apos;s detail.</p></div>
        {vMissing ? <p className="warn !text-sm">Vendor activity is not switched on yet: run 2026-11-vendor-activity.sql in the Supabase SQL editor.</p>
          : vSess && !vehicles.length ? <p className="text-sm text-slate-500">No vehicle has a vendor link yet.</p>
          : <Table who="Vehicle" rows={vehicles} sess={vSess} evs={vEvs} view={view} date={date} days={days} nameOf={vNameOf} page={vPageName} />}
      </div>
    </div>
  );
}

function Detail({ s, evs, nameOf, page }: { s: Sess[]; evs: Ev[]; nameOf: (id: string | null) => string; page: (p: string) => string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3 text-xs">
      <ul className="space-y-2">{s.map((x) => <li key={x.id} className="space-y-0.5">
        <div className="text-sm"><b className="font-medium tabular-nums">{time(x.started_at)}–{time(x.last_seen_at)}</b> <span className="text-slate-500">· {dur(x.active_seconds)} active · {x.device}{x.ip ? ` · ${x.ip}` : ""}</span></div>
        <div className="text-slate-600">{Object.entries(x.pages || {}).sort((a, b) => b[1] - a[1]).map(([pg, sec]) => `${page(pg)} ${dur(sec)}`).join(" · ") || `${page(x.last_path)}`}</div>
        <div className="text-slate-500">Location: {x.start_lat != null ? <>at start {mapLink(x.start_lat, x.start_lng, x.start_acc)}{x.last_lat != null && (x.last_lat !== x.start_lat || x.last_lng !== x.start_lng) && <>, latest {mapLink(x.last_lat, x.last_lng, x.last_acc)}</>}</> : x.geo_status === "denied" ? "the phone refused location" : "not available (location not allowed yet, or no signal)"}</div>
      </li>)}</ul>
      {evs.length > 0 && <div><div className="font-semibold text-slate-600 mb-0.5">Sign-ins and sign-outs</div><ul className="space-y-0.5">{evs.map((e) => <li key={e.id}>{time(e.at)} · {EV[e.kind] ?? e.kind}{e.by_user ? ` by ${nameOf(e.by_user)}` : ""}{e.device ? ` · ${e.device}` : ""}{e.ip ? ` · ${e.ip}` : ""}{e.detail ? ` · ${e.detail}` : ""}</li>)}</ul></div>}
    </div>
  );
}

function Table({ who, rows: board, sess, evs, view, date, days, nameOf, page }: { who: string; rows: Board[]; sess: Sess[] | null; evs: Ev[]; view: "day" | "7" | "30"; date: string; days: string[]; nameOf: (id: string | null) => string; page: (p: string) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  const byUser = useMemo(() => { const m = new Map<string, Sess[]>(); (sess || []).forEach((x) => m.set(x.user_id, [...(m.get(x.user_id) ?? []), x])); return m; }, [sess]);
  if (!sess) return <div className="card"><div className="skeleton h-24 w-full" /></div>;
  const rows = board.map((p) => { const s = byUser.get(p.id) ?? []; return { p, s, total: s.reduce((t, x) => t + x.active_seconds, 0), first: s[0]?.started_at, last: s.reduce<string | undefined>((m, x) => (!m || x.last_seen_at > m ? x.last_seen_at : m), undefined) }; })
    .sort((a, b) => b.total - a.total || a.p.name.localeCompare(b.p.name));
  return view === "day" ? (
    <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500 bg-slate-50"><tr><th className="px-4 py-2 font-medium">{who}</th><th className="px-3 py-2 font-medium min-w-72">When {who === "Person" ? "the app" : "the page"} was open <span className="font-normal text-slate-400">(00–24 h)</span></th><th className="px-3 py-2 font-medium">First</th><th className="px-3 py-2 font-medium">Last</th><th className="px-3 py-2 font-medium text-right">Active</th><th className="px-3 py-2 font-medium text-right">Sessions</th></tr></thead>
      <tbody>{rows.map(({ p, s, total, first, last }) => { const ev = evs.filter((e) => e.user_id === p.id); const can = s.length > 0 || ev.length > 0; return <Fragment key={p.id}>
        <tr className={`border-t border-slate-100 ${can ? "cursor-pointer hover:bg-slate-50" : "text-slate-400"}`} onClick={() => can && setOpen(open === p.id ? null : p.id)}>
          <td className="px-4 py-2"><div className="font-medium">{p.name}</div><div className="text-xs text-slate-400">{p.sub}{!s.length && ev.length ? ` · ${ev.length} sign-in event${ev.length === 1 ? "" : "s"}` : ""}</div></td>
          <td className="px-3 py-2"><div className="relative h-4 rounded bg-slate-100" aria-label={`${s.length} sessions`}>
            {[6, 12, 18].map((h) => <span key={h} className="absolute top-0 h-full border-l border-slate-200" style={{ left: `${(h / 24) * 100}%` }} />)}
            {s.map((x) => { const a = istDay(x.started_at) < date ? 0 : istMin(x.started_at), b = istDay(x.last_seen_at) > date ? 1440 : istMin(x.last_seen_at) + 1; return <span key={x.id} title={`${time(x.started_at)}–${time(x.last_seen_at)} · ${dur(x.active_seconds)}`} className="absolute top-0 h-full rounded bg-blue-600" style={{ left: `${(a / 1440) * 100}%`, width: `${Math.max(0.4, ((b - a) / 1440) * 100)}%` }} />; })}
          </div></td>
          <td className="px-3 py-2 tabular-nums">{first ? time(first) : "—"}</td><td className="px-3 py-2 tabular-nums">{last ? time(last) : "—"}</td>
          <td className="px-3 py-2 text-right tabular-nums">{s.length ? dur(total) : "—"}</td><td className="px-3 py-2 text-right tabular-nums">{s.length || ""}</td>
        </tr>
        {open === p.id && <tr><td colSpan={6} className="px-4 pb-3"><Detail s={s} evs={ev} nameOf={nameOf} page={page} /></td></tr>}
      </Fragment>; })}</tbody>
    </table></div>
  ) : (
    <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500 bg-slate-50"><tr><th className="px-4 py-2 font-medium sticky left-0 bg-slate-50">{who}</th>{days.map((d) => <th key={d} className="px-1 py-2 font-medium text-center whitespace-nowrap">{new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</th>)}<th className="px-3 py-2 font-medium text-right">Total</th></tr></thead>
      <tbody>{rows.map(({ p, s, total }) => <tr key={p.id} className="border-t border-slate-100">
        <td className="px-4 py-1.5 sticky left-0 bg-white whitespace-nowrap">{p.name}</td>
        {days.map((d) => { const t = s.filter((x) => istDay(x.started_at) === d).reduce((a, x) => a + x.active_seconds, 0); const m = Math.round(t / 60);
          return <td key={d} className="px-1 py-1.5 text-center"><span title={t ? dur(t) : "not opened"} className={`inline-block min-w-8 rounded px-1 text-xs tabular-nums ${!m ? "text-slate-300" : m < 15 ? "bg-blue-50 text-blue-800" : m < 60 ? "bg-blue-200 text-blue-900" : "bg-blue-600 text-white"}`}>{m ? (m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h`) : "·"}</span></td>; })}
        <td className="px-3 py-1.5 text-right tabular-nums">{total ? dur(total) : "—"}</td>
      </tr>)}</tbody>
    </table></div>
  );
}
