// "Remember me": when the login box is unticked we store cipco_remember=0 and drop the cookie lifetime,
// so the Supabase session ends when the browser is closed. Ticked = the library's default long-lived cookie.
export const REMEMBER_COOKIE = "cipco_remember";

type Opts = { maxAge?: number; expires?: Date; [k: string]: unknown };
export const withLifetime = (options: Opts | undefined, remember: boolean): Opts => {
  const o = { ...(options || {}) };
  if (!remember && o.maxAge !== 0) { delete o.maxAge; delete o.expires; }   // keep maxAge 0 so sign-out still clears cookies
  return o;
};
