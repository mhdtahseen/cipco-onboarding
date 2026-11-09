import en, { type Dict } from "./en";

// Languages the candidate self-fill page can be shown in. English is the default. Answers are always typed in English whatever language is chosen.
// Each language is loaded on demand, so a candidate only downloads the one they pick. To add a language: copy en.ts, translate it, and add a line below (the compiler checks every key is present).
export const LANGS = [
  { code: "en", native: "English", english: "English" },
  { code: "hi", native: "हिन्दी", english: "Hindi" },
  { code: "mr", native: "मराठी", english: "Marathi" },
  { code: "gu", native: "ગુજરાતી", english: "Gujarati" },
  { code: "bn", native: "বাংলা", english: "Bengali" },
  { code: "or", native: "ଓଡ଼ିଆ", english: "Odia" },
  { code: "ta", native: "தமிழ்", english: "Tamil" },
  { code: "te", native: "తెలుగు", english: "Telugu" },
  { code: "kn", native: "ಕನ್ನಡ", english: "Kannada" },
  { code: "ml", native: "മലയാളം", english: "Malayalam" },
  { code: "pa", native: "ਪੰਜਾਬੀ", english: "Punjabi" },
] as const;
export type LangCode = (typeof LANGS)[number]["code"];
export const DEFAULT_LANG: LangCode = "en";
export const isLang = (c: unknown): c is LangCode => LANGS.some((l) => l.code === c);
export { en };
export type { Dict };

const loaders: Record<Exclude<LangCode, "en">, () => Promise<{ default: Dict }>> = {
  hi: () => import("./hi"), mr: () => import("./mr"), gu: () => import("./gu"), bn: () => import("./bn"), or: () => import("./or"), ta: () => import("./ta"),
  te: () => import("./te"), kn: () => import("./kn"), ml: () => import("./ml"), pa: () => import("./pa"),
};
export async function loadDict(code: LangCode): Promise<Dict> { return code === "en" ? en : (await loaders[code]()).default; }

/** A translator for one language: t("s.name"), t("done.t", { name }). Anything missing falls back to English. */
export function makeT(dict: Dict) {
  return (key: string, vars?: Record<string, string | number>) => {
    let s = (dict as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
    if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.split(`{${k}}`).join(String(v)); });
    return s;
  };
}

/** Answers must be English: printable ASCII (letters, numbers, punctuation) and new lines. */
export const NON_ENGLISH = /[^\x20-\x7E\n]/;
export const stripNonEnglish = (s: string) => s.replace(/[^\x20-\x7E\n]/g, "");
