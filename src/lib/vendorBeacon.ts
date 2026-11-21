"use client";
import { useEffect, useRef } from "react";
import { quietFix } from "./geo";

// Vendor activity (2026-11-vendor-activity.sql), the vendor page's copy of usageBeacon.ts: while the page is open AND on screen, a "still here" signal every
// minute, at once when it opens or comes back to the front, when the part of the page changes, and one last time when it goes to the background.
// Location (only if the phone allows it; the page asks once, see VendorGeoAsk) when a session starts and every 30 minutes. Nothing is sent in the background.
const EVERY = 60_000, GEO_EVERY = 30 * 60_000, NEW_SESSION = 5 * 60_000;
const tabId = () => { try { let t = sessionStorage.getItem("cipco_vtab"); if (!t) { t = crypto.randomUUID(); sessionStorage.setItem("cipco_vtab", t); } return t; } catch { return "no-storage"; } };

/** Send one signal now, with the location if the phone allows it (used right after the vendor allows location). */
export async function vendorBeat(token: string, session: string, path: string, opts: { geo?: boolean; final?: boolean } = {}) {
  if (!session) return;
  const body: Record<string, unknown> = { token, session, tab: tabId(), path };
  if (opts.geo) { try { const f = await quietFix(); body.geo = f.status; if (f.status === "ok") { body.lat = f.lat; body.lng = f.lng; body.acc = f.acc; } } catch { /* no location is fine */ } }
  const json = JSON.stringify(body);
  if (opts.final && navigator.sendBeacon) { navigator.sendBeacon("/api/vendor/beat", new Blob([json], { type: "application/json" })); return; }
  fetch("/api/vendor/beat", { method: "POST", headers: { "Content-Type": "application/json" }, body: json, keepalive: true }).catch(() => { /* offline: the gap shows */ });
}

/** Signed out / chose a PIN. Awaited before signing out, so the session is still there to check. */
export const vendorEvent = (token: string, session: string, kind: "sign_out" | "pin_set", detail = "") =>
  fetch("/api/vendor/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, session, kind, detail }), keepalive: true }).catch(() => {});

/** on: signed in. session(): the phone's session now. path: the part of the page ("account", "add-trip", "set-pin", "change-pin"). */
export function useVendorBeacon(on: boolean, token: string, session: () => string, path: string) {
  const last = useRef(0), lastGeo = useRef(0), pathRef = useRef(path), sessRef = useRef(session); pathRef.current = path; sessRef.current = session;
  useEffect(() => {
    if (!on) return;
    const send = (final = false) => {
      if (!final && document.visibilityState !== "visible") return;
      const now = Date.now(); const fresh = now - last.current > NEW_SESSION; last.current = now;
      const geo = !final && (fresh || now - lastGeo.current > GEO_EVERY); if (geo) lastGeo.current = now;
      void vendorBeat(token, sessRef.current(), pathRef.current, { geo, final });
    };
    send();
    const t = setInterval(() => send(), EVERY);
    const vis = () => (document.visibilityState === "visible" ? send() : send(true));
    const hide = () => send(true);
    document.addEventListener("visibilitychange", vis); window.addEventListener("pagehide", hide);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); window.removeEventListener("pagehide", hide); };
  }, [on, token]);
  // a change of part: the time so far goes to the part they were on
  useEffect(() => { if (on && last.current) { const n = Date.now(); if (n - last.current > 3000) { last.current = n; void vendorBeat(token, sessRef.current(), path); } } }, [path, on, token]);
}
