// A Viewer (read-only role) can look at everything and change nothing. The database already refuses every write from a Viewer; this turns an attempt into a plain message
// instead of a technical error, and stops it from going out at all. The app sets it as soon as it knows who is signed in (see me.ts).
let readOnly = false;
export const setReadOnly = (on: boolean) => { readOnly = on; };
export const VIEW_ONLY_MESSAGE = "You have view-only access, so nothing can be changed.";
const READ_RPCS = new Set(["attendance_roster", "day_readiness", "is_admin", "is_staff", "is_viewer", "can_attend", "can_see", "relogin_before"]);
const refused = (): any => new Proxy(function () { /* chainable stand-in for a query that was never sent */ }, {
  get: (_t, k) => (k === "then" ? (res: any, rej: any) => Promise.resolve({ data: null, error: { message: VIEW_ONLY_MESSAGE, code: "view_only" }, count: null, status: 403, statusText: "view only" }).then(res, rej) : () => refused()),
  apply: () => refused(),
});
export const guard = <T extends object>(client: T): T => new Proxy(client, {
  get(target, key) {
    const value = (target as any)[key];
    if (key === "rpc") return (name: string, ...args: unknown[]) => (readOnly && !READ_RPCS.has(name) ? refused() : value.call(target, name, ...args));
    if (key === "from") return (table: string) => new Proxy(value.call(target, table), { get(q, qk) { const v = (q as any)[qk]; if (readOnly && (qk === "insert" || qk === "update" || qk === "upsert" || qk === "delete")) return () => refused(); return typeof v === "function" ? v.bind(q) : v; } });
    return typeof value === "function" ? value.bind(target) : value;
  },
});

