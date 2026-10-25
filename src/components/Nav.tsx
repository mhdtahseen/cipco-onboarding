"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function Nav() {
  const path = usePathname(); const router = useRouter(); const [email, setEmail] = useState("");
  useEffect(() => { supabase().auth.getUser().then(({ data }) => setEmail(data.user?.email || "")); }, []);
  if (path.startsWith("/login") || path.startsWith("/apply")) return null;
  const link = (href: string, label: string) => (
    <Link href={href} className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap ${path === href || (href !== "/" && path.startsWith(href)) ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>);
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-4 py-2 sm:py-0 sm:h-14 flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1">
        <Link href="/" className="sm:mr-3 mr-auto shrink-0 flex items-center gap-2"><img src="/branding/logo.png" alt="CIPCO" className="h-7 w-auto" /><span className="hidden sm:inline text-sm font-semibold text-slate-500">Operations</span></Link>
        <nav className="order-last sm:order-none w-full sm:w-auto flex items-center gap-1 overflow-x-auto -mx-1 px-1">{link("/", "Employees")}{link("/quotations", "Quotations")}{link("/projects", "Projects")}{link("/clauses", "Clause library")}{link("/mail-templates", "Mail templates")}</nav>
        {email && <span className="ml-auto hidden md:inline text-xs text-slate-500 truncate max-w-48" title={email}>{email}</span>}
        <button className={`btn shrink-0 ${email ? "" : "ml-auto"}`} onClick={async () => { await supabase().auth.signOut(); router.push("/login"); router.refresh(); }}>Sign out</button>
      </div>
    </header>
  );
}
