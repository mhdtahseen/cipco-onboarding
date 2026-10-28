"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useMedia } from "@/lib/useMedia";
import { Icon } from "./NavIcons";
import { roleRank } from "@/lib/roles";
import TransportCard from "./TransportCard";
import DayBar from "./DayBar";
import { MEALS, STATUS_LABEL, addDays, canWriteDay, dayName, effectiveStatus, fmtTime, isFuture, isLocked, isSupervisorRole, isWeeklyOff, istToday, type AttRow, type DayRow, type Meal, type Person, type Run, type Status, type Vehicle, type Vendor } from "@/lib/attendance";

const WORK: { s: Status; label: string }[] = [{ s: "present", label: "Present" }, { s: "absent", label: "Absent" }, { s: "half", label: "Half-day" }, { s: "off", label: "Off" }];
const POLL_MS = Number(process.env.NEXT_PUBLIC_ATT_POLL_MS) || 25000;   // how often to check for other people's changes when the live connection is quiet
const blank = (p: Person, projectId: string, date: string, status: Status | null): AttRow => ({ employee_id: p.employee_id, project_id: projectId, work_date: date, status, breakfast_vendor_id: null, lunch_vendor_id: null, dinner_vendor_id: null });

// The daily sheet: one card per person on the project — work status and, for each meal, which vendor (or none). Saves on every tap.
export default function AttendanceSheet({ projectId, role, vendors, vehicles, names }: { projectId: string; role: string | null; vendors: Vendor[]; vehicles: Vehicle[]; names: Record<string, string> }) {
  const admin = role === "admin"; const myRank = roleRank(role);
  const [runs, setRuns] = useState<Run[]>([]); const [day, setDay] = useState<DayRow | null>(null);
  const [date, setDate] = useState(istToday()); const [people, setPeople] = useState<Person[]>([]); const [rows, setRows] = useState<Record<string, AttRow>>({});
  const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [bulkMeal, setBulkMeal] = useState<Meal>("lunch"); const [bulkVendor, setBulkVendor] = useState(""); const [q, setQ] = useState(""); const [onlyOpen, setOnlyOpen] = useState(false); const [qa, setQa] = useState(false); const [statusPick, setStatusPick] = useState<Status>("present"); const [scopePick, setScopePick] = useState<"open" | "all">("open"); const [qm, setQm] = useState(false); const qmRef = useRef<HTMLDivElement>(null); const wide = useMedia("(min-width: 1024px)");
  useEffect(() => {
    if (!qm) return;
    const down = (e: MouseEvent) => { if (!qmRef.current?.contains(e.target as Node)) setQm(false); }; const key = (e: KeyboardEvent) => { if (e.key === "Escape") setQm(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key); return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [qm]);
  const overrideRef = useRef(false); const [override, setOverride] = useState(false); useEffect(() => { setOverride(false); setStale(false); pendingRef.current = null; }, [projectId, date]);   // an Admin sees a day view-only until they choose Override, so nothing is changed by accident
  const viewOnly = admin && !override; overrideRef.current = override;
  const future = isFuture(date), verifiedLock = isSupervisorRole(role) && !!day?.verified_at, lockedByRules = !canWriteDay(role, date) || verifiedLock, locked = lockedByRules || viewOnly;
  const sb = () => supabase();

  type Snap = { list: Person[]; m: Record<string, AttRow>; runs: Run[]; day: DayRow | null };
  // What is really stored right now for this project and day.
  async function fetchDay(): Promise<Snap | { error: string }> {
    const { data: ppl, error } = await sb().rpc("attendance_roster", { p_project: projectId, p_from: date, p_to: date });
    if (error) return { error: error.message };
    const list = (ppl || []) as Person[];
    const { data: att } = list.length ? await sb().from("attendance").select("*").eq("work_date", date).in("employee_id", list.map((p) => p.employee_id)) : { data: [] };
    const m: Record<string, AttRow> = {}; ((att || []) as AttRow[]).forEach((a) => (m[a.employee_id] = a));
    const [t, d] = await Promise.all([sb().from("transport_runs").select("*").eq("project_id", projectId).eq("work_date", date), sb().from("attendance_days").select("*").eq("project_id", projectId).eq("work_date", date).maybeSingle()]);
    return { list, m, runs: (t.data || []) as Run[], day: (d.data as DayRow) ?? null };
  }
  const apply = (r: Snap) => { setPeople(r.list); setRows(r.m); setRuns(r.runs); setDay(r.day); };
  // A comparable fingerprint of a day, so "has anyone else changed it?" is a cheap question.
  const sig = (r: Snap) => JSON.stringify([r.list.map((p) => p.employee_id), Object.values(r.m).sort((x, y) => x.employee_id.localeCompare(y.employee_id)).map((a) => [a.employee_id, a.status, a.breakfast_vendor_id, a.lunch_vendor_id, a.dinner_vendor_id, a.rank]), [...r.runs].sort((x, y) => x.id.localeCompare(y.id)).map((x) => [x.id, x.status, x.at, x.rank]), r.day && [r.day.submitted_at, r.day.verified_at]]);
  async function load(quiet = false) {
    if (!quiet) setLoading(true); setErr("");
    const r = await fetchDay();
    if ("error" in r) { setErr(r.error); setPeople([]); setRows({}); setLoading(false); return null; }
    apply(r); setStale(false); pendingRef.current = null; setLoading(false); return r.m;
  }

  // ── Live view: other people's changes reach this screen. Realtime pushes a nudge, a timer checks too (weak site internet), and the same check
  //    runs when the tab is shown again. Anyone not mid-edit sees the new data at once; an Admin with Override on gets a banner instead, so the screen never shifts under them. ──
  const [stale, setStale] = useState(false); const [live, setLive] = useState(false); const pendingRef = useRef<Snap | null>(null); const inflight = useRef(0);
  const stateRef = useRef<Snap>({ list: [], m: {}, runs: [], day: null }); stateRef.current = { list: people, m: rows, runs, day };
  async function sync() {
    if (inflight.current > 0 || (typeof document !== "undefined" && document.hidden)) return;
    const r = await fetchDay(); if ("error" in r || inflight.current > 0) return;
    if (sig(r) === sig(stateRef.current)) return;   // nothing new (this includes the user's own changes, already on screen)
    if (overrideRef.current) { pendingRef.current = r; setStale(true); } else { apply(r); }
  }
  const syncRef = useRef(sync); syncRef.current = sync;
  useEffect(() => {
    const client = sb(); let t: ReturnType<typeof setTimeout> | undefined;
    const nudge = (payload?: any) => { const wd = payload?.new?.work_date ?? payload?.old?.work_date; if (wd && wd !== date) return; clearTimeout(t); t = setTimeout(() => syncRef.current(), 300); };
    const ch = client.channel(`att-${projectId}-${date}`);
    ["attendance", "transport_runs", "attendance_days"].forEach((table) => ch.on("postgres_changes" as any, { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` }, nudge));
    ch.subscribe((st: string) => setLive(st === "SUBSCRIBED"));
    const timer = setInterval(() => syncRef.current(), POLL_MS); const shown = () => { if (!document.hidden) syncRef.current(); }; document.addEventListener("visibilitychange", shown);
    return () => { clearTimeout(t); clearInterval(timer); document.removeEventListener("visibilitychange", shown); client.removeChannel(ch); };
  }, [projectId, date]);
  useEffect(() => { load(); }, [projectId, date]);

  // Saves send only the fields that changed (never the whole row), so two people editing the same person at once (one sets the work status,
  // another a meal) cannot wipe each other's change. An upsert with just these columns updates just these columns when the row already exists.
  type Upd = { employee_id: string } & Partial<AttRow>;
  const rec = (u: Upd) => ({ ...u, project_id: projectId, work_date: date });
  async function save(p: Person, patch: Partial<AttRow>) {
    if (locked) return; const cur = rows[p.employee_id];
    if (cur?.rank && cur.rank > myRank) { setErr(`${p.full_name} was set by the ${cur.rank === 3 ? "Admin" : "Site Engineer"}; you can't change it.`); return; }
    const next: AttRow = { ...(cur ?? blank(p, projectId, date, null)), ...patch };   // a meal can be recorded for anyone (absent, off, not marked): meals are ours to pay for whatever their work status
    setRows((r) => ({ ...r, [p.employee_id]: next })); setErr(""); inflight.current++;
    const { data, error } = await sb().from("attendance").upsert(rec({ employee_id: p.employee_id, ...patch }), { onConflict: "employee_id,work_date" }).select().single(); inflight.current--;
    if (error) { setErr(error.message); setRows((r) => { const c = { ...r }; if (cur) c[p.employee_id] = cur; else delete c[p.employee_id]; return c; }); return; }
    setRows((r) => ({ ...r, [p.employee_id]: data as AttRow }));
  }
  // Bulk actions: save, then re-read what is really stored, so the screen can never disagree with the database.
  async function bulk(updates: Upd[], done: string, nothing = "Nothing to change.") {
    if (locked) return; updates = updates.filter((u) => !(rows[u.employee_id]?.rank && rows[u.employee_id].rank! > myRank));
    if (!updates.length) { setMsg(nothing); setTimeout(() => setMsg(""), 4000); return; }
    setErr(""); setMsg("Saving…");
    inflight.current++; const { error } = await sb().from("attendance").upsert(updates.map(rec), { onConflict: "employee_id,work_date" }); inflight.current--;
    if (error) { setMsg(""); setErr(error.message); return; }
    const saved = await load(true); if (!saved) { setMsg(""); return; }
    const missing = updates.filter((u) => !saved[u.employee_id]).length;
    if (missing) { setMsg(""); setErr(`Only ${updates.length - missing} of ${updates.length} were saved. Please refresh and try again.`); return; }
    setMsg(`${done} (${updates.length})`); setTimeout(() => setMsg(""), 4000);
  }
  const everyonePresent = () => {
    const todo = people.filter((p) => !rows[p.employee_id] && !isWeeklyOff(p, date));
    const why = people.every((p) => isWeeklyOff(p, date) && !rows[p.employee_id]) ? `Everyone is on their weekly off (${dayName(date)}). Tap Present on a person to override.` : "Everyone is already marked.";
    bulk(todo.map((p) => ({ employee_id: p.employee_id, status: "present" as const })), "Marked present ✓", why);
  };
  // Mark a whole group in one go: people still open, or everyone (which changes people already marked, so it asks first). Meals are left as they are.
  function markAs() {
    const ups: Upd[] = []; let changing = 0;
    people.forEach((p) => { const cur = rows[p.employee_id]; const st = effectiveStatus(p, date, cur); if (scopePick === "open" ? st === null : st !== statusPick) { if (cur && cur.status !== statusPick) changing++; ups.push({ employee_id: p.employee_id, status: statusPick }); } });
    if (scopePick === "all" && changing && !confirm(`This changes ${changing} ${changing === 1 ? "person" : "people"} who ${changing === 1 ? "is" : "are"} already marked. Continue?`)) return;
    bulk(ups, `Marked ${STATUS_LABEL[statusPick].toLowerCase()} ✓`, scopePick === "open" ? "Nobody is still open." : `Everyone is already ${STATUS_LABEL[statusPick].toLowerCase()}.`);
  }
  async function copyYesterdayAttendance() {
    const { data } = await sb().from("attendance").select("*").eq("work_date", addDays(date, -1)).in("employee_id", people.map((p) => p.employee_id));
    const y: Record<string, AttRow> = {}; ((data || []) as AttRow[]).forEach((a) => (y[a.employee_id] = a));
    const ups: Upd[] = []; people.forEach((p) => { const prev = y[p.employee_id]; if (!prev || !prev.status || prev.status === "off" || effectiveStatus(p, date, rows[p.employee_id]) !== null) return; ups.push({ employee_id: p.employee_id, status: prev.status }); });   // only people still open; yesterday's weekly off is not carried over
    bulk(ups, "Copied yesterday's attendance ✓", "Nothing to copy — nobody who was marked yesterday is still open today.");
  }
  async function copyYesterday() {
    const { data } = await sb().from("attendance").select("*").eq("work_date", addDays(date, -1)).in("employee_id", people.map((p) => p.employee_id));
    const y: Record<string, AttRow> = {}; ((data || []) as AttRow[]).forEach((a) => (y[a.employee_id] = a));
    const ups: Upd[] = []; people.forEach((p) => { const prev = y[p.employee_id]; if (!prev || !(prev.breakfast_vendor_id || prev.lunch_vendor_id || prev.dinner_vendor_id)) return; ups.push({ employee_id: p.employee_id, breakfast_vendor_id: prev.breakfast_vendor_id, lunch_vendor_id: prev.lunch_vendor_id, dinner_vendor_id: prev.dinner_vendor_id }); });   // meals are repeated for everyone who had them, whatever their work status
    bulk(ups, "Copied yesterday's meals ✓", "Nothing to copy — nobody had a meal recorded yesterday.");
  }
  const setAllMeal = () => { const col = MEALS.find((m) => m.key === bulkMeal)!.col; const ups: Upd[] = people.map((p) => ({ employee_id: p.employee_id, [col]: bulkVendor || null })); bulk(ups, "Meals updated ✓", "Nobody on this project."); };

  const quickPanel = (done: () => void, menu = false) => (
    <div className="space-y-4">
      <div className="space-y-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Attendance</div>
        <button type="button" role={menu ? "menuitem" : undefined} className="btn w-full justify-center" onClick={() => { done(); copyYesterdayAttendance(); }}>Copy yesterday's attendance</button>
        <div className="grid grid-cols-2 gap-2"><select className="inp" aria-label="Who" value={scopePick} onChange={(e) => setScopePick(e.target.value as "open" | "all")}><option value="open">Still open</option><option value="all">Everyone</option></select>
          <select className="inp" aria-label="Mark as" value={statusPick} onChange={(e) => setStatusPick(e.target.value as Status)}>{WORK.map((w) => <option key={w.s} value={w.s}>{w.label}</option>)}</select></div>
        <button type="button" role={menu ? "menuitem" : undefined} className="btn w-full justify-center" onClick={() => { done(); markAs(); }}>Mark as {STATUS_LABEL[statusPick].toLowerCase()}</button></div>
      <div className="space-y-2 border-t border-slate-100 pt-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Meals</div>
        <button type="button" role={menu ? "menuitem" : undefined} className="btn w-full justify-center" onClick={() => { done(); copyYesterday(); }}>Copy yesterday's meals</button>
        <div className="lbl !mb-0">Set a meal for everyone</div>
        <div className="grid grid-cols-2 gap-2"><select className="inp" aria-label="Meal" value={bulkMeal} onChange={(e) => setBulkMeal(e.target.value as Meal)}>{MEALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          <select className="inp" aria-label="Vendor" value={bulkVendor} onChange={(e) => setBulkVendor(e.target.value)}><option value="">No meal</option>{vendors.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <button type="button" role={menu ? "menuitem" : undefined} className="btn w-full justify-center" onClick={() => { done(); setAllMeal(); }}>Apply</button></div>
    </div>
  );

  const sum = useMemo(() => {
    const c = { present: 0, half: 0, absent: 0, off: 0, none: 0 }; const meals: Record<Meal, Record<string, number>> = { breakfast: {}, lunch: {}, dinner: {} };
    people.forEach((p) => { const r = rows[p.employee_id]; const st = effectiveStatus(p, date, r); if (st) c[st]++; else c.none++; MEALS.forEach((m) => { const v = r?.[m.col]; if (v) meals[m.key][v] = (meals[m.key][v] || 0) + 1; }); });
    return { c, meals };
  }, [people, rows, date]);
  const stamp = (r?: AttRow) => (r?.updated_by && r.updated_at ? `${names[r.updated_by] ?? "someone"} · ${fmtTime(r.updated_at)}` : "");
  const prot = (r?: AttRow) => !!r?.rank && r.rank > myRank;   // set by someone senior: shown, not editable
  const lastChange = useMemo(() => { const c: { at: string; by: string | null }[] = []; Object.values(rows).forEach((r) => r.updated_at && c.push({ at: r.updated_at, by: r.updated_by ?? null })); runs.forEach((r) => r.updated_at && c.push({ at: r.updated_at, by: r.updated_by ?? null })); if (day?.verified_at) c.push({ at: day.verified_at, by: day.verified_by }); if (day?.submitted_at) c.push({ at: day.submitted_at, by: day.submitted_by }); return c.sort((a, b) => b.at.localeCompare(a.at))[0]; }, [rows, runs, day]);
  const liveNote = !loading && people.length > 0 && <p className="text-[11px] text-slate-400 flex items-center justify-center sm:justify-start gap-1.5" data-live><span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-slate-300"}`} title={live ? "Live: changes appear as they happen" : `Checking for changes every ${Math.round(POLL_MS / 1000)} seconds`} />{lastChange ? `Last change: ${lastChange.by ? names[lastChange.by] ?? "someone" : "someone"} · ${fmtTime(lastChange.at)}` : "No changes yet today"}</p>;
  const staleBar = stale && <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2" data-stale><span className="text-sm text-blue-900 min-w-0 flex-1">Someone else changed this day. Refresh to see it. Your own edits are already saved.</span><button type="button" className="btn btn-primary" onClick={() => { if (pendingRef.current) apply(pendingRef.current); pendingRef.current = null; setStale(false); }}>Refresh</button></div>;
  const overrideBar = admin && !loading && people.length > 0 && (
    <div className={`rounded-2xl border px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 ${override ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`} data-override>
      <span className={`text-sm min-w-0 flex-1 ${override ? "text-amber-900" : "text-slate-600"}`}>{override ? "Override is on. Your changes are stamped as Admin and replace what the Supervisor or Site Engineer entered." : "View only. Tap Override to change anything on this day."}</span>
      <button type="button" onClick={() => setOverride(!override)} aria-pressed={override} className={`btn ${override ? "" : "btn-primary"}`}>{override ? "Done" : "Override"}</button>
    </div>);
  const extras = !loading && people.length > 0 && <div className="space-y-3"><DayBar projectId={projectId} date={date} role={role} day={day} names={names} people={people} rows={rows} vehicles={vehicles} runs={runs} canWrite={!viewOnly && (!future || admin)} reload={() => load(true)} /><TransportCard projectId={projectId} date={date} vehicles={vehicles} runs={runs} canWrite={!locked} today={date === istToday()} myRank={myRank} names={names} reload={() => load(true)} /></div>;
  const vName = (id: string) => vendors.find((v) => v.id === id)?.name ?? "?";
  const shownVendors = (cur: string | null) => vendors.filter((v) => v.active || v.id === cur);

  const nextVendor = (cur: string | null, list: Vendor[]) => { const ids = [null, ...list.map((v) => v.id)]; return ids[(ids.indexOf(cur) + 1) % ids.length]; };   // one tap moves none → vendor 1 → vendor 2 → none
  const shown = people.filter((p) => (!q.trim() || p.full_name.toLowerCase().includes(q.trim().toLowerCase())) && (!onlyOpen || !effectiveStatus(p, date, rows[p.employee_id])));

  // ── Phones and tablets: calm, spacious cards. Status is a soft segmented control, meals appear only for people who are working,
  //    and colour is used sparingly (small dots and tints, never solid blocks). ──
  const SEG: Record<Status, string> = { present: "text-emerald-700", absent: "text-rose-700", half: "text-amber-700", off: "text-slate-600" };
  const VDOT = ["bg-blue-500", "bg-orange-400", "bg-violet-500", "bg-teal-500", "bg-pink-500"];
  const vDot = (id: string) => VDOT[Math.max(0, vendors.findIndex((v) => v.id === id)) % VDOT.length];
  const dayLabel = new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  const marked = people.length - sum.c.none;
  const mealLine = MEALS.map((m) => Object.keys(sum.meals[m.key]).length ? `${m.label} ${Object.entries(sum.meals[m.key]).map(([v, n]) => `${vName(v)} ${n}`).join(", ")}` : "").filter(Boolean).join("  ·  ");
  const mobileView = (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" className="h-11 w-11 grid place-items-center rounded-full text-slate-500 active:bg-slate-100 touch-manipulation"><Icon name="chevron-left" /></button>
          <label className="relative block text-center px-2">
            <span className="block text-[17px] font-medium text-slate-900">{dayLabel}</span>
            <span className="block text-xs text-slate-400">{date === istToday() ? "Today" : "Tap to change date"}</span>
            <input type="date" aria-label="Choose date" max={admin ? undefined : istToday()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="absolute inset-0 h-full w-full opacity-0 cursor-pointer" />
          </label>
          <button type="button" onClick={() => setDate(addDays(date, 1))} aria-label="Next day" className="h-11 w-11 grid place-items-center rounded-full text-slate-500 active:bg-slate-100 touch-manipulation"><Icon name="chevron-right" /></button>
        </div>
        <div className="mt-1 flex justify-center">
          {viewOnly ? null : future && !admin ? <p className="text-xs text-amber-800 bg-amber-50 rounded-full px-3 py-1">Future days can't be marked</p>
            : verifiedLock ? <p className="text-xs text-blue-800 bg-blue-50 rounded-full px-3 py-1">Verified by the Site Engineer · view only</p>
            : lockedByRules ? <p className="text-xs text-amber-800 bg-amber-50 rounded-full px-3 py-1">Locked at 11:00 PM · view only</p>
            : admin && isLocked(date) ? <p className="text-xs text-blue-800 bg-blue-50 rounded-full px-3 py-1">Locked for others · editing as Admin</p>
            : <p className="text-[11px] text-slate-400">Open until 11:00 PM · saves as you tap</p>}
        </div>
        {date !== istToday() && <div className="mt-1 text-center"><button className="text-xs text-blue-700 underline" onClick={() => setDate(istToday())}>Go to today</button></div>}
      </div>
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
      {liveNote}
      {overrideBar}
      {staleBar}

      {!loading && people.length > 0 && <>
        <div className="rounded-2xl bg-white border border-slate-200/80 p-4 space-y-3">
          <div className="flex items-baseline justify-between"><div><span className="text-2xl font-medium tabular-nums text-slate-900">{marked}</span><span className="text-slate-400"> of {people.length} marked</span></div>
            {sum.c.none > 0 ? <span className="text-xs text-amber-700">{sum.c.none} still open</span> : <span className="text-xs text-emerald-700">All done</span>}</div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={people.length} aria-valuenow={marked} aria-label="People marked"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${people.length ? (marked / people.length) * 100 : 0}%` }} /></div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">{([["present", "Present", "bg-emerald-500"], ["half", "Half-day", "bg-amber-400"], ["absent", "Absent", "bg-rose-500"], ["off", "Off", "bg-slate-300"]] as const).map(([k, l, d]) => <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${d}`} /><b className="font-medium text-slate-700 tabular-nums">{sum.c[k]}</b>{l}</span>)}</div>
          {mealLine && <div className="text-xs text-slate-400">{mealLine}</div>}
          {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        </div>
        {!locked && <div className="rounded-2xl bg-white border border-slate-200/80">
          <button type="button" className="w-full flex items-center justify-between px-4 min-h-12 text-sm text-slate-700 touch-manipulation" onClick={() => setQa(!qa)} aria-expanded={qa}>Quick actions<Icon name={qa ? "chevron-down" : "chevron-right"} className="h-4 w-4 text-slate-400" /></button>
          {qa && <div className="px-4 pb-4 border-t border-slate-100 pt-4">{quickPanel(() => setQa(false))}</div>}
        </div>}
        {extras}
        {people.length > 6 && <div className="flex items-center gap-2 md:max-w-lg"><input className="inp flex-1 min-w-0" type="search" placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className={`shrink-0 h-11 rounded-full px-4 text-sm border touch-manipulation ${onlyOpen ? "bg-blue-50 border-blue-200 text-blue-800" : "bg-white border-slate-200 text-slate-600"}`} onClick={() => setOnlyOpen(!onlyOpen)} aria-pressed={onlyOpen}>Open only</button></div>}
      </>}

      {loading && <p className="text-center text-sm text-slate-400 py-6">Loading…</p>}
      {!loading && !err && !people.length && <p className="text-center text-sm text-slate-400 py-6">Nobody is on this project for {dayName(date)} {date}. People appear once they have a joining date on or before the day.</p>}
      {!loading && people.length > 0 && !shown.length && <p className="text-center text-sm text-slate-400 py-6">{onlyOpen && !q ? "Everyone is marked ✓" : "No one matches."}</p>}
      {/* meals are shown for everyone: an absent or weekly-off worker still eats, at the accommodation or the site */}
      <div className="space-y-2.5 md:space-y-0 md:grid md:grid-cols-2 md:gap-3">
        {shown.map((p) => { const r = rows[p.employee_id]; const st = effectiveStatus(p, date, r); const virtualOff = !r && st === "off"; const showMeals = true; return (
          <div key={p.employee_id} data-person className="rounded-2xl bg-white border border-slate-200/80 p-3.5 space-y-3">
            <div className="flex items-center gap-2.5 min-w-0"><span className={`h-2 w-2 shrink-0 rounded-full ${st ? "bg-transparent" : "bg-amber-400"}`} title={st ? undefined : "Not marked yet"} />
              <div className="min-w-0"><div className="text-[15px] font-medium text-slate-900 truncate">{p.full_name}</div><div className="text-xs text-slate-400 truncate">{[p.emp_no, p.designation].filter(Boolean).join(" · ") || "—"}{virtualOff ? " · weekly off" : ""}</div></div>
              {stamp(r) && <div className="ml-auto text-right text-[11px] leading-tight text-slate-400 shrink-0" data-stamp>{stamp(r)}</div>}</div>
            <div role="group" aria-label={`Work – ${p.full_name}`} className="grid grid-cols-4 gap-0.5 rounded-xl bg-slate-100 p-1">
              {WORK.map((w) => <button key={w.s} type="button" disabled={locked || prot(r)} aria-pressed={st === w.s} onClick={() => save(p, { status: w.s })} className={`h-11 rounded-lg text-[13px] font-medium touch-manipulation transition-colors disabled:opacity-60 ${st === w.s ? `bg-white shadow-sm ${SEG[w.s]}` : "text-slate-500"}`}>{w.label}</button>)}</div>
            {showMeals && <div className="grid grid-cols-3 gap-2">
              {MEALS.map((m) => { const cur = r?.[m.col] ?? null; const list = shownVendors(cur); const many = list.length > 3; return (
                <div key={m.key} className="min-w-0"><div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1 pl-1">{m.label}</div>
                  {many ? <select className="inp !px-2" disabled={locked || prot(r)} aria-label={`${m.label} – ${p.full_name}`} value={cur ?? ""} onChange={(e) => save(p, { [m.col]: e.target.value || null })}><option value="">–</option>{list.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                    : <button type="button" disabled={locked || prot(r)} aria-label={`${m.label}: ${cur ? vName(cur) : "none"}. Tap to change.`} onClick={() => save(p, { [m.col]: nextVendor(cur, list) })} className={`h-11 w-full rounded-xl border text-[13px] flex items-center justify-center gap-1.5 px-1 touch-manipulation disabled:opacity-60 ${cur ? "bg-white border-slate-200 text-slate-700" : "bg-slate-50 border-transparent text-slate-300"}`}>{cur && <span className={`h-2 w-2 shrink-0 rounded-full ${vDot(cur)}`} />}<span className="truncate">{cur ? vName(cur) : "–"}</span></button>}</div>); })}
            </div>}
          </div>); })}
      </div>

      {!loading && people.length > 0 && !locked && <div className="sticky bottom-[var(--bottom-nav-h,0px)] z-10 -mx-4 px-4 py-2.5 border-t border-slate-200/70 bg-white/90 backdrop-blur flex items-center gap-3">
        <div className="text-sm min-w-0 flex-1">{sum.c.none ? <span className="text-slate-500"><b className="font-medium text-slate-800">{sum.c.none}</b> still open</span> : <span className="text-emerald-700">All marked</span>}</div>
        <button className="btn btn-primary" onClick={everyonePresent} disabled={!sum.c.none}>Everyone present</button>
      </div>}
    </div>
  );

  // ── Wide screens (≥1024px): one compact roster table and a single toolbar, instead of a tall card per person ──
  const TINT: Record<Status, string> = { present: "bg-green-100 text-green-800", absent: "bg-red-100 text-red-800", half: "bg-amber-100 text-amber-800", off: "bg-slate-200 text-slate-700" };
  const VTINT = ["bg-blue-50 border-blue-200 text-blue-800", "bg-orange-50 border-orange-200 text-orange-800", "bg-violet-50 border-violet-200 text-violet-800", "bg-teal-50 border-teal-200 text-teal-800", "bg-pink-50 border-pink-200 text-pink-800"];
  const vTint = (id: string) => VTINT[Math.max(0, vendors.findIndex((v) => v.id === id)) % VTINT.length];
  const DOT: Record<string, string> = { present: "bg-green-500", half: "bg-amber-500", absent: "bg-red-500", off: "bg-slate-400", none: "bg-amber-400" };
  const hint = future && !admin ? "" : locked ? "" : admin && isLocked(date) ? "" : "Open until 11:00 PM · saves as you click";
  const desktopView = (
    <div className="space-y-3">
      <div className="xl:sticky xl:top-14 z-10 -mx-4 px-4 py-2 bg-[#f6f7fb]/95 xl:backdrop-blur border-b border-slate-200/70 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1"><button className="btn !px-3" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><Icon name="chevron-left" className="h-4 w-4" /></button>
            <input className="inp !w-36 text-center" type="date" max={admin ? undefined : istToday()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button className="btn !px-3" onClick={() => setDate(addDays(date, 1))} aria-label="Next day"><Icon name="chevron-right" className="h-4 w-4" /></button></div>
          <div className="text-sm flex items-center gap-2"><b>{dayName(date)}</b>{date === istToday() ? <span className="text-xs bg-green-50 text-green-800 rounded-full px-2 py-0.5">today</span> : <button className="text-blue-700 underline text-sm" onClick={() => setDate(istToday())}>Go to today</button>}</div>
          <div className="ml-auto flex items-center gap-2">
            {people.length > 6 && <input className="inp !w-40" type="search" placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />}
            {people.length > 0 && <button className={`btn ${onlyOpen ? "btn-primary" : ""}`} onClick={() => setOnlyOpen(!onlyOpen)} aria-pressed={onlyOpen}>Open only</button>}
            {!locked && people.length > 0 && <div ref={qmRef} className="relative">
              <button type="button" className="btn" aria-haspopup="menu" aria-expanded={qm} onClick={() => setQm(!qm)}>Quick actions<Icon name="chevron-down" className="h-4 w-4 text-slate-400" /></button>
              {qm && <div role="menu" className="absolute right-0 top-full mt-1 w-80 rounded-xl border border-slate-200 bg-white shadow-lg p-3 z-30">{quickPanel(() => setQm(false), true)}</div>}
            </div>}
            {!locked && people.length > 0 && <button className="btn btn-primary" onClick={everyonePresent} disabled={!sum.c.none}>Everyone present</button>}
          </div>
        </div>
        {!loading && people.length > 0 && <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {([["present", "Present"], ["half", "Half-day"], ["absent", "Absent"], ["off", "Off"], ["none", "Open"]] as const).map(([k, l]) => <span key={k} className={`inline-flex items-center gap-1.5 ${k === "none" && sum.c.none ? "font-medium text-amber-800" : "text-slate-600"}`}><span className={`h-2 w-2 rounded-full ${DOT[k]}`} /><b className="text-slate-900 tabular-nums">{sum.c[k]}</b>{l}</span>)}
          {hint && <span className="hidden xl:inline text-xs text-slate-400">{hint}</span>}
          <span className="hidden xl:inline ml-auto text-xs text-slate-500">{MEALS.map((m) => `${m.label}: ${Object.keys(sum.meals[m.key]).length ? Object.entries(sum.meals[m.key]).map(([v, n]) => `${vName(v)} ${n}`).join(", ") : "—"}`).join("  ·  ")}</span>
        </div>}
      </div>

      {extras}
      {liveNote}
      {overrideBar}
      {staleBar}
      {viewOnly ? null : future && !admin ? <p className="warn !text-sm">Attendance can't be entered for a future date.</p>
        : verifiedLock ? <p className="text-sm bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-3 py-2">Verified by the Site Engineer — view only until they reopen the day.</p>
        : lockedByRules ? <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">🔒 Locked at 11:00 PM. You can view this day, but only an Admin can change it.</p>
        : admin && isLocked(date) ? <p className="text-sm bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-3 py-2">Locked for others — you're editing as an Admin.</p> : null}
      {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {loading && <p className="card text-center text-sm text-slate-500">Loading…</p>}
      {!loading && !err && !people.length && <p className="card text-center text-sm text-slate-500">Nobody is on this project for {dayName(date)} {date}. People appear once they have a joining date on or before the day.</p>}
      {!loading && people.length > 0 && !shown.length && <p className="card text-center text-sm text-slate-500">{onlyOpen && !q ? "Everyone is marked ✓" : "No one matches."}</p>}

      {shown.length > 0 && <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="text-left font-medium pl-4 pr-2 py-2">Name</th><th className="text-left font-medium px-2 py-2 w-[19rem]">Work</th>{MEALS.map((m) => <th key={m.key} className="text-left font-medium px-2 py-2 w-32">{m.label}</th>)}<th className="text-left font-medium px-2 py-2 w-36">Last change</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((p) => { const r = rows[p.employee_id]; const st = effectiveStatus(p, date, r); const virtualOff = !r && st === "off"; return (
              <tr key={p.employee_id} className="hover:bg-slate-50/70">
                <td className="pl-4 pr-2 py-1.5"><div className="flex items-center gap-2.5 min-w-0"><span className={`h-2 w-2 shrink-0 rounded-full ${st ? "bg-transparent" : "bg-amber-400"}`} title={st ? undefined : "Not marked yet"} />
                  <div className="min-w-0"><div className="font-medium truncate">{p.full_name}</div><div className="text-xs text-slate-500 truncate">{[p.emp_no, p.designation].filter(Boolean).join(" · ") || "—"}{virtualOff ? " · weekly off" : ""}</div></div></div></td>
                <td className="px-2 py-1.5"><div role="group" aria-label={`Work – ${p.full_name}`} className="inline-flex rounded-lg border border-slate-300 overflow-hidden divide-x divide-slate-300 bg-white">
                  {WORK.map((w) => <button key={w.s} type="button" disabled={locked || prot(r)} onClick={() => save(p, { status: w.s })} aria-pressed={st === w.s} className={`h-8 px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${st === w.s ? TINT[w.s] : "text-slate-600 hover:bg-slate-50"}`}>{w.label}</button>)}</div></td>
                {MEALS.map((m) => { const cur = r?.[m.col] ?? null; const list = shownVendors(cur); const many = list.length > 3; return (
                  <td key={m.key} className="px-2 py-1.5">{many
                    ? <select className="h-8 w-full rounded-lg border border-slate-300 bg-white px-1.5 text-xs disabled:opacity-60" disabled={locked || prot(r)} aria-label={`${m.label} – ${p.full_name}`} value={cur ?? ""} onChange={(e) => save(p, { [m.col]: e.target.value || null })}><option value="">–</option>{list.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                    : <button type="button" disabled={locked || prot(r)} title="Click to change" aria-label={`${m.label} – ${p.full_name}: ${cur ? vName(cur) : "none"}. Click to change.`} onClick={() => save(p, { [m.col]: nextVendor(cur, list) })} className={`h-8 w-full rounded-lg border px-2 text-xs font-medium truncate disabled:cursor-not-allowed disabled:opacity-60 ${cur ? vTint(cur) : "border-dashed border-slate-300 text-slate-400 hover:bg-slate-50"}`}>{cur ? vName(cur) : "–"}</button>}</td>); })}
                <td className="px-2 py-1.5 text-[11px] leading-tight text-slate-400" data-stamp>{stamp(r)}</td>
              </tr>); })}
          </tbody>
        </table>
      </div>}
    </div>
  );

  return wide ? desktopView : mobileView;
}
