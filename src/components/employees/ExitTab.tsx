"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRole } from "@/lib/roles";
import { istToday } from "@/lib/attendance";
import { fmtShort } from "@/lib/employeeList";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { EXIT_TYPE, ITEMS, LETTER_LABEL, PAY_ACTION, REHIRE, isCleared, rupees, type Exit, type ExitItem, type ExitType, type ItemKey, type PayAction, type Rehire } from "@/lib/offboarding";
import { DOC_TYPES, type Employee, type LetterRow } from "@/lib/types";
import PromptDialog, { type PromptSpec } from "../PromptDialog";
import ExitLetters from "./ExitLetters";
import ShareDoc from "./ShareDoc";

type Slip = { line_id: string; pay_month: string; project: string | null; net: number; held: boolean };
type Doc = { doc_type: string; file_path: string | null; status: string };
type Form = { exit_type: ExitType; resigned_on: string; last_day: string; reason: string; notes: string; rehire: Rehire; rehire_note: string; pay_action: PayAction; pay_reason: string };
const blankForm = (e: Employee): Form => ({ exit_type: "resigned", resigned_on: "", last_day: e.left_on || istToday(), reason: "", notes: "", rehire: "yes", rehire_note: "", pay_action: "pay", pay_reason: "" });
const formOf = (x: Exit): Form => ({ exit_type: x.exit_type, resigned_on: x.resigned_on || "", last_day: x.last_day, reason: x.reason, notes: x.notes, rehire: x.rehire, rehire_note: x.rehire_note, pay_action: x.pay_action, pay_reason: x.pay_reason });
const STATUS_PILL: Record<string, string> = { open: "bg-amber-50 text-amber-800", closed: "bg-emerald-50 text-emerald-700", cancelled: "bg-slate-100 text-slate-600" };
const monthName = (iso: string) => new Date(iso.slice(0, 7) + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/** The Exit tab: record someone leaving, run the exit checklist, issue the exit letters, and keep every document issued to them (letters, salary slips, files)
 *  in one place to view and share. Admin and Operations only. */
export default function ExitTab({ emp, onChange }: { emp: Employee; onChange: (e: Employee) => void }) {
  const { admin, staff } = useRole();
  const [exits, setExits] = useState<Exit[] | null>(null); const [items, setItems] = useState<ExitItem[]>([]); const [letters, setLetters] = useState<LetterRow[]>([]);
  const [slips, setSlips] = useState<Slip[]>([]); const [docs, setDocs] = useState<Doc[]>([]); const [advance, setAdvance] = useState(0); const [missing, setMissing] = useState(false);
  const [form, setForm] = useState<Form | null>(null); const [busy, setBusy] = useState(""); const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const [dlg, setDlg] = useState<PromptSpec | null>(null);
  const ask = (s: Omit<PromptSpec, "resolve">) => new Promise<string | null>((res) => setDlg({ ...s, resolve: (x) => { setDlg(null); res(x); } }));

  const current = useMemo(() => (exits || []).find((x) => x.status !== "cancelled" && !x.rehired_at) ?? null, [exits]);
  const load = useCallback(async () => {
    const sb = supabase();
    const [x, l, s, d, a] = await Promise.all([
      sb.from("employee_exits").select("*").eq("employee_id", emp.id).order("created_at", { ascending: false }),
      sb.from("letters").select("*").eq("employee_id", emp.id).order("created_at", { ascending: false }),
      sb.rpc("employee_slips", { p_employee: emp.id }),
      sb.from("employee_documents").select("doc_type,file_path,status").eq("employee_id", emp.id).not("file_path", "is", null),
      sb.rpc("employee_advance_balance", { p_employee: emp.id }),
    ]);
    if (x.error) { setMissing(true); setExits([]); } else { setMissing(false); setExits((x.data || []) as Exit[]); }
    setLetters((l.data || []) as LetterRow[]); setSlips(s.error ? [] : ((s.data || []) as Slip[])); setDocs((d.data || []) as Doc[]); setAdvance(a.error ? 0 : Number(a.data) || 0);
    const cur = ((x.data || []) as Exit[]).find((e) => e.status !== "cancelled" && !e.rehired_at);
    if (cur) { const { data } = await sb.from("employee_exit_items").select("*").eq("exit_id", cur.id); setItems((data || []) as ExitItem[]); } else setItems([]);
  }, [emp.id]);
  useEffect(() => { load(); }, [load]);
  const refreshEmp = async () => { const { data } = await supabase().from("employees").select("*").eq("id", emp.id).single(); if (data) onChange(data as Employee); };
  const done = (m: string) => { setOk(m); setTimeout(() => setOk(""), 4000); };

  async function save() {
    if (!form) return; setBusy("save"); setErr("");
    const args = { p_type: form.exit_type, p_last_day: form.last_day, p_resigned_on: form.resigned_on || null, p_reason: form.reason, p_notes: form.notes, p_rehire: form.rehire, p_rehire_note: form.rehire_note, p_pay_action: form.pay_action, p_pay_reason: form.pay_reason };
    const { error } = current && current.status === "open" ? await supabase().rpc("exit_update", { p_exit: current.id, ...args }) : await supabase().rpc("exit_start", { p_employee: emp.id, ...args });
    setBusy(""); if (error) { setErr(error.message); return; }
    setForm(null); done(current ? "Exit updated ✓" : "Exit recorded ✓ Their last working day is set; payroll and attendance follow it."); await load(); await refreshEmp();
  }
  async function cancelExit() {
    if (!current) return;
    const why = await ask({ title: "Cancel this exit?", label: "Reason", hint: "They become a working employee again: the last working day is cleared, and any salary hold or forfeit from this exit is undone.", confirmLabel: "Cancel exit", validate: (v) => (v ? null : "Give a reason") });
    if (!why) return; setBusy("cancel"); setErr(""); const { error } = await supabase().rpc("exit_cancel", { p_exit: current.id, p_reason: why }); setBusy("");
    if (error) { setErr(error.message); return; } done("Exit cancelled ✓"); await load(); await refreshEmp();
  }
  async function closeExit() {
    if (!current) return; let note = "";
    if (!isCleared(items)) {
      if (!admin) { setErr("Finish the exit checklist first: mark each item done or not applicable."); return; }
      const why = await ask({ title: "The checklist is not finished", label: "Reason for closing it anyway", hint: "Recorded on the exit.", confirmLabel: "Close anyway", validate: (v) => (v ? null : "Give a reason") });
      if (!why) return; note = why;
    } else if (!confirm("Close this exit? The checklist can no longer be changed. Letters can still be issued.")) return;
    setBusy("close"); setErr(""); const { error } = await supabase().rpc("exit_close", { p_exit: current.id, p_note: note }); setBusy("");
    if (error) { setErr(error.message); return; } done("Exit closed ✓"); load();
  }
  async function rehire() {
    const risky = current && (current.rehire === "no" || current.exit_type === "absconded");
    if (risky && !admin) { setErr("This person was marked as not to be rehired. Only an Admin can rehire them."); return; }
    const note = await ask({ title: `Rehire ${emp.full_name}?`, label: risky ? "Reason (required)" : "Note (optional)", hint: `${risky ? `Marked ${current!.exit_type === "absconded" ? "absconded" : "not to be rehired"}. ` : ""}They go back to the Offer stage with no joining date. Issue a fresh offer and appointment letter, then onboard them again. Their past letters and slips stay here.`, confirmLabel: "Rehire", validate: (v) => (risky && !v ? "Give a reason" : null) });
    if (note === null) return; setBusy("rehire"); setErr(""); const { error } = await supabase().rpc("employee_rehire", { p_employee: emp.id, p_note: note }); setBusy("");
    if (error) { setErr(error.message); return; } done("Rehired ✓ They are back in the hiring pipeline at Offer."); await load(); await refreshEmp();
  }

  if (!staff) return <div className="card text-sm text-slate-500">Exits and exit letters are for Admin and Operations.</div>;
  if (!exits) return <div className="card"><div className="skeleton h-24 w-full" /></div>;
  const editing = !!form; const open = current?.status === "open";
  return (
    <div className="space-y-4" data-exit-tab>
      <PromptDialog spec={dlg} />
      {missing && <p className="warn !text-sm">Offboarding is not switched on yet: run 2026-11-offboarding.sql in the Supabase SQL editor. Documents already issued are listed below.</p>}
      {ok && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">{ok}</p>}
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{err}</p>}

      {/* the exit */}
      {!missing && !editing && !current && <div className="card flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1"><h3 className="font-semibold">{emp.stage === "onboarded" ? "Still working" : "Not employed at the moment"}</h3><p className="text-sm text-slate-500">Record the exit when they resign, finish a contract, are terminated or abscond. It sets their last working day.</p></div>
        {emp.stage === "onboarded" && <button type="button" className="btn btn-primary" onClick={() => setForm(blankForm(emp))}>Offboard {emp.full_name.split(/\s+/)[0]}</button>}
      </div>}
      {editing && form && <ExitForm form={form} setForm={setForm} admin={admin} busy={busy === "save"} isNew={!current} onSave={save} onCancel={() => { setForm(null); setErr(""); }} />}
      {!editing && current && <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{EXIT_TYPE[current.exit_type]}</h3>
          <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[current.status]}`}>{current.status === "open" ? "Exit open" : "Exit closed"}</span>
          {current.exit_type === "absconded" && <span className="rounded-full px-2 py-0.5 text-xs bg-rose-50 text-rose-700">Absconded</span>}
          <div className="ml-auto flex flex-wrap gap-2">
            {open && <button type="button" className="btn btn-sm" onClick={() => setForm(formOf(current))}>Edit</button>}
            {open && <button type="button" className="btn btn-sm btn-danger" disabled={!!busy} onClick={cancelExit}>Cancel exit</button>}
            {open && <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={closeExit}>Close exit</button>}
            {current.status === "closed" && <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={rehire}>Rehire</button>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4 text-sm">
          <div><div className="lbl">Last working day</div>{fmtShort(current.last_day, true)}</div>
          {current.resigned_on && <div><div className="lbl">Resigned on</div>{fmtShort(current.resigned_on, true)}</div>}
          <div><div className="lbl">Salary</div><span className={current.pay_action === "pay" ? "" : "text-rose-700 font-medium"}>{PAY_ACTION[current.pay_action].label}</span>{current.pay_reason && <div className="text-xs text-slate-500">{current.pay_reason}</div>}</div>
          <div><div className="lbl">Rehire</div>{REHIRE[current.rehire]}{current.rehire_note && <div className="text-xs text-slate-500">{current.rehire_note}</div>}</div>
        </div>
        {(current.reason || current.notes) && <p className="text-sm text-slate-600 whitespace-pre-line">{[current.reason, current.notes].filter(Boolean).join("\n")}</p>}
        {current.close_note && <p className="text-xs text-amber-800">Closed by an Admin with the checklist unfinished: {current.close_note}</p>}
        {current.pay_action !== "pay" && <p className="text-xs text-slate-500">Their unpaid salary is on hold{current.pay_action === "forfeit" ? `, and ${monthName(current.last_day)} is left out of payroll` : ""}. Release a hold from <Link className="text-blue-700 underline" href="/payroll">Payroll → Pay</Link> once they settle.</p>}
      </div>}

      {/* the checklist */}
      {current && !editing && <Checklist emp={emp} exitId={current.id} open={open} items={items} advance={advance} reload={load} setErr={setErr} />}

      {/* letters */}
      {!missing && (current || emp.stage === "onboarded") && <ExitLetters emp={emp} exit={current} items={items} slips={slips} advance={advance} admin={admin} onIssued={load} />}

      {/* everything issued */}
      <div className="card space-y-4" data-issued>
        <h3 className="font-semibold">Documents issued</h3>
        <section><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Letters</h4>
          {letters.length ? <ul className="divide-y divide-slate-100">{letters.map((l) => <li key={l.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-medium">{LETTER_LABEL[l.kind] ?? l.kind}</span><span className="text-xs text-slate-500">{fmtShort(l.issued_on, true)} · {l.ref_no}</span>
            {l.vars?.override && <span className="text-[11px] text-amber-700" title={l.vars.override}>Admin override</span>}
            <span className="ml-auto"><ShareDoc kind="letter" id={l.id} view={`/api/letters/${l.id}/pdf`} download={`/api/letters/${l.id}/pdf?download=1`} title={LETTER_LABEL[l.kind] ?? "Letter"} phone={emp.phone} email={emp.email} name={emp.full_name} /></span></li>)}</ul>
            : <p className="text-sm text-slate-500">No letters issued yet.</p>}</section>
        <section><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Salary slips</h4>
          {slips.length ? <ul className="divide-y divide-slate-100">{slips.map((s) => <li key={s.line_id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-medium">{monthName(s.pay_month)}</span><span className="text-xs text-slate-500">{s.project} · {rupees(Number(s.net))}{s.held ? " · on hold" : ""}</span>
            <span className="ml-auto"><ShareDoc kind="slip" id={s.line_id} view={`/api/payslips/${s.line_id}`} title={`Salary slip for ${monthName(s.pay_month)}`} phone={emp.phone} email={emp.email} name={emp.full_name} /></span></li>)}</ul>
            : <p className="text-sm text-slate-500">{missing ? "Shown once the migration is run." : "No approved salary slips yet."}</p>}</section>
        <section><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Files on record</h4>
          {docs.length ? <ul className="flex flex-wrap gap-2">{docs.map((d) => <li key={d.doc_type}><a className="chip" href={`/api/docs/view?path=${encodeURIComponent(d.file_path!)}`} target="_blank" rel="noreferrer">{DOC_TYPES.find((t) => t.key === d.doc_type)?.label ?? d.doc_type}</a></li>)}</ul>
            : <p className="text-sm text-slate-500">No files uploaded.</p>}</section>
      </div>

      {/* earlier exits */}
      {exits.filter((x) => x !== current).length > 0 && <details className="card"><summary className="cursor-pointer text-sm font-semibold">Earlier exits ({exits.filter((x) => x !== current).length})</summary>
        <ul className="mt-2 divide-y divide-slate-100 text-sm">{exits.filter((x) => x !== current).map((x) => <li key={x.id} className="py-2 flex flex-wrap gap-x-3">
          <span className="font-medium">{EXIT_TYPE[x.exit_type]}</span><span className="text-slate-500">last day {fmtShort(x.last_day, true)}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_PILL[x.status]}`}>{x.status}</span>{x.rehired_at && <span className="text-xs text-blue-700">rehired {fmtShort(x.rehired_at.slice(0, 10), true)}</span>}
          {x.cancel_reason && <span className="basis-full text-xs text-slate-500">Cancelled: {x.cancel_reason}</span>}</li>)}</ul></details>}
    </div>
  );
}

function ExitForm({ form, setForm, admin, busy, isNew, onSave, onCancel }: { form: Form; setForm: (f: Form) => void; admin: boolean; busy: boolean; isNew: boolean; onSave: () => void; onCancel: () => void }) {
  const set = (p: Partial<Form>) => setForm({ ...form, ...p });
  const pickType = (t: ExitType) => set({ exit_type: t, pay_action: t === "absconded" ? (form.pay_action === "pay" ? "hold" : form.pay_action) : form.pay_action === "hold" && form.exit_type === "absconded" ? "pay" : form.pay_action, rehire: t === "absconded" ? "no" : form.exit_type === "absconded" ? "yes" : form.rehire });
  return (
    <div className="card space-y-4" data-exit-form>
      <h3 className="font-semibold">{isNew ? "Offboard" : "Edit exit"}</h3>
      <div><div className="lbl">How are they leaving?</div><div className="flex flex-wrap gap-2">{(Object.keys(EXIT_TYPE) as ExitType[]).map((t) => <button key={t} type="button" className={`chip ${form.exit_type === t ? "chip-on" : ""}`} aria-pressed={form.exit_type === t} onClick={() => pickType(t)}>{EXIT_TYPE[t]}</button>)}</div></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="lbl">Last working day</span><input type="date" className="inp" value={form.last_day} onChange={(e) => set({ last_day: e.target.value })} /><span className="text-xs text-slate-500">{form.exit_type === "absconded" ? "The last day they actually worked." : "Pay and the attendance sheet stop after this day."}</span></label>
        {form.exit_type !== "absconded" && <label className="block"><span className="lbl">{form.exit_type === "resigned" ? "Resignation date" : "Notice / decision date"} (optional)</span><input type="date" className="inp" value={form.resigned_on} onChange={(e) => set({ resigned_on: e.target.value })} /></label>}
      </div>
      <label className="block"><span className="lbl">Reason</span><input className="inp" value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder={form.exit_type === "absconded" ? "e.g. Stopped reporting from 3 Nov; not reachable" : "e.g. Better opportunity, project completed…"} /></label>
      <div><div className="lbl">Salary</div><div className="grid gap-2 sm:grid-cols-3">{(Object.keys(PAY_ACTION) as PayAction[]).map((p) => { const off = p === "forfeit" && !admin; return (
        <label key={p} className={`rounded-xl border px-3 py-2 text-sm ${form.pay_action === p ? "border-blue-500 bg-blue-50/50" : "border-slate-200"} ${off ? "opacity-50" : "cursor-pointer"}`}>
          <span className="flex items-center gap-2 font-medium"><input type="radio" name="pay" disabled={off} checked={form.pay_action === p} onChange={() => set({ pay_action: p })} />{PAY_ACTION[p].label}</span>
          <span className="block text-xs text-slate-500 mt-0.5">{PAY_ACTION[p].help}</span></label>); })}</div>
        {form.pay_action !== "pay" && <input className="inp mt-2" value={form.pay_reason} onChange={(e) => set({ pay_reason: e.target.value })} placeholder={form.pay_action === "forfeit" ? "Reason for not paying (required)" : "Reason for the hold (optional)"} />}
        {form.pay_action === "forfeit" && <p className="text-xs text-amber-800 mt-1">Wages already earned are generally payable under Indian wage law. Prefer a hold and settle it, unless your HR or legal advisor has confirmed the forfeit.</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[auto_1fr] items-end">
        <div><div className="lbl">Can they be rehired?</div><div className="flex gap-2">{(Object.keys(REHIRE) as Rehire[]).map((r) => <button key={r} type="button" className={`chip ${form.rehire === r ? "chip-on" : ""}`} aria-pressed={form.rehire === r} onClick={() => set({ rehire: r })}>{REHIRE[r]}</button>)}</div></div>
        {form.rehire !== "yes" && <input className="inp" value={form.rehire_note} onChange={(e) => set({ rehire_note: e.target.value })} placeholder={form.rehire === "no" ? "Why not" : "On what conditions"} />}
      </div>
      <label className="block"><span className="lbl">Notes (optional)</span><textarea className="inp" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-primary" disabled={busy} onClick={onSave}>{busy ? "Saving…" : isNew ? "Record exit" : "Save changes"}</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function Checklist({ emp, exitId, open, items, advance, reload, setErr }: { emp: Employee; exitId: string; open: boolean; items: ExitItem[]; advance: number; reload: () => void; setErr: (s: string) => void }) {
  const [busy, setBusy] = useState("");
  const of = (k: ItemKey) => items.find((i) => i.item === k);
  async function set(k: ItemKey, state: "done" | "na" | null, patch: { done_on?: string; note?: string; file?: string } = {}) {
    const cur = of(k); setBusy(k); setErr("");
    const { error } = await supabase().rpc("exit_item_set", { p_exit: exitId, p_item: k, p_state: state, p_done_on: patch.done_on ?? cur?.done_on ?? null, p_note: patch.note ?? cur?.note ?? "", p_file: patch.file ?? null });
    setBusy(""); if (error) { setErr(error.message); return; } reload();
  }
  async function upload(k: ItemKey, picked: File) {
    const file = await prepareUpload(picked, {}); if (file.size > MAX_UPLOAD) { setErr("That file is larger than 5 MB."); return; }
    setBusy(k); const fd = new FormData(); fd.set("file", file); fd.set("employeeId", emp.id); fd.set("docType", `exit_${k}`);
    const r = await fetch("/api/docs/upload", { method: "POST", body: fd }); setBusy("");
    if (!r.ok) { setErr(await r.text()); return; } const { path } = await r.json(); await set(k, of(k)?.state ?? "done", { file: path });
  }
  const n = ITEMS.filter((i) => of(i.key)).length;
  return (
    <div className="card space-y-2" data-exit-checklist>
      <div className="flex items-center gap-2"><h3 className="font-semibold mr-auto">Exit checklist</h3><span className={`text-sm ${n === ITEMS.length ? "text-emerald-700" : "text-slate-500"}`}>{n}/{ITEMS.length} done</span></div>
      <ul className="divide-y divide-slate-100">{ITEMS.map((i) => { const it = of(i.key); return (
        <li key={i.key} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="min-w-0 flex-1 basis-56"><span className={`block text-sm font-medium ${it ? "" : "text-slate-800"}`}>{it?.state === "done" ? "✓ " : it?.state === "na" ? "— " : ""}{i.label}</span>
            <span className="block text-xs text-slate-500">{i.key === "advances" ? (advance > 0 ? `Outstanding: ${rupees(advance)}. ` : "No advance outstanding. ") : ""}{i.hint}{i.key === "accommodation" ? <> <Link className="text-blue-700 underline" href="/accommodation">Accommodation</Link></> : null}</span>
            {it && <span className="block text-xs text-slate-500">{it.state === "done" ? `Done${it.done_on ? ` on ${fmtShort(it.done_on, true)}` : ""}` : "Not applicable"}{it.note ? ` · ${it.note}` : ""}</span>}</span>
          {it?.file_path && <a className="text-xs text-blue-700 underline" href={`/api/docs/view?path=${encodeURIComponent(it.file_path)}`} target="_blank" rel="noreferrer">View file</a>}
          {open && <span className="flex flex-wrap items-center gap-1.5">
            {it?.state === "done" && <input type="date" aria-label={`${i.label}: date`} className="inp !w-auto !py-1 text-xs" value={it.done_on ?? ""} max={istToday()} onChange={(e) => e.target.value && set(i.key, "done", { done_on: e.target.value })} />}
            {!it && <><button type="button" className="btn btn-sm" disabled={busy === i.key} onClick={() => set(i.key, "done")}>Done</button><button type="button" className="btn btn-sm" disabled={busy === i.key} onClick={() => set(i.key, "na")}>N/A</button></>}
            {it && <button type="button" className="text-xs text-slate-500 underline" disabled={busy === i.key} onClick={() => { const v = prompt(`Note for "${i.label}"`, it.note); if (v !== null) set(i.key, it.state, { note: v }); }}>Note</button>}
            {it && <label className="text-xs text-blue-700 underline cursor-pointer">{busy === i.key ? "…" : it.file_path ? "Replace file" : "Attach file"}<input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(i.key, e.target.files[0])} /></label>}
            {it && <button type="button" className="text-xs text-red-700 underline" disabled={busy === i.key} onClick={() => set(i.key, null)}>Undo</button>}
          </span>}
        </li>); })}</ul>
    </div>
  );
}
