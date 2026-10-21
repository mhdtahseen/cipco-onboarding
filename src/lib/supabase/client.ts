import { createBrowserClient } from "@supabase/ssr";
import { REMEMBER_COOKIE, withLifetime } from "./session";

const read = () => document.cookie.split("; ").filter(Boolean).map((c) => { const i = c.indexOf("="); return { name: c.slice(0, i), value: decodeURIComponent(c.slice(i + 1)) }; });

export const supabase = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: read,
      setAll: (list) => {
        const remember = read().find((c) => c.name === REMEMBER_COOKIE)?.value !== "0";
        list.forEach(({ name, value, options }) => {
          const o = withLifetime(options as any, remember);
          let s = `${name}=${encodeURIComponent(value)}; path=${o.path ?? "/"}`;
          if (o.maxAge !== undefined) s += `; max-age=${o.maxAge}`;
          s += `; samesite=${o.sameSite ?? "lax"}`;
          if (location.protocol === "https:") s += "; secure";
          document.cookie = s;
        });
      },
    },
  });

export const setRemember = (on: boolean) => { document.cookie = `${REMEMBER_COOKIE}=${on ? "1" : "0"}; path=/; samesite=lax${on ? "; max-age=31536000" : ""}`; };
