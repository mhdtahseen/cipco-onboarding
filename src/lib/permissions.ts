// Who may do what, per module and per tab. Pure data and functions (no React, no database), so the menu, the page guard in middleware and the Permissions page all read the same rules.
//
// A level is what a role may do in a module:
//   none   cannot open it (it is not in their menu)
//   view   can look, cannot change anything
//   create can look and add new entries, cannot change or remove existing ones
//   edit   can look, add and change, cannot delete or void
//   full   everything the module offers (delete, void, reopen) except the things only an Admin can ever do (approve payroll, authorize the JSL portal, users and permissions)
// Admin always has full on everything and cannot be changed. The Permissions page (Admin only) edits the matrix; until the matrix table exists in the database the DEFAULTS below apply.
export const LEVELS = ["none", "view", "create", "edit", "full"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_INFO: Record<Level, { label: string; help: string }> = {
  none: { label: "No access", help: "Not in the menu and the page cannot be opened." },
  view: { label: "View", help: "Can look at everything. Nothing can be added or changed." },
  create: { label: "Create", help: "Can look and add new entries. Cannot change or remove existing ones." },
  edit: { label: "Edit", help: "Can look, add and change. Cannot delete or void." },
  full: { label: "Full", help: "Can also delete, void and reopen. Admin-only actions (approving payroll, the JSL portal, users) still need an Admin." },
};
export const levelRank = (l: Level | string | null | undefined) => Math.max(0, LEVELS.indexOf((l ?? "none") as Level));
export const atLeast = (have: Level, need: Level) => levelRank(have) >= levelRank(need);
export type Action = "view" | "create" | "edit" | "delete";
export const ACTION_NEEDS: Record<Action, Level> = { view: "view", create: "create", edit: "edit", delete: "full" };

/** The roles an Admin can set. Admin is fixed at full; "none" has nothing. */
export type RoleKey = "staff" | "site_engineer" | "supervisor" | "viewer";
export const CONTROLLED_ROLES: { key: RoleKey; label: string; blurb: string }[] = [
  { key: "staff", label: "Operations", blurb: "Office staff who run the day-to-day." },
  { key: "site_engineer", label: "Site Engineer", blurb: "On site; works on the projects they are assigned." },
  { key: "supervisor", label: "Supervisor", blurb: "On site; attendance and site entries for assigned projects." },
  { key: "viewer", label: "Viewer", blurb: "Read-only. The levels above View are ignored for this role." },
];

export type Tab = { key: string; label: string };
export type Module = { key: string; label: string; section: string; tabs?: Tab[]; adminOnly?: boolean; note?: string };
export const SECTIONS = ["People", "Operations", "Sales", "Templates", "Admin"] as const;
export const MODULES: Module[] = [
  { key: "employees", label: "Employees", section: "People" },
  { key: "payroll", label: "Payroll", section: "People", tabs: [{ key: "run", label: "Run" }, { key: "pay", label: "Pay" }, { key: "slips", label: "Salary slips" }, { key: "statutory", label: "PF / ESI" }, { key: "advances", label: "Advances" }], note: "Approving, reopening and paying out a payroll run stay Admin-only whatever the level." },
  { key: "attendance", label: "Attendance", section: "People" },
  { key: "projects", label: "Projects", section: "Operations", note: "Project expenses are under Expenses." },
  { key: "sites", label: "Sites today", section: "Operations" },
  { key: "transport", label: "Transport", section: "Operations" },
  { key: "meals", label: "Meals", section: "Operations", tabs: [{ key: "overview", label: "Overview" }, { key: "daily", label: "Daily log" }, { key: "people", label: "People" }, { key: "vendors", label: "Vendors & prices" }, { key: "bills", label: "Bills" }, { key: "payments", label: "Payments" }, { key: "reports", label: "Reports" }] },
  { key: "accommodation", label: "Accommodation", section: "Operations" },
  { key: "site_supplies", label: "Site supplies", section: "Operations", note: "Gas cylinders and hired equipment." },
  { key: "inventory", label: "Inventory", section: "Operations", note: "Sending a bill to the JSL portal stays Admin-only." },
  { key: "tools", label: "Tools & equipment", section: "Operations", note: "What the company owns and where it is. Changes need Admin or Operations whatever is set here." },
  { key: "expenses", label: "Expenses", section: "Operations", tabs: [{ key: "due", label: "Due" }, { key: "spent", label: "Spent" }] },
  { key: "quotations", label: "Quotations", section: "Sales" },
  { key: "invoices", label: "Invoices", section: "Sales" },
  { key: "work_orders", label: "Work orders", section: "Sales" },
  { key: "clients", label: "Clients", section: "Sales" },
  { key: "clauses", label: "Clause library", section: "Templates" },
  { key: "mail_templates", label: "Mail templates", section: "Templates" },
  { key: "quote_library", label: "Quotation wording", section: "Templates" },
  { key: "settings", label: "Settings", section: "Admin" },
  { key: "locations", label: "Locations", section: "Admin" },
];
export const moduleOf = (key: string) => MODULES.find((m) => m.key === key);
/** The key stored for a tab: "meals.bills". */
export const tabKey = (module: string, tab: string) => `${module}.${tab}`;
export const ALL_KEYS = MODULES.flatMap((m) => [m.key, ...(m.tabs ?? []).map((t) => tabKey(m.key, t.key))]);

// ---------- defaults ----------
// What each role gets until an Admin changes it. This reproduces how the app behaved before the Permissions page, plus the Operations decisions of 2026-11-07:
// Quotations create/read/update, Payroll and Clients, and view-only for Projects, Expenses and Meals (Overview, Daily log, People, Bills).
type Row = Record<string, Level>;
const staff: Row = {
  employees: "full", payroll: "edit", attendance: "full", projects: "view", site_supplies: "full", inventory: "full", tools: "full", expenses: "view",
  quotations: "edit", clients: "edit", clauses: "full", mail_templates: "full", quote_library: "full", settings: "full",
  "meals.overview": "view", "meals.daily": "view", "meals.people": "view", "meals.bills": "view",
};
const siteRole: Row = { attendance: "edit", inventory: "edit" };
const viewer: Row = Object.fromEntries(MODULES.map((m) => [m.key, "view" as Level]));
export const DEFAULTS: Record<RoleKey, Row> = { staff, site_engineer: siteRole, supervisor: siteRole, viewer };

export type Matrix = Record<string, Level>;   // one role's rows, keyed "module" or "module.tab"; a missing key means none
export const normRole = (r: string | null | undefined): string => (r === "attendance" ? "supervisor" : r ?? "none");

/** The level a role has in a module, or in one tab of it (a tab with no row of its own takes the module's level). Admin is full everywhere. */
export function levelIn(role: string | null | undefined, m: Matrix | null, module: string, tab?: string): Level {
  const r = normRole(role); if (r === "admin") return "full"; if (r === "none" || !r) return "none";
  const rows: Matrix = m ?? (DEFAULTS[r as RoleKey] as Matrix) ?? {};
  const base = rows[module] ?? "none";
  if (r === "viewer") return levelRank(rows[tab ? tabKey(module, tab) : module] ?? base) > 0 ? "view" : "none";   // a Viewer never gets more than View
  return tab ? rows[tabKey(module, tab)] ?? base : base;
}
/** The most a role can do anywhere in a module (its own level or any tab's): what decides whether the page opens at all. */
export function openLevel(role: string | null | undefined, m: Matrix | null, module: string): Level {
  const mod = moduleOf(module); let best = levelIn(role, m, module);
  (mod?.tabs ?? []).forEach((t) => { const l = levelIn(role, m, module, t.key); if (levelRank(l) > levelRank(best)) best = l; });
  return best;
}
export const canDo = (have: Level, action: Action) => atLeast(have, ACTION_NEEDS[action]);

// Data routes that belong to a module although they are not menu pages: prefix -> module (and tab). A write needs create, a read needs view.
export const API_MODULES: [prefix: string, module: string, tab?: string][] = [
  ["/api/payroll-register", "payroll"], ["/api/payroll-bank-letter", "payroll"], ["/api/payslips", "payroll"],
  ["/api/payments-due", "expenses", "due"], ["/api/vendor-statement", "meals"], ["/api/quotations", "quotations"], ["/api/invoices", "invoices"],
];
export const apiModuleOf = (path: string) => API_MODULES.find(([p]) => path === p || path.startsWith(p + "/"));
