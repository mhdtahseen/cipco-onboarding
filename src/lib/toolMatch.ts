// Fuzzy matching of a purchase bill's item name ("Ring Spaner 20x22", "4 inch grinding disc", "D-Shackle 17T") to an item in the Tools & equipment catalogue.
// Different people (and suppliers) call the same thing different names, so: spelling is forgiven, common other names are understood, and the SIZE has to agree
// ("20-22" is not "21-23"). A name that was matched before is remembered (tool_item_aliases) and wins outright the next time. Pure: no database.
import type { ToolItem } from "./tools";

// other words for the same thing (and common misspellings), all mapped to one word
const SAME: Record<string, string> = {
  wrinch: "wrench", wrech: "wrench", wrinchh: "wrench", rench: "wrench", spaner: "spanner", spanar: "spanner", spannar: "spanner", spaners: "spanner", spanners: "spanner",
  ceiling: "sling", sealing: "sling", slings: "sling", plums: "plumb", plum: "plumb", bendar: "bender", openar: "opener", measurment: "measuring", measurement: "measuring", measure: "measuring",
  allan: "allen", alen: "allen", hex: "allen", disc: "wheel", disk: "wheel", discs: "wheel", wheels: "wheel", shackel: "shackle", shackels: "shackle", shackles: "shackle",
  screw: "screwdriver", driver: "screwdriver", plier: "pliers", plyer: "pliers", pliars: "pliers", cutter: "cutter", hacksaw: "hacksaw", chisle: "chisel", chissel: "chisel",
  welding: "welding", weld: "welding", electrodes: "electrode", rods: "electrode", rod: "electrode", cable: "cable", cables: "cable", wire: "cable", hose: "hose", pipe: "pipe",
  jack: "jack", jacks: "jack", bolts: "bolt", bolt: "bolt", eyebolt: "eye bolt", tap: "tap", taps: "tap", bits: "bit", drill: "drill", tape: "tape", tapes: "tape",
  gloves: "gloves", glove: "gloves", harness: "harness", belt: "harness", ton: "ton", tons: "ton", tonne: "ton", tonnes: "ton", mtr: "m", mtrs: "m", meter: "m", metre: "m", meters: "m", metres: "m",
  de: "double end", se: "single end", kgs: "kg", kilo: "kg", inch: "in", inches: "in", feet: "ft", sq: "sq", sqmm: "sqmm", nos: "", no: "", pcs: "", pc: "", piece: "", pieces: "", approx: "", nos_: "",
};
const STOP = new Set(["of", "for", "with", "and", "the", "a", "an", "to", "in_", "type", "make", "brand", "new", "size", "heavy", "duty"]);

/** One canonical form for comparing and remembering names: lower case, units written one way, other names and misspellings mapped. */
export function normName(s: string): string {
  let t = ` ${s.toLowerCase()} `
    .replace(/[øφ⌀]/g, " ").replace(/\bdia\.?\b/g, " ").replace(/×/g, " x ")
    .replace(/(\d)\s*(?:"|''|”|″|inch(?:es)?\b|in\b)/g, "$1in ")              // 12" / 12 inch → 12in
    .replace(/(\d)\s*(mm|kg|ton|t|m|ltr|l)\b/g, "$1 $2 ")                         // 50mm → 50 mm, 17t → 17 t
    .replace(/(\d)\s*[x×*/]\s*(\d)/g, "$1-$2")                                    // 20x22, 20/22 → 20-22 (sizes of a double-ended tool)
    .replace(/([a-z])-(?=[a-z])/g, "$1 ")                                          // c-clamp, cut-off → two words
    .replace(/[(),;:+&]/g, " ").replace(/\s+/g, " ");
  t = t.split(" ").map((w) => (w === "t" ? "ton" : w in SAME ? SAME[w] : w)).filter((w) => w && !STOP.has(w)).join(" ");
  return t.trim();
}

const isNum = (w: string) => /\d/.test(w);
const numsOf = (words: string[]) => new Set(words.filter(isNum).flatMap((w) => w.split("-")).map((w) => w.replace(/^m(?=\d)/, "")).filter(Boolean));   // "20-22" → 20, 22; "m12" → 12

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1; prev = cur;
  }
  return prev[b.length];
}
/** How well one word of the bill matches the item's words: exact 1, starts the same 0.8, one or two letters off 0.75 / 0.6. */
function wordScore(w: string, words: string[]): number {
  let best = 0;
  for (const x of words) {
    if (x === w) return 1;
    if (w.length >= 3 && x.length >= 3 && (x.startsWith(w) || w.startsWith(x))) best = Math.max(best, 0.8);
    else if (w.length >= 4 && lev(w, x, 1) <= 1) best = Math.max(best, 0.75);
    else if (w.length >= 7 && lev(w, x, 2) <= 2) best = Math.max(best, 0.6);
  }
  return best;
}

export type Match = { item: ToolItem; score: number; learned: boolean };
export type Quality = "learned" | "good" | "maybe" | "none";
export const quality = (m: Match | undefined): Quality => (!m ? "none" : m.learned ? "learned" : m.score >= 0.8 ? "good" : m.score >= 0.55 ? "maybe" : "none");

/** The best catalogue items for a name typed on a bill, best first. aliases: normalized name → item id, from earlier matches. */
export function matchTool(name: string, items: ToolItem[], aliases: Record<string, string> = {}, limit = 6): Match[] {
  const q = normName(name); if (!q) return [];
  const learnedId = aliases[q];
  const qw = q.split(" "); const qWords = qw.filter((w) => !isNum(w) && w.length >= 2); const qNums = numsOf(qw);
  const out: Match[] = [];
  for (const it of items) {
    if (!it.active && it.id !== learnedId) continue;
    if (it.id === learnedId) { out.push({ item: it, score: 1, learned: true }); continue; }
    const iw = normName(`${it.name} ${it.spec}`).split(" "); const cw = normName(it.category).split(" ");
    const iWords = iw.filter((w) => !isNum(w)); const iNums = numsOf(iw);
    if (!qWords.length && !qNums.size) continue;
    // words: every word on the bill should be found in the item's name (the category helps a little)
    const ws = qWords.length ? qWords.reduce((s, w) => s + Math.max(wordScore(w, iWords), 0.6 * wordScore(w, cw)), 0) / qWords.length : 0.5;
    // ...and the item's main words should be on the bill too, so "spanner" alone does not match every spanner equally well
    const back = iWords.length ? iWords.filter((w) => w.length >= 3).reduce((s, w) => s + wordScore(w, qWords), 0) / Math.max(1, iWords.filter((w) => w.length >= 3).length) : 0;
    let score = 0.75 * ws + 0.25 * back;
    // sizes must agree
    if (qNums.size || iNums.size) {
      const hit = [...qNums].filter((n) => iNums.has(n)).length;
      if (qNums.size && iNums.size) { const ns = hit / Math.max(qNums.size, iNums.size); score = hit ? 0.65 * score + 0.35 * ns : score * 0.35; }
      else if (iNums.size) score *= 0.8;   // the item has a size, the bill does not say one
      else score *= 0.85;                  // the bill has a size, the item has none
    }
    if (score >= 0.3) out.push({ item: it, score: Math.round(score * 100) / 100, learned: false });
  }
  return out.sort((a, b) => Number(b.learned) - Number(a.learned) || b.score - a.score).slice(0, limit);
}
