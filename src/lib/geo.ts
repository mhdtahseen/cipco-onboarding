"use client";
import { supabase } from "./supabase/client";

// Quietly attaches the phone's location to what a Supervisor or Site Engineer enters, for the Admin's reference. Nothing here (or anywhere in the app) shows it.
//  - it never slows or blocks an entry: the entry is saved first and the location is sent afterwards, in the background
//  - it never asks the phone's permission question in the middle of an entry (that is asked once, after sign-in); no permission just means "no location" is recorded
//  - a recent fix (under 90 seconds old) is reused, so tapping through thirty people does not start the GPS thirty times
export type GeoStatus = "ok" | "denied" | "unavailable" | "timeout" | "unsupported";
type Fix = { lat: number | null; lng: number | null; acc: number | null; status: GeoStatus; at: string };
export type GeoAction = "attendance" | "meal" | "bulk" | "transport" | "submit" | "verify" | "reopen";

/** Who is tagged: Supervisor, Site Engineer and Staff. The Admin's own entries are not. */
const TAGGED = ["supervisor", "site_engineer", "staff", "attendance"];
export const isTagged = (role: string | null | undefined) => !!role && TAGGED.includes(role);

export const geoSupported = () => typeof navigator !== "undefined" && "geolocation" in navigator;
export async function geoPermission(): Promise<"granted" | "denied" | "prompt" | "unsupported"> {
  if (!geoSupported()) return "unsupported";
  try { const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName }); return p ? (p.state as "granted" | "denied" | "prompt") : "prompt"; } catch { return "prompt"; }
}

// Some phone browsers (seen on a Realme 12x with its built-in browser) answer "denied" when asked about the permission although reading the location works.
// So "denied" is checked once by actually reading the location: a phone that really blocks it fails at once, without any question on screen, and a phone where it
// works is treated as allowed. A success is remembered for 10 minutes so the gate and the entries do not start the GPS again and again.
let verifiedAt = 0;
const VERIFIED_MS = 10 * 60_000;
const probe = (): Promise<boolean> => new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve(true), () => resolve(false), { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 }));
/** The permission as it really is: like geoPermission(), but a "denied" that turns out to work counts as granted. */
export async function geoAllowed(): Promise<"granted" | "denied" | "prompt" | "unsupported"> {
  const p = await geoPermission(); if (p !== "denied") return p;
  if (Date.now() - verifiedAt < VERIFIED_MS) return "granted";
  if (await probe()) { verifiedAt = Date.now(); return "granted"; }
  return "denied";
}

const none = (status: GeoStatus): Fix => ({ lat: null, lng: null, acc: null, status, at: new Date().toISOString() });
let cache: { fix: Fix; at: number } | null = null; let inflight: Promise<Fix> | null = null;
const read = (): Promise<Fix> => new Promise((resolve) => navigator.geolocation.getCurrentPosition(
  (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, status: "ok", at: new Date(pos.timestamp).toISOString() }),
  (err) => resolve(none(err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable")),
  { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 }));

async function currentFix(): Promise<Fix> {
  if (!geoSupported()) return none("unsupported");
  const perm = await geoAllowed();
  if (perm === "denied") return none("denied");
  if (perm === "prompt") return none("unavailable");   // not asked yet: an entry never brings up the phone's question
  if (cache && cache.fix.status === "ok" && Date.now() - cache.at < 90_000) return cache.fix;
  inflight ||= read().finally(() => { inflight = null; });
  const fix = await inflight; cache = { fix, at: Date.now() }; return fix;
}

/** Call after an entry has been saved. Fire and forget. */
export function trackEntry(role: string | null | undefined, projectId: string, date: string, action: GeoAction, subject?: string | null) {
  if (!isTagged(role)) return;
  void (async () => {
    try {
      const f = await currentFix();
      await supabase().rpc("record_geo", { p_project: projectId, p_date: date, p_action: action, p_subject: subject ?? null, p_lat: f.lat, p_lng: f.lng, p_accuracy: f.acc, p_status: f.status, p_fix_at: f.at });
    } catch { /* an entry never fails because of this */ }
  })();
}

/** Brings up the phone's location question (used once, from the sign-in prompt). */
export const askLocation = (): Promise<void> => new Promise((resolve) => { if (!geoSupported()) return resolve(); navigator.geolocation.getCurrentPosition(() => resolve(), () => resolve(), { timeout: 10000 }); });

/** The current location if the phone already allows it (never asks): for the app activity log (src/lib/usageBeacon.ts). */
export const quietFix = () => currentFix();
