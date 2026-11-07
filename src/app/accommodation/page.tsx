"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { monthOf, type Adjustment, type Landlord, type Rent, type Room, type RoomPayment } from "@/lib/accommodation";
import type { Project } from "@/lib/types";
import type { Acc } from "@/components/accommodation/shared";
import Overview from "@/components/accommodation/Overview";
import LandlordsRooms from "@/components/accommodation/LandlordsRooms";
import RentTab from "@/components/accommodation/RentTab";
import PaymentsTab from "@/components/accommodation/PaymentsTab";
import { PageLoader } from "@/components/Loader";

type Tab = "overview" | "landlords" | "rent" | "payments";
const TABS: [Tab, string][] = [["overview", "Overview"], ["landlords", "Landlords & rooms"], ["rent", "Rent"], ["payments", "Payments"]];

// Admin: the rooms rented for a project, who is paid for them, and the rent (paid a full month in advance, unless a month was agreed differently).
// A landlord is entered once, with their bank details, and their rooms sit under them. A rent payment is recorded once, on the Rent tab, for a landlord;
// it posts an Accommodation expense on the project, and voiding it removes that expense.
export default function Accommodation() {
  const today = istToday(); const thisMonth = monthOf(today);
  const [projects, setProjects] = useState<Project[]>([]); const [pid, setPid] = useState("");
  const [allRooms, setRooms] = useState<Room[]>([]); const [allRents, setRents] = useState<Rent[]>([]); const [allPays, setPays] = useState<RoomPayment[]>([]); const [allAdjs, setAdjs] = useState<Adjustment[]>([]); const [landlords, setLandlords] = useState<Landlord[]>([]); const [hasBank, setHasBank] = useState<Record<string, boolean>>({});
  const [people, setPeople] = useState<number | null>(null); const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [tab, setTab] = useState<Tab>("overview"); const [focus, setFocus] = useState<string | undefined>(); const [payLandlord, setPayLandlord] = useState<string | undefined>(); const [histLandlord, setHistLandlord] = useState<string | undefined>();
  const note = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 6000); };

  async function load() {
    const sb = supabase();
    const [pr, r, rt, p, ll, ad, bk] = await Promise.all([sb.from("projects").select("*").eq("status", "active").order("name"), sb.from("accommodation_rooms").select("*").order("sort_order").order("name"), sb.from("accommodation_rents").select("*"), sb.from("accommodation_payments").select("*").order("paid_on", { ascending: false }),
      sb.from("accommodation_landlords").select("*").order("name"), sb.from("accommodation_adjustments").select("*"), sb.from("payee_bank").select("ref_id, account_no, upi").eq("kind", "landlord")]);
    const x = pr.error || r.error || rt.error || p.error || ll.error || ad.error;
    if (x) { setErr(x.message + (/landlord|adjustment|schema cache|does not exist/i.test(x.message) ? " — run the 2026-11-accommodation-landlords.sql migration in Supabase (after 2026-10-accommodation.sql)." : " — has the accommodation SQL migration (2026-10-accommodation.sql) been run?")); setLoading(false); return; }
    const pl = (pr.data || []) as Project[]; setProjects(pl); setPid((c) => c || pl[0]?.id || ""); setRooms((r.data || []) as Room[]);
    setRents(((rt.data || []) as Rent[]).map((q) => ({ ...q, rent: Number(q.rent) }))); setPays(((p.data || []) as RoomPayment[]).map((q) => ({ ...q, amount: Number(q.amount) })));
    setLandlords((ll.data || []) as Landlord[]); setAdjs(((ad.data || []) as Adjustment[]).map((q) => ({ ...q, amount: Number(q.amount) })));
    setHasBank(Object.fromEntries(((bk.data || []) as { ref_id: string; account_no: string; upi: string }[]).map((b) => [b.ref_id, !!(b.account_no || b.upi)]))); setErr(""); setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!pid) return; (async () => { const { data } = await supabase().rpc("attendance_roster", { p_project: pid, p_from: today, p_to: today }); setPeople(Array.isArray(data) ? data.length : null); })(); }, [pid, today]);

  const rooms = useMemo(() => allRooms.filter((r) => r.project_id === pid), [allRooms, pid]); const ids = useMemo(() => new Set(rooms.map((r) => r.id)), [rooms]);
  const acc: Acc = {
    pid, project: projects.find((p) => p.id === pid)?.name ?? "project", today, thisMonth, rooms, landlords, hasBank,
    rents: useMemo(() => allRents.filter((r) => ids.has(r.room_id)), [allRents, ids]), pays: useMemo(() => allPays.filter((x) => ids.has(x.room_id)), [allPays, ids]), adjs: useMemo(() => allAdjs.filter((x) => ids.has(x.room_id)), [allAdjs, ids]),
    reload: load, note, fail: (m) => { setErr(m); setMsg(""); },
    run: async (p, ok) => { setErr(""); const { error } = await p; if (error) { setErr(error.message); return false; } if (ok) note(ok); await load(); return true; },
  };
  const go = (t: "landlords" | "rent" | "payments", landlord?: string) => { setTab(t); setFocus(t === "landlords" ? landlord : undefined); setPayLandlord(t === "rent" ? landlord : undefined); setHistLandlord(t === "payments" ? landlord : undefined); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold sm:mr-auto">Accommodation</h1><a className="text-xs text-blue-700 underline" href="/payments-due">Payments due report →</a>
        {projects.length > 0 && <select className="inp w-full sm:!w-auto max-w-full" aria-label="Project" value={pid} onChange={(e) => setPid(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` — ${p.location}` : ""}</option>)}</select>}</div>
      <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab whitespace-nowrap ${tab === k ? "tab-on" : ""}`} onClick={() => { setTab(k); setFocus(undefined); setPayLandlord(undefined); setHistLandlord(undefined); }}>{l}</button>)}</div>
      {err && <p className="warn" role="alert">{err}</p>}{msg && <p className="text-sm text-green-700" role="status">{msg}</p>}{loading && <PageLoader />}

      {!loading && !err && pid && <>
        {tab === "overview" && <Overview a={acc} people={people} go={go} />}
        {tab === "landlords" && <LandlordsRooms a={acc} focus={focus} />}
        {tab === "rent" && <RentTab a={acc} openFor={payLandlord} />}
        {tab === "payments" && <PaymentsTab key={histLandlord ?? "all"} a={acc} landlord={histLandlord} />}</>}
      {!loading && !err && !pid && <p className="text-slate-500">No active projects.</p>}
    </div>
  );
}
