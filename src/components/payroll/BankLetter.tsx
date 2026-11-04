"use client";
import { useEffect, useState } from "react";
import { BANK } from "@/lib/company";

export type BankRow = { id: string; name: string; left: number; account: string; ifsc: string; bank: string };
const KEY = "cipco_bank_letter";
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const MODES = [["NEFT", "NEFT"], ["RTGS", "RTGS (₹2 lakh and above)"], ["IMPS", "IMPS"], ["transfer within the bank", "Transfer within the bank"]];

// Pay tab: the letter to the bank asking it to credit this month's salaries, on the company letterhead, to be signed by hand and submitted with the account details.
// Lists the people still to be paid by bank transfer; anyone without an account number or IFSC is shown but left out. The bank, branch and company account number are remembered on this device.
export default function BankLetter({ runId, ym, rows }: { runId: string; ym: string; rows: BankRow[] }) {
  const [f, setF] = useState({ bank: BANK.bank, branch: BANK.branch, account: BANK.accountNo, mode: "NEFT", value: "", ref: `CIPCO/SAL/${ym}` }); const [off, setOff] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); setF((x) => ({ ...x, bank: s.bank || x.bank, branch: s.branch || x.branch, account: s.account || x.account, mode: s.mode ?? "NEFT" })); } catch { /* storage unavailable */ } }, []);
  useEffect(() => { setF((x) => ({ ...x, ref: `CIPCO/SAL/${ym}` })); }, [ym]);
  const set = (k: keyof typeof f, v: string) => { const n = { ...f, [k]: v }; setF(n); if (k !== "ref" && k !== "value") try { localStorage.setItem(KEY, JSON.stringify({ bank: n.bank, branch: n.branch, account: n.account, mode: n.mode })); } catch { /* ignore */ } };
  const ok = rows.filter((r) => r.account && r.ifsc), bad = rows.filter((r) => !(r.account && r.ifsc)); const chosen = ok.filter((r) => !off.has(r.id)); const total = chosen.reduce((s, r) => s + r.left, 0);
  const small = f.mode === "RTGS" ? chosen.filter((r) => r.left < 200000).length : 0;
  async function make() {
    if (!f.bank.trim() || !f.account.trim()) { setErr("Enter the bank name and your account number with it: the letter is addressed to that branch."); return; } if (!chosen.length) { setErr("Choose at least one person."); return; }
    setErr(""); setBusy(true); const tab = window.open("", "_blank");   // opened now, on the tap, so the browser does not block it after the wait
    const q = new URLSearchParams({ run: runId, lines: chosen.map((r) => r.id).join(","), bank: f.bank.trim(), branch: f.branch.trim(), account: f.account.trim(), mode: f.mode, ref: f.ref.trim() }); if (f.value) q.set("value", f.value);
    try { const r = await fetch(`/api/payroll-bank-letter?${q}`); if (!r.ok) throw new Error((await r.text()) || `Error ${r.status}`); const url = URL.createObjectURL(await r.blob()); if (tab) tab.location.href = url; else window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    catch (e: any) { tab?.close(); setErr(e?.message || "Couldn't make the letter."); } setBusy(false);
  }
  const inp = (k: keyof typeof f, l: string, w = "!w-full", ph = "", type = "text") => <div><label className="lbl">{l}</label><input type={type} className={`inp ${w}`} value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} autoComplete="off" /></div>;
  return (
    <details className="card !p-3">
      <summary className="cursor-pointer text-sm font-medium">Letter to the bank (PDF){ok.length ? ` · ${ok.length} to pay by transfer` : ""}</summary>
      <div className="mt-2 space-y-3">
        <p className="text-xs text-slate-500">A letter on the company letterhead asking your bank to credit the salaries, with each person's name (as per Aadhaar), amount, bank, branch, account number and IFSC. It has no seal or signature: print it, sign it, and submit it to the bank.</p>
        {!rows.length && <p className="text-sm text-slate-500">Nobody is left to pay by bank transfer.</p>}
        {rows.length > 0 && <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{inp("bank", "Your bank (the letter is addressed to it)", "", "e.g. IDBI Bank")}{inp("branch", "Branch", "", "e.g. Mundra")}{inp("account", "Company account number to debit")}
            <div><label className="lbl">Payment mode</label><select className="inp" value={f.mode} onChange={(e) => set("mode", e.target.value)}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            {inp("value", "Process on (optional)", "", "", "date")}{inp("ref", "Letter reference")}</div>
          <div className="space-y-1"><div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span>People on the letter</span><button type="button" className="underline" onClick={() => setOff(new Set())}>select all</button><button type="button" className="underline" onClick={() => setOff(new Set(ok.map((r) => r.id)))}>clear</button></div>
            <ul className="grid gap-1 sm:grid-cols-2">{ok.map((r) => <li key={r.id}><label className="flex items-center gap-2 text-sm rounded-lg border border-slate-200 px-2.5 py-1.5 cursor-pointer"><input type="checkbox" checked={!off.has(r.id)} onChange={(e) => { const n = new Set(off); if (e.target.checked) n.delete(r.id); else n.add(r.id); setOff(n); }} /><span className="flex-1 min-w-0 truncate">{r.name}</span><span className="tabular-nums text-slate-600">₹{inr(r.left)}</span></label></li>)}
              {bad.map((r) => <li key={r.id} className="flex items-center gap-2 text-sm rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5"><span className="flex-1 min-w-0 truncate">{r.name}</span><span className="text-xs text-amber-800">no account no. / IFSC: left out</span></li>)}</ul></div>
          {small > 0 && <p className="warn">RTGS is for ₹2 lakh and above, and {small} payment{small === 1 ? " is" : "s are"} below that. Use NEFT for those.</p>}
          {bad.length > 0 && <p className="warn">{bad.length} {bad.length === 1 ? "person has" : "people have"} no account number or IFSC, so {bad.length === 1 ? "they are" : "they are"} not on the letter. Add the details on their record and come back.</p>}
          {err && <p className="warn" role="alert">{err}</p>}
          <div className="flex flex-wrap items-center gap-3"><button className="btn btn-primary" disabled={busy || !chosen.length} onClick={make}>{busy ? "Making the letter…" : "Make the letter (PDF)"}</button><span className="text-sm text-slate-600">{chosen.length} {chosen.length === 1 ? "person" : "people"} · ₹{inr(total)}</span></div></>}
      </div>
    </details>
  );
}
