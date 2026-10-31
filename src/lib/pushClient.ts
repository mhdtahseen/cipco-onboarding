"use client";
import { supabase } from "./supabase/client";

// This phone's side of notifications: the service worker, the permission, and telling the server which phone to send to.
const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!KEY;
export const isIOS = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
/** Opened from the Home Screen icon rather than a browser tab (iPhones only allow notifications this way). */
export const isStandalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
export const notifPermission = (): NotificationPermission | "unsupported" => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

const keyBytes = (s: string) => { const raw = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
async function registerSW() { if (!("serviceWorker" in navigator)) return null; try { return await navigator.serviceWorker.register("/sw.js"); } catch { return null; } }

/** With permission already given: make sure this phone is subscribed and the server knows about it. Safe to run on every load. */
export async function subscribePush(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    if (!(await registerSW())) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) as unknown as BufferSource }));
    const j = sub.toJSON();
    await supabase().rpc("save_push_subscription", { p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_ua: navigator.userAgent });
    return true;
  } catch { return false; }
}
/** Asks the phone's permission, then subscribes. */
export async function enablePush(): Promise<NotificationPermission | "unsupported"> {
  if (!pushSupported()) return "unsupported";
  const p = await Notification.requestPermission(); if (p === "granted") await subscribePush(); return p;
}
/** On sign-out: this phone stops getting the previous person's reminders. */
export async function dropPush() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); const sub = await reg?.pushManager.getSubscription(); if (sub) { await supabase().rpc("drop_push_subscription", { p_endpoint: sub.endpoint }); await sub.unsubscribe(); } } catch { /* nothing to drop */ }
}
