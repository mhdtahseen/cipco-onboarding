"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { ROLE_LABEL, useRole } from "@/lib/roles";
import { NAV_SECTIONS, itemFor, visibleItems, type NavItem } from "@/lib/nav";
import { Icon } from "./NavIcons";

// The frame around every signed-in page.
//  desktop (≥1280px): a sidebar with section headings, collapsible to an icon rail
//  tablet  (768–1279): a permanent icon rail; its menu button opens the full labelled menu
//  phone   (<768):     a top bar with a menu button, a bottom bar with the main pages + More, and a slide-out menu
//  single-purpose logins (a supervisor): no sidebar and no bottom bar, just the top bar
const BARE = ["/login", "/apply"];   // login and the public candidate form carry no app chrome

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (BARE.some((p) => path.startsWith(p))) return <>{children}</>;
  return <Shell path={path}>{children}</Shell>;
}

function NavList({ items, path, showLabels, collapsed, onNavigate }: { items: NavItem[]; path: string; showLabels: "always" | "wide"; collapsed?: boolean; onNavigate?: () => void }) {
  // Every section is a group you can fold: the one holding the current page is always open, the others remember what you opened.
  // In the icon rail nothing folds, so every icon stays reachable.
  const current = itemFor(path); const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => { try { setOpened(JSON.parse(localStorage.getItem("cipco_nav_groups") || "[]")); } catch { /* storage unavailable */ } }, []);
  const toggle = (s: string, open: boolean) => { const next = open ? opened.filter((x) => x !== s) : [...opened, s]; setOpened(next); try { localStorage.setItem("cipco_nav_groups", JSON.stringify(next)); } catch { /* ignore */ } };
  const label = showLabels === "always" ? "" : collapsed ? "hidden" : "hidden xl:inline";
  const row = (i: NavItem) => { const on = current?.href === i.href; return (
    <Link key={i.href} href={i.href} onClick={onNavigate} title={i.label} aria-current={on ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 min-h-11 text-sm ${showLabels === "wide" ? (collapsed ? "justify-center" : "justify-center xl:justify-start") : ""} ${on ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}`}>
      <Icon name={i.icon} /><span className={label}>{i.label}</span>
    </Link>); };
  const divider = <div className={`mx-3 my-2 border-t border-slate-100 ${showLabels === "always" ? "" : collapsed ? "" : "xl:hidden"}`} />;
  const groups = NAV_SECTIONS.map((s) => ({ s, list: items.filter((i) => i.section === s) })).filter((g) => g.list.length);
  return (
    <nav aria-label="Main" className="space-y-0.5">
      {groups.map(({ s, list }, n) => {
        const open = opened.includes(s) || current?.section === s; const folded = showLabels === "always" ? !open : !open && !collapsed;
        return (
          <div key={s}>
            {n > 0 && showLabels === "wide" && divider}
            <button type="button" onClick={() => toggle(s, open)} aria-expanded={open} disabled={current?.section === s}
              className={`w-full items-center justify-between rounded-lg px-3 min-h-9 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 disabled:hover:text-slate-400 ${showLabels === "always" ? "flex" : collapsed ? "hidden" : "hidden xl:flex"}`}>
              {s}<Icon name="chevron-down" className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />
            </button>
            <div className={`grid transition-[grid-template-rows,visibility] duration-200 ease-out ${!folded ? "grid-rows-[1fr]" : showLabels === "always" ? "grid-rows-[0fr] invisible" : "grid-rows-[1fr] xl:grid-rows-[0fr] xl:invisible"}`}><div className="space-y-0.5 min-h-0 overflow-hidden">{list.map(row)}</div></div>
          </div>);
      })}
    </nav>
  );
}

function Account({ email, name, role }: { email: string; name: string; role: string | null }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null); const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const who = role ? ROLE_LABEL[role] : "";
  async function signOut() { await supabase().auth.signOut(); router.push("/login"); router.refresh(); }
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-full p-1 md:pr-2 hover:bg-slate-100 touch-manipulation min-h-11">
        <span className="h-9 w-9 rounded-full bg-[#1e4fa3] text-white grid place-items-center text-sm font-semibold">{(name || email || "?")[0].toUpperCase()}</span>
        <span className="hidden md:block text-left leading-tight"><span className="block text-xs text-slate-700 max-w-40 truncate">{name || email || "…"}</span><span className="block text-[11px] text-slate-400">{who}</span></span>
        <Icon name="chevron-down" className="hidden md:block h-4 w-4 text-slate-400" />
      </button>
      {open && <div role="menu" className="pop-in absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-lg p-2 z-50">
        <div className="px-3 py-2 border-b border-slate-100"><div className="text-sm font-medium break-all">{name || email}</div>{name && <div className="text-xs text-slate-500 break-all">{email}</div>}<div className="text-xs text-slate-500">{who}</div></div>
        <button type="button" role="menuitem" onClick={signOut} className="w-full flex items-center gap-2 px-3 min-h-11 mt-1 rounded-lg text-sm text-left hover:bg-slate-100"><Icon name="logout" className="h-4 w-4" />Sign out</button>
      </div>}
    </div>
  );
}

function Shell({ path, children }: { path: string; children: React.ReactNode }) {
  const router = useRouter(); const { role } = useRole(); const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [collapsed, setCollapsed] = useState(false); const [drawer, setDrawer] = useState(false); const [hint, setHint] = useState<"min" | "full">("full");
  const closeRef = useRef<HTMLButtonElement>(null);
  const items = visibleItems(role);
  const minimal = role ? items.length <= 1 : hint === "min";   // a single-purpose login gets no sidebar or bottom bar
  const item = itemFor(path); const title = path === "/no-access" ? "No access" : item?.label ?? "CIPCO Operations";

  // the name comes from the Users page; the email shows until one is set
  useEffect(() => { (async () => { const sb = supabase(); const { data } = await sb.auth.getUser(); setEmail(data.user?.email || ""); if (data.user) { const { data: p } = await sb.from("user_profiles").select("full_name").eq("user_id", data.user.id).maybeSingle(); setName(((p?.full_name as string) || "").trim()); } })(); }, []);
  useEffect(() => { try { setCollapsed(localStorage.getItem("cipco_nav_collapsed") === "1"); if (localStorage.getItem("cipco_nav_min") === "1") setHint("min"); } catch { /* storage unavailable */ } }, []);
  useEffect(() => { if (role) try { localStorage.setItem("cipco_nav_min", items.length <= 1 ? "1" : "0"); } catch { /* ignore */ } }, [role, items.length]);
  useEffect(() => { setDrawer(false); }, [path]);
  useEffect(() => {   // slide-out menu: Escape closes, the page behind does not scroll, and it closes if the window grows to desktop size
    if (!drawer) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    const mq = window.matchMedia("(min-width: 1280px)"); const wide = () => mq.matches && setDrawer(false);
    document.addEventListener("keydown", key); mq.addEventListener("change", wide); document.body.style.overflow = "hidden"; closeRef.current?.focus();
    return () => { document.removeEventListener("keydown", key); mq.removeEventListener("change", wide); document.body.style.overflow = ""; };
  }, [drawer]);

  async function signOut() { await supabase().auth.signOut(); router.push("/login"); router.refresh(); }
  const toggleSide = () => { if (window.matchMedia("(min-width: 1280px)").matches) { const v = !collapsed; setCollapsed(v); try { localStorage.setItem("cipco_nav_collapsed", v ? "1" : "0"); } catch { /* ignore */ } } else setDrawer(true); };
  const barItems = items.filter((i) => i.bar).slice(0, 4);
  const crumb = item ? <><span className="text-slate-400 hidden md:inline">{item.section}</span><span className="text-slate-300 hidden md:inline"> › </span><span className="font-semibold text-slate-800">{item.label}</span></> : <span className="font-semibold text-slate-800">{title}</span>;

  return (
    <div className={`min-h-screen ${minimal ? "" : "shell-has-bar"}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:bg-white focus:px-3 focus:py-2 focus:rounded-lg focus:shadow">Skip to content</a>

      {!minimal && <aside aria-label="Sidebar" className={`hidden md:flex flex-col fixed inset-y-0 left-0 z-30 bg-white border-r border-slate-200 print:hidden transition-[width] duration-200 ease-out ${collapsed ? "w-16" : "w-16 xl:w-64"}`}>
        <div className={`h-14 shrink-0 flex items-center gap-2 border-b border-slate-100 px-3 ${collapsed ? "justify-center" : "justify-center xl:justify-between"}`}>
          <Link href="/" aria-label="CIPCO home" className={`items-center gap-2 min-w-0 ${collapsed ? "hidden" : "hidden xl:flex"}`}><img src="/branding/logo.png" alt="CIPCO" className="h-7 w-auto" /><span className="text-sm font-semibold text-slate-500">Operations</span></Link>
          <button type="button" onClick={toggleSide} aria-label={collapsed ? "Expand sidebar" : "Menu"} title={collapsed ? "Expand sidebar" : "Menu"} className="h-10 w-10 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100 touch-manipulation"><Icon name={collapsed ? "chevron-right" : "menu"} /></button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2"><NavList items={items} path={path} showLabels="wide" collapsed={collapsed} /></div>
        {!collapsed && <div className="hidden xl:block p-3 border-t border-slate-100"><button type="button" onClick={toggleSide} className="w-full flex items-center gap-2 px-3 min-h-10 rounded-lg text-xs text-slate-500 hover:bg-slate-100"><Icon name="chevron-left" className="h-4 w-4" />Collapse</button></div>}
      </aside>}

      <div className={`transition-[padding] duration-200 ease-out ${minimal ? "" : collapsed ? "md:pl-16" : "md:pl-16 xl:pl-64"}`}>
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-slate-200 flex items-center gap-2 px-3 sm:px-4 print:hidden">
          {!minimal && <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="md:hidden h-11 w-11 -ml-1 grid place-items-center rounded-lg text-slate-600 hover:bg-slate-100 touch-manipulation"><Icon name="menu" /></button>}
          <Link href="/" aria-label="CIPCO home" className={`shrink-0 items-center gap-2 ${minimal ? "flex" : "hidden"}`}><img src="/branding/logo.png" alt="CIPCO" className="h-7 w-auto" /></Link>
          <div className="min-w-0 flex-1 truncate text-sm">{crumb}</div>
          <Account email={email} name={name} role={role} />
        </header>
        <main id="main" className="max-w-6xl mx-auto px-4 py-4 sm:py-6">{children}</main>
        {!minimal && <div className="md:hidden h-[var(--bottom-nav-h,0px)]" aria-hidden />}
      </div>

      {!minimal && <nav aria-label="Quick links" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)] print:hidden">
        <div className="grid h-14" style={{ gridTemplateColumns: `repeat(${barItems.length + 1}, minmax(0, 1fr))` }}>
          {barItems.map((i) => { const on = item?.href === i.href; return (
            <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={`flex flex-col items-center justify-center gap-0.5 text-[11px] touch-manipulation ${on ? "text-blue-800 font-semibold" : "text-slate-500"}`}><Icon name={i.icon} className="h-6 w-6" /><span className="max-w-full truncate px-1">{i.label}</span></Link>); })}
          <button type="button" onClick={() => setDrawer(true)} aria-label="More" className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-slate-500 touch-manipulation"><Icon name="grid" className="h-6 w-6" /><span>More</span></button>
        </div>
      </nav>}

      <div className="overlay z-50 xl:hidden print:hidden" data-open={drawer} role="dialog" aria-modal="true" aria-label="Menu">
        <div className="overlay-bg bg-slate-900/40" onClick={() => setDrawer(false)} />
        <div className="overlay-panel from-left absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl flex flex-col pt-[env(safe-area-inset-top)]">
          <div className="h-14 shrink-0 px-4 flex items-center gap-2 border-b border-slate-100"><img src="/branding/logo.png" alt="CIPCO" className="h-7 w-auto" /><span className="text-sm font-semibold text-slate-500">Operations</span>
            <button ref={closeRef} type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="ml-auto h-11 w-11 -mr-2 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><Icon name="x" /></button></div>
          <div className="flex-1 overflow-y-auto p-3"><NavList items={items} path={path} showLabels="always" onNavigate={() => setDrawer(false)} /></div>
          <div className="border-t border-slate-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><div className="px-3 pb-2"><div className="text-sm font-medium break-all">{name || email}</div>{name && <div className="text-xs text-slate-500 break-all">{email}</div>}<div className="text-xs text-slate-500">{role ? ROLE_LABEL[role] : ""}</div></div><button type="button" onClick={signOut} className="w-full flex items-center gap-3 px-3 min-h-11 rounded-lg text-sm text-slate-600 hover:bg-slate-100"><Icon name="logout" />Sign out</button></div>
        </div>
      </div>
    </div>
  );
}
