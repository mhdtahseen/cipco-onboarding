import { createServerClient } from "@supabase/ssr";
import { REMEMBER_COOKIE, withLifetime } from "@/lib/supabase/session";
import { NextResponse, type NextRequest } from "next/server";
import { canAccess, homeFor, roleFromClaims } from "@/lib/nav";

// Roles change rarely, but every request needs one. Remembering it for a minute in this server's memory saves a database round trip per request
// (nothing is stored in the browser, so it cannot be tampered with). The database still enforces every read and write against the real role at once;
// this only affects which pages a person is sent to, so a role change reaches the page guard within a minute.
const ROLE_TTL_MS = 60_000; const roleCache = new Map<string, { role: string; at: number }>();

// Keeps the Supabase session fresh and sends logged-out visitors to /login.
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        const remember = req.cookies.get(REMEMBER_COOKIE)?.value !== "0";
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, withLifetime(options as any, remember)));
      },
    },
  });
  // getClaims checks the signed login token on this server against the project's public key (cached after the first call), so there is no round trip to
  // Supabase on every request. It still refreshes an expired session. (getUser() asked Supabase "who is this?" on every single page and API call.)
  const { data: claims } = await sb.auth.getClaims(); const uid = (claims?.claims?.sub as string | undefined) || null;
  const isLogin = req.nextUrl.pathname.startsWith("/login");
  const isPublic = req.nextUrl.pathname.startsWith("/apply") || req.nextUrl.pathname.startsWith("/api/apply"); // candidate self-fill links
  if (isPublic) return res;
  if (!uid && !isLogin) return NextResponse.redirect(new URL("/login", req.url));
  if (!uid) return res;

  // Roles: admin / staff / supervisor / none. If the roles table does not exist yet (migration not run) treat everyone as admin.
  const path = req.nextUrl.pathname; const isApi = path.startsWith("/api/");
  // Best source first: the role inside the verified login token (the database hook puts it there; see 2026-10-role-in-login-token.sql): no lookup at all.
  // Without it (hook not switched on, or a token from before it was) fall back to the remembered or looked-up role.
  let role: string; const claimRole = roleFromClaims(claims?.claims); const hit = roleCache.get(uid);
  if (claimRole) role = claimRole;
  else if (hit && Date.now() - hit.at < ROLE_TTL_MS) role = hit.role;
  else {
    const { data: rr, error } = await sb.from("user_roles").select("role").eq("user_id", uid).maybeSingle();
    role = error ? "admin" : rr?.role ?? "none";
    if (!error) { if (roleCache.size > 500) roleCache.clear(); roleCache.set(uid, { role, at: Date.now() }); }   // never remember a failed lookup
  }
  const home = homeFor(role);
  if (isLogin) return NextResponse.redirect(new URL(home, req.url));
  if (!canAccess(role, path)) return isApi ? NextResponse.json({ error: "Not allowed" }, { status: 403 }) : NextResponse.redirect(new URL(home, req.url));
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|branding/).*)"] };
