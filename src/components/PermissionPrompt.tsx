"use client";
import { useEffect, useState } from "react";
import { askLocation, geoPermission, geoSupported, isTagged } from "@/lib/geo";
import { enablePush, isIOS, isStandalone, notifPermission, pushSupported, subscribePush } from "@/lib/pushClient";

type Need = { notif: boolean; geo: boolean; iosHint: boolean };

// Shown after signing in, once per sign-in, while the phone has not yet been asked. The phone shows its own questions; this just brings them up on a tap
// (phones only allow that from a tap). It says nothing about what the location is for, and nothing in the app ever displays a location.
export default function PermissionPrompt({ role }: { role: string | null }) {
  const [need, setNeed] = useState<Need | null>(null); const [busy, setBusy] = useState(false); const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!role || role === "none") return; let alive = true;
    (async () => {
      if (pushSupported() && notifPermission() === "granted") void subscribePush();   // already allowed: keep this phone registered
      try { if (sessionStorage.getItem("cipco_perm_later") === "1") return; } catch { /* storage unavailable */ }
      const notif = pushSupported() && notifPermission() === "default";
      const geo = isTagged(role) && geoSupported() && (await geoPermission()) === "prompt";
      const iosHint = isIOS() && !isStandalone() && !pushSupported();
      if (alive && (notif || geo || iosHint)) setNeed({ notif, geo, iosHint });
    })();
    return () => { alive = false; };
  }, [role]);
  if (!need) return null;
  const later = () => { try { sessionStorage.setItem("cipco_perm_later", "1"); } catch { /* ignore */ } setNeed(null); };
  async function allow() {
    setBusy(true);
    if (need!.notif) await enablePush();
    if (need!.geo) await askLocation();
    setBusy(false);
    const geoNow = need!.geo ? await geoPermission() : "granted";
    if ((need!.notif && notifPermission() === "denied") || geoNow === "denied") setBlocked(true); else setNeed(null);
  }
  const what = need.notif && need.geo ? "notifications and location" : need.notif ? "notifications" : need.geo ? "location" : "notifications";
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4 fade" role="dialog" aria-modal="true" aria-label="Allow permissions">
      <div className="absolute inset-0 bg-slate-900/50" />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl space-y-3 pop-in !origin-center">
        {need.iosHint && !need.notif && !need.geo ? <>
          <h2 className="font-semibold">Get reminders on your iPhone</h2>
          <p className="text-sm text-slate-600">Tap the Share button in Safari, choose <b>Add to Home Screen</b>, then open CIPCO from the new icon and sign in there.</p>
          <div className="flex justify-end"><button className="btn btn-primary" onClick={later}>OK</button></div>
        </> : blocked ? <>
          <h2 className="font-semibold">Some permissions are blocked</h2>
          <p className="text-sm text-slate-600">Your browser is blocking {what}. You can allow it in the browser's site settings for this page, then sign in again.</p>
          <div className="flex justify-end"><button className="btn btn-primary" onClick={() => setNeed(null)}>Close</button></div>
        </> : <>
          <h2 className="font-semibold">Allow {what}</h2>
          <p className="text-sm text-slate-600">Tap <b>Allow</b>, then choose <b>Allow</b> on each question your phone asks.</p>
          <div className="flex justify-end gap-2"><button className="btn" onClick={later} disabled={busy}>Not now</button><button className="btn btn-primary" onClick={allow} disabled={busy}>{busy ? "Waiting…" : "Allow"}</button></div>
        </>}
      </div>
    </div>
  );
}
