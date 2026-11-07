// What the signed-in person may change on the screen they are looking at, enforced in the browser so an attempt turns into a plain message instead of a technical error.
//   view   : nothing goes out (Viewer, or a module/tab set to View in the Permissions page)
//   create : new rows only (no update, upsert or delete)
//   edit   : everything except delete
//   full   : no limit
// The database still refuses what a role may never do; for modules whose rows other roles may already write, this is the guard. The shell sets it from the person's level in the module they are on,
// and tabbed screens (Meals, Payroll, Expenses) narrow it to the tab. See lib/perms.ts.
export type WriteLevel = "view" | "create" | "edit" | "full";
let level: WriteLevel = "full"; let viewer = false;
export const setReadOnly = (on: boolean) => { viewer = on; };          // the Viewer role: always view
export const setWriteLevel = (l: WriteLevel) => { level = l; };
const effective = (): WriteLevel => (viewer ? "view" : level);
export const VIEW_ONLY_MESSAGE = "You have view-only access, so nothing can be changed.";
const message = (l: WriteLevel) => (l === "view" ? VIEW_ONLY_MESSAGE : l === "create" ? "You can add new entries here but not change or remove existing ones." : "You can add and change entries here but not delete them.");
const READ_RPCS = new Set(["attendance_roster", "day_readiness", "is_admin", "is_staff", "is_viewer", "can_attend", "can_see", "relogin_before", "perm_level", "save_push_subscription"]);
const refused = (l: WriteLevel): any => new Proxy(function () { /* chainable stand-in for a query that was never sent */ }, {
  get: (_t, k) => (k === "then" ? (res: any, rej: any) => Promise.resolve({ data: null, error: { message: message(l), code: "view_only" }, count: null, status: 403, statusText: "not allowed" }).then(res, rej) : () => refused(l)),
  apply: () => refused(l),
});
const BLOCKED: Record<WriteLevel, string[]> = { view: ["insert", "update", "upsert", "delete"], create: ["update", "upsert", "delete"], edit: ["delete"], full: [] };
export const guard = <T extends object>(client: T): T => new Proxy(client, {
  get(target, key) {
    const value = (target as any)[key];
    if (key === "rpc") return (name: string, ...args: unknown[]) => { const l = effective(); return l === "view" && !READ_RPCS.has(name) ? refused(l) : value.call(target, name, ...args); };
    if (key === "from") return (table: string) => new Proxy(value.call(target, table), { get(q, qk) { const v = (q as any)[qk]; const l = effective(); if (BLOCKED[l].includes(qk as string)) return () => refused(l); return typeof v === "function" ? v.bind(q) : v; } });
    return typeof value === "function" ? value.bind(target) : value;
  },
});
