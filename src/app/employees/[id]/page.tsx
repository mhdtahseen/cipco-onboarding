"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { DOC_TYPES, type Employee } from "@/lib/types";
import EmployeeForm from "@/components/EmployeeForm";
import LettersTab from "@/components/LettersTab";
import FormsTab from "@/components/FormsTab";
import DocsTab from "@/components/DocsTab";
import MailTab from "@/components/MailTab";
import PipelineBar from "@/components/PipelineBar";
import CandidatePanel from "@/components/CandidatePanel";
import { ActivityTab, PayTab } from "@/components/EmployeeWorkTabs";
import { Icon } from "@/components/NavIcons";
import { LIST_QS_KEY } from "@/components/employees/EmployeeList";
import { initials, telHref, waHref } from "@/lib/employeeList";
import { stageIndex, stageLabel } from "@/lib/pipeline";

const TABS = [
  { slug: "details", label: "Details" }, { slug: "letters", label: "Letters" }, { slug: "forms", label: "Forms & kit" }, { slug: "documents", label: "Documents" }, { slug: "mail", label: "Mail" },
  { slug: "pay", label: "Pay & attendance", onboarded: true }, { slug: "activity", label: "Activity", onboarded: true },
] as const;
type Slug = (typeof TABS)[number]["slug"];

// "← Employees" goes back to the list exactly as it was left (pile, stage, project, search, sort).
function useBackHref() { const [h, setH] = useState("/"); useEffect(() => { try { const q = sessionStorage.getItem(LIST_QS_KEY); if (q) setH(`/?${q}`); } catch { /* storage unavailable */ } }, []); return h; }

export default function EmployeePage() { return <Suspense fallback={<Skeleton />}><EmployeeScreen /></Suspense>; }

function Skeleton() { return <div className="space-y-4"><div className="skeleton h-4 w-24" /><div className="skeleton h-14 w-72" /><div className="skeleton h-24 w-full" /><div className="skeleton h-64 w-full" /></div>; }

function EmployeeScreen() {
  const { id } = useParams<{ id: string }>(); const isNew = id === "new"; const back = useBackHref();
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  const [emp, setEmp] = useState<Employee | null>(null); const [docsKey, setDocsKey] = useState(0); const [panel, setPanel] = useState(false); const [err, setErr] = useState(""); const [missing, setMissing] = useState(false);
  const [counts, setCounts] = useState<{ docs: number; letters: number }>({ docs: 0, letters: 0 });
  useEffect(() => { if (isNew) return; (async () => {
    const { data, error } = await supabase().from("employees").select("*").eq("id", id).maybeSingle();
    if (error) setErr(error.message); else if (!data) setMissing(true); else setEmp(data as Employee);
  })(); }, [id, isNew]);
  const loadCounts = useCallback(async () => {
    if (isNew) return; const sb = supabase();
    const [d, l] = await Promise.all([sb.from("employee_documents").select("status").eq("employee_id", id).neq("doc_type", "resume"), sb.from("letters").select("id", { count: "exact", head: true }).eq("employee_id", id)]);
    setCounts({ docs: (d.data || []).filter((x: any) => x.status === "verified" || x.status === "received").length, letters: l.count ?? 0 });
  }, [id, isNew]);
  useEffect(() => { loadCounts(); }, [loadCounts, docsKey]);

  const backLink = <Link href={back} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><Icon name="chevron-left" className="h-4 w-4" />Employees</Link>;
  if (isNew) return (<div className="space-y-4">{backLink}<h1 className="text-xl font-bold">New candidate</h1><p className="text-sm text-slate-500">Just the basics for now — add the resume and everything else after saving.</p><EmployeeForm initial={null} /></div>);
  if (missing) return <div className="space-y-4">{backLink}<div className="card text-center space-y-3"><h1 className="text-lg font-semibold">Employee not found</h1><p className="text-sm text-slate-500">This record may have been removed, or the link is wrong.</p><Link className="btn btn-primary" href={back}>Back to employees</Link></div></div>;
  if (err) return <div className="space-y-4">{backLink}<p className="warn !text-sm">Couldn't load this record: {err}</p></div>;
  if (!emp) return <Skeleton />;

  const onboarded = emp.stage === "onboarded" && emp.outcome !== "rejected"; const rejected = emp.outcome === "rejected";
  const tabs = TABS.filter((t) => !("onboarded" in t) || onboarded);
  const slug = (tabs.find((t) => t.slug === sp.get("tab"))?.slug ?? "details") as Slug;
  const goTab = (s: Slug) => { const n = new URLSearchParams(sp.toString()); if (s === "details") n.delete("tab"); else n.set("tab", s); const q = n.toString(); router.replace(q ? `${path}?${q}` : path, { scroll: false }); };
  const badge = (s: Slug) => s === "documents" ? `${counts.docs}/${DOC_TYPES.length}` : s === "letters" && counts.letters ? String(counts.letters) : "";
  const tel = telHref(emp.phone); const wa = waHref(emp.phone); const hasNotes = !!(emp.notes || emp.call_notes || emp.interview_notes);

  return (
    <div className="space-y-4">
      {backLink}
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="h-12 w-12 shrink-0 rounded-full bg-blue-50 text-blue-800 font-semibold grid place-items-center">{initials(emp.full_name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold truncate">{emp.full_name}</h1>{rejected ? <span className="pill !bg-red-50 !text-red-800">Rejected</span> : <span className="pill">{stageLabel(emp.stage)}</span>}{emp.emp_no && <span className="text-xs text-slate-500">{emp.emp_no}</span>}</div>
          <p className="text-sm text-slate-500">{[emp.designation, emp.department, emp.project, emp.site_location].filter(Boolean).join(" · ") || "No role or project yet"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className="btn relative" onClick={() => setPanel(true)} aria-haspopup="dialog">Notes &amp; resume{hasNotes && <span aria-label="Has notes" className="ml-1 h-2 w-2 rounded-full bg-amber-500" />}</button>
          {tel ? <a className="btn" href={tel}><Icon name="phone" className="h-4 w-4" />Call</a> : null}
          {wa ? <a className="btn" href={wa} target="_blank" rel="noreferrer"><Icon name="chat" className="h-4 w-4" />WhatsApp</a> : null}
          {emp.email ? <a className="btn" href={`mailto:${emp.email}`} aria-label={`Email ${emp.full_name}`}><Icon name="mail" className="h-4 w-4" /><span className="hidden sm:inline">Email</span></a> : null}
        </div>
      </div>
      <PipelineBar emp={emp} onChange={setEmp} />
      <div>
        <div className="space-y-4 min-w-0">
          <div role="tablist" className="flex border-b border-slate-200 overflow-x-auto">{tabs.map((t) => <button key={t.slug} role="tab" aria-selected={slug === t.slug} className={`tab ${slug === t.slug ? "tab-on" : ""}`} onClick={() => goTab(t.slug)}>{t.label}{badge(t.slug) && <span className="ml-1.5 text-xs font-normal text-slate-500">{badge(t.slug)}</span>}</button>)}</div>
          {/* The form stays mounted (just hidden) so edits aren't lost when you look at another tab */}
          <div className={slug === "details" ? "fade-in" : "hidden"}><EmployeeForm initial={emp} onSaved={setEmp} /></div>
          <div key={slug} className="fade-in space-y-4 empty:hidden">
          {slug === "letters" && <LettersTab emp={emp} onIssued={async (kind) => { loadCounts(); if (emp.outcome === "active" && stageIndex(emp.stage) < stageIndex(kind)) { const { data } = await supabase().from("employees").update({ stage: kind }).eq("id", emp.id).select().single(); if (data) setEmp(data as Employee); } }} />}
          {slug === "forms" && <FormsTab emp={emp} />}
          {slug === "documents" && <DocsTab key={docsKey} emp={emp} />}
          {slug === "mail" && <MailTab emp={emp} />}
          {slug === "pay" && <PayTab emp={emp} />}
          {slug === "activity" && <ActivityTab emp={emp} />}
          </div>
        </div>
      </div>
      <CandidatePanel emp={emp} onChange={setEmp} open={panel} onClose={() => setPanel(false)} showInvite={!onboarded && !rejected} onApplied={() => setDocsKey((k) => k + 1)} />
    </div>
  );
}
