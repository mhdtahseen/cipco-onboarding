"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRole } from "@/lib/roles";
import { addDays, istToday } from "@/lib/attendance";
import { ACTION_COLOR, type GeoPoint } from "@/lib/geoPoints";

const LocationsMap = dynamic(() => import("@/components/LocationsMap"), { ssr: false, loading: () => <div className="h-[55vh] min-h-[22rem] rounded-xl bg-slate-100 animate-pulse" /> });
type Row = { id: string; user_id: string; role: string | null; project_id: string | null; work_date: string | null; action: string; subject: string | null; lat: number | null; lng: number | null; accuracy_m: number | null; geo_status: string; created_at: string };
const STATUS_LABEL: Record<string, string> = { denied: "refused", unavailable: "no signal / GPS off", timeout: "timed out", unsupported: "not supported" };
const ago = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const LIMIT = 5000;

// Admin only: where the Supervisors' and Site Engineers' entries were made, project by project, on an OpenStreetMap map. The phone supplies the coordinates, so treat them
// as evidence, not proof. Entries with no location are listed separately: "no location" is itself worth seeing.
export default function Locations() {
  const { admin } = useRole(); const today = istToday();
  const [from, setFrom] = useState(addDays(today, -6)); const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]); const [names, setNames] = useState<Record<string, string>>({}); const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [project, setProject] = useState(""); const [person, setPerson] = useState(""); const [action, setAction] = useState(""); const [joined, setJoined] = useState(false); const [sel, setSel] = useState<string | null>(null); const [more, setMore] = useState(1);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [capped, setCapped] = useState(false);

  useEffect(() => { if (!admin) return; let live = true; (async () => {
    setLoading(true); setErr(""); const sb = supabase();
    const [g, u, p] = await Promise.all([
      sb.from("entry_geo").select("id, user_id, role, project_id, work_date, action, subject, lat, lng, accuracy_m, geo_status, created_at").gte("created_at", `${from}T00:00:00+05:30`).lt("created_at", `${addDays(to, 1)}T00:00:00+05:30`).order("created_at", { ascending: false }).limit(LIMIT),
      sb.rpc("admin_list_users"), sb.from("projects").select("id, name").order("name")]);
    if (!live) return; if (g.error) { setErr(g.error.message); setLoading(false); return; }
    setRows((g.data || []) as Row[]); setCapped((g.data || []).length >= LIMIT);
    setNames(Object.fromEntries(((u.data || []) as { user_id: string; email: string; full_name: string }[]).map((x) => [x.user_id, x.full_name || x.email])));
    setProjects((p.data || []) as { id: string; name: string }[]); setLoading(false); setSel(null); setMore(1);
  })(); return () => { live = false; }; }, [admin, from, to]);

  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "—"; const who = (id: string) => names[id] ?? "Unknown";
  // per project, over the whole date range (so the project cards always show everything)
  const perProject = useMemo(() => projects.map((p) => { const r = rows.filter((x) => x.project_id === p.id); return { ...p, total: r.length, located: r.filter((x) => x.lat !== null).length, people: new Set(r.map((x) => x.user_id)).size }; }).filter((p) => p.total > 0), [rows, projects]);
  const inProject = useMemo(() => rows.filter((r) => !project || r.project_id === project), [rows, project]);
  const people = useMemo(() => [...new Set(inProject.map((r) => r.user_id))].sort((a, b) => who(a).localeCompare(who(b))), [inProject, names]);   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => inProject.filter((r) => (!person || r.user_id === person) && (!action || r.action === action)), [inProject, person, action]);
  const points: GeoPoint[] = useMemo(() => shown.filter((r) => r.lat !== null && r.lng !== null).map((r) => ({ id: r.id, lat: r.lat!, lng: r.lng!, acc: r.accuracy_m, at: r.created_at, who: who(r.user_id), role: r.role ?? "", project: pname(r.project_id), action: r.action, subject: r.subject, workDate: r.work_date })), [shown, names, projects]);   // eslint-disable-line react-hooks/exhaustive-deps
  const path = useMemo(() => (joined && person ? [...points].sort((a, b) => a.at.localeCompare(b.at)) : []), [joined, person, points]);
  const none = shown.filter((r) => r.lat === null);
  const noneByPerson = useMemo(() => { const m = new Map<string, Record<string, number>>(); none.forEach((r) => { const e = m.get(r.user_id) ?? {}; e[r.geo_status] = (e[r.geo_status] ?? 0) + 1; m.set(r.user_id, e); }); return [...m.entries()].sort((a, b) => Object.values(b[1]).reduce((s, n) => s + n, 0) - Object.values(a[1]).reduce((s, n) => s + n, 0)); }, [none]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!admin) return <p className="text-slate-500">Only admins can see locations.</p>;
  const listed = shown.filter((r) => r.lat !== null).slice(0, 100 * more);
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold">Locations</h1>
        <p className="text-sm text-slate-500">Where Supervisors and Site Engineers were when they made an entry, project by project. The phone supplies the coordinates, so treat them as evidence, not proof.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">From<input type="date" className="inp !w-36 block" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-500">To<input type="date" className="inp !w-36 block" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <span className="flex gap-2 pb-2 text-xs"><button className="text-blue-700 underline" onClick={() => { setFrom(today); setTo(today); }}>today</button><button className="text-blue-700 underline" onClick={() => { setFrom(addDays(today, -6)); setTo(today); }}>last 7 days</button><button className="text-blue-700 underline" onClick={() => { setFrom(addDays(today, -29)); setTo(today); }}>last 30 days</button></span>
        <select className="inp !w-44" aria-label="Person" value={person} onChange={(e) => { setPerson(e.target.value); setSel(null); }}><option value="">Everyone</option>{people.map((id) => <option key={id} value={id}>{who(id)}</option>)}</select>
        <select className="inp !w-40" aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}><option value="">All entries</option>{Object.keys(ACTION_COLOR).map((a) => <option key={a} value={a}>{a}</option>)}</select>
        {person && <label className="text-xs text-slate-600 flex items-center gap-1.5 pb-2"><input type="checkbox" checked={joined} onChange={(e) => setJoined(e.target.checked)} />Join their points in time order</label>}
      </div>
      {err && <p className="warn">{err} — has 2026-10-entry-geo.sql been run, and are you an Admin?</p>}
      {capped && <p className="warn">Showing the latest {LIMIT} entries only. Narrow the dates to see the rest.</p>}

      <div className="flex gap-2 overflow-x-auto pb-1" data-project-cards>
        <button className={`shrink-0 rounded-xl border px-3 py-2 text-left text-sm ${!project ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`} onClick={() => { setProject(""); setPerson(""); }}><div className="font-medium">All projects</div><div className="text-[11px] text-slate-500">{rows.length} entries · {rows.filter((r) => r.lat !== null).length} located</div></button>
        {perProject.map((p) => <button key={p.id} className={`shrink-0 rounded-xl border px-3 py-2 text-left text-sm ${project === p.id ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`} onClick={() => { setProject(p.id); setPerson(""); setSel(null); }}>
          <div className="font-medium">{p.name}</div><div className="text-[11px] text-slate-500">{p.total} entries · <span className={p.located < p.total ? "text-amber-700" : ""}>{p.located} located</span> · {p.people} {p.people === 1 ? "person" : "people"}</div></button>)}
      </div>

      {loading ? <div className="h-[55vh] min-h-[22rem] rounded-xl bg-slate-100 animate-pulse" /> : <>
        <LocationsMap points={points} selectedId={sel} onSelect={setSel} path={path} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500" aria-label="Colour key">{Object.entries(ACTION_COLOR).map(([a, c]) => <span key={a}><span className="inline-block h-2.5 w-2.5 rounded-full align-middle mr-1" style={{ background: c }} />{a}</span>)}
          <span className="ml-auto">{points.length} on the map{none.length ? ` · ${none.length} without a location` : ""}</span></div>
        {!points.length && <p className="text-sm text-slate-400">No located entries for these filters.{none.length ? " The entries below have no location: see “Entries with no location”." : ""}</p>}

        {listed.length > 0 && <section className="card !p-3 space-y-2"><h2 className="text-sm font-medium">Entries on the map</h2>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[36rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">When (IST)</th><th className="text-left">Person</th><th className="text-left">Project</th><th className="text-left">Entry</th><th className="text-right">Accuracy</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{listed.map((r) => <tr key={r.id} className={`cursor-pointer hover:bg-slate-50 ${sel === r.id ? "bg-blue-50" : ""}`} onClick={() => setSel(r.id)}>
              <td className="py-1.5 whitespace-nowrap">{ago(r.created_at)}</td><td>{who(r.user_id)}<span className="text-[11px] text-slate-400"> · {(r.role ?? "").replace("_", " ")}</span></td><td>{pname(r.project_id)}</td>
              <td><span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ background: ACTION_COLOR[r.action] ?? "#475569" }} />{r.action}{r.subject ? <span className="text-slate-500"> · {r.subject}</span> : ""}</td><td className="text-right tabular-nums text-slate-500">{r.accuracy_m != null ? `±${Math.round(r.accuracy_m)} m` : "—"}</td></tr>)}</tbody></table></div>
          {shown.filter((r) => r.lat !== null).length > listed.length && <button className="text-xs text-blue-700 underline" onClick={() => setMore(more + 1)}>Show more</button>}
        </section>}

        {none.length > 0 && <section className="card !p-3 space-y-2" data-no-location><h2 className="text-sm font-medium">Entries with no location <span className="font-normal text-slate-400">({none.length})</span></h2>
          <p className="text-xs text-slate-500">The entry was saved, but the phone gave no location: permission refused, GPS off, or no signal.</p>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[24rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Person</th><th className="text-left">Why</th><th className="text-right">Entries</th><th className="text-right">Latest</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{noneByPerson.map(([id, by]) => <tr key={id}><td className="py-1.5">{who(id)}</td><td className="text-slate-600">{Object.entries(by).map(([s, n]) => `${STATUS_LABEL[s] ?? s} ${n}`).join(", ")}</td><td className="text-right tabular-nums">{Object.values(by).reduce((s, n) => s + n, 0)}</td><td className="text-right text-slate-500 whitespace-nowrap">{ago(none.find((r) => r.user_id === id)!.created_at)}</td></tr>)}</tbody></table></div>
        </section>}
      </>}
    </div>
  );
}
