import type { NextRequest } from "next/server";

// App activity, server side: who the request came from (network address) and on what (device), read from the request itself. Server only.

/** The caller's network address, as passed on by the hosting platform. */
export const ipOf = (req: NextRequest) => (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "").trim().slice(0, 64);

/** "Android phone · Chrome", "Windows · Edge", "iPhone · Safari (app)" from the browser's own description. */
export function deviceOf(req: NextRequest, installed = false): string {
  const ua = req.headers.get("user-agent") || "";
  const os = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet") : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}${installed ? " (app)" : ""}`;
}
