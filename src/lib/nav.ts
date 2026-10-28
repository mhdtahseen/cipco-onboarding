// The ONE list of pages in the app. The sidebar, the phone tab bar, the slide-out menu and the route guard all read it,
// so adding a module (Payroll, Invoices, Inventory…) means adding an entry here and nothing else.
// Pure data + helpers (no React), so the server-side route guard can import it too.
export type NavRole = "admin" | "staff" | "site_engineer" | "supervisor" | "attendance";   // "attendance" = the old name for Supervisor, kept so the app still works before the migration renames it
export type IconName = "users" | "clipboard" | "folder" | "file" | "book" | "mail" | "list" | "sliders" | "shield" | "building" | "truck" | "utensils" | "bed";
export type NavItem = {
  href: string;            // where the link goes
  label: string;
  icon: IconName;
  section: string;         // heading in the sidebar (see NAV_SECTIONS for the order)
  roles: NavRole[];        // who sees it AND who may open it (admin may always open everything)
  paths: string[];         // addresses that belong to this item; "/" matches only the home page, others match themselves and anything under them
  bar?: boolean;           // also shown on the phone's bottom bar (the first four that a role can see)
};

export const NAV_SECTIONS = ["People", "Operations", "Sales", "Templates", "Admin"] as const;

export const NAV: NavItem[] = [
  { href: "/", label: "Employees", icon: "users", section: "People", roles: ["admin", "staff"], paths: ["/", "/employees"], bar: true },
  { href: "/attendance", label: "Attendance", icon: "clipboard", section: "People", roles: ["admin", "staff", "site_engineer", "supervisor", "attendance"], paths: ["/attendance"], bar: true },
  { href: "/projects", label: "Projects", icon: "folder", section: "Operations", roles: ["admin", "staff"], paths: ["/projects"], bar: true },
  { href: "/sites", label: "Sites today", icon: "building", section: "Operations", roles: ["admin"], paths: ["/sites"] },
  { href: "/transport", label: "Transport", icon: "truck", section: "Operations", roles: ["admin"], paths: ["/transport"] },
  { href: "/meals", label: "Meals", icon: "utensils", section: "Operations", roles: ["admin"], paths: ["/meals"] },
  { href: "/accommodation", label: "Accommodation", icon: "bed", section: "Operations", roles: ["admin"], paths: ["/accommodation"] },
  { href: "/quotations", label: "Quotations", icon: "file", section: "Sales", roles: ["admin", "staff"], paths: ["/quotations"], bar: true },
  { href: "/clauses", label: "Clause library", icon: "book", section: "Templates", roles: ["admin", "staff"], paths: ["/clauses"] },
  { href: "/mail-templates", label: "Mail templates", icon: "mail", section: "Templates", roles: ["admin", "staff"], paths: ["/mail-templates"] },
  { href: "/quote-library", label: "Quotation wording", icon: "list", section: "Templates", roles: ["admin", "staff"], paths: ["/quote-library"] },
  { href: "/settings", label: "Settings", icon: "sliders", section: "Admin", roles: ["admin", "staff"], paths: ["/settings"] },
  { href: "/users", label: "Users", icon: "shield", section: "Admin", roles: ["admin"], paths: ["/users"] },
  // Coming: People → Payroll · Sales → Invoices, Clients · Operations → Stock, Suppliers  (see to-do.md)
];

const matches = (path: string, p: string) => (p === "/" ? path === "/" : path === p || path.startsWith(p + "/"));
export const itemFor = (path: string) => NAV.find((i) => i.paths.some((p) => matches(path, p)));
export const visibleItems = (role: string | null | undefined) => NAV.filter((i) => !!role && i.roles.includes(role as NavRole));
export const homeFor = (role: string) => (role === "attendance" || role === "supervisor" || role === "site_engineer" ? "/attendance" : role === "none" ? "/no-access" : "/");

/** May this role open this address? Used by the route guard (middleware). Addresses that are not menu pages (data routes) are for staff and admin only. */
export function canAccess(role: string, path: string): boolean {
  if (role === "admin") return true;
  if (path === "/no-access") return true;
  if (role === "none") return false;
  const item = itemFor(path);
  return item ? item.roles.includes(role as NavRole) : role === "staff";
}
