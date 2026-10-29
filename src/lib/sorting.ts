// Shared sorting for list pages: one comparer (blanks always last, numbers as numbers, "INV-9" before "INV-10") and the remembered choice.
export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };
export type SortOption<K extends string> = { key: K; label: string; dir: SortDir };   // dir = the natural first direction (newest / largest / A to Z)

const blank = (v: unknown) => v === null || v === undefined || v === "";

/** Sort a copy of the rows by one value. Rows with no value stay at the bottom whichever way you sort; `tie` settles equal values. */
export function sortRows<T>(rows: T[], get: (r: T) => string | number | null | undefined, dir: SortDir, tie?: (a: T, b: T) => number): T[] {
  const m = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b), nx = blank(x), ny = blank(y);
    if (nx !== ny) return nx ? 1 : -1;
    const c = nx ? 0 : typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { sensitivity: "base", numeric: true });
    return c * m || (tie ? tie(a, b) : 0);
  });
}
