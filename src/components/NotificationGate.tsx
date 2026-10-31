"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { resetMe } from "@/lib/me";
import { swrClear } from "@/lib/swr";
import { dropPush, enablePush, isIOS, isStandalone, notifPermission, pushSupported, subscribePush } from "@/lib/pushClient";
import { isTagged } from "@/lib/geo";

type State = "checking" | "ok" | "ask" | "blocked" | "install" | "failed";

// Supervisors and Site Engineers must have reminders switched on, on the phone they use. Until this phone is registered nothing else in the app can be used:
// there is no "Not now". The only other way out is signing out. It checks again whenever the app comes back to the front (after the phone's settings),
// and it never locks anyone out of a phone that cannot do notifications at all (an old browser): the server cannot be told otherwise, so the gate steps aside.
// Admins are not gated. It renders for every shell, including the single-purpose sign-ins that have no sidebar (where the old prompt never appeared).
export default function NotificationGate({ role }: { role: string | null }) {
  const router = useRouter(); const gated = isTagged(role); const [state, setState] = useState<State>("checking"); const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    if (isIOS() && !isStandalone()) { setState("install"); return; }   // iPhones only allow notifications from the Home Screen icon
    if (!pushSupported()) { setState("ok"); return; }
    const p = notifPermission();
    if (p === "default") { setState("ask"); return; }
    if (p === "denied") { setState("blocked"); return; }
    setState((await subscribePush()) ? "ok" : "failed");
  }, []);
  useEffect(() => {
    if (!gated) return;
    void check();
    const again = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", again); window.addEventListener("focus", again);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); };
  }, [gated, check]);
  async function allow() { setBusy(true); await enablePush(); await check(); setBusy(false); }
  async function signOut() { await dropPush(); await supabase().auth.signOut(); resetMe(); swrClear(); router.push("/login"); router.refresh(); }
  if (!gated || state === "ok" || state === "checking") return null;

  const out = <button className="btn" onClick={signOut} disabled={busy}>Sign out</button>;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4 bg-slate-900/70" role="alertdialog" aria-modal="true" aria-label="Turn on reminders">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl space-y-3">
        {state === "install" ? <>
          <h2 className="font-semibold">Add CIPCO to your Home Screen</h2>
          <p className="text-sm text-slate-600">Reminders on an iPhone only work from the app icon. In Safari tap the <b>Share</b> button, choose <b>Add to Home Screen</b>, then open CIPCO from the new icon and sign in there.</p>
          <p className="text-xs text-slate-400">This screen stays until it is done.</p>
          <div className="flex justify-end gap-2">{out}<button className="btn btn-primary" onClick={() => void check()}>I have done this</button></div>
        </> : state === "blocked" ? <>
          <h2 className="font-semibold">Notifications are blocked</h2>
          <p className="text-sm text-slate-600">Reminders are required for your role, but this phone is blocking them. Open your phone's settings (or the browser's site settings for this page), switch <b>Notifications</b> to <b>Allow</b>, then come back to the app.</p>
          <p className="text-xs text-slate-400">It checks again when you come back. This screen stays until it is done.</p>
          <div className="flex justify-end gap-2">{out}<button className="btn btn-primary" onClick={() => location.reload()}>Check again</button></div>
        </> : state === "failed" ? <>
          <h2 className="font-semibold">Could not register this phone</h2>
          <p className="text-sm text-slate-600">Notifications are allowed, but this phone could not be registered. Check the internet connection and try again.</p>
          <div className="flex justify-end gap-2">{out}<button className="btn btn-primary" disabled={busy} onClick={() => { setBusy(true); void check().finally(() => setBusy(false)); }}>{busy ? "Trying…" : "Try again"}</button></div>
        </> : <>
          <h2 className="font-semibold">Turn on reminders</h2>
          <p className="text-sm text-slate-600">Your role must get reminders on this phone, for attendance, meals and the day's sign-off. Tap <b>Allow</b>, then choose <b>Allow</b> on the question your phone asks.</p>
          <p className="text-xs text-slate-400">This screen stays until it is done.</p>
          <div className="flex justify-end gap-2">{out}<button className="btn btn-primary" onClick={allow} disabled={busy}>{busy ? "Waiting…" : "Allow"}</button></div>
        </>}
      </div>
    </div>
  );
}
