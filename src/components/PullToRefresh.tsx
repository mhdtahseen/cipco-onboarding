"use client";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "./Loader";

// An app saved to the iPhone or iPad home screen has no browser around it: no reload button and no pull-down-to-refresh. This adds the pull-down:
// drag the page down from the very top and let go, and the app reloads (so it also picks up a newer version). Only in that home-screen mode on iOS
// (navigator.standalone), where nothing else does it. Never while something scrollable is not at its top, inside a form box or a dialog, or on a sideways drag.
const TRIGGER = 64, MAX = 110;
export default function PullToRefresh() {
  const [pull, setPull] = useState(0); const [busy, setBusy] = useState(false); const state = useRef({ y: 0, x: 0, on: false, dist: 0 });
  useEffect(() => {
    if ((navigator as unknown as { standalone?: boolean }).standalone !== true) return;
    const s = state.current;
    const blocked = (t: EventTarget | null) => {
      for (let e = t as HTMLElement | null; e && e !== document.documentElement; e = e.parentElement) {
        if (e.matches?.("input, textarea, select, [contenteditable], [role=dialog], [data-no-ptr], .overlay[data-open=true]")) return true;
        const cs = getComputedStyle(e);
        if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight && e.scrollTop > 0) return true;   // a scrolled list or table: let it scroll
      }
      return false;
    };
    const start = (e: TouchEvent) => { s.on = false; s.dist = 0; if (e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) return; s.y = e.touches[0].clientY; s.x = e.touches[0].clientX; s.on = true; };
    const move = (e: TouchEvent) => {
      if (!s.on) return; const dy = e.touches[0].clientY - s.y, dx = e.touches[0].clientX - s.x;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) { s.on = false; setPull(0); return; }
      s.dist = Math.min(MAX, dy * 0.5); setPull(s.dist); if (e.cancelable) e.preventDefault();   // stops the page's own rubber-band while we show ours
    };
    const end = () => {
      if (!s.on) return; s.on = false;
      if (s.dist >= TRIGGER) { setBusy(true); setPull(TRIGGER); setTimeout(() => location.reload(), 200); } else setPull(0);
    };
    document.addEventListener("touchstart", start, { passive: true }); document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end); document.addEventListener("touchcancel", end);
    return () => { document.removeEventListener("touchstart", start); document.removeEventListener("touchmove", move); document.removeEventListener("touchend", end); document.removeEventListener("touchcancel", end); };
  }, []);
  if (!pull && !busy) return null;
  const ready = pull >= TRIGGER || busy;
  return (
    <div aria-hidden="true" className="fixed left-0 right-0 z-[65] flex justify-center pointer-events-none" style={{ top: "env(safe-area-inset-top, 0px)", transform: `translateY(${pull - 44}px)`, transition: busy || pull === 0 ? "transform .2s" : "none" }}>
      <div className="h-10 w-10 rounded-full bg-white shadow-md border border-slate-200 grid place-items-center text-[#1e4fa3]">
        {busy ? <Spinner size={22} /> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${ready ? 180 : Math.min(180, (pull / TRIGGER) * 180)}deg)`, transition: "transform .15s" }}><path d="M12 5v14M6 13l6 6 6-6" /></svg>}
      </div>
    </div>
  );
}
