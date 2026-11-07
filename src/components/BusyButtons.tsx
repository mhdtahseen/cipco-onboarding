"use client";
import { useEffect } from "react";

// A button that is switched off while it works says so in words ("Saving…", "Uploading…", "Sending…"). This gives every such button a turning ring in front of the words,
// on every screen and as new ones appear, so a screen written later gets it without being touched. (See .busy in globals.css.)
function scan() {
  document.querySelectorAll<HTMLElement>("button:disabled, a[aria-disabled='true']").forEach((el) => {
    const t = (el.textContent || "").trim();
    const busy = /…$|\.\.\.$/.test(t) && t.length < 40;
    if (busy) el.setAttribute("data-busy", ""); else if (el.hasAttribute("data-busy")) el.removeAttribute("data-busy");
  });
  document.querySelectorAll<HTMLElement>("[data-busy]").forEach((el) => { if (!(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true") el.removeAttribute("data-busy"); });
}
export default function BusyButtons() {
  useEffect(() => {
    let raf = 0; const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(scan); };
    const mo = new MutationObserver(run); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-disabled"], characterData: true });
    run(); return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return null;
}
