// Practice mode (2026-11-practice-mode.sql): a person learning the app (a Supervisor not yet officially onboarded) uses their real role and sees
// the real data, but nothing they change reaches the database. Each save is kept here, in this browser tab only, and laid over every later read
// of that table, so the screen behaves as if it had been saved (the daily sheet re-reads every few seconds and still shows it). A refresh forgets it all.
// Anything that would leave the app (emails, notifications, file uploads, letters, the portal) is stopped with a plain message instead.
// This is a browser guard: the database still treats them as their real role, so it is for trusted trainees, not a security boundary.

export const PRACTICE_MESSAGE = "Practice mode: this isn't sent or saved.";
let on = false;
export const isPractice = () => on;

type Call = [string, unknown[]];
type Op = { kind: "put"; key: string[]; rows: Record<string, unknown>[] } | { kind: "patch"; calls: Call[]; patch: Record<string, unknown> } | { kind: "drop"; calls: Call[] };
const ops = new Map<string, Op[]>();   // table → what was "saved", in order
const opsFor = (t: string) => { let l = ops.get(t); if (!l) ops.set(t, (l = [])); return l; };

// Filters that can be checked here, against a row in the browser. Anything else (or, ilike, not, …) is "can't tell", and such rows are left alone.
const SHAPE = new Set(["select", "order", "limit", "range", "single", "maybeSingle", "returns", "throwOnError", "abortSignal", "csv", "explain", "overrideTypes"]);
const same = (a: unknown, b: unknown) => (a == null || b == null ? a == null && b == null : String(a) === String(b));
function matches(row: Record<string, any>, calls: Call[]): boolean | null {
  for (const [m, a] of calls) {
    if (SHAPE.has(m)) continue;
    const [col, v] = a as [string, any];
    const x = row[col];
    if (m === "eq") { if (!same(x, v)) return false; }
    else if (m === "neq") { if (same(x, v)) return false; }
    else if (m === "in") { if (!(v as unknown[]).some((y) => same(x, y))) return false; }
    else if (m === "is") { if (v === null ? x != null : x !== v) return false; }
    else if (m === "gt" || m === "gte" || m === "lt" || m === "lte") { if (x == null) return false; const c = typeof v === "number" ? Number(x) - v : String(x).localeCompare(String(v)); if (m === "gt" ? c <= 0 : m === "gte" ? c < 0 : m === "lt" ? c >= 0 : c > 0) return false; }
    else if (m === "match") { if (!Object.entries(col as unknown as Record<string, unknown>).every(([k, y]) => same(row[k], y))) return false; }
    else return null;
  }
  return true;
}

/** Lay the practice saves for `table` over what the database returned for a read with these filters. */
function overlay(table: string, res: any, calls: Call[]) {
  const list = ops.get(table); if (!list?.length || !res || res.error && !calls.some(([m]) => m === "single")) return res;
  const one = calls.some(([m]) => m === "single" || m === "maybeSingle");
  if (!one && !Array.isArray(res.data)) return res;   // a count-only read
  let rows: Record<string, any>[] = one ? (res.data ? [res.data] : []) : [...res.data];
  for (const op of list) {
    if (op.kind === "put") op.rows.forEach((r) => { const i = rows.findIndex((x) => op.key.every((k) => same(x[k], r[k]))); if (i >= 0) rows[i] = { ...rows[i], ...r }; else if (matches(r, calls) === true) rows.push({ ...r }); });
    else if (op.kind === "patch") rows = rows.map((x) => (matches(x, op.calls) === true ? { ...x, ...op.patch } : x));
    else rows = rows.filter((x) => matches(x, op.calls) !== true);
  }
  if (one) return rows.length ? { ...res, data: rows[0], error: null, status: 200 } : { ...res, data: null };
  return { ...res, data: rows, count: res.count == null ? res.count : rows.length };
}

/** A read query: passed to the database as normal, its result has the practice saves laid over it. */
export function practiceRead(table: string, builder: any, calls: Call[] = []): any {
  return new Proxy(builder, {
    get(b, k) {
      if (k === "then") return (res: any, rej: any) => b.then((r: any) => overlay(table, r, calls)).then(res, rej);
      const v = b[k]; if (typeof v !== "function") return v;
      return (...a: unknown[]) => { const out = v.apply(b, a); const next: Call[] = [...calls, [String(k), a]]; return out && typeof out === "object" && typeof out.then === "function" ? practiceRead(table, out, next) : out; };
    },
  });
}

/** insert / upsert / update / delete: kept here instead of being sent. Answers like the database would, including .select() / .single(). */
export function practiceWrite(client: any, table: string, op: "insert" | "upsert" | "update" | "delete", payload: any, opts: any): any {
  const calls: Call[] = []; let sel: string | null = null; let single: "single" | "maybe" | null = null;
  const run = async () => {
    const now = new Date().toISOString(); let reads: Call[][] = [];
    if (op === "insert" || op === "upsert") {
      const key = op === "upsert" && opts?.onConflict ? String(opts.onConflict).split(",").map((s: string) => s.trim()) : ["id"];
      const rows = (Array.isArray(payload) ? payload : [payload]).map((r: Record<string, unknown>): Record<string, unknown> => ({ ...(key.includes("id") && r.id == null ? { id: crypto.randomUUID() } : {}), updated_at: now, ...r }));
      opsFor(table).push({ kind: "put", key, rows: rows.map((r) => (op === "insert" ? { created_at: now, ...r } : r)) });
      reads = rows.map((r) => key.map((k) => ["eq", [k, r[k]]] as Call));
    } else if (op === "update") { opsFor(table).push({ kind: "patch", calls, patch: { updated_at: now, ...payload } }); reads = [calls]; }
    else { if (sel !== null) reads = [calls]; }   // a delete that asks for the removed rows back gets them (read before the drop is recorded)
    let data: any = null;
    if (sel !== null) {
      const got = await Promise.all(reads.map(async (c) => { let q: any = practiceRead(table, client.from(table).select(sel || "*")); for (const [m, a] of c) if (!SHAPE.has(m) && typeof q[m] === "function") q = q[m](...a); const r = await q; return (r.data || []) as unknown[]; }));
      data = got.flat();
    }
    if (op === "delete") opsFor(table).push({ kind: "drop", calls });
    if (single && Array.isArray(data)) data = data[0] ?? null;
    return { data, error: null, count: null, status: op === "insert" ? 201 : 200, statusText: "OK" };
  };
  const chain: any = new Proxy(function () { /* stand-in */ }, {
    get: (_t, k) => {
      if (k === "then") return (res: any, rej: any) => run().then(res, rej);
      if (k === "catch" || k === "finally") return (f: any) => (run() as any)[k](f);
      if (typeof k === "symbol") return undefined;
      if (k === "select") return (cols?: string) => { sel = cols ?? "*"; return chain; };
      if (k === "single") return () => { single = "single"; return chain; };
      if (k === "maybeSingle") return () => { single = "maybe"; return chain; };
      return (...a: unknown[]) => { calls.push([String(k), a]); return chain; };
    },
  });
  return chain;
}

// Database functions that only look things up: these run as normal. Any other function call (it would change something) is answered "done" and not sent.
const LOOKUPS = new Set(["attendance_roster", "day_readiness", "is_admin", "is_staff", "is_viewer", "can_attend", "can_see", "relogin_before", "perm_level", "save_push_subscription", "usage_beat",
  "invite_get", "ps_states", "ps_districts", "ps_stations", "admin_list_users", "day_watch_snapshot", "day_grant_candidates", "gas_low_stock", "gas_order_recipients", "inventory_project_wos", "inventory_project_people", "employee_slips", "employee_advance_balance", "logins_due_to_disable"]);
export const practiceRpc = (name: string) => !LOOKUPS.has(name);
export const practiceRpcResult = () => Promise.resolve({ data: null, error: null, count: null, status: 200, statusText: "OK" });

// Server routes: reading (GET) is fine; anything that sends, uploads or issues is stopped. Notifications pretend to go, so the screen carries on.
const PRETEND = ["/api/notify", "/api/gas/notify", "/api/gas/low-stock"];
const ALLOW = ["/api/usage/"];
let fetchWrapped = false;
function wrapFetch() {
  if (fetchWrapped || typeof window === "undefined") return; fetchWrapped = true;
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!on) return real(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
    const method = (init?.method || (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    if (!path.startsWith("/api/") || method === "GET" || method === "HEAD" || ALLOW.some((p) => path.startsWith(p))) return real(input, init);
    const json = (body: unknown, status: number) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    return PRETEND.some((p) => path.startsWith(p)) ? json({ ok: true, practice: true }, 200) : json({ error: PRACTICE_MESSAGE }, 403);
  };
}

export const setPractice = (v: boolean) => { if (on && !v) ops.clear(); on = v; if (v) wrapFetch(); };
