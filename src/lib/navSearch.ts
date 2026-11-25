// Searching the menu: each page has words people might type for it (related terms, other names, what you do there), and the match is forgiving:
// part of a word, letters in order ("emp" → Employees, "invc" → Invoices), and small typos ("atendance", "payrol") all count.
// Pure (no React), so it is easy to test.
import type { NavItem } from "./nav";

/** Related words for each page, by its address. Add to these when people search for something and do not find it. */
export const NAV_WORDS: Record<string, string> = {
  "/attendance": "present absent leave check in shift muster roll daily register mark site people today",
  "/employees": "staff workers people team onboarding joining candidate documents aadhaar pan bank esic pf uan hire offer letter exit offboarding",
  "/payroll": "salary wages pay slip payslip esic pf deductions advance month bonus",
  "/projects": "sites jobs work client project report forecast",
  "/sites": "today live site status who is where",
  "/transport": "vehicle bus taxi travel trips car driver fuel",
  "/meals": "food canteen mess lunch tiffin catering",
  "/accommodation": "rooms rent landlord housing stay quarters lodging water",
  "/site-supplies": "gas cylinder lpg oxygen equipment crane hydra machine hire rented scaffolding rental consumables",
  "/inventory": "purchases purchase bills vendors credit to pay supplier payment statement materials jsl portal mrr gate pass items bought inventory",
  "/tools": "inventory stock tools equipment register containers tool kit issue transfer to add",
  "/expenses": "spend spent cost bills receipts payments due vendor money",
  "/quotations": "quote estimate proposal rates offer tender",
  "/invoices": "bill billing tax invoice gst client payment received",
  "/work-orders": "wo po purchase order contract client order",
  "/clients": "customers companies accounts contacts",
  "/clauses": "terms conditions templates clauses",
  "/mail-templates": "email templates letters messages",
  "/quote-library": "quotation wording text templates",
  "/settings": "configuration options preferences setup",
  "/pdf": "pdf merge split compress scan crop sign signature stamp seal aadhaar id card photo passport unlock password convert image jpg ilovepdf canva redact black out",
  "/locations": "places geofence gps site location map",
  "/": "dashboard home overview analytics charts summary",
  "/users": "logins accounts access people roles invite",
  "/permissions": "access rights roles matrix who can",
  "/company": "company details gst udyam pan seal signature documents letterhead bank",
};

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").trim();

// letters of q appear in w in order (a "subsequence"): "invc" in "invoices"
function inOrder(q: string, w: string) { let i = 0; for (const c of w) if (c === q[i]) i++; return i === q.length; }
// edit distance, stopping early once it is clearly too far
function close(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return false; let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; let best = i; for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); } if (best > max) return false; prev = cur; }
  return prev[b.length] <= max;
}

/** How well one typed word fits a list of words (0 = not at all). The page's own name counts more than its related words. */
function wordScore(q: string, words: string[], weight: number) {
  let best = 0;
  for (const w of words) {
    let s = 0;
    if (w === q) s = 10; else if (w.startsWith(q)) s = 8; else if (q.length >= 3 && w.includes(q)) s = 6;
    else if (q.length >= 4 && close(q, w.slice(0, q.length + 1), q.length >= 7 ? 2 : 1)) s = 5;   // a typo
    else if (q.length >= 3 && q[0] === w[0] && inOrder(q, w)) s = 4;                                 // letters in order
    if (s > best) best = s;
  }
  return best * weight;
}

export type SearchItem = Pick<NavItem, "href" | "label" | "icon" | "section">;
/** The pages that fit what was typed, best first. Every typed word must fit something. */
export function searchNav<T extends SearchItem>(items: T[], query: string): T[] {
  const qs = norm(query).split(/\s+/).filter(Boolean); if (!qs.length) return items;
  return items.map((it) => {
    const name = norm(it.label).split(" "), rel = norm(`${NAV_WORDS[it.href] ?? ""} ${it.section}`).split(" ").filter(Boolean);
    let total = 0; for (const q of qs) { const s = Math.max(wordScore(q, name, 2), wordScore(q, rel, 1)); if (!s) return { it, total: 0 }; total += s; }
    return { it, total };
  }).filter((x) => x.total > 0).sort((a, b) => b.total - a.total).map((x) => x.it);
}
