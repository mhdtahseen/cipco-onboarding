"use client";
import { useCallback, useEffect, useState } from "react";
import { useRole } from "@/lib/roles";
import type { Dash } from "@/lib/dashboardData";
import DashboardView from "@/components/dashboard/DashboardView";
import { PageLoader } from "@/components/Loader";

// Dashboard (the plain address, Admin only; everyone else is sent to their landing page by the route guard). One call (/api/dashboard) brings everything;
// the screen itself is components/dashboard/DashboardView.tsx.
export default function Dashboard() {
  const { role } = useRole(); const admin = role === "admin";
  const [d, setD] = useState<Dash | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); const r = await fetch("/api/dashboard"); const j = await r.json().catch(() => ({})); setBusy(false);
    if (!r.ok) { setErr(j.error || `Could not load the dashboard (${r.status}).`); return; } setErr(""); setD(j);
  }, []);
  useEffect(() => { if (admin) void load(); }, [admin, load]);
  if (!role) return <PageLoader />;
  if (!admin) return <p className="text-slate-500">The dashboard is for Admins.</p>;
  if (err && !d) return <p className="warn">{err}</p>;
  if (!d) return <PageLoader />;
  return <>{err && <p className="warn">{err}</p>}<DashboardView d={d} busy={busy} onRefresh={load} /></>;
}
