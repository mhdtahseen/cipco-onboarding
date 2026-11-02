"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { resetMe } from "@/lib/me";
import { swrClear } from "@/lib/swr";
import { dropPush, enablePush, isIOS, isStandalone, notifPermission, pushSupported, subscribePush } from "@/lib/pushClient";
import { askLocation, geoPermission, isTagged } from "@/lib/geo";

type Step = "ok" | "ask" | "blocked" | "failed";
type State = { checking: boolean; install: boolean; notif: Step; geo: Step };

// Supervisors and Site Engineers must have reminders AND location switched on, on the phone they use. Until this phone is registered for both, nothing else in the
// app can be used: there is no "Not now". The only other way out is signing out. It checks again whenever the app comes back to the front (after the phone's
// settings), and it never locks anyone out of something the phone cannot do at all (an old browser): the gate steps aside for that part.
// Admins are not gated. It renders for every shell, including the single-purpose sign-ins that have no sidebar (where the old prompt never appeared).
export default function NotificationGate({ role }: { role: string | null }) {
  const router = useRouter(); const gated = isTagged(role); const [s, setS] = useState<State>({ checking: true, install: false, notif: "ok", geo: "ok" }); const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    const install = isIOS() && !isStandalone();   // iPhones only allow notifications from the Home Screen icon
    let notif: Step = "ok";
    if (!install && pushSupported()) { const p = notifPermission(); notif = p === "default" ? "ask" : p === "denied" ? "blocked" : (await subscribePush()) ? "ok" : "failed"; }
    const g = await geoPermission(); const geo: Step = g === "prompt" ? "ask" : g === "denied" ? "blocked" : "ok";   // "unsupported" steps aside
    setS({ checking: false, install, notif, geo });
  }, []);
  useEffect(() => {
    if (!gated) return;
    void check();
    const again = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", again); window.addEventListener("focus", again);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); };
  }, [gated, check]);
  async function allow() { setBusy(true); if (s.notif === "ask") await enablePush(); if (s.geo === "ask") await askLocation(); await check(); setBusy(false); }
  async function signOut() { await dropPush(); await supabase().auth.signOut(); resetMe(); swrClear(); router.push("/login"); router.refresh(); }
  if (!gated || s.checking || (!s.install && s.notif === "ok" && s.geo === "ok")) return null;

  const out = <button className="btn" onClick={signOut} disabled={busy}>Sign out</button>;
  const asking = [s.notif === "ask" ? "reminders" : "", s.geo === "ask" ? "location" : ""].filter(Boolean).join(" and ");
  const blocked = [s.notif === "blocked" ? "Notifications" : "", s.geo === "blocked" ? "Location" : ""].filter(Boolean).join(" and ");
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4 bg-slate-900/70" role="alertdialog" aria-modal="true" aria-label="Turn on reminders and location">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl space-y-3">
        {s.install ? <>
          <h2 className="font-semibold">Add CIPCO to your Home Screen</h2>
          <p className="text-sm text-slate-600">Reminders on an iPhone only work from the app icon. In Safari tap the <b>Share</b> button, choose <b>Add to Home Screen</b>, then open CIPCO from the new icon and sign in there.</p>
          <p className="text-xs text-slate-400">This screen stays until it is done.</p>
          <div className="flex justify-end gap-2">{out}<button className="btn btn-primary" onClick={() => void check()}>I have done this</button></div>
        </> : blocked ? <>
          <h2 className="font-semibold">{blocked} {blocked.includes("and") ? "are" : "is"} blocked</h2>
          <p className="text-sm text-slate-600">{blocked} {blocked.includes("and") ? "are" : "is"} required for your role, but this phone is blocking {blocked.includes("and") ? "them" : "it"}. Open your phone's settings (or the browser's site settings for this page), switch {blocked.includes("and") ? "both" : "it"} to <b>Allow</b>, then come back to the app.</p>
          <p className="text-xs text-slate-400">It checks again when you come back. This screen stays until it is done.</p>
          <div className="flex justify-end gap-2">{out}<button className="btn btn-primary" onClick={() => location.reload()}>Check again</button></div>
        </> : s.notif === "failed" ? <>
          <h2 className="font-semibold">Could not register this phone</h2>
          <p className="text-sm text-slate-600">Notifications are allowed, but this phone could not be registered. Check the internet connection and try again.</p>
          <div className="flex justify-end gap-2">{out}<button className="btn btn-primary" disabled={busy} onClick={() => { setBusy(true); void check().finally(() => setBusy(false)); }}>{busy ? "Trying…" : "Try again"}</button></div>
        </> : <>
          <h2 className="font-semibold">Turn on {asking}</h2>
          <p className="text-sm text-slate-600">Your role must have {asking} on this phone{s.notif === "ask" ? ", for attendance, meals and the day's sign-off reminders" : ""}. Tap <b>Allow</b>, then choose <b>Allow</b> on each question your phone asks{s.geo === "ask" ? " (for location, choose “While using the app”)" : ""}.</p>
          <p className="text-xs text-slate-400">This screen stays until it is done.</p>
          <div className="flex justify-end gap-2">{out}<button className="btn btn-primary" onClick={allow} disabled={busy}>{busy ? "Waiting…" : "Allow"}</button></div>
        </>}
      </div>
    </div>
  );
}
