"use client";
import { useEffect, useMemo, useState } from "react";
import { EXIT_LETTER, draftLetter, letterBlock, rupees, settlementNet, type Exit, type ExitItem, type ExitLetterKind, type NoticeArgs, type SettlementRow } from "@/lib/offboarding";
import type { Employee } from "@/lib/types";

type Slip = { line_id: string; pay_month: string; project: string | null; net: number; held: boolean };
const KINDS: ExitLetterKind[] = ["relieving", "experience", "recommendation", "settlement", "absconding_notice"];
const monthName = (iso: string) => new Date(iso.slice(0, 7) + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/** Write and issue an exit letter: pick the kind, the wording is drafted from the employee and the exit, edit anything, preview, issue.
 *  Operations follow the rules (checklist finished, not absconded…); an Admin can override them after confirming. */
export default function ExitLetters({ emp, exit, items, slips, advance, admin, onIssued }: { emp: Employee; exit: Exit | null; items: ExitItem[]; slips: Slip[]; advance: number; admin: boolean; onIssued: () => void }) {
  const [kind, setKind] = useState<ExitLetterKind | null>(null);
  const [subject, setSubject] = useState(""); const [text, setText] = useState(""); const [rows, setRows] = useState<SettlementRow[]>([]); const [seal, setSeal] = useState(true);
  const [notice, setNotice] = useState<NoticeArgs>({ notice_no: 1, absent_since: "", report_by: "" });
  const [busy, setBusy] = useState(""); const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const settled = items.some((i) => i.item === "settlement");

  const defaultRows = useMemo<SettlementRow[]>(() => {
    const out: SettlementRow[] = []; const m = exit?.last_day?.slice(0, 7);
    const last = slips.find((s) => s.pay_month.slice(0, 7) === m);
    if (last) out.push({ label: `Salary for ${monthName(last.pay_month)} (net, as per salary slip)`, amount: Number(last.net) });
    else out.push({ label: `Salary for ${m ? monthName(m) : "the last month"} (up to the last working day)`, amount: 0 });
    if (advance > 0) out.push({ label: "Less: advance outstanding", amount: -advance });
    return out;
  }, [slips, exit, advance]);

  // a fresh draft whenever the kind (or, for a notice, its dates) changes
  useEffect(() => {
    if (!kind) return;
    const r = kind === "settlement" ? (rows.length ? rows : defaultRows) : undefined;
    const dft = draftLetter(kind, emp, exit, { rows: r, notice, settled });
    setSubject(dft.subject); setText(dft.paragraphs.join("\n\n")); if (kind === "settlement" && !rows.length) setRows(defaultRows); setErr(""); setOk("");
  }, [kind, notice]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the settlement's closing sentence follows the total
  const net = settlementNet(rows);
  function redraftNet() { if (kind !== "settlement") return; const dft = draftLetter("settlement", emp, exit, { rows }); const paras = text.split(/\n\s*\n/); paras[paras.length - 1] = dft.paragraphs[dft.paragraphs.length - 1]; setText(paras.join("\n\n")); }

  const block = kind ? letterBlock(kind, exit, items) : null;
  const body = (preview: boolean, override = false) => JSON.stringify({ employee_id: emp.id, kind, exit_id: exit?.id ?? null, subject, paragraphs: text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean), rows: kind === "settlement" ? rows : undefined, with_seal: seal, preview, override });
  async function preview() {
    setBusy("preview"); setErr("");
    const r = await fetch("/api/exit-letters", { method: "POST", headers: { "Content-Type": "application/json" }, body: body(true) });
    setBusy(""); if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || "Could not make the preview."); return; }
    window.open(URL.createObjectURL(await r.blob()), "_blank");
  }
  async function issue(override = false) {
    setBusy("issue"); setErr(""); setOk("");
    const r = await fetch("/api/exit-letters", { method: "POST", headers: { "Content-Type": "application/json" }, body: body(false, override) }); const j = await r.json().catch(() => ({}));
    setBusy("");
    if (r.status === 409 && j.needOverride) { if (confirm(`${j.error}\n\nIssue it anyway as an Admin override? The override is recorded on the letter.`)) issue(true); return; }
    if (!r.ok) { setErr(j.error || "Could not issue the letter."); return; }
    setOk(`${EXIT_LETTER[kind!].label} issued · ${j.ref_no}`); window.open(`/api/letters/${j.id}/pdf`, "_blank"); onIssued();
  }

  return (
    <div className="card space-y-3" data-exit-letters>
      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold mr-auto">Exit letters</h3>{kind && <button type="button" className="text-sm text-slate-500 underline" onClick={() => setKind(null)}>Close</button>}</div>
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => { const why = letterBlock(k, exit, items); return (
          <button key={k} type="button" className={`chip ${kind === k ? "chip-on" : ""} ${why && !admin ? "opacity-60" : ""}`} aria-pressed={kind === k} title={why ?? undefined} onClick={() => setKind(k)}>
            {EXIT_LETTER[k].label}{why ? <span aria-label="Not yet" className="text-amber-600">•</span> : null}</button>); })}
      </div>
      {!kind && <p className="text-xs text-slate-500">Relieving and experience letters can be issued once the exit checklist is finished. An amber dot means a rule is not met yet{admin ? "; as an Admin you can still issue it, after confirming" : ""}.</p>}
      {kind && <>
        {block && <p className={`text-sm rounded-xl px-3 py-2 ${admin ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-800"}`}>{block}{admin ? " You can still issue it as an Admin override." : " Only an Admin can override this."}</p>}
        {kind === "absconding_notice" && <div className="grid gap-2 sm:grid-cols-4">
          <label className="block text-xs text-slate-500">Notice<select className="inp mt-1" value={notice.notice_no} onChange={(e) => setNotice({ ...notice, notice_no: Number(e.target.value) as 1 | 2 })}><option value={1}>First notice</option><option value={2}>Final notice</option></select></label>
          <label className="block text-xs text-slate-500">Absent since<input type="date" className="inp mt-1" value={notice.absent_since} onChange={(e) => setNotice({ ...notice, absent_since: e.target.value })} /></label>
          <label className="block text-xs text-slate-500">Report for duty by<input type="date" className="inp mt-1" value={notice.report_by} onChange={(e) => setNotice({ ...notice, report_by: e.target.value })} /></label>
          {notice.notice_no === 2 && <label className="block text-xs text-slate-500">First notice was dated<input type="date" className="inp mt-1" value={notice.first_notice_on ?? ""} onChange={(e) => setNotice({ ...notice, first_notice_on: e.target.value })} /></label>}
        </div>}
        {kind === "settlement" && <div className="space-y-2">
          <div className="text-xs text-slate-500">Lines: a positive amount is payable to them, a negative one is recovered from them (advance, notice pay not served, unreturned items…).</div>
          {rows.map((r, i) => <div key={i} className="flex gap-2">
            <input className="inp flex-1" aria-label="Particulars" value={r.label} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="inp !w-32 text-right" aria-label="Amount" inputMode="decimal" value={String(r.amount)} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value.replace(/[^\d.-]/g, "")) || 0 } : x)))} onBlur={redraftNet} />
            <button type="button" className="text-xs text-red-700 underline" onClick={() => setRows(rows.filter((_, j) => j !== i))}>remove</button></div>)}
          <div className="flex flex-wrap items-center gap-3"><button type="button" className="btn btn-sm" onClick={() => setRows([...rows, { label: "", amount: 0 }])}>+ Add line</button>
            <span className="text-sm">Net: <b className={net < 0 ? "text-rose-700" : ""}>{net < 0 ? "(-) " : ""}{rupees(net)}</b> {net < 0 ? "recoverable from them" : "payable to them"}</span></div>
        </div>}
        <label className="block text-xs text-slate-500">Subject<input className="inp mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <label className="block text-xs text-slate-500">Letter text (a blank line starts a new paragraph; edit freely)<textarea className="inp mt-1 text-sm" rows={Math.min(16, Math.max(6, text.split("\n").length + 2))} value={text} onChange={(e) => setText(e.target.value)} /></label>
        {/\[[^\]]+\]/.test(text) && <p className="warn">Replace the text in [square brackets] before issuing.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={seal} onChange={(e) => setSeal(e.target.checked)} /> Seal &amp; signature</label>
          <button type="button" className="btn" disabled={!!busy} onClick={preview}>{busy === "preview" ? "Preparing…" : "Preview (nothing saved)"}</button>
          <button type="button" className="btn btn-primary" disabled={!!busy || (!!block && !admin)} onClick={() => issue(false)}>{busy === "issue" ? "Issuing…" : `Issue ${EXIT_LETTER[kind].label.toLowerCase()}`}</button>
        </div>
      </>}
      {ok && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">{ok}</p>}
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
    </div>
  );
}
