"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DOC_TYPES } from "@/lib/types";
import { stageLabel } from "@/lib/pipeline";
import { fmtShort, idleDays, initials, joinInfo, telHref, waHref, type ListRow, type Pile, type SortKey } from "@/lib/employeeList";
import { Icon } from "../NavIcons";

type Common = { rows: ListRow[]; pile: Pile; sel: string[]; setSel: (s: string[]) => void; docs: Record<string, number>; loading: boolean; empty: string; emptyAction?: React.ReactNode };

const TONE = { soon: "text-amber-700", late: "text-red-700", plain: "text-slate-500" } as const;

function Avatar({ name }: { name: string }) { return <span aria-hidden className="h-8 w-8 shrink-0 rounded-full bg-blue-50 text-blue-800 text-xs font-semibold grid place-items-center">{initials(name)}</span>; }

/** Call / WhatsApp shortcuts. Rendered only when the number is a valid 10-digit one. */
export function Contact({ phone, name }: { phone: string | null; name: string }) {
  const tel = telHref(phone); const wa = waHref(phone);
  if (!tel) return <span className="text-xs text-slate-400">No number</span>;
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <a href={tel} aria-label={`Call ${name}`} title="Call" className="h-9 w-9 grid place-items-center rounded-lg text-slate-600 hover:bg-slate-100"><Icon name="phone" className="h-4 w-4" /></a>
      <a href={wa} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${name}`} title="WhatsApp" className="h-9 w-9 grid place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50"><Icon name="chat" className="h-4 w-4" /></a>
    </span>
  );
}

function DocBar({ n, wide }: { n: number; wide?: boolean }) {
  return <div className="flex items-center gap-2"><div className={`h-1.5 ${wide ? "w-20" : "w-16"} rounded-full bg-slate-100 overflow-hidden`} role="img" aria-label={`${n} of ${DOC_TYPES.length} documents`}><div className="h-full bg-[#1e4fa3]" style={{ width: `${(n / DOC_TYPES.length) * 100}%` }} /></div><span className="text-xs text-slate-500">{n}/{DOC_TYPES.length} docs</span></div>;
}

function Skeleton({ table }: { table?: boolean }) {
  return <>{Array.from({ length: 6 }).map((_, i) => table
    ? <tr key={i} className="border-t border-slate-100"><td className="p-3" colSpan={8}><div className="skeleton h-8 w-full" /></td></tr>
    : <div key={i} className="card !p-3"><div className="skeleton h-4 w-2/3 mb-2" /><div className="skeleton h-3 w-1/2" /></div>)}</>;
}

export function EmployeeCards({ rows, pile, sel, setSel, docs, loading, empty, emptyAction }: Common) {
  const toggle = (id: string, on: boolean) => setSel(on ? [...sel, id] : sel.filter((x) => x !== id));
  return (
    <div className="md:hidden space-y-2">
      {loading && <Skeleton />}
      {!loading && !rows.length && <div className="card text-center text-sm text-slate-500 space-y-3"><p>{empty}</p>{emptyAction}</div>}
      {rows.map((r) => { const j = pile === "process" ? joinInfo(r) : null; const idle = pile === "process" ? idleDays(r) : null; return (
        <div key={r.id} className="fade card !p-3 flex gap-3">
          <input type="checkbox" className="mt-2 h-5 w-5" aria-label={`Select ${r.full_name}`} checked={sel.includes(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
          <Link href={`/employees/${r.id}`} className="flex-1 min-w-0 flex gap-3">
            <Avatar name={r.full_name} />
            <span className="min-w-0 flex-1">
              <span className="flex items-start gap-2"><span className="font-semibold text-blue-800 truncate">{r.full_name}</span>{pile !== "rejected" && <span className="pill ml-auto">{stageLabel(r.stage)}</span>}</span>
              <span className="block text-sm text-slate-600 truncate">{[r.designation, r.department].filter(Boolean).join(" · ") || "—"}</span>
              <span className="block text-xs text-slate-500 truncate">{[r.project, r.site_location].filter(Boolean).join(" · ")}</span>
              {pile === "rejected" && <span className="block text-xs text-red-800 mt-1">{r.closed_reason} · at {stageLabel(r.closed_stage)}</span>}
              {pile === "process" && <span className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs"><DocBar n={docs[r.id] || 0} />{j && <span className={TONE[j.tone]}>{j.text}</span>}{idle && <span className="text-slate-500">No update for {idle} days</span>}</span>}
              {pile === "onboarded" && r.join_date && <span className="block text-xs text-slate-500 mt-1">Joined {fmtShort(r.join_date, true)}</span>}
            </span>
          </Link>
          <Contact phone={r.phone} name={r.full_name} />
        </div>); })}
    </div>
  );
}

export function EmployeeTable({ rows, pile, sel, setSel, docs, loading, empty, emptyAction, sort, dir, onSort }: Common & { sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void }) {
  const router = useRouter();
  const toggle = (id: string, on: boolean) => setSel(on ? [...sel, id] : sel.filter((x) => x !== id));
  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="p-3 font-medium" aria-sort={sort === k ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-slate-800">{children}{sort === k ? <Icon name={dir === "asc" ? "arrow-up" : "arrow-down"} className="h-3.5 w-3.5" /> : null}</button>
    </th>);
  const cols = pile === "process" ? 8 : 6;
  return (
    <div className="card !p-0 overflow-x-auto hidden md:block">
      <table className="w-full text-sm">
        <caption className="sr-only">{pile === "process" ? "Candidates in process" : pile === "onboarded" ? "Onboarded employees" : "Rejected candidates"}</caption>
        <thead className="bg-slate-50 text-left text-slate-500"><tr>
          <th className="p-3 w-8"><input type="checkbox" aria-label="Select all shown" checked={rows.length > 0 && rows.every((r) => sel.includes(r.id))} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} /></th>
          <Th k="name">Name</Th><Th k="role">Role</Th><Th k="project">Project / site</Th>
          {pile === "rejected" ? <th className="p-3 font-medium">Closed</th> : <Th k="join">{pile === "onboarded" ? "Joined" : "Joining"}</Th>}
          {pile === "process" && <><Th k="stage">Stage</Th><th className="p-3 font-medium">Documents</th></>}
          <th className="p-3 font-medium text-right">Contact</th>
        </tr></thead>
        <tbody>
          {loading && <Skeleton table />}
          {!loading && !rows.length && <tr><td className="p-8 text-center text-slate-500" colSpan={cols}><p>{empty}</p>{emptyAction && <div className="mt-3">{emptyAction}</div>}</td></tr>}
          {rows.map((r) => { const j = pile === "process" ? joinInfo(r) : null; const idle = pile === "process" ? idleDays(r) : null; return (
            <tr key={r.id} className="fade border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/employees/${r.id}`)}>
              <td className="p-3" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.full_name}`} checked={sel.includes(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} /></td>
              <td className="p-3"><div className="flex items-center gap-3"><Avatar name={r.full_name} /><div className="min-w-0"><Link className="font-medium text-blue-800 hover:underline" href={`/employees/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.full_name}</Link><div className="text-xs text-slate-500">{r.emp_no}</div></div></div></td>
              <td className="p-3">{r.designation}<div className="text-xs text-slate-500">{r.department}</div></td>
              <td className="p-3">{r.project}<div className="text-xs text-slate-500">{r.site_location}</div></td>
              {pile === "rejected"
                ? <td className="p-3"><div className="text-xs font-medium text-red-800">{r.closed_reason}</div><div className="text-xs text-slate-500">at {stageLabel(r.closed_stage)}</div></td>
                : <td className="p-3 whitespace-nowrap">{fmtShort(r.join_date, true)}{j && <div className={`text-xs ${TONE[j.tone]}`}>{j.text}</div>}</td>}
              {pile === "process" && <>
                <td className="p-3"><span className="pill">{stageLabel(r.stage)}</span>{idle && <div className="text-xs text-slate-500 mt-1">No update for {idle} days</div>}</td>
                <td className="p-3"><DocBar n={docs[r.id] || 0} wide /></td></>}
              <td className="p-3 text-right"><Contact phone={r.phone} name={r.full_name} /></td>
            </tr>); })}
        </tbody>
      </table>
    </div>
  );
}
