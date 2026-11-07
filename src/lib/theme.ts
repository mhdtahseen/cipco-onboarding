// Light / dark / follow-the-device. The choice is kept per browser (localStorage "cipco_theme": "light" | "dark"; nothing stored means System).
// The same rule runs once before the page paints (THEME_BOOT in layout.tsx) so there is no flash; this file is for changing it afterwards.
export type ThemeMode = "system" | "light" | "dark";
const KEY = "cipco_theme";
const DARK_BAR = "#0e1420", LIGHT_BAR = "#1e4fa3";

export function getMode(): ThemeMode {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
}
export function resolve(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode;
}
export function setMode(mode: ThemeMode) {
  try { if (mode === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch { /* storage unavailable: it still applies for this visit */ }
  const dark = resolve(mode) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  // browser bar colour: a chosen mode overrides the device-following pair set in the layout
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? DARK_BAR : LIGHT_BAR));
}

// Runs in <head> before first paint, and keeps following the device while the choice is System.
export const THEME_BOOT = `(function(){try{var r=document.documentElement,q=matchMedia("(prefers-color-scheme: dark)");function f(){var m=null;try{m=localStorage.getItem("cipco_theme")}catch(e){}return m==="dark"||(m!=="light"&&q.matches)}r.classList.toggle("dark",f());q.addEventListener("change",function(){var m=null;try{m=localStorage.getItem("cipco_theme")}catch(e){}if(m!=="light"&&m!=="dark")r.classList.toggle("dark",q.matches)})}catch(e){}})();`;
