"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function Nav() {
  const path = usePathname(); const router = useRouter();
  if (path.startsWith("/login")) return null;
  const link = (href: string, label: string) => (
    <Link href={href} className={`px-3 py-1.5 rounded-md text-sm ${path === href || (href !== "/" && path.startsWith(href)) ? "bg-blue-50 text-blue-800 font-semibold" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>);
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2">
        <span className="font-bold text-blue-900 mr-4">CIPCO <span className="font-normal text-slate-500">Onboarding</span></span>
        {link("/", "Employees")}{link("/clauses", "Clause library")}{link("/mail-templates", "Mail templates")}
        <button className="btn ml-auto" onClick={async () => { await supabase().auth.signOut(); router.push("/login"); router.refresh(); }}>Sign out</button>
      </div>
    </header>
  );
}
