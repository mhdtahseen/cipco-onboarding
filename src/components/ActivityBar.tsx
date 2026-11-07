"use client";
import { useEffect, useState } from "react";

// Shows that something is happening in the background: a thin bar along the top of the screen while the app is talking to the server (loading, saving, sending),
// on every screen and for every kind of call, without each screen having to ask for it. It only appears if a call takes longer than a moment (no flicker on fast ones)
// and stays just long enough to be seen. Calls counted: the app's own /api routes and the database (REST, sign-in, storage). Page files and prefetching are not.
const counts = (input: RequestInfo | URL): boolean => {
  try {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const x = new URL(u, location.href);
    return (x.origin === location.origin && x.pathname.startsWith("/api/")) || /\/(rest|auth|storage|functions)\/v1\//.test(x.pathname);
  } catch { return false; }
};

export default function ActivityBar() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const original = window.fetch; let inflight = 0; let showTimer: ReturnType<typeof setTimeout> | undefined; let hideTimer: ReturnType<typeof setTimeout> | undefined; let shownAt = 0;
    const begin = () => { inflight++; clearTimeout(hideTimer); if (inflight === 1 && !shownAt) showTimer = setTimeout(() => { shownAt = Date.now(); setOn(true); }, 350); };
    const end = () => {
      inflight = Math.max(0, inflight - 1); if (inflight > 0) return;
      clearTimeout(showTimer);
      if (shownAt) { hideTimer = setTimeout(() => { setOn(false); shownAt = 0; }, Math.max(0, 500 - (Date.now() - shownAt))); }   // visible for at least half a second once shown
    };
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      if (!counts(args[0])) return original.apply(this, args);
      begin(); return original.apply(this, args).finally(end);
    } as typeof fetch;
    return () => { window.fetch = original; clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, []);
  return (<>
    <div className="activity-bar" data-on={on} aria-hidden="true"><div /></div>
    <div role="status" aria-live="polite" className="sr-only">{on ? "Working…" : ""}</div>
  </>);
}
