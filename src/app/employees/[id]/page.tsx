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
import PipelineBar from "@/components/PipelineBar";
import ResumeCard from "@/components/ResumeCard";
import InviteCard from "@/components/InviteCard";
import NotesCard from "@/components/NotesCard";
import { stageIndex } from "@/lib/pipeline";

const TABS = ["Details", "Letters", "Forms & kit", "Documents", "Mail"] as const;
export default function EmployeePage() {
  const { id } = useParams<{ id: string }>(); const isNew = id === "new";
  const [emp, setEmp] = useState<Employee | null>(null); const [docsKey, setDocsKey] = useState(0); const [tab, setTab] = useState<(typeof TABS)[number]>("Details"); const [err, setErr] = useState("");
  useEffect(() => { if (isNew) return; (async () => { const { data, error } = await supabase().from("employees").select("*").eq("id", id).single(); if (error) setErr(error.message); setEmp(data as Employee); })(); }, [id, isNew]);
  if (isNew) return (<div className="space-y-4"><Link href="/" className="text-sm text-blue-700">← Employees</Link><h1 className="text-xl font-bold">New candidate</h1><p className="text-sm text-slate-500">Just the basics for now — add the resume and everything else after saving.</p><EmployeeForm initial={null} /></div>);
  if (err) return <p className="warn">{err}</p>; if (!emp) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-blue-700">← Employees</Link>
      <div><h1 className="text-xl font-bold">{emp.full_name}</h1><p className="text-sm text-slate-500">{[emp.designation, emp.department, emp.project, emp.site_location].filter(Boolean).join(" · ")}</p></div>
      <PipelineBar emp={emp} onChange={setEmp} />
      <ResumeCard emp={emp} />
      <InviteCard emp={emp} onChange={setEmp} onApplied={() => setDocsKey((k) => k + 1)} />
      <NotesCard emp={emp} onChange={setEmp} />
      <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? "tab-on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "Details" && <EmployeeForm initial={emp} onSaved={setEmp} />}
      {tab === "Letters" && <LettersTab emp={emp} onIssued={async (kind) => { if (emp.outcome === "active" && stageIndex(emp.stage) < stageIndex(kind)) { const { data } = await supabase().from("employees").update({ stage: kind }).eq("id", emp.id).select().single(); if (data) setEmp(data as Employee); } }} />}
      {tab === "Forms & kit" && <FormsTab emp={emp} />}
      {tab === "Documents" && <DocsTab key={docsKey} emp={emp} />}
      {tab === "Mail" && <MailTab emp={emp} />}
    </div>
  );
}
