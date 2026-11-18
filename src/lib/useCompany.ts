"use client";
import { useEffect, useState } from "react";
import { applyCompanyData, BANK, COMPANY, type CompanyData } from "./company";

// The company details saved on the Company page, in the browser: fetched once per tab (/api/company/info, the letterhead and bank details only) and laid over
// COMPANY and BANK, so screens that show them (salary slip, invoice, bank letter) show the current ones. Until it arrives, or if it cannot be read, the defaults show.
let loaded: Promise<void> | null = null; const listeners = new Set<() => void>(); let version = 0;
export function loadCompanyInfo(force = false): Promise<void> {
  if (loaded && !force) return loaded;
  loaded = fetch("/api/company/info").then((r) => (r.ok ? r.json() : null)).then((j: { data?: CompanyData } | null) => {
    if (j?.data) { applyCompanyData(j.data); version++; listeners.forEach((f) => f()); }
  }).catch(() => {});
  return loaded;
}
/** Use in a screen that shows COMPANY or BANK: it shows again once the saved details have arrived. */
export function useCompany() {
  const [, set] = useState(version);
  useEffect(() => { const f = () => set(version); listeners.add(f); void loadCompanyInfo(); return () => { listeners.delete(f); }; }, []);
  return { COMPANY, BANK };
}
