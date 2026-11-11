// The ONE list of pages in the app. The sidebar, the phone tab bar, the slide-out menu and the route guard all read it,
// so adding a module (Payroll, Invoices, Inventory…) means adding an entry here and nothing else.
// Pure data + helpers (no React), so the server-side route guard can import it too.
import { apiModuleOf, levelRank, levelIn, openLevel, type Matrix } from "./permissions";
export type NavRole = "admin" | "staff" | "site_engineer" | "supervisor" | "attendance" | "viewer";   // "attendance" = the old name for Supervisor, kept so the app still works before the migration renames it
export type IconName = "users" | "user-check" | "crane" | "calculator" | "book" | "mail" | "quote" | "gear" | "user-cog" | "building" | "truck" | "utensils" | "bed" | "wallet" | "pin" | "wheelbarrow" | "box" | "rupee-down" | "receipt" | "clipboard-list" | "hard-hat" | "wrench" | "key";
export type NavItem = {
  href: string;            // where the link goes
  label: string;
  icon: IconName;
  section: string;         // heading in the sidebar (see NAV_SECTIONS for the order)
  roles: NavRole[];        // who sees it AND who may open it (admin may always open everything)
  paths: string[];         // addresses that belong to this item; "/" matches only the home page, others match themselves and anything under them
  module?: string;         // the permission module this page belongs to (see permissions.ts); pages without one follow `roles`
  bar?: boolean | NavRole[];   // also shown on the phone's bottom bar (the first four that a role can see): true for every role, or only for the listed roles
};

export const NAV_SECTIONS = ["People", "Operations", "Sales", "Templates", "Admin"] as const;

// Site supplies (gas cylinders and hired equipment) is open to Supervisors and Site Engineers too, with no money shown: gas stock, recording runs and changes, the runs and
// their challans, and equipment start / stop. Set this to false to take it away from them again: the menu, the bottom bar, the page guard and the gas routes all follow it.
const SITE_ROLES_GET_CONSUMABLES = true;
const CONSUMABLES_ROLES: NavRole[] = SITE_ROLES_GET_CONSUMABLES ? ["admin", "staff", "site_engineer", "supervisor", "attendance", "viewer"] : ["admin", "staff", "viewer"];
const CONSUMABLES_BAR: NavRole[] = SITE_ROLES_GET_CONSUMABLES ? ["site_engineer", "supervisor", "attendance"] : [];

export const NAV: NavItem[] = [
  { href: "/", label: "Employees", icon: "users", section: "People", module: "employees", roles: ["admin", "staff", "viewer"], paths: ["/", "/employees"], bar: true },
  { href: "/payroll", label: "Payroll", icon: "wallet", section: "People", module: "payroll", roles: ["admin", "viewer"], paths: ["/payroll"] },
  { href: "/attendance", label: "Attendance", icon: "user-check", section: "People", module: "attendance", roles: ["admin", "staff", "site_engineer", "supervisor", "attendance", "viewer"], paths: ["/attendance"], bar: true },
  { href: "/projects", label: "Projects", icon: "crane", section: "Operations", module: "projects", roles: ["admin", "staff", "viewer"], paths: ["/projects"], bar: true },
  { href: "/sites", label: "Sites today", icon: "hard-hat", section: "Operations", module: "sites", roles: ["admin", "viewer"], paths: ["/sites"], bar: ["viewer"] },
  { href: "/transport", label: "Transport", icon: "truck", section: "Operations", module: "transport", roles: ["admin", "viewer"], paths: ["/transport"] },
  { href: "/meals", label: "Meals", icon: "utensils", section: "Operations", module: "meals", roles: ["admin", "viewer"], paths: ["/meals"] },
  { href: "/accommodation", label: "Accommodation", icon: "bed", section: "Operations", module: "accommodation", roles: ["admin", "viewer"], paths: ["/accommodation"] },
  { href: "/site-supplies", label: "Site supplies", icon: "wheelbarrow", section: "Operations", module: "site_supplies", roles: CONSUMABLES_ROLES, paths: ["/site-supplies", "/gas", "/equipment", "/api/gas"], bar: CONSUMABLES_BAR },
  { href: "/inventory", label: "Inventory", icon: "box", section: "Operations", module: "inventory", roles: ["admin", "staff", "site_engineer", "supervisor", "attendance", "viewer"], paths: ["/inventory", "/api/inventory"], bar: ["site_engineer", "supervisor", "attendance"] },
  { href: "/tools", label: "Tools & equipment", icon: "wrench", section: "Operations", module: "tools", roles: ["admin", "staff", "viewer"], paths: ["/tools", "/api/tools"] },
  { href: "/expenses", label: "Expenses", icon: "rupee-down", section: "Operations", module: "expenses", roles: ["admin", "staff", "viewer"], paths: ["/expenses", "/payments-due"] },
  { href: "/quotations", label: "Quotations", icon: "calculator", section: "Sales", module: "quotations", roles: ["admin", "staff", "viewer"], paths: ["/quotations"], bar: true },
  { href: "/invoices", label: "Invoices", icon: "receipt", section: "Sales", module: "invoices", roles: ["admin", "viewer"], paths: ["/invoices"] },
  { href: "/work-orders", label: "Work orders", icon: "clipboard-list", section: "Sales", module: "work_orders", roles: ["admin", "viewer"], paths: ["/work-orders"] },
  { href: "/clients", label: "Clients", icon: "building", section: "Sales", module: "clients", roles: ["admin", "staff", "viewer"], paths: ["/clients"] },
  { href: "/clauses", label: "Clause library", icon: "book", section: "Templates", module: "clauses", roles: ["admin", "staff", "viewer"], paths: ["/clauses"] },
  { href: "/mail-templates", label: "Mail templates", icon: "mail", section: "Templates", module: "mail_templates", roles: ["admin", "staff", "viewer"], paths: ["/mail-templates"] },
  { href: "/quote-library", label: "Quotation wording", icon: "quote", section: "Templates", module: "quote_library", roles: ["admin", "staff", "viewer"], paths: ["/quote-library"] },
  { href: "/settings", label: "Settings", icon: "gear", section: "Admin", module: "settings", roles: ["admin", "staff", "viewer"], paths: ["/settings"] },
  { href: "/locations", label: "Locations", icon: "pin", section: "Admin", module: "locations", roles: ["admin", "viewer"], paths: ["/locations"] },
  { href: "/users", label: "Users", icon: "user-cog", section: "Admin", roles: ["admin"], paths: ["/users"] },
  { href: "/permissions", label: "Permissions", icon: "key", section: "Admin", roles: ["admin"], paths: ["/permissions"] },
  // Coming: People → Payroll · Sales → Invoices, Clients · Operations → Stock, Suppliers  (see to-do.md)
];

const matches = (path: string, p: string) => (p === "/" ? path === "/" : path === p || path.startsWith(p + "/"));
export const itemFor = (path: string) => NAV.find((i) => i.paths.some((p) => matches(path, p)));
/** The menu for a role under the permission matrix (null = the built-in defaults): a page shows when the role can open its module; pages with no module follow `roles`. */
export const visibleItemsWith = (role: string | null | undefined, m: Matrix | null) => NAV.filter((i) => !!role && (role === "admin" || (i.module ? levelRank(openLevel(role, m, i.module)) > 0 : i.roles.includes(role as NavRole))));
export const visibleItems = (role: string | null | undefined) => NAV.filter((i) => !!role && i.roles.includes(role as NavRole));
/** When this login session began, in ms: the latest sign-in time recorded in the token ("amr"), which stays the same when the token is quietly renewed,
 *  else the token's own issue time. null when the token says neither. Used to sign out everyone who signed in before a chosen moment. */
export function signedInAtMs(claims: unknown): number | null {
  const c = claims as { amr?: { timestamp?: unknown }[]; iat?: unknown } | null | undefined;
  const stamps = (Array.isArray(c?.amr) ? c!.amr! : []).map((a) => a?.timestamp).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const s = stamps.length ? Math.max(...stamps) : typeof c?.iat === "number" ? c.iat : null;
  return s === null ? null : s * 1000;
}

/** The role carried in a verified login token (the "app_role" claim added by the database hook), or null when the token has none:
 *  the hook is not switched on yet, or this is a token issued before it was. Anything that is not a non-empty string is ignored. */
export function roleFromClaims(claims: unknown): string | null {
  const v = (claims as { app_role?: unknown } | null | undefined)?.app_role;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export const homeFor = (role: string) => (role === "attendance" || role === "supervisor" || role === "site_engineer" ? "/attendance" : role === "viewer" ? "/sites" : role === "none" ? "/no-access" : "/");

/** May this role open this address? Used by the route guard (middleware). Addresses that are not menu pages (data routes) are for staff and admin only. */
export function canAccess(role: string, path: string, method = "GET"): boolean {
  if (role === "admin") return true;
  if (path === "/no-access") return true;
  if (role === "none") return false;
  if (path === "/api/usage/beat" || path === "/api/usage/event") return true;   // the app's own activity signal, sent by everyone signed in (2026-11-usage-activity.sql)
  const item = itemFor(path);
  // a Viewer reads only: the menu pages above, and data routes (documents, PDFs, exports) when they are asked for with GET. Every route that saves or sends something is POST and is refused.
  if (role === "viewer" && !item) return method === "GET" || method === "HEAD";
  return item ? item.roles.includes(role as NavRole) : role === "staff";
}

/** The same question as canAccess, under the permission matrix (null = the built-in defaults). A page opens when the role can open its module (or the tab a data route belongs to);
 *  anything that saves or sends needs Create or more. Pages with no module (Users, Permissions) are Admin only; unknown data routes keep the old rules. */
export function canAccessWith(role: string, path: string, method: string, m: Matrix | null): boolean {
  if (role === "admin" || path === "/no-access") return true;
  if (role === "none") return false;
  if (path === "/api/usage/beat" || path === "/api/usage/event") return true;   // the app's own activity signal, sent by everyone signed in
  const write = !(method === "GET" || method === "HEAD");
  const item = itemFor(path);
  if (item?.module) return levelRank(openLevel(role, m, item.module)) >= (write ? 2 : 1);
  if (item) return item.roles.includes(role as NavRole);
  const api = apiModuleOf(path);
  if (api) { const have = api[2] ? levelIn(role, m, api[1], api[2]) : openLevel(role, m, api[1]); return levelRank(have) >= (write ? 2 : 1); }
  return canAccess(role, path, method);
}
