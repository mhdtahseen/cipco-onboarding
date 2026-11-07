"use client";
import { useEffect, useState } from "react";
import { supabase, setWriteLevel } from "./supabase/client";
import { useRole } from "./roles";
import { canDo, levelIn, levelRank, normRole, openLevel, type Action, type Level, type Matrix } from "./permissions";

// The permission matrix for the signed-in role, fetched once per tab and shared (like me.ts). null = the table does not exist yet or holds nothing for this role: the built-in defaults apply.
let cache: { role: string; promise: Promise<Matrix | null> } | null = null; let known: { role: string; m: Matrix | null } | null = null; const listeners = new Set<() => void>();
async function fetchMatrix(role: string): Promise<Matrix | null> {
  const { data, error } = await supabase().from("role_permissions").select("module, level").eq("role", role);
  const rows = (data ?? []) as { module: string; level: Level }[];
  return error || !rows.length ? null : Object.fromEntries(rows.map((r) => [r.module, r.level]));
}
export function loadMatrix(role: string): Promise<Matrix | null> {
  const r = normRole(role);
  if (r === "admin" || r === "none") return Promise.resolve(null);
  if (cache?.role !== r) { const p = fetchMatrix(r).then((m) => { known = { role: r, m }; listeners.forEach((f) => f()); return m; }, () => null); cache = { role: r, promise: p }; }
  return cache.promise;
}
/** Forget the cached matrix (after an Admin saves changes, or someone signs out) so the next read fetches it again. */
export const resetPerms = () => { cache = null; known = null; listeners.forEach((f) => f()); };

// ---- what the shell and the tabbed screens enforce on the page being looked at ----
let shellLevel: Level = "full"; let override: Level | null = null;
function apply() {
  const l = override ?? shellLevel, r = levelRank(l);
  setWriteLevel(r >= 4 ? "full" : r === 3 ? "edit" : r === 2 ? "create" : "view");
  const el = document.documentElement; el.toggleAttribute("data-readonly", r < 2); el.toggleAttribute("data-noedit", r < 3); el.toggleAttribute("data-nodelete", r < 4);   // globals.css hides the save and delete controls
}
export const setShellLevel = (l: Level) => { shellLevel = l; apply(); };
export const clearPerms = () => { shellLevel = "full"; override = null; setWriteLevel("full"); document.documentElement.removeAttribute("data-readonly"); document.documentElement.removeAttribute("data-nodelete"); document.documentElement.removeAttribute("data-noedit"); };

/** The signed-in person's rights. level(module, tab?) and can(module, action, tab?) answer for any module; ready is false until the matrix has been read (the built-in defaults answer meanwhile). */
export function usePerms() {
  const { role } = useRole(); const r = normRole(role); const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); if (role) loadMatrix(role); return () => { listeners.delete(f); }; }, [role]);
  const m = known?.role === r ? known.m : null; const ready = r === "admin" || r === "none" || known?.role === r;
  return {
    role, matrix: m, ready,
    level: (module: string, tab?: string): Level => levelIn(role, m, module, tab),
    open: (module: string): Level => openLevel(role, m, module),
    can: (module: string, action: Action, tab?: string) => canDo(levelIn(role, m, module, tab), action),
  };
}

/** A screen with tabs calls this with the tab on show: the save and delete controls and the write guard follow that tab's level, not the whole module's. */
export function useTabLevel(module: string, tab: string): Level {
  const p = usePerms(); const l = p.level(module, tab);
  useEffect(() => { override = l; apply(); return () => { override = null; apply(); }; }, [l]);
  return l;
}

/** For a screen with tabs: the tabs this person may open (a tab set to No access disappears), the tab to show, and the write guard narrowed to it. If the tab on show is not allowed the first allowed one opens. */
export function useAllowedTabs<T extends string>(module: string, all: readonly (readonly [T, string])[], tab: T, setTab: (t: T) => void) {
  const p = usePerms(); const allowed = all.filter(([k]) => levelRank(p.level(module, k)) > 0);
  const ok = allowed.some(([k]) => k === tab);
  useEffect(() => { if (p.role && !ok && allowed[0]) setTab(allowed[0][0]); });   // eslint-disable-line react-hooks/exhaustive-deps
  const level = useTabLevel(module, ok ? tab : (allowed[0]?.[0] ?? tab));
  return { tabs: allowed, level, can: (a: Action) => canDo(level, a) };
}
