"use client";
import { useSyncExternalStore } from "react";

/** True while the screen matches a CSS media query, e.g. useMedia("(min-width: 1024px)"). False on the server. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => { const m = window.matchMedia(query); m.addEventListener("change", notify); return () => m.removeEventListener("change", notify); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
