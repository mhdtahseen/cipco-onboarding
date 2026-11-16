import { createHmac, timingSafeEqual } from "crypto";

// Private link to one person's passport photo, printed in the ESIC details PDF so the person making the ESIC card can download the photo and upload it.
// Same idea as the letter and salary-slip links (docLink.ts, slipLink.ts): nothing is stored, the link carries the employee's id and an expiry, signed with a key
// derived from the server's secret, so it cannot be guessed or changed and it stops working on its own. The storage bucket is never exposed. Server only.
const key = () => { const k = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!k) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set"); return createHmac("sha256", k).update("cipco-photo-link-v1").digest(); };
const sig = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url").slice(0, 32);
export const PHOTO_LINK_DAYS = 7;

export const signPhoto = (employeeId: string, days = PHOTO_LINK_DAYS) => { const exp = Math.floor(Date.now() / 1000) + days * 86400; const p = `${employeeId}.${exp}`; return `${p}.${sig(p)}`; };
/** The employee id if the token is genuine and not expired, else null. */
export function verifyPhoto(token: string): { id: string; exp: number } | null {
  const m = /^([0-9a-f-]{36})\.(\d{9,11})\.([A-Za-z0-9_-]{32})$/.exec(token); if (!m) return null;
  const a = Buffer.from(sig(`${m[1]}.${m[2]}`)), b = Buffer.from(m[3]); if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const exp = Number(m[2]); return exp * 1000 > Date.now() ? { id: m[1], exp } : null;
}
