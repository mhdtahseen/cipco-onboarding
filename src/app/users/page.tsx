"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { ROLE_LABEL, useRole } from "@/lib/roles";
import { resetMe } from "@/lib/me";
import type { Project } from "@/lib/types";

type U = { user_id: string; email: string; full_name: string; last_sign_in_at: string | null; role: string | null; project_ids: string[] };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "never");
const SITE_ROLES = ["supervisor", "site_engineer"];   // these are tied to particular sites
const norm = (r: string | null) => (r === "attendance" ? "supervisor" : r ?? "none");

// Admin only: who can sign in, what they are called, what they can do. Logins themselves are created in Supabase (Authentication → Add user).
export default function UsersPage() {
  const { admin } = useRole(); const [me, setMe] = useState(""); const [users, setUsers] = useState<U[]>([]); const [projects, setProjects] = useState<Project[]>([]); const [edit, setEdit] = useState<Record<string, { role: string; projects: string[]; name: string }>>({});
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  async function load() {
    const sb = supabase(); const { data: u } = await sb.auth.getUser(); setMe(u.user?.id ?? "");
    const [l, p] = await Promise.all([sb.rpc("admin_list_users"), sb.from("projects").select("*").order("name")]);
    if (l.error) { setErr(l.error.message + " — has the latest attendance SQL migration been run, and are you an Admin?"); return; }
    const list = (l.data || []) as U[]; setUsers(list); setProjects(((p.data || []) as Project[]).filter((x) => x.status === "active"));
    setEdit(Object.fromEntries(list.map((x) => [x.user_id, { role: norm(x.role), projects: x.project_ids || [], name: x.full_name || "" }])));
  }
  useEffect(() => { load(); }, []);
  async function save(u: U) {
    const e = edit[u.user_id]; setBusy(u.user_id); setMsg(""); const sb = supabase();
    const { error: ne } = await sb.from("user_profiles").upsert({ user_id: u.user_id, full_name: e.name.trim(), updated_at: new Date().toISOString() }, { onConflict: "user_id" }); if (ne) { setMsg(ne.message); setBusy(""); return; }
    if (e.role === "none") { await sb.from("user_projects").delete().eq("user_id", u.user_id); const { error } = await sb.from("user_roles").delete().eq("user_id", u.user_id); if (error) { setMsg(error.message); setBusy(""); return; } }
    else {
      const { error } = await sb.from("user_roles").upsert({ user_id: u.user_id, role: e.role }, { onConflict: "user_id" }); if (error) { setMsg(error.message); setBusy(""); return; }
      await sb.from("user_projects").delete().eq("user_id", u.user_id);
      if (SITE_ROLES.includes(e.role) && e.projects.length) { const { error: e2 } = await sb.from("user_projects").insert(e.projects.map((project_id) => ({ user_id: u.user_id, project_id }))); if (e2) { setMsg(e2.message); setBusy(""); return; } }
    }
    resetMe();   // the shell and role checks cache these per tab; a changed name or role must be re-read
    setBusy(""); setMsg(`Saved ${e.name.trim() || u.email} ✓`); load();
  }
  if (!admin) return <p className="text-slate-500">Only admins can manage users.</p>;
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold">Users &amp; roles</h1>
        <p className="text-sm text-slate-500">Create the login in Supabase (Authentication → Add user), then name it and set what it can do here. Everyone needs their own login, because every attendance change is stamped with who made it.</p></div>
      <div className="grid gap-2 sm:grid-cols-3 text-xs text-slate-500">
        <div className="card !p-3"><b className="text-slate-700">Admin</b><br />Everything, every site, the activity trail, transport rates and payments, and changing any day.</div>
        <div className="card !p-3"><b className="text-slate-700">Site Engineer</b><br />Attendance only, for their sites. Can overrule the Supervisor, correct yesterday, and verify the day.</div>
        <div className="card !p-3"><b className="text-slate-700">Supervisor</b><br />Attendance and transport only, for their sites, until 11:00 PM that day. Cannot change what the Site Engineer set.</div>
      </div>
      {err && <p className="warn">{err}</p>}{msg && <p className="text-sm text-green-700">{msg}</p>}
      {users.map((u) => { const e = edit[u.user_id]; if (!e) return null; const mine = u.user_id === me; const legacy = norm(u.role) === "staff";
        const changed = e.role !== norm(u.role) || e.name.trim() !== (u.full_name || "") || JSON.stringify([...e.projects].sort()) !== JSON.stringify([...(u.project_ids || [])].sort()); return (
        <div key={u.user_id} className="card !p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium break-all">{u.email}</span>{mine && <span className="text-xs bg-blue-50 text-blue-800 rounded-full px-2 py-0.5">you</span>}<span className="text-xs text-slate-400 sm:ml-auto">last sign-in {fmt(u.last_sign_in_at)}</span></div>
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] items-end">
            <div><label className="lbl">Name <span className="font-normal text-slate-400">(shown on stamps and in the activity trail)</span></label><input className="inp" value={e.name} placeholder="e.g. Ravi Kumar" onChange={(ev) => setEdit({ ...edit, [u.user_id]: { ...e, name: ev.target.value } })} /></div>
            <div><label className="lbl">Role</label><select className="inp" value={e.role} disabled={mine} title={mine ? "You can't change your own role" : ""} onChange={(ev) => setEdit({ ...edit, [u.user_id]: { ...e, role: ev.target.value } })}>
              {["admin", "site_engineer", "supervisor", "none"].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}{legacy && <option value="staff">Staff (old)</option>}</select></div>
            <button className="btn btn-primary" disabled={!changed || busy === u.user_id} onClick={() => save(u)}>{busy === u.user_id ? "Saving…" : "Save"}</button>
          </div>
          {SITE_ROLES.includes(e.role) && <div className="space-y-1"><div className="lbl">Sites this {ROLE_LABEL[e.role].toLowerCase()} can work on</div><div className="flex flex-wrap gap-x-4 gap-y-1">{projects.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={e.projects.includes(p.id)} onChange={(ev) => setEdit({ ...edit, [u.user_id]: { ...e, projects: ev.target.checked ? [...e.projects, p.id] : e.projects.filter((x) => x !== p.id) } })} />{p.name}</label>)}{!projects.length && <span className="text-sm text-slate-400">No active projects.</span>}</div></div>}
        </div>); })}
    </div>
  );
}
