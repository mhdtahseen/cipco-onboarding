"use client";
import { useEffect, useState } from "react";
import { supabase } from "./supabase/client";

export type Role = "admin" | "staff" | "site_engineer" | "supervisor" | "none";
export const ROLE_LABEL: Record<string, string> = { admin: "Admin", staff: "Staff", site_engineer: "Site Engineer", supervisor: "Supervisor", attendance: "Supervisor", none: "No access" };
// Higher roles overrule lower ones and a lower role cannot change what a higher role set.
export const roleRank = (r: string | null | undefined) => (r === "admin" ? 3 : r === "site_engineer" || r === "staff" ? 2 : r === "supervisor" || r === "attendance" ? 1 : 0);

// The signed-in user's role. If the roles table does not exist yet (migration not run) everyone is treated as admin, so nobody is locked out.
// "attendance" (the old name for Supervisor, before the migration renames it) is treated as Supervisor.
export function useRole(): { role: Role | null; admin: boolean; staff: boolean; rank: number; money: boolean; userId: string } {
  const [role, setRole] = useState<Role | null>(null); const [userId, setUserId] = useState("");
  useEffect(() => { (async () => {
    const sb = supabase(); const { data: u } = await sb.auth.getUser(); if (!u.user) { setRole("none"); return; } setUserId(u.user.id);
    const { data, error } = await sb.from("user_roles").select("role").eq("user_id", u.user.id).maybeSingle();
    const raw = error ? "admin" : ((data?.role as string) ?? "none"); setRole((raw === "attendance" ? "supervisor" : raw) as Role);
  })(); }, []);
  return { role, admin: role === "admin", staff: role === "admin" || role === "staff", rank: roleRank(role), money: role === "admin" || role === "staff", userId };
}
