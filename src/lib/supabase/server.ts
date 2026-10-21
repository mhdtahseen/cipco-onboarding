import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { REMEMBER_COOKIE, withLifetime } from "./session";
export async function serverClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { { const remember = store.get(REMEMBER_COOKIE)?.value !== "0"; list.forEach(({ name, value, options }) => store.set(name, value, withLifetime(options as any, remember))); } } catch { /* called from a Server Component */ } },
    },
  });
}
