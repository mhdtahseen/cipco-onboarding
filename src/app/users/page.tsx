"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { ROLE_LABEL, useRole } from "@/lib/roles";
import { resetMe } from "@/lib/me";
import type { Project } from "@/lib/types";
import ActivityTab from "@/components/users/ActivityTab";

type U = { user_id: string; email: string; full_name: string; last_sign_in_at: string | null; role: string | null; project_ids: string[]; push_devices?: number; push_last_at?: string | null; employee_id?: string | null; disabled_at?: string | null; disabled_reason?: string };
type Emp = { id: string; full_name: string; emp_no: string | null; email: string | null; stage: string; left_on: string | null };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "never");
const NEEDS_ALERTS = ["supervisor", "site_engineer", "staff", "attendance"];   // these roles must have reminders on (see NotificationGate)
const SITE_ROLES = ["supervisor", "site_engineer"];   // these are tied to particular sites
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : fmt(iso); };
const norm = (r: string | null) => (r === "attendance" ? "supervisor" : r ?? "none");

// Admin only: who can sign in, what they are called, what they can do. Logins themselves are created in Supabase (Authentication → Add user).
export default function UsersPage() {
  const { admin } = useRole(); const [me, setMe] = useState(""); const [users, setUsers] = useState<U[]>([]); const [projects, setProjects] = useState<Project[]>([]); const [edit, setEdit] = useState<Record<string, { role: string; projects: string[]; name: string; employee: string; practice: boolean }>>({});
  const [practice, setPractice] = useState<Record<string, boolean> | null>(null);   // who is in practice mode; null until 2026-11-practice-mode.sql is run
  const [emps, setEmps] = useState<Emp[]>([]);
  const [tab, setTab] = useState<"users" | "activity">("users"); const [seen, setSeen] = useState<Record<string, string>>({});   // last time each person had the app open (2026-11-usage-activity.sql)
  const [geo, setGeo] = useState<Record<string, { status: string; at: string }>>({}); const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  async function load() {
    const sb = supabase(); const { data: u } = await sb.auth.getUser(); setMe(u.user?.id ?? "");
    const [l, p, em] = await Promise.all([sb.rpc("admin_list_users"), sb.from("projects").select("*").order("name"), sb.from("employees").select("id, full_name, emp_no, email, stage, left_on").eq("outcome", "active").order("full_name")]);
    setEmps((em.data || []) as Emp[]);
    const pr = await sb.from("user_roles").select("user_id, practice"); const pm: Record<string, boolean> | null = pr.error ? null : Object.fromEntries(((pr.data || []) as { user_id: string; practice: boolean }[]).map((x) => [x.user_id, !!x.practice])); setPractice(pm);
    const us = await sb.from("usage_sessions").select("user_id, last_seen_at").order("last_seen_at", { ascending: false }).limit(1000);
    const ls: Record<string, string> = {}; ((us.data || []) as { user_id: string; last_seen_at: string }[]).forEach((r) => { if (!ls[r.user_id]) ls[r.user_id] = r.last_seen_at; }); setSeen(ls);
    if (l.error) { setErr(l.error.message + " — has the latest attendance SQL migration been run, and are you an Admin?"); return; }
    // the phone never reports its location setting by itself: the best evidence is how the latest tagged entry from each person went
    const g = await sb.from("entry_geo").select("user_id, geo_status, created_at").order("created_at", { ascending: false }).limit(2000);
    const last: Record<string, { status: string; at: string }> = {}; ((g.data || []) as { user_id: string; geo_status: string; created_at: string }[]).forEach((r) => { if (!last[r.user_id]) last[r.user_id] = { status: r.geo_status, at: r.created_at }; }); setGeo(last);
    const list = (l.data || []) as U[]; setUsers(list); setProjects(((p.data || []) as Project[]).filter((x) => x.status === "active"));
    setEdit(Object.fromEntries(list.map((x) => [x.user_id, { role: norm(x.role), projects: x.project_ids || [], name: x.full_name || "", employee: x.employee_id || "", practice: !!pm?.[x.user_id] }])));
  }
  useEffect(() => { load(); }, []);
  async function save(u: U) {
    const e = edit[u.user_id]; setBusy(u.user_id); setMsg(""); const sb = supabase();
    const { error: ne } = await sb.from("user_profiles").upsert({ user_id: u.user_id, full_name: e.name.trim(), updated_at: new Date().toISOString() }, { onConflict: "user_id" }); if (ne) { setMsg(ne.message); setBusy(""); return; }
    if (e.employee !== (u.employee_id || "")) { const { error: le } = await sb.rpc("admin_link_login", { p_user: u.user_id, p_employee: e.employee || null }); if (le) { setErr(/admin_link_login|schema cache/.test(le.message) ? "Linking to an employee needs 2026-11-login-disable.sql to be run first." : le.message); setBusy(""); return; } }
    if (e.role === "none") { await sb.from("user_projects").delete().eq("user_id", u.user_id); const { error } = await sb.from("user_roles").delete().eq("user_id", u.user_id); if (error) { setMsg(error.message); setBusy(""); return; } }
    else {
      const { error } = await sb.from("user_roles").upsert({ user_id: u.user_id, role: e.role, ...(practice ? { practice: e.role !== "admin" && e.practice } : {}) }, { onConflict: "user_id" }); if (error) { setMsg(error.message); setBusy(""); return; }
      await sb.from("user_projects").delete().eq("user_id", u.user_id);
      if (SITE_ROLES.includes(e.role) && e.projects.length) { const { error: e2 } = await sb.from("user_projects").insert(e.projects.map((project_id) => ({ user_id: u.user_id, project_id }))); if (e2) { setMsg(e2.message); setBusy(""); return; } }
    }
    resetMe();   // the shell and role checks cache these per tab; a changed name or role must be re-read
    setBusy(""); setMsg(`Saved ${e.name.trim() || u.email} ✓`); load();
  }
  async function signOutUser(u: U) {
    if (!confirm(`Sign ${u.full_name || u.email} out now? They will have to sign in again (and will be asked to turn on reminders).`)) return;
    setBusy(u.user_id); setMsg(""); setErr(""); const { error } = await supabase().rpc("admin_sign_out_user", { p_user: u.user_id }); setBusy("");
    if (error) { setErr(error.message + " — has 2026-10-notification-enforcement.sql been run?"); return; } setMsg(`${u.full_name || u.email} will be signed out at their next tap ✓`);
    fetch("/api/usage/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "signed_out_by_admin", user_id: u.user_id }) }).catch(() => {});
  }
  // turning a login off completely (the password stops working) or back on, through the server, which holds the key Supabase needs for this
  async function setLogin(u: U, action: "disable" | "enable") {
    const who = u.full_name || u.email; let reason = "";
    if (action === "disable") { const r = prompt(`Disable ${who}'s login? Their password will stop working, they are signed out everywhere and their role is removed. Everything they entered stays, with their name.\n\nReason:`, "Left the company"); if (!r?.trim()) return; reason = r.trim(); }
    else if (!confirm(`Enable ${who}'s login again? They can sign in, but have no access until you give them a role here.`)) return;
    setBusy(u.user_id); setMsg(""); setErr("");
    const r = await fetch("/api/users/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: u.user_id, action, reason }) }); const j = await r.json().catch(() => ({}));
    setBusy(""); if (!r.ok) { setErr(j.error || "Could not change the login."); return; } resetMe(); setMsg(action === "disable" ? `${who}'s login is disabled ✓` : `${who}'s login is enabled. Give them a role to let them in ✓`); load();
  }
  const empLabel = (id: string) => { const x = emps.find((m) => m.id === id); return x ? `${x.full_name}${x.emp_no ? ` (${x.emp_no})` : ""}` : "an employee"; };
  // reminders on a phone: shown only where the role is required to have them; "unknown" until the migration adds the count
  const alertBadge = (u: U) => { if (!NEEDS_ALERTS.includes(norm(u.role)) || u.push_devices === undefined) return null; const n = u.push_devices;
    return n > 0 ? <span className="text-xs bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5" title={u.push_last_at ? `Last phone registered ${fmt(u.push_last_at)}` : ""}>Alerts on · {n} {n === 1 ? "phone" : "phones"}</span>
      : <span className="text-xs bg-amber-50 text-amber-800 rounded-full px-2 py-0.5" title="No phone has reminders switched on. Use Sign out now, or ask them to open the app.">Alerts off</span>; };
  const geoBadge = (u: U) => { if (!NEEDS_ALERTS.includes(norm(u.role))) return null; const g = geo[u.user_id];
    if (!g) return <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-2 py-0.5" title="No entry from this person has been tagged yet, so the app cannot tell.">Location unknown</span>;
    const when = `Judged from their last entry, ${fmt(g.at)}`;
    return g.status === "ok" || g.status === "timeout" ? <span className="text-xs bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5" title={when}>Location on</span>
      : <span className="text-xs bg-amber-50 text-amber-800 rounded-full px-2 py-0.5" title={`${when}. ${g.status === "denied" ? "The phone refused location." : "No location was available (not allowed yet, or no signal)."} Use Sign out now, or ask them to allow location.`}>Location off</span>; };
  if (!admin) return <p className="text-slate-500">Only admins can manage users.</p>;
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold">Users &amp; roles</h1>
        <p className="text-sm text-slate-500">Create the login in Supabase (Authentication → Add user), then name it and set what it can do here. Everyone needs their own login, because every attendance change is stamped with who made it.</p></div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5 text-xs text-slate-500">
        <div className="card !p-3"><b className="text-slate-700">Viewer</b><br />Looks at everything for overview and monitoring: every page, every figure, bank details and documents. Cannot change, approve, send or delete anything. Starts on Sites today.</div>
        <div className="card !p-3"><b className="text-slate-700">Operations</b><br />Every site and the money side (rates, bills, approvals) of operations modules such as Gas. Not payroll, users or bank details.</div>
        <div className="card !p-3"><b className="text-slate-700">Admin</b><br />Everything, every site, the activity trail, transport rates and payments, and changing any day.</div>
        <div className="card !p-3"><b className="text-slate-700">Site Engineer</b><br />Attendance only, for their sites. Can overrule the Supervisor, correct yesterday, and verify the day.</div>
        <div className="card !p-3"><b className="text-slate-700">Supervisor</b><br />Attendance and transport only, for their sites, until 11:00 PM that day. Cannot change what the Site Engineer set.</div>
      </div>
      <div role="tablist" className="flex border-b border-slate-200">{([["users", "Users & roles"], ["activity", "Activity"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "tab-on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "activity" && <ActivityTab people={users} />}
      {tab === "users" && err && <p className="warn">{err}</p>}{tab === "users" && msg && <p className="text-sm text-green-700">{msg}</p>}
      {tab === "users" && users.map((u) => { const e = edit[u.user_id]; if (!e) return null; const mine = u.user_id === me;
        const suggest = !e.employee && !u.employee_id ? emps.find((m) => m.email && m.email.trim().toLowerCase() === u.email.toLowerCase() && !users.some((x) => x.employee_id === m.id)) : undefined;
        const changed = e.practice !== !!practice?.[u.user_id] || e.employee !== (u.employee_id || "") || e.role !== norm(u.role) || e.name.trim() !== (u.full_name || "") || JSON.stringify([...e.projects].sort()) !== JSON.stringify([...(u.project_ids || [])].sort()); return (
        <div key={u.user_id} className="card !p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium break-all">{u.email}</span>{mine && <span className="text-xs bg-blue-50 text-blue-800 rounded-full px-2 py-0.5">you</span>}{practice?.[u.user_id] && <span className="text-xs bg-amber-100 text-amber-900 rounded-full px-2 py-0.5" title="Nothing they change is saved">Practice mode</span>}{alertBadge(u)}{geoBadge(u)}<span className="text-xs text-slate-400 sm:ml-auto" title={`Last signed in ${fmt(u.last_sign_in_at)}`}>{seen[u.user_id] ? `last active ${ago(seen[u.user_id])}` : `last sign-in ${fmt(u.last_sign_in_at)}`}</span>{u.disabled_at && <span className="text-xs bg-rose-50 text-rose-700 rounded-full px-2 py-0.5" title={u.disabled_reason || ""}>Login disabled · {fmt(u.disabled_at)}</span>}
            {!mine && !u.disabled_at && <button className="btn !py-1 !text-xs" disabled={busy === u.user_id} onClick={() => signOutUser(u)}>Sign out now</button>}
            {!mine && (u.disabled_at ? <button className="btn !py-1 !text-xs" disabled={busy === u.user_id} onClick={() => setLogin(u, "enable")}>Enable login</button> : <button className="btn btn-danger !py-1 !text-xs" disabled={busy === u.user_id} onClick={() => setLogin(u, "disable")}>Disable login</button>)}</div>
          {u.disabled_at && u.disabled_reason && <p className="text-xs text-rose-700">Disabled: {u.disabled_reason}</p>}
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] items-end">
            <div><label className="lbl">Name <span className="font-normal text-slate-400">(shown on stamps and in the activity trail)</span></label><input className="inp" value={e.name} placeholder="e.g. Ravi Kumar" onChange={(ev) => setEdit({ ...edit, [u.user_id]: { ...e, name: ev.target.value } })} /></div>
            <div><label className="lbl">Role</label><select className="inp" value={e.role} disabled={mine} title={mine ? "You can't change your own role" : ""} onChange={(ev) => setEdit({ ...edit, [u.user_id]: { ...e, role: ev.target.value } })}>
              {["admin", "staff", "viewer", "site_engineer", "supervisor", "none"].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
            <button className="btn btn-primary" disabled={!changed || busy === u.user_id} onClick={() => save(u)}>{busy === u.user_id ? "Saving…" : "Save"}</button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-xs text-slate-500">Employee <span className="text-slate-400">(when they leave, this login is disabled automatically after their last working day)</span>
              <select className="inp mt-1 !w-auto min-w-64" value={e.employee} onChange={(ev) => setEdit({ ...edit, [u.user_id]: { ...e, employee: ev.target.value } })}><option value="">Not linked</option>
                {emps.filter((m) => m.id === e.employee || !users.some((x) => x.user_id !== u.user_id && x.employee_id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.emp_no ? ` (${m.emp_no})` : ""}{m.left_on ? ` · left ${fmt(m.left_on)}` : ""}</option>)}</select></label>
            {suggest && <button type="button" className="tlink text-xs mb-2" onClick={() => setEdit({ ...edit, [u.user_id]: { ...e, employee: suggest.id } })}>Suggested: {empLabel(suggest.id)} (same email) · link</button>}
          </div>
          {practice && !mine && e.role !== "admin" && e.role !== "none" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={e.practice} onChange={(ev) => setEdit({ ...edit, [u.user_id]: { ...e, practice: ev.target.checked } })} /><span><b>Practice mode</b> <span className="text-slate-500">They use the app as a {ROLE_LABEL[e.role]} with the real data, but nothing they change is saved, sent or uploaded. A refresh resets it. Untick when they start for real (it applies from their next sign-in or refresh).</span></span></label>}
          {SITE_ROLES.includes(e.role) && <div className="space-y-1"><div className="lbl">Sites this {ROLE_LABEL[e.role].toLowerCase()} can work on</div><div className="flex flex-wrap gap-x-4 gap-y-1">{projects.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={e.projects.includes(p.id)} onChange={(ev) => setEdit({ ...edit, [u.user_id]: { ...e, projects: ev.target.checked ? [...e.projects, p.id] : e.projects.filter((x) => x !== p.id) } })} />{p.name}</label>)}{!projects.length && <span className="text-sm text-slate-400">No active projects.</span>}</div></div>}
        </div>); })}
    </div>
  );
}
