"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { buildVars, isSuggested, renderSections, salaryFor, type AcceptMode } from "@/lib/clauses";
import { annexureNotes, annexureRows } from "@/lib/salary";
import type { Clause, Employee, LetterRow, Section } from "@/lib/types";

export default function LettersTab({ emp }: { emp: Employee }) {
  const [kind, setKind] = useState<"offer" | "appointment">("offer");
  const [clauses, setClauses] = useState<Clause[]>([]); const [picked, setPicked] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, Section>>({}); const [editing, setEditing] = useState<string | null>(null);
  const [letters, setLetters] = useState<LetterRow[]>([]); const [seal, setSeal] = useState(true); const [busy, setBusy] = useState(""); const [msg, setMsg] = useState("");
  const [extras, setExtras] = useState<{ title: string; body: string }[]>([]);
  const calc = useMemo(() => salaryFor(emp), [emp]);
  const [acceptMode, setAcceptMode] = useState<AcceptMode>("email"); const [annexure, setAnnexure] = useState(true); const [notesText, setNotesText] = useState(""); const [notesEdited, setNotesEdited] = useState(false);
  const vars = useMemo(() => buildVars(emp, { annexure: annexure && !!calc, accept_mode: acceptMode }), [emp, annexure, calc, acceptMode]);
  const tfa = clauses.some((c) => c.key === "site_allowances" && picked.has(c.id));

  async function loadLetters() { const { data } = await supabase().from("letters").select("*").eq("employee_id", emp.id).order("created_at", { ascending: false }); setLetters((data || []) as LetterRow[]); }
  useEffect(() => { loadLetters(); }, [emp.id]);
  useEffect(() => { (async () => {
    const { data } = await supabase().from("clauses").select("*").eq("letter_type", kind).eq("active", true).order("sort_order");
    const list = (data || []) as Clause[]; setClauses(list); setPicked(new Set(list.filter((c) => isSuggested(c, emp)).map((c) => c.id))); setOverrides({}); setEditing(null);
  })(); }, [kind, emp]);
  useEffect(() => { setAnnexure(kind === "offer"); }, [kind]);   // offer: Annexure on by default; appointment: off by default (you can switch either)
  useEffect(() => { if (!notesEdited && calc) setNotesText(annexureNotes(calc, tfa).join("\n")); }, [calc, tfa, notesEdited]);

  const rendered = (c: Clause): Section => renderSections([c], vars)[0];
  const current = (c: Clause): Section => overrides[c.id] ?? rendered(c);
  const missing = useMemo(() => {
    const used = new Set<string>(); clauses.filter((c) => picked.has(c.id) && !overrides[c.id]).forEach((c) => (c.title + c.body).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => { used.add(k); return ""; }));
    return [...used].filter((k) => !vars[k]);
  }, [clauses, picked, vars, overrides]);

  const payload = (preview: boolean) => ({
    employee_id: emp.id, kind, clause_ids: [...picked], overrides, with_seal: seal, preview, accept_mode: acceptMode,
    extra_sections: extras.filter((x) => x.title && x.body), include_annexure: annexure && !!calc, annexure_notes: notesText.split("\n").map((x) => x.trim()).filter(Boolean),
  });
  async function previewPdf() {
    setBusy("preview"); setMsg("");
    const r = await fetch("/api/letters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(true)) }); setBusy("");
    if (!r.ok) { setMsg((await r.json().catch(() => ({}))).error || "Preview failed"); return; }
    window.open(URL.createObjectURL(await r.blob()), "_blank");
  }
  async function issue() {
    setBusy("issue"); setMsg("");
    const r = await fetch("/api/letters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(false)) });
    const j = await r.json(); setBusy("");
    if (!r.ok) { setMsg(j.error || "Failed"); return; }
    setMsg(`Issued ${j.ref_no}`); setExtras([]); await loadLetters(); window.open(`/api/letters/${j.id}/pdf`, "_blank");
  }
  const setAll = (on: boolean) => setPicked(on ? new Set(clauses.map((c) => c.id)) : new Set());
  const rows = calc ? annexureRows(calc) : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["offer", "appointment"] as const).map((k) => <button key={k} className={`btn ${kind === k ? "btn-primary" : ""}`} onClick={() => setKind(k)}>{k === "offer" ? "Offer letter" : "Appointment letter"}</button>)}
          <span className="ml-auto flex gap-2"><button className="btn !text-xs" onClick={() => setAll(true)}>Tick all</button><button className="btn !text-xs" onClick={() => setAll(false)}>Untick all</button><button className="btn !text-xs" onClick={() => setPicked(new Set(clauses.filter((c) => isSuggested(c, emp)).map((c) => c.id)))}>Reset to suggested</button></span>
        </div>
        <p className="text-sm text-slate-500">Every section is optional. Suggested ones are pre-ticked. Use <b>Edit wording</b> to change any section for this letter only — to change it for all future letters, edit it in the Clause library.</p>

        <div className="space-y-2">
          {clauses.map((c) => { const on = picked.has(c.id); const cur = current(c); const isEdited = !!overrides[c.id]; return (
            <div key={c.id} className={`border rounded-lg p-3 ${on ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50"}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" checked={on} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(c.id) : n.delete(c.id); setPicked(n); }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap"><span className={`font-medium text-sm ${on ? "" : "text-slate-500"}`}>{cur.title}</span>
                    {c.default_on && <span className="text-[10px] bg-green-50 text-green-700 rounded px-1.5">suggested</span>}{isEdited && <span className="text-[10px] bg-amber-50 text-amber-700 rounded px-1.5">edited for this letter</span>}
                    <button className="text-xs text-blue-700 underline ml-auto" onClick={() => { setEditing(editing === c.id ? null : c.id); if (!overrides[c.id] && editing !== c.id) setOverrides((o) => ({ ...o, [c.id]: rendered(c) })); }}>{editing === c.id ? "Done" : "Edit wording"}</button></div>
                  {editing === c.id ? (
                    <div className="mt-2 space-y-2">
                      <input className="inp" value={cur.title} onChange={(e) => setOverrides((o) => ({ ...o, [c.id]: { ...cur, title: e.target.value } }))} />
                      <textarea className="inp font-mono text-xs" rows={Math.min(12, cur.body.split("\n").length + 2)} value={cur.body} onChange={(e) => setOverrides((o) => ({ ...o, [c.id]: { ...cur, body: e.target.value } }))} />
                      <div className="flex items-center gap-3 text-xs text-slate-500"><span><code>- </code> bullet · <code>**bold**</code></span>
                        {isEdited && <button className="text-red-700 underline" onClick={() => setOverrides((o) => { const n = { ...o }; delete n[c.id]; return n; })}>Reset to library wording</button>}</div>
                    </div>
                  ) : on && <pre className="whitespace-pre-wrap text-xs text-slate-600 mt-1 font-sans">{cur.body}</pre>}
                </div>
              </div>
            </div>); })}
          {!clauses.length && <p className="text-sm text-slate-500">No clauses found — run supabase/seed.sql.</p>}
        </div>

        <div className="border border-slate-200 rounded-lg p-3 space-y-2">
          <div className="text-sm font-medium">How the employee accepts</div>
          <label className="flex items-start gap-2 text-sm"><input type="radio" className="mt-1" checked={acceptMode === "email"} onChange={() => setAcceptMode("email")} /><span><b>Reply on the confidential email thread</b> <span className="text-xs text-green-700">(default)</span><br /><span className="text-xs text-slate-500">Letter asks them to reply on the same Gmail thread with a confirmation line. No signed copy, no signature block.</span></span></label>
          <label className="flex items-start gap-2 text-sm"><input type="radio" className="mt-1" checked={acceptMode === "signed"} onChange={() => setAcceptMode("signed")} /><span><b>Sign and return a copy</b><br /><span className="text-xs text-slate-500">Letter asks for a signed copy and prints a Declaration &amp; Acceptance block with signature and date lines.</span></span></label>
        </div>

        <div className="border border-slate-200 rounded-lg p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={annexure && !!calc} disabled={!calc} onChange={(e) => setAnnexure(e.target.checked)} /> Attach Annexure A (salary structure &amp; break-up) <span className="font-normal text-xs text-slate-500">— untick to leave it out</span></label>
          {!calc && <p className="warn">No salary entered for this employee. Add it in the Details tab (CTC / in-hand / gross) to enable this.</p>}
          {calc && annexure && (<>
            <details><summary className="text-xs text-blue-700 cursor-pointer">preview table</summary>
              <table className="text-xs mt-2 w-full">{rows.map((r, i) => <tr key={i} className={r.kind === "row" ? "" : "font-semibold bg-slate-50"}><td className="py-0.5">{r.label}</td><td className="text-right">{r.monthly}</td><td className="text-right">{r.annual}</td></tr>)}</table></details>
            <div><label className="lbl">Notes printed under the table (one per line — edit freely)</label><textarea className="inp text-xs" rows={3} value={notesText} onChange={(e) => { setNotesText(e.target.value); setNotesEdited(true); }} /></div>
          </>)}
        </div>

        <div>
          <div className="flex items-center justify-between"><h4 className="font-semibold text-sm">Extra sections (this letter only)</h4><button className="btn" onClick={() => setExtras([...extras, { title: "", body: "" }])}>+ Add section</button></div>
          {extras.map((x, i) => (
            <div key={i} className="mt-2 space-y-1"><input className="inp" placeholder="Heading" value={x.title} onChange={(e) => setExtras(extras.map((y, j) => j === i ? { ...y, title: e.target.value } : y))} />
              <textarea className="inp" rows={3} placeholder="Text — use {{placeholders}}, '- ' for bullets, **bold**" value={x.body} onChange={(e) => setExtras(extras.map((y, j) => j === i ? { ...y, body: e.target.value } : y))} />
              <button className="text-xs text-red-700 underline" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>remove</button></div>))}
        </div>

        {missing.length > 0 && <p className="warn">Employee record is missing: {missing.join(", ")} — these will print blank. Fill them in the Details tab first.</p>}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={seal} onChange={(e) => setSeal(e.target.checked)} /> Stamp seal & signature</label>
          <button className="btn" disabled={!!busy} onClick={previewPdf}>{busy === "preview" ? "Preparing…" : "Preview PDF (nothing saved)"}</button>
          <button className="btn btn-primary" disabled={!!busy} onClick={issue}>{busy === "issue" ? "Generating…" : `Issue ${kind} letter & download`}</button>
          {msg && <span className="text-sm text-slate-600">{msg}</span>}
        </div>
      </div>
      <div className="card h-fit">
        <h3 className="font-semibold mb-3">Issued letters</h3>
        {letters.map((l) => (
          <div key={l.id} className="py-2 border-t border-slate-100 text-sm">
            <div className="font-medium">{l.kind === "offer" ? "Offer" : "Appointment"} · {l.issued_on}</div>
            <div className="text-xs text-slate-500">{l.ref_no}</div>
            <div className="mt-1 flex gap-3 text-xs"><a className="text-blue-700 underline" href={`/api/letters/${l.id}/pdf?seal=1`} target="_blank">with seal</a><a className="text-blue-700 underline" href={`/api/letters/${l.id}/pdf?seal=0`} target="_blank">without seal</a></div>
          </div>))}
        {!letters.length && <p className="text-sm text-slate-500">Nothing issued yet.</p>}
      </div>
    </div>
  );
}
