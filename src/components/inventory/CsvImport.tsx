"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { inr } from "@/lib/inventory";
import { GEMINI_PROMPT, TEMPLATE_CSV, parseBillCsv, type ImportResult } from "@/lib/inventoryCsv";

const MAX_BYTES = 1_000_000;
const friendly = (e: { code?: string; message: string }) => (e.code === "23505" ? "This bill is already entered: same vendor, bill number and date." : e.message);
const dmy = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// Admin only (the page decides who sees it). One CSV = one bill: it becomes a draft with every item entered. The photo of the bill cannot come from a CSV, so it is attached on the next screen, and the usual checks still run when the bill is recorded.
export default function CsvImport({ projectId, onClose, onChanged, onCreated }: { projectId: string; onClose: () => void; onChanged: () => Promise<void>; onCreated: (id: string) => void }) {
  const [res, setRes] = useState<ImportResult | null>(null); const [fileName, setFileName] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [copied, setCopied] = useState(false);

  async function pick(file: File | undefined) {
    setErr(""); setRes(null); if (!file) return; setFileName(file.name);
    if (file.size > MAX_BYTES) return setErr("That file is too large for one bill (over 1 MB).");
    setRes(parseBillCsv(await file.text()));
  }
  function download() {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" })); a.download = "inventory-bill-template.csv"; a.click(); URL.revokeObjectURL(a.href);
  }
  async function copyPrompt() { try { await navigator.clipboard.writeText(GEMINI_PROMPT); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setErr("Could not copy. Open the prompt below and select it by hand."); } }

  async function create() {
    if (!res?.bill || res.errors.length) return; setBusy(true); setErr("");
    const sb = supabase();
    const { data, error } = await sb.from("inventory_bills").insert({ ...res.bill, project_id: projectId }).select("id").single();
    if (error) { setBusy(false); return setErr(friendly(error)); }
    const id = (data as { id: string }).id;
    const rows = res.items.map((i, n) => ({ bill_id: id, line_no: n + 1, name: i.name, hsn: i.hsn, qty: i.qty, unit: i.unit, rate: i.rate, gst_pct: i.gst_pct }));
    const ins = await sb.from("inventory_bill_items").insert(rows);
    if (ins.error) { await sb.from("inventory_bills").delete().eq("id", id); setBusy(false); return setErr(`Nothing was imported: ${ins.error.message}`); }   // all the items go in one statement, so a failure leaves none; the empty draft is removed too
    await onChanged(); setBusy(false); onCreated(id);
  }

  const b = res?.bill; const blocked = !res || !b || res.errors.length > 0;
  return (
    <section className="card !p-3 space-y-3">
      <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Import a bill from CSV</h2><span className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-600">Admin</span><button className="btn btn-sm ml-auto" onClick={onClose}>Close</button></div>
      <ol className="text-sm text-slate-600 list-decimal pl-5 space-y-1">
        <li>Give the bill to Gemini with the prompt below. It returns the CSV, with any missing HSN filled in and marked as a guess.</li>
        <li>Save it as a .csv file and choose it here. Check the preview.</li>
        <li>Create the draft, attach the photo of the bill on the next screen, then record it.</li>
      </ol>
      <div className="flex flex-wrap gap-2 form-actions">
        <button className="btn" onClick={copyPrompt}>{copied ? "Prompt copied ✓" : "Copy the Gemini prompt"}</button>
        <button className="btn" onClick={download}>Download the template</button>
        <label className="btn btn-primary cursor-pointer justify-center">Choose CSV file<input type="file" className="hidden" accept=".csv,text/csv" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} /></label>
      </div>
      <details className="text-sm"><summary className="cursor-pointer text-[#1e4fa3]">Show the prompt</summary><textarea readOnly className="inp mt-2 h-48 text-xs font-mono" value={GEMINI_PROMPT} onFocus={(e) => e.currentTarget.select()} /></details>
      {err && <p className="warn" role="alert">{err}</p>}

      {res && <div className="space-y-3 border-t border-slate-100 pt-3">
        <div className="text-xs text-slate-500">{fileName}</div>
        {res.errors.length > 0 && <div className="warn" role="alert"><b>Fix these in the file, then choose it again:</b><ul className="list-disc pl-5 mt-1">{res.errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}{res.errors.length > 12 && <li>and {res.errors.length - 12} more</li>}</ul></div>}
        {res.warnings.length > 0 && <div className="text-sm rounded-xl px-3 py-2 bg-amber-50 text-amber-900"><b>Check:</b><ul className="list-disc pl-5 mt-1">{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
        {b && <>
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-5 text-sm">
            <div><div className="text-xs text-slate-400">Vendor</div>{b.vendor_name}</div><div><div className="text-xs text-slate-400">GSTIN</div>{b.vendor_gstin || "—"}</div><div><div className="text-xs text-slate-400">Bill</div>{b.bill_no}</div>
            <div><div className="text-xs text-slate-400">Date</div>{dmy(b.bill_date)}</div><div><div className="text-xs text-slate-400">Total on the bill</div><b className="tabular-nums">₹{inr(b.bill_total)}</b>{b.other_charges !== 0 && <span className="text-xs text-slate-500"> · other ₹{inr(b.other_charges)}</span>}</div>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500 border-b"><tr><th className="py-1 pr-2">#</th><th className="pr-2">Item</th><th className="pr-2">HSN</th><th className="pr-2 text-right">Qty</th><th className="pr-2 text-right">Rate</th><th className="pr-2 text-right">GST</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{res.items.map((i, n) => <tr key={n} className="border-b border-slate-100 align-top"><td className="py-1 pr-2 text-slate-400">{n + 1}</td><td className="pr-2">{i.name}</td><td className="pr-2 whitespace-nowrap">{i.hsn || "—"}{i.hsnGuessed && <span className="ml-1 text-[10px] rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-800">guessed</span>}</td><td className="pr-2 text-right whitespace-nowrap tabular-nums">{i.qty} {i.unit}</td><td className="pr-2 text-right tabular-nums">{inr(i.rate)}</td><td className="pr-2 text-right tabular-nums">{i.gst_pct}%</td><td className="text-right tabular-nums">{inr(i.amount)}</td></tr>)}</tbody></table></div>
          {res.sums && <div className={`flex flex-wrap justify-between gap-x-4 text-sm font-medium tabular-nums ${res.sums.matches ? "text-green-700" : "text-amber-700"}`}><span>Items ₹{inr(res.sums.taxable)} + GST ₹{inr(res.sums.tax)} = ₹{inr(res.sums.computed)}</span><span>{res.sums.matches ? (res.sums.diff === 0 ? "Matches the bill" : `Matches, with ₹${inr(Math.abs(res.sums.diff))} round off`) : `₹${inr(Math.abs(res.sums.diff))} ${res.sums.diff > 0 ? "short" : "over"} of the bill`}</span></div>}
        </>}
        <div className="flex flex-wrap items-center gap-2 form-actions"><button className="btn btn-primary" disabled={busy || blocked} onClick={create}>{busy ? "Importing…" : blocked ? "Create draft" : `Create draft with ${res.items.length} item${res.items.length === 1 ? "" : "s"}`}</button><button className="btn" onClick={() => { setRes(null); setFileName(""); }}>Clear</button></div>
        <p className="text-xs text-slate-500">The photo of the bill is not in a CSV. You attach it on the next screen, and the bill can only be recorded once it is there and the items match its total.</p>
      </div>}
    </section>
  );
}
