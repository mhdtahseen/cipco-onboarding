"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRole, ROLE_LABEL } from "@/lib/roles";
import { STATUS_LABEL, daysWorked, istToday, type AttRow, type Status } from "@/lib/attendance";
import type { Employee } from "@/lib/types";

const inr = (n: number | null | undefined) => (n || n === 0 ? n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }) : "—");
const fmt = (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const monthEnd = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };

/** Pay and attendance for one onboarded person: this is a read-only summary; the sheets and payroll runs stay on their own pages. */
export function PayTab({ emp }: { emp: Employee }) {
  const { admin } = useRole(); const [ym, setYm] = useState(istToday().slice(0, 7));
  const [att, setAtt] = useState<AttRow[] | null>(null); const [hist, setHist] = useState<{ id: string; effective_from: string; monthly_ctc: number | null; note: string }[] | null>(null);
  useEffect(() => { (async () => {
    const sb = supabase(); setAtt(null);
    const { data } = await sb.from("attendance").select("work_date,status,project_id,employee_id").eq("employee_id", emp.id).gte("work_date", `${ym}-01`).lte("work_date", monthEnd(ym));
    setAtt((data || []) as AttRow[]);
  })(); }, [emp.id, ym]);
  useEffect(() => { (async () => {
    const { data, error } = await supabase().from("salary_history").select("id,effective_from,monthly_ctc,note").eq("employee_id", emp.id).order("effective_from", { ascending: false });
    setHist(error ? [] : (data || []) as any);   // empty until the payroll migration has been run
  })(); }, [emp.id]);
  const count = (s: Status) => (att || []).filter((r) => r.status === s).length;
  return (
    <div className="space-y-4">
      <div className="card grid gap-3 sm:grid-cols-3">
        <div><div className="lbl">Monthly CTC</div><div className="text-lg font-semibold">{inr(emp.monthly_ctc)}</div></div>
        <div><div className="lbl">Paid by</div><div className="font-medium capitalize">{emp.pay_mode || "bank"}{emp.pay_mode === "upi" && emp.upi_id ? ` · ${emp.upi_id}` : ""}</div></div>
        <div><div className="lbl">Left on</div><div className="font-medium">{emp.left_on ? fmt(emp.left_on) : "Still working"}</div></div>
      </div>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold mr-auto">Attendance</h3><input type="month" className="inp !w-auto" aria-label="Month" value={ym} max={istToday().slice(0, 7)} onChange={(e) => e.target.value && setYm(e.target.value)} /></div>
        {!att ? <div className="skeleton h-12 w-full" /> : <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
          <div className="rounded-xl bg-emerald-50 py-2"><div className="text-xl font-semibold text-emerald-800">{daysWorked(att)}</div><div className="text-xs text-slate-600">Days worked</div></div>
          {(["present", "half", "absent", "off"] as Status[]).map((s) => <div key={s} className="rounded-xl bg-slate-50 py-2"><div className="text-xl font-semibold">{count(s)}</div><div className="text-xs text-slate-600">{STATUS_LABEL[s]}</div></div>)}
        </div>}
        <div className="flex flex-wrap gap-2"><Link className="btn btn-sm" href="/attendance">Open attendance</Link>{admin && <Link className="btn btn-sm" href="/payroll">Open payroll</Link>}</div>
      </div>
      {hist && hist.length > 0 && <div className="card"><h3 className="font-semibold mb-2">Salary revisions</h3>
        <ul className="divide-y divide-slate-100 text-sm">{hist.map((h) => <li key={h.id} className="py-2 flex flex-wrap gap-x-4"><span className="w-28 text-slate-600">{fmt(h.effective_from)}</span><span className="font-medium">{inr(h.monthly_ctc)}</span><span className="text-slate-500">{h.note}</span></li>)}</ul></div>}
    </div>
  );
}

type Log = { id: number; at: string; user_name: string | null; user_role: string | null; work_date: string | null; field: string; old_value: string | null; new_value: string | null; action: string };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

/** Who changed this person's attendance, and when (read from the attendance change log). */
export function ActivityTab({ emp }: { emp: Employee }) {
  const [rows, setRows] = useState<Log[] | null>(null); const [err, setErr] = useState("");
  useEffect(() => { (async () => {
    const { data, error } = await supabase().from("attendance_log").select("id,at,user_name,user_role,work_date,field,old_value,new_value,action").eq("employee_id", emp.id).order("at", { ascending: false }).limit(60);
    if (error) setErr(error.message); setRows((data || []) as Log[]);
  })(); }, [emp.id]);
  if (err) return <p className="warn">{err}</p>;
  if (!rows) return <div className="skeleton h-24 w-full" />;
  if (!rows.length) return <p className="card text-center text-sm text-slate-500">No attendance changes recorded for {emp.full_name} yet.</p>;
  return (
    <ul className="rounded-2xl bg-white border border-slate-200/80 divide-y divide-slate-100">
      {rows.map((r) => <li key={r.id} className="px-4 py-2.5 text-sm text-slate-600 flex flex-wrap gap-x-2">
        <span className="text-xs text-slate-500 tabular-nums w-28 shrink-0">{when(r.at)}</span>
        <span className="min-w-0 flex-1"><b className="font-medium text-slate-900">{r.user_name || "Someone"}</b> <span className="text-xs text-slate-500">({ROLE_LABEL[r.user_role ?? ""] ?? r.user_role})</span> {r.action === "delete" ? <>removed {r.field} (was {r.old_value || "—"})</> : r.action === "create" ? <>{r.field}: {r.new_value || "—"}</> : <>{r.field}: {r.old_value || "—"} → {r.new_value || "—"}</>}{r.work_date && <span className="text-xs text-slate-500"> · for {r.work_date}</span>}</span>
      </li>)}
    </ul>
  );
}
