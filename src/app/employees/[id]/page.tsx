"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { docTypesFor, type Employee } from "@/lib/types";
import EmployeeForm from "@/components/EmployeeForm";
import LettersTab from "@/components/LettersTab";
import FormsTab from "@/components/FormsTab";
import DocsTab from "@/components/DocsTab";
import MailTab from "@/components/MailTab";
import PipelineBar from "@/components/PipelineBar";
import CandidatePanel from "@/components/CandidatePanel";
import { swrDrop } from "@/lib/swr";
import { ActivityTab, PayTab } from "@/components/EmployeeWorkTabs";
import ExitTab from "@/components/employees/ExitTab";
import { useRole } from "@/lib/roles";
import { istToday } from "@/lib/attendance";
import { Icon } from "@/components/NavIcons";
import { LIST_QS_KEY } from "@/components/employees/EmployeeList";
import { fmtShort, initials, telHref, waHref } from "@/lib/employeeList";
import { stageIndex, stageLabel } from "@/lib/pipeline";

const TABS = [
  { slug: "details", label: "Details" }, { slug: "letters", label: "Letters" }, { slug: "forms", label: "Forms & kit" }, { slug: "documents", label: "Documents" }, { slug: "mail", label: "Mail" },
  { slug: "pay", label: "Pay & attendance", onboarded: true }, { slug: "activity", label: "Activity", onboarded: true }, { slug: "exit", label: "Exit & documents" },
] as const;
type Slug = (typeof TABS)[number]["slug"];

// "← Employees" goes back to the list exactly as it was left (pile, stage, project, search, sort).
function useBackHref() { const [h, setH] = useState("/"); useEffect(() => { try { const q = sessionStorage.getItem(LIST_QS_KEY); if (q) setH(`/?${q}`); } catch { /* storage unavailable */ } }, []); return h; }

export default function EmployeePage() { return <Suspense fallback={<Skeleton />}><EmployeeScreen /></Suspense>; }

function Skeleton() { return <div className="space-y-4"><div className="skeleton h-4 w-24" /><div className="skeleton h-14 w-72" /><div className="skeleton h-24 w-full" /><div className="skeleton h-64 w-full" /></div>; }

function EmployeeScreen() {
  const { id } = useParams<{ id: string }>(); const isNew = id === "new"; const back = useBackHref();
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  const [emp, setEmp0] = useState<Employee | null>(null); const [docsKey, setDocsKey] = useState(0); const [panel, setPanel] = useState(false); const [err, setErr] = useState(""); const [missing, setMissing] = useState(false);
  const [counts, setCounts] = useState<{ docs: number; letters: number; exits: number; submitted: number; have: string[] }>({ docs: 0, letters: 0, exits: 0, submitted: 0, have: [] }); const { staff } = useRole();
  // The employee list is remembered between visits. It is only thrown away if something it shows (a name, stage, project, document count) was changed here.
  const touched = useRef(false); const firstDocs = useRef<number | null>(null);
  const setEmp = useCallback((e: Employee) => { touched.current = true; setEmp0(e); }, []);
  useEffect(() => () => { if (touched.current) swrDrop("employees"); }, []);
  useEffect(() => { if (isNew) return; (async () => {
    const { data, error } = await supabase().from("employees").select("*").eq("id", id).maybeSingle();
    if (error) setErr(error.message); else if (!data) setMissing(true); else setEmp0(data as Employee);
  })(); }, [id, isNew]);
  const loadCounts = useCallback(async () => {
    if (isNew) return; const sb = supabase();
    const [d, l, x, f] = await Promise.all([sb.from("employee_documents").select("status, doc_type").eq("employee_id", id).neq("doc_type", "resume"), sb.from("letters").select("id", { count: "exact", head: true }).eq("employee_id", id).in("kind", ["offer", "appointment"]), sb.from("employee_exits").select("id", { count: "exact", head: true }).eq("employee_id", id),
      sb.from("form_invites").select("id", { count: "exact", head: true }).eq("employee_id", id).eq("status", "submitted")]);
    const docsN = (d.data || []).filter((x: any) => x.status === "verified" || x.status === "received").length;
    if (firstDocs.current === null) firstDocs.current = docsN; else if (docsN !== firstDocs.current) touched.current = true;   // the list shows this count
    // submitted: the candidate has filled in their self-fill link and nobody has applied it yet (applying sets the invite to "applied", and onApplied reloads this)
    setCounts({ docs: docsN, letters: l.count ?? 0, exits: x.error ? 0 : x.count ?? 0, submitted: f.error ? 0 : f.count ?? 0, have: (d.data || []).filter((x: any) => x.status === "verified" || x.status === "received").map((x: any) => x.doc_type) });   // exits: 0 until the offboarding migration is run
  }, [id, isNew]);
  useEffect(() => { loadCounts(); }, [loadCounts, docsKey]);

  const backLink = <Link href={back} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><Icon name="chevron-left" className="h-4 w-4" />Employees</Link>;
  if (isNew) return (<div className="space-y-4">{backLink}<h1 className="text-xl font-bold">New candidate</h1><p className="text-sm text-slate-500">Just the basics for now — add the resume and everything else after saving.</p><EmployeeForm initial={null} /></div>);
  if (missing) return <div className="space-y-4">{backLink}<div className="card text-center space-y-3"><h1 className="text-lg font-semibold">Employee not found</h1><p className="text-sm text-slate-500">This record may have been removed, or the link is wrong.</p><Link className="btn btn-primary" href={back}>Back to employees</Link></div></div>;
  if (err) return <div className="space-y-4">{backLink}<p className="warn !text-sm">Couldn't load this record: {err}</p></div>;
  if (!emp) return <Skeleton />;

  const onboarded = emp.stage === "onboarded" && emp.outcome !== "rejected"; const rejected = emp.outcome === "rejected";
  const left = !!emp.left_on && emp.left_on < istToday();   // their last working day has passed: they are in the Offboarded list
  const tabs = TABS.filter((t) => (t.slug === "exit" ? staff && (onboarded || !!emp.left_on || counts.exits > 0) : !("onboarded" in t) || onboarded));
  const slug = (tabs.find((t) => t.slug === sp.get("tab"))?.slug ?? "details") as Slug;
  const goTab = (s: Slug) => { const n = new URLSearchParams(sp.toString()); if (s === "details") n.delete("tab"); else n.set("tab", s); const q = n.toString(); router.replace(q ? `${path}?${q}` : path, { scroll: false }); };
  const badge = (s: Slug) => s === "documents" ? `${docTypesFor(emp).filter((t) => counts.have.includes(t.key)).length}/${docTypesFor(emp).length}` : s === "letters" && counts.letters ? String(counts.letters) : "";
  const tel = telHref(emp.phone); const wa = waHref(emp.phone); const hasNotes = !!(emp.notes || emp.call_notes || emp.interview_notes);

  return (
    <div className="space-y-4">
      {backLink}
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="h-12 w-12 shrink-0 rounded-full bg-blue-50 text-blue-800 font-semibold grid place-items-center">{initials(emp.full_name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold truncate">{emp.full_name}</h1>{rejected ? <span className="pill !bg-red-50 !text-red-800">Rejected</span> : left && onboarded ? <span className="pill !bg-slate-100 !text-slate-700">Left {fmtShort(emp.left_on!, true)}</span> : <span className="pill">{stageLabel(emp.stage)}</span>}{!left && onboarded && emp.left_on && <span className="pill !bg-amber-50 !text-amber-800">Leaving {fmtShort(emp.left_on, true)}</span>}{emp.emp_no && <span className="text-xs text-slate-500">{emp.emp_no}</span>}</div>
          <p className="text-sm text-slate-500">{[emp.designation, emp.department, emp.project, emp.site_location].filter(Boolean).join(" · ") || "No role or project yet"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className="btn relative" onClick={() => setPanel(true)} aria-haspopup="dialog">Notes &amp; resume{hasNotes && <span aria-label="Has notes" className="ml-1 h-2 w-2 rounded-full bg-amber-500" />}
            {counts.submitted > 0 && <span className="absolute -top-2 -right-2 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow ring-2 ring-white" title="The candidate filled in their self-fill form. Open to review and apply it.">Form filled</span>}</button>
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
          {slug === "exit" && <ExitTab emp={emp} onChange={(e) => { setEmp(e); loadCounts(); }} />}
          </div>
        </div>
      </div>
      <CandidatePanel emp={emp} onChange={setEmp} open={panel} onClose={() => setPanel(false)} showInvite={!onboarded && !rejected} onApplied={() => setDocsKey((k) => k + 1)} />
    </div>
  );
}
