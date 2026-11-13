"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// The State → District → Police station lists (2026-11-police-stations.sql, loaded from the Passport Seva list). Used by the employee form and the
// candidate self-fill link: the address State and District are picked from these lists, and the police station of the permanent address is then
// offered from the stations of that district. Each list is fetched once per page and remembered. Until the migration and its seed have been run
// the lists come back empty (ready = false) and the forms keep their plain text boxes.
const cache = new Map<string, Promise<string[]>>();
const fetchList = (key: string, run: () => PromiseLike<{ data: unknown; error: unknown }>) => {
  if (!cache.has(key)) cache.set(key, Promise.resolve(run()).then(({ data, error }) => (error || !Array.isArray(data) ? [] : (data as unknown[]).map(String))).catch(() => []));
  return cache.get(key)!;
};
/** The list entry that matches a typed value, ignoring case and spacing ("maharashtra" → "Maharashtra"); "" when none does. */
export const matchIn = (list: string[], v: string | null | undefined) => { const k = String(v ?? "").trim().toLowerCase().replace(/\s+/g, " "); return k ? list.find((x) => x.toLowerCase() === k) ?? "" : ""; };

export function usePoliceLists(state: string | null | undefined, district: string | null | undefined) {
  const [states, setStates] = useState<string[]>([]); const [districts, setDistricts] = useState<string[]>([]); const [stations, setStations] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => { let live = true; fetchList("s", () => supabase().rpc("ps_states")).then((l) => { if (live) { setStates(l); setReady(l.length > 0); } }); return () => { live = false; }; }, []);
  const st = matchIn(states, state);
  useEffect(() => { let live = true; if (!st) { setDistricts([]); return; } fetchList(`d|${st}`, () => supabase().rpc("ps_districts", { p_state: st })).then((l) => { if (live) setDistricts(l); }); return () => { live = false; }; }, [st]);
  const di = matchIn(districts, district);
  useEffect(() => { let live = true; if (!st || !di) { setStations([]); return; } fetchList(`p|${st}|${di}`, () => supabase().rpc("ps_stations", { p_state: st, p_district: di })).then((l) => { if (live) setStations(l); }); return () => { live = false; }; }, [st, di]);
  return { ready, states, districts, stations, state: st, district: di };
}
