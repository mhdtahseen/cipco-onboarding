"use client";
import { useEffect, useRef } from "react";
import { quietFix } from "./geo";

// App activity (2026-11-usage-activity.sql): while the app is open AND on screen, a small "still here" signal goes to the server every minute, at once when it
// is opened or comes back to the front, on every page change, and one last time when it goes to the background. A gap of over 5 minutes starts a new
// session on the server. Location (only if the phone already allows it; it is never asked for here) is sent when a session starts and every 30 minutes.
// Nothing is sent while the app is in the background, so it costs nothing then.
const EVERY = 60_000, GEO_EVERY = 30 * 60_000, NEW_SESSION = 5 * 60_000;
const tabId = () => { try { let t = sessionStorage.getItem("cipco_tab"); if (!t) { t = crypto.randomUUID(); sessionStorage.setItem("cipco_tab", t); } return t; } catch { return "no-storage"; } };
const installed = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
// one page per kind, not per record: /employees/3f2a… → /employees/:id
const pageOf = (p: string) => p.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id").replace(/\/\d+(?=\/|$)/g, "/:n");

export function useUsageBeacon(on: boolean, path: string) {
  const last = useRef(0), lastGeo = useRef(0), pathRef = useRef(path); pathRef.current = path;
  useEffect(() => {
    if (!on) return;
    const send = async (final = false) => {
      if (!final && document.visibilityState !== "visible") return;
      const now = Date.now(); const fresh = now - last.current > NEW_SESSION; last.current = now;
      const body: Record<string, unknown> = { tab: tabId(), path: pageOf(pathRef.current), app: installed() };
      if (!final && (fresh || now - lastGeo.current > GEO_EVERY)) {
        lastGeo.current = now;
        try { const f = await quietFix(); body.geo = f.status; if (f.status === "ok") { body.lat = f.lat; body.lng = f.lng; body.acc = f.acc; } } catch { /* no location is fine */ }
      }
      const json = JSON.stringify(body);
      if (final && navigator.sendBeacon) { navigator.sendBeacon("/api/usage/beat", new Blob([json], { type: "application/json" })); return; }
      fetch("/api/usage/beat", { method: "POST", headers: { "Content-Type": "application/json" }, body: json, keepalive: true }).catch(() => { /* offline: the gap shows */ });
    };
    send();
    const t = setInterval(() => send(), EVERY);
    const vis = () => (document.visibilityState === "visible" ? send() : send(true));
    const hide = () => send(true);
    document.addEventListener("visibilitychange", vis); window.addEventListener("pagehide", hide);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); window.removeEventListener("pagehide", hide); };
  }, [on]);
  // a page change: the time so far goes to the page they were on
  useEffect(() => { if (on && last.current) { const n = Date.now(); if (n - last.current > 3000) { last.current = n; fetch("/api/usage/beat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tab: tabId(), path: pageOf(path), app: installed() }), keepalive: true }).catch(() => {}); } } }, [path, on]);
}

/** Sign in / sign out, for the activity log. Fire and forget. */
export const usageEvent = (kind: "sign_in" | "sign_out") => fetch("/api/usage/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, app: installed() }), keepalive: true }).catch(() => {});
