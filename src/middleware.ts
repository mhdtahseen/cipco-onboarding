import { createServerClient } from "@supabase/ssr";
import { REMEMBER_COOKIE, withLifetime } from "@/lib/supabase/session";
import { NextResponse, type NextRequest } from "next/server";
import { canAccess, homeFor } from "@/lib/nav";

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
  const { data } = await sb.auth.getUser();
  const isLogin = req.nextUrl.pathname.startsWith("/login");
  const isPublic = req.nextUrl.pathname.startsWith("/apply") || req.nextUrl.pathname.startsWith("/api/apply"); // candidate self-fill links
  if (isPublic) return res;
  if (!data.user && !isLogin) return NextResponse.redirect(new URL("/login", req.url));
  if (!data.user) return res;

  // Roles: admin / staff / supervisor / none. If the roles table does not exist yet (migration not run) treat everyone as admin.
  const path = req.nextUrl.pathname; const isApi = path.startsWith("/api/");
  const { data: rr, error } = await sb.from("user_roles").select("role").eq("user_id", data.user.id).maybeSingle();
  const role: string = error ? "admin" : rr?.role ?? "none";
  const home = homeFor(role);
  if (isLogin) return NextResponse.redirect(new URL(home, req.url));
  if (!canAccess(role, path)) return isApi ? NextResponse.json({ error: "Not allowed" }, { status: 403 }) : NextResponse.redirect(new URL(home, req.url));
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|branding/).*)"] };
