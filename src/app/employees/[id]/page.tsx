"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import type { Employee } from "@/lib/types";
import EmployeeForm from "@/components/EmployeeForm";
import LettersTab from "@/components/LettersTab";
import FormsTab from "@/components/FormsTab";
import DocsTab from "@/components/DocsTab";
import MailTab from "@/components/MailTab";

const TABS = ["Details", "Letters", "Forms & kit", "Documents", "Mail"] as const;
export default function EmployeePage() {
  const { id } = useParams<{ id: string }>(); const isNew = id === "new";
  const [emp, setEmp] = useState<Employee | null>(null); const [tab, setTab] = useState<(typeof TABS)[number]>("Details"); const [err, setErr] = useState("");
  useEffect(() => { if (isNew) return; (async () => { const { data, error } = await supabase().from("employees").select("*").eq("id", id).single(); if (error) setErr(error.message); setEmp(data as Employee); })(); }, [id, isNew]);
  if (isNew) return (<div className="space-y-4"><Link href="/" className="text-sm text-blue-700">← Employees</Link><h1 className="text-xl font-bold">New employee</h1><EmployeeForm initial={null} /></div>);
  if (err) return <p className="warn">{err}</p>; if (!emp) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-blue-700">← Employees</Link>
      <div><h1 className="text-xl font-bold">{emp.full_name}</h1><p className="text-sm text-slate-500">{[emp.designation, emp.department, emp.project, emp.site_location].filter(Boolean).join(" · ")}</p></div>
      <div className="flex border-b border-slate-200 overflow-x-auto">{TABS.map((t) => <div key={t} className={`tab whitespace-nowrap ${tab === t ? "tab-on" : ""}`} onClick={() => setTab(t)}>{t}</div>)}</div>
      {tab === "Details" && <EmployeeForm initial={emp} onSaved={setEmp} />}
      {tab === "Letters" && <LettersTab emp={emp} />}
      {tab === "Forms & kit" && <FormsTab emp={emp} />}
      {tab === "Documents" && <DocsTab emp={emp} />}
      {tab === "Mail" && <MailTab emp={emp} />}
    </div>
  );
}
