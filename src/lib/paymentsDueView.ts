import type { Category, DueItem } from "./paymentsDueLabels";
import type { KeyedPayee } from "./paymentsDueData";

// Which part of what we owe to show: pure functions over the items the loader attaches to every payee, so the report page and the PDF agree to the rupee.
//   now   : what needs paying now, i.e. everything unpaid that is overdue or falls due this month (last month's bills and salaries, this month's rent in advance)
//   month : one chosen month, either by when it falls DUE ("due") or by the month the cost BELONGS to ("cost")
//   all   : everything billed so far
// "Running" costs (this month's meals, trips, deliveries and hours not billed yet) are separate: they are never counted as owed, and show only when asked for.
export type Scope = "now" | "month" | "all"; export type Lens = "due" | "cost";
export type View = { scope: Scope; month: string; lens: Lens; running: boolean; includePaid: boolean; today: string };
export type PayeeView = { payee: KeyedPayee; items: DueItem[]; running: DueItem[]; total: number; paid: number; pending: number; advance: number; runningTotal: number; overdue: number };

export const thisMonthOf = (today: string) => today.slice(0, 7);
const pendingOf = (i: DueItem) => Math.max(0, i.total - i.paid);
const dueMonth = (i: DueItem) => (i.dueOn ?? `${i.month}-01`).slice(0, 7);

/** The part of one payee that falls in the view, or null when there is nothing to show for them. */
export function viewOf(p: KeyedPayee, v: View): PayeeView | null {
  const items = p.items ?? [{ month: v.today.slice(0, 7), label: p.forWhat, total: p.total, paid: Math.min(p.paid, p.total), dueOn: p.oldestDue ?? null, state: "billed" as const }];
  const billed = items.filter((i) => i.state !== "running"), run = items.filter((i) => i.state === "running"), cur = thisMonthOf(v.today);
  const pick = (list: DueItem[]) => (v.scope === "all" ? list : v.scope === "now" ? list.filter((i) => pendingOf(i) > 0.004 && dueMonth(i) <= cur) : v.lens === "due" ? list.filter((i) => dueMonth(i) === v.month) : list.filter((i) => i.month === v.month));
  const sel = pick(billed); const runSel = v.running ? (v.scope === "now" || v.scope === "all" ? run : run.filter((i) => (v.lens === "due" ? (i.dueOn ?? `${i.month}-01`).slice(0, 7) === v.month || i.month === v.month : i.month === v.month))) : [];
  const total = sel.reduce((s, i) => s + i.total, 0), paid = sel.reduce((s, i) => s + Math.min(i.paid, i.total), 0), pending = Math.max(0, total - paid);
  const advance = v.scope === "month" ? 0 : Math.max(0, p.paid - p.total);   // money paid beyond what was billed cannot be placed in a month: shown on the overall and "now" views
  const runningTotal = runSel.reduce((s, i) => s + i.total, 0), overdue = sel.reduce((s, i) => s + (i.dueOn && i.dueOn < v.today ? pendingOf(i) : 0), 0);
  const show = pending > 0.004 || runningTotal > 0.004 || advance > 0.004 || (v.includePaid && total > 0.004 && v.scope !== "now");
  return show ? { payee: p, items: [...sel, ...runSel].sort((a, b) => a.month.localeCompare(b.month)), running: runSel, total, paid, pending, advance, runningTotal, overdue } : null;
}

export type Grid = { months: string[]; rows: { category: Category; cells: Record<string, number>; running: number; total: number }[]; running: Record<string, number> };
/** Pending by category and by the month each cost belongs to, over the payees given (the "month by month" picture). */
export function monthGrid(payees: KeyedPayee[]): Grid {
  const cells = new Map<Category, Record<string, number>>(); const runCat = new Map<Category, number>(); const months = new Set<string>(); const running: Record<string, number> = {};
  payees.forEach((p) => (p.items ?? []).forEach((i) => {
    if (i.state === "running") { runCat.set(p.category, (runCat.get(p.category) ?? 0) + i.total); running[i.month] = (running[i.month] ?? 0) + i.total; return; }
    const pend = pendingOf(i); if (pend <= 0.004) return; months.add(i.month); const r = cells.get(p.category) ?? {}; r[i.month] = (r[i.month] ?? 0) + pend; cells.set(p.category, r);
  }));
  const order: Category[] = ["food", "transport", "accommodation", "gas", "equipment", "salary", "statutory"];
  return { months: [...months].sort(), running, rows: order.filter((c) => cells.has(c) || runCat.has(c)).map((c) => ({ category: c, cells: cells.get(c) ?? {}, running: runCat.get(c) ?? 0, total: Object.values(cells.get(c) ?? {}).reduce((s, n) => s + n, 0) })) };
}

const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
/** What a view is called, for the page heading and the PDF. */
export const titleOf = (v: View) => (v.scope === "now" ? `Pay now: overdue, and due in ${monthName(thisMonthOf(v.today))}` : v.scope === "all" ? "All time" : v.lens === "due" ? `Due in ${monthName(v.month)}` : `Costs of ${monthName(v.month)}`) + (v.running ? ", with running costs" : "");
