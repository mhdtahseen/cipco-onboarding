"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Icon } from "./NavIcons";
import { LEG_LABEL, effectiveStatus, fmtTime, istISO, istToday, type AttRow, type Leg, type Passenger, type Person, type Trip, type Vehicle } from "@/lib/attendance";

type Dlg = { mode: "new"; leg: Leg } | { mode: "edit"; trip: Trip };

// Transport for the day, inside the daily sheet. A trip is a vehicle run (pickup or drop) stamped with the server's clock, with the people who were on board.
// Attendance and transport are independent: people can be marked before, after or without being on a trip.
export default function TransportCard({ projectId, date, people, rows, vehicles, trips, passengers, canWrite, reload }: { projectId: string; date: string; people: Person[]; rows: Record<string, AttRow>; vehicles: Vehicle[]; trips: Trip[]; passengers: Passenger[]; canWrite: boolean; reload: () => void }) {
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const vName = (id: string) => vehicles.find((v) => v.id === id)?.name ?? "Vehicle";
  const onTrip = useMemo(() => { const m: Record<string, number> = {}; passengers.forEach((p) => (m[p.trip_id] = (m[p.trip_id] || 0) + 1)); return m; }, [passengers]);
  const boarded = (leg: Leg) => new Set(passengers.filter((p) => p.leg === leg).map((p) => p.employee_id)).size;
  const legTrips = (leg: Leg) => trips.filter((t) => t.leg === leg).sort((a, b) => a.started_at.localeCompare(b.started_at));
  const usable = vehicles.some((v) => v.active);

  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 p-4 space-y-3" data-transport>
      <div className="flex items-center gap-2"><Icon name="truck" className="h-4 w-4 text-slate-400" /><h3 className="text-sm font-medium text-slate-900">Transport</h3>
        {canWrite && usable && <div className="ml-auto flex gap-2">{(["pickup", "drop"] as Leg[]).map((leg) => <button key={leg} type="button" onClick={() => setDlg({ mode: "new", leg })} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 touch-manipulation">+ {LEG_LABEL[leg]} trip</button>)}</div>}</div>
      {!usable ? <p className="text-xs text-slate-400">No vehicles set up yet. An Admin adds them under Operations → Transport.</p> :
        <div className="grid gap-3 sm:grid-cols-2">
          {(["pickup", "drop"] as Leg[]).map((leg) => <div key={leg} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs"><span className="uppercase tracking-wide text-slate-400">{LEG_LABEL[leg]}</span><span className="text-slate-500">{boarded(leg)} of {people.length} on board</span></div>
            {legTrips(leg).map((t) => <button key={t.id} type="button" onClick={() => setDlg({ mode: "edit", trip: t })} className="w-full flex items-center gap-2 rounded-xl border border-slate-200 px-3 min-h-11 text-left hover:bg-slate-50 touch-manipulation">
              <span className="text-sm text-slate-800 truncate">{vName(t.vehicle_id)}</span><span className="text-sm tabular-nums text-slate-500">{fmtTime(t.started_at)}</span><span className="ml-auto text-xs text-slate-500 whitespace-nowrap">{onTrip[t.id] || 0} on board</span><Icon name="chevron-right" className="h-4 w-4 text-slate-300" /></button>)}
            {!legTrips(leg).length && <p className="text-xs text-slate-400">No {leg} trip yet</p>}
          </div>)}
        </div>}
      {dlg && <TripDialog dlg={dlg} projectId={projectId} date={date} people={people} rows={rows} vehicles={vehicles} trips={trips} passengers={passengers} canWrite={canWrite} onClose={() => setDlg(null)} onDone={() => { setDlg(null); reload(); }} />}
    </div>
  );
}

function TripDialog({ dlg, projectId, date, people, rows, vehicles, trips, passengers, canWrite, onClose, onDone }: { dlg: Dlg; projectId: string; date: string; people: Person[]; rows: Record<string, AttRow>; vehicles: Vehicle[]; trips: Trip[]; passengers: Passenger[]; canWrite: boolean; onClose: () => void; onDone: () => void }) {
  const editing = dlg.mode === "edit"; const trip = dlg.mode === "edit" ? dlg.trip : null; const leg: Leg = dlg.mode === "edit" ? dlg.trip.leg : dlg.leg;
  const past = date !== istToday();
  const [vehicleId, setVehicleId] = useState(trip?.vehicle_id ?? vehicles.find((v) => v.active)?.id ?? "");
  const [custom, setCustom] = useState(editing || past); const [hhmm, setHhmm] = useState(trip ? fmtTime(trip.started_at) : leg === "pickup" ? "07:00" : "18:00");
  const elsewhere = useMemo(() => { const m: Record<string, string> = {}; passengers.filter((p) => p.leg === leg && p.trip_id !== trip?.id).forEach((p) => { const t = trips.find((x) => x.id === p.trip_id); m[p.employee_id] = vehicles.find((v) => v.id === t?.vehicle_id)?.name ?? "another trip"; }); return m; }, [passengers, trips, vehicles, leg, trip]);
  const initial = useMemo(() => new Set(trip ? passengers.filter((p) => p.trip_id === trip.id).map((p) => p.employee_id) : people.filter((p) => !elsewhere[p.employee_id]).map((p) => p.employee_id)), []);   // a new trip starts with everyone not already on one
  const [sel, setSel] = useState<Set<string>>(new Set(initial)); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", key); document.body.style.overflow = "hidden"; return () => { document.removeEventListener("keydown", key); document.body.style.overflow = ""; }; }, []);
  const free = people.filter((p) => !elsewhere[p.employee_id]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function save() {
    setErr(""); if (!vehicleId) { setErr("Choose the vehicle."); return; } if (custom && !/^\d{2}:\d{2}$/.test(hhmm)) { setErr("Enter the time."); return; }
    setBusy(true); const sb = supabase(); const ids = [...sel];
    if (!trip) {
      const row: Record<string, any> = { project_id: projectId, work_date: date, leg, vehicle_id: vehicleId }; if (custom) row.started_at = istISO(date, hhmm);   // today: the server stamps the time
      const { data: t, error } = await sb.from("transport_trips").insert(row).select().single(); if (error || !t) { setErr(error?.message ?? "Couldn't save the trip."); setBusy(false); return; }
      if (ids.length) { const { error: e2 } = await sb.from("transport_passengers").insert(ids.map((employee_id) => ({ trip_id: t.id, employee_id }))); if (e2) { await sb.from("transport_trips").delete().eq("id", t.id); setErr(e2.message); setBusy(false); return; } }
    } else {
      const patch: Record<string, any> = {}; if (vehicleId !== trip.vehicle_id) patch.vehicle_id = vehicleId; if (hhmm !== fmtTime(trip.started_at)) patch.started_at = istISO(date, hhmm);
      if (Object.keys(patch).length) { const { error } = await sb.from("transport_trips").update(patch).eq("id", trip.id); if (error) { setErr(error.message); setBusy(false); return; } }
      const remove = [...initial].filter((id) => !sel.has(id)), add = ids.filter((id) => !initial.has(id));
      if (remove.length) { const { error } = await sb.from("transport_passengers").delete().eq("trip_id", trip.id).in("employee_id", remove); if (error) { setErr(error.message); setBusy(false); return; } }
      if (add.length) { const { error } = await sb.from("transport_passengers").insert(add.map((employee_id) => ({ trip_id: trip.id, employee_id }))); if (error) { setErr(error.message); setBusy(false); return; } }
    }
    setBusy(false); onDone();
  }
  async function del() {
    if (!trip || !confirm(`Delete this ${leg} trip and its ${initial.size} boardings?`)) return; setBusy(true);
    const { error } = await supabase().from("transport_trips").delete().eq("id", trip.id); setBusy(false); if (error) { setErr(error.message); return; } onDone();
  }
  const stLabel = (p: Person) => { const st = effectiveStatus(p, date, rows[p.employee_id]); return st === "present" ? "Present" : st === "half" ? "Half-day" : st === "absent" ? "Absent" : st === "off" ? "Off" : "Not marked"; };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center print:hidden" role="dialog" aria-modal="true" aria-label={`${LEG_LABEL[leg]} trip`}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[88vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white shadow-xl pb-[env(safe-area-inset-bottom)]">
        <div className="px-4 pt-4 pb-3 border-b border-slate-100 flex items-center gap-2"><h3 className="text-base font-medium">{editing ? "Edit" : "New"} {leg} trip</h3><button type="button" onClick={onClose} aria-label="Close" className="ml-auto h-10 w-10 -mr-2 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><Icon name="x" /></button></div>
        <div className="overflow-y-auto px-4 py-3 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="lbl">Vehicle</label><select className="inp" value={vehicleId} disabled={!canWrite} onChange={(e) => setVehicleId(e.target.value)}>{vehicles.filter((v) => v.active || v.id === vehicleId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <div><label className="lbl">Time</label>{custom ? <input className="inp" type="time" value={hhmm} disabled={!canWrite} onChange={(e) => setHhmm(e.target.value)} /> : <div className="flex items-center gap-2 min-h-10 text-sm text-slate-500">Stamped when you save <button type="button" className="text-blue-700 underline text-xs" onClick={() => setCustom(true)}>set a time</button></div>}</div>
          </div>
          <div><div className="flex items-center gap-2 mb-1"><span className="lbl !mb-0">On board ({sel.size} of {free.length})</span>{canWrite && <span className="ml-auto text-xs"><button type="button" className="text-blue-700" onClick={() => setSel(new Set(free.map((p) => p.employee_id)))}>All</button> · <button type="button" className="text-blue-700" onClick={() => setSel(new Set())}>None</button></span>}</div>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {people.map((p) => { const away = elsewhere[p.employee_id]; return (
                <label key={p.employee_id} className={`flex items-center gap-3 px-3 min-h-11 text-sm ${away ? "opacity-50" : ""}`}>
                  <input type="checkbox" className="h-4 w-4" checked={sel.has(p.employee_id)} disabled={!canWrite || !!away} onChange={() => toggle(p.employee_id)} />
                  <span className="min-w-0 flex-1 truncate">{p.full_name}</span><span className="text-xs text-slate-400 whitespace-nowrap">{away ? `on ${away}` : stLabel(p)}</span></label>); })}
            </div></div>
          {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
        </div>
        <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2">
          {editing && canWrite && <button type="button" className="btn btn-danger" disabled={busy} onClick={del}>Delete trip</button>}
          <button type="button" className="btn ml-auto" onClick={onClose}>Cancel</button>
          {canWrite && <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : editing ? "Save changes" : `Stamp ${leg} · ${sel.size}`}</button>}
        </div>
      </div>
    </div>
  );
}
