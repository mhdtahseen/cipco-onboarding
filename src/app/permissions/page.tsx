"use client";
import { useEffect, useMemo, useState } from "react";
import { useRole } from "@/lib/roles";
import { supabase } from "@/lib/supabase/client";
import { resetPerms } from "@/lib/perms";
import { visibleItemsWith } from "@/lib/nav";
import { CONTROLLED_ROLES, DEFAULTS, LEVELS, LEVEL_INFO, MODULES, SECTIONS, levelRank, tabKey, type Level, type Matrix, type Module, type RoleKey } from "@/lib/permissions";

type Val = Level | "inherit";   // a tab can take its module's level
const SHORT: Record<Level, string> = { none: "None", view: "View", create: "Create", edit: "Edit", full: "Full" };

// Admin only: what each role may do in each module and tab. Pick a role, set a level for every module (open a module with tabs to set tabs apart), review the menu that role will see, and save.
// Saving changes the menu, the pages that open, and which add / change / delete controls appear. The sign-in role of a person is set on the Users page.
export default function PermissionsPage() {
  const { admin } = useRole(); const [role, setRole] = useState<RoleKey>("staff");
  const [saved, setSaved] = useState<Record<string, Matrix>>({}); const [draft, setDraft] = useState<Matrix>({}); const [loaded, setLoaded] = useState(false); const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");

  async function load() {
    const { data, error } = await supabase().from("role_permissions").select("role, module, level");
    if (error) { setMissing(true); setSaved({}); setLoaded(true); return; }
    const by: Record<string, Matrix> = {}; ((data || []) as { role: string; module: string; level: Level }[]).forEach((r) => { (by[r.role] ??= {})[r.module] = r.level; });
    setMissing(false); setSaved(by); setLoaded(true);
  }
  useEffect(() => { if (admin) load(); }, [admin]);
  // what is in force for a role: its saved rows, or the built-in defaults when nothing is saved for it yet
  const inForce = (r: RoleKey): Matrix => (saved[r] && Object.keys(saved[r]).length ? saved[r] : { ...(DEFAULTS[r] as Matrix) });
  useEffect(() => { if (loaded) setDraft({ ...inForce(role) }); }, [loaded, role, saved]);   // eslint-disable-line react-hooks/exhaustive-deps

  const base = inForce(role);
  const keys = useMemo(() => { const k = new Set([...Object.keys(base), ...Object.keys(draft)]); return [...k]; }, [base, draft]);
  const changes = keys.filter((k) => (draft[k] ?? (k.includes(".") ? "inherit" : "none")) !== (base[k] ?? (k.includes(".") ? "inherit" : "none")));
  const dirty = changes.length > 0;
  const get = (key: string): Val => draft[key] ?? (key.includes(".") ? "inherit" : "none");
  const put = (key: string, v: Val) => setDraft((d) => { const n = { ...d }; if (v === "inherit") delete n[key]; else n[key] = v; return n; });
  const isViewer = role === "viewer";
  const menu = visibleItemsWith(role, draft);
  const switchRole = (r: RoleKey) => { if (dirty && !confirm("Discard the changes you have not saved?")) return; setRole(r); setMsg(""); setErr(""); };

  async function save() {
    setBusy(true); setMsg(""); setErr("");
    // every key is sent, so a role that had nothing saved gets all of its defaults written explicitly (a role with no rows at all means "never configured")
    const rows = [...MODULES.flatMap((m) => [m.key, ...(m.tabs ?? []).map((t) => tabKey(m.key, t.key))])].map((k) => ({ module: k, level: draft[k] ?? (k.includes(".") ? "inherit" : "none") }));
    const { error } = await supabase().rpc("admin_set_role_permissions", { p_role: role, p_rows: rows });
    setBusy(false); if (error) { setErr(error.message); return; }
    resetPerms(); setMsg(`Saved ${CONTROLLED_ROLES.find((r) => r.key === role)!.label}. Changes reach their open pages within a minute.`); await load();
  }
  const resetDefaults = () => { setDraft({ ...(DEFAULTS[role] as Matrix) }); setMsg(""); };

  const seg = (key: string, label: string, tab: boolean) => {
    const v = get(key); const levels = isViewer ? (["none", "view"] as Level[]) : [...LEVELS];
    return (
      <div role="radiogroup" aria-label={`${label} level`} className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs shrink-0 max-w-full overflow-x-auto">
        {tab && <button type="button" role="radio" aria-checked={v === "inherit"} disabled={missing} onClick={() => put(key, "inherit")} className={`px-2.5 min-h-8 rounded-md ${v === "inherit" ? "bg-slate-200 font-semibold text-slate-800" : "text-slate-500"}`} title="Takes the module's level">Same</button>}
        {levels.map((l) => <button key={l} type="button" role="radio" aria-checked={v === l} disabled={missing} title={`${LEVEL_INFO[l].label}: ${LEVEL_INFO[l].help}`} onClick={() => put(key, l)}
          className={`px-2.5 min-h-8 rounded-md ${v === l ? (l === "none" ? "bg-slate-200 text-slate-800" : l === "view" ? "bg-sky-100 text-sky-900" : l === "full" ? "bg-emerald-100 text-emerald-900" : "bg-blue-100 text-blue-900") + " font-semibold" : "text-slate-500 hover:bg-slate-50"}`}>{SHORT[l]}</button>)}
      </div>);
  };
  const row = (m: Module) => {
    const lv = (get(m.key) === "inherit" ? "none" : get(m.key)) as Level; const isOpen = open.has(m.key); const tabs = m.tabs ?? [];
    const tabNote = tabs.length ? tabs.filter((t) => get(tabKey(m.key, t.key)) !== "inherit" && get(tabKey(m.key, t.key)) !== lv).length : 0;
    return (
      <div key={m.key} className="border-t border-slate-100 first:border-t-0 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-1 basis-40"><div className="text-sm font-medium">{m.label}{tabs.length > 0 && <button type="button" onClick={() => setOpen((s) => { const n = new Set(s); n.has(m.key) ? n.delete(m.key) : n.add(m.key); return n; })} aria-expanded={isOpen} className="ml-2 text-xs font-normal text-blue-700 underline">{isOpen ? "Hide" : "Set"} tabs{tabNote ? ` (${tabNote} differ)` : ""}</button>}</div>
            {m.note && <div className="text-xs text-slate-400">{m.note}</div>}</div>
          {seg(m.key, m.label, false)}
        </div>
        {isOpen && tabs.length > 0 && <div className="mt-2 ml-3 pl-3 border-l-2 border-slate-100 space-y-1.5">{tabs.map((t) => (
          <div key={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-1"><div className="flex-1 basis-32 text-sm text-slate-600">{t.label}</div>{seg(tabKey(m.key, t.key), `${m.label} ${t.label}`, true)}</div>))}</div>}
      </div>);
  };

  if (!admin) return <p className="text-slate-500">Only admins can manage permissions.</p>;
  const info = CONTROLLED_ROLES.find((r) => r.key === role)!;
  return (
    <div className="space-y-4 pb-24">
      <div><h1 className="text-xl font-semibold">Permissions</h1>
        <p className="text-sm text-slate-500">Choose what each role can do in every module and tab. Admin always has full access and cannot be changed. Which role a person has is set on the <a className="text-blue-700 underline" href="/users">Users</a> page.</p></div>

      {missing && <div role="alert" className="card !p-3 border-amber-200 bg-amber-50 text-sm text-amber-900">The permissions table is not in the database yet, so the built-in defaults are in force and cannot be changed here. Run <b>supabase/migrations/2026-11-role-permissions.sql</b> in Supabase, then reload this page.</div>}
      {loaded && !missing && !saved[role] && <div className="card !p-3 border-sky-200 bg-sky-50 text-sm text-sky-900">Nothing has been saved for {info.label} yet, so the built-in defaults are in force. Saving writes them all down.</div>}

      <div role="tablist" aria-label="Role" className="flex flex-wrap gap-2">{CONTROLLED_ROLES.map((r) => <button key={r.key} role="tab" aria-selected={role === r.key} onClick={() => switchRole(r.key)} className={`chip ${role === r.key ? "chip-on" : ""}`}>{r.label}</button>)}
        <span className="chip opacity-60 cursor-default" title="Admin always has full access">Admin · Full, fixed</span></div>
      <p className="text-sm text-slate-500">{info.blurb}{isViewer ? " Viewers can only be set to None or View." : ""}</p>

      <div className="grid gap-2 sm:grid-cols-5 text-xs">{LEVELS.map((l) => <div key={l} className="rounded-lg border border-slate-200 bg-white p-2"><div className="font-semibold text-slate-700">{LEVEL_INFO[l].label}</div><div className="text-slate-500">{LEVEL_INFO[l].help}</div></div>)}</div>

      {!loaded ? <div className="h-40 rounded-xl bg-slate-100 animate-pulse" /> : <div className="grid gap-4 lg:grid-cols-[1fr_16rem] items-start">
        <div className="space-y-3">{SECTIONS.map((s) => { const list = MODULES.filter((m) => m.section === s); return list.length ? <section key={s} className="card !p-3"><h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{s}</h2>{list.map(row)}</section> : null; })}
          <section className="card !p-3"><h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Always Admin only</h2><p className="text-sm text-slate-500">Users, Permissions, approving or reopening a payroll run, the bank transfer letter, and authorizing a bill for the JSL portal. These cannot be handed to another role.</p></section></div>
        <aside className="card !p-3 lg:sticky lg:top-20"><h2 className="text-sm font-semibold">Menu for {info.label}</h2><p className="text-xs text-slate-400 mb-2">What they will see, with the choices on this page.</p>
          {menu.length ? <ul className="space-y-1 text-sm">{menu.map((i) => { const lv = i.module ? (levelRank((draft[i.module] as Level) ?? "none") > 0 ? (draft[i.module] as Level) : "tabs") : "view"; return <li key={i.href} className="flex items-center justify-between gap-2"><span>{i.label}</span><span className="text-[11px] text-slate-400">{lv === "tabs" ? "some tabs" : SHORT[lv as Level]}</span></li>; })}</ul> : <p className="text-sm text-slate-500">Nothing: this role could sign in but would see no pages.</p>}</aside>
      </div>}

      <div className="fixed inset-x-0 bottom-[var(--bottom-nav-h,0px)] z-30 border-t border-slate-200 bg-white/95 backdrop-blur px-4 py-3 md:pl-[calc(4rem+1rem)] xl:pl-[calc(16rem+1rem)] print:hidden">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-600" role="status">{err ? <span className="text-rose-700">{err}</span> : msg ? <span className="text-emerald-700">{msg}</span> : dirty ? `${changes.length} unsaved change${changes.length === 1 ? "" : "s"} for ${info.label}` : "No unsaved changes"}</span>
          <span className="flex-1" />
          <button className="btn" onClick={resetDefaults} disabled={missing || busy}>Reset to defaults</button>
          <button className="btn" onClick={() => setDraft({ ...base })} disabled={!dirty || busy}>Discard</button>
          <button className="btn btn-primary" onClick={save} disabled={missing || busy || (!dirty && !!saved[role])}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}
