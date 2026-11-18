import { adminClient } from "./supabase/admin";
import { applyCompanyData, type CompanyData } from "./company";
import { readAsset } from "./pdf/common";
import { r2Get } from "./r2";

// Server only. The details saved on the Company page (2026-11-company-profile.sql), laid over COMPANY and BANK before a PDF or an email is made,
// and the seal and signature to stamp. Read with the server's own key, because letters and invoices are also made by people who cannot open the Company page.
// Remembered for a minute, so a change reaches every PDF within a minute. Before the migration is run (or if the read fails) the built-in details and images are used.
type Profile = { data: CompanyData; seal_path: string | null; signature_path: string | null };
const TTL = 60_000;
let cache: { at: number; p: Profile | null } | null = null; let inflight: Promise<Profile | null> | null = null;

async function profile(): Promise<Profile | null> {
  if (cache && Date.now() - cache.at < TTL) return cache.p;
  inflight ||= (async () => {
    try {
      const { data, error } = await adminClient().from("company_profile").select("data, seal_path, signature_path").eq("id", 1).maybeSingle();
      const p = error || !data ? null : ({ data: (data.data ?? {}) as CompanyData, seal_path: data.seal_path, signature_path: data.signature_path } as Profile);
      cache = { at: Date.now(), p }; return p;
    } catch { cache = { at: Date.now(), p: null }; return null; } finally { inflight = null; }
  })();
  return inflight;
}
/** Forget the remembered details (after an Admin saves), so this server uses the new ones at once. */
export const forgetCompany = () => { cache = null; images.clear(); };

/** Lays the saved details over COMPANY and BANK. Cheap to call often. */
export async function applyCompany(): Promise<CompanyData> {
  const p = await profile(); const data = p?.data ?? {};
  applyCompanyData(data); return data;
}

/** The saved details as they are (for the Company page and /api/company/info). */
export async function companyData(): Promise<CompanyData> { return (await profile())?.data ?? {}; }

const images = new Map<string, Uint8Array>();
async function image(path: string | null | undefined, fallback: string) {
  if (path) { const hit = images.get(path); if (hit) return hit; const b = await r2Get(path); if (b) { images.set(path, b); return b; } }
  return new Uint8Array(await readAsset("branding", fallback));
}
/** The seal and signature to stamp: the ones uploaded on the Company page, else the built-in images (assets/branding, not public). */
export async function brandingImages(): Promise<{ seal: Uint8Array; sign: Uint8Array; custom: { seal: boolean; sign: boolean } }> {
  const p = await profile();
  const [seal, sign] = await Promise.all([image(p?.seal_path, "seal.png"), image(p?.signature_path, "signature.png")]);
  return { seal, sign, custom: { seal: !!p?.seal_path, sign: !!p?.signature_path } };
}
