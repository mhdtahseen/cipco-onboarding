"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { BLANK_ITEM, emptyQuote, inr, itemAmount, totals, type QItem, type QLib, type Quote } from "@/lib/quote";
import { todayISO } from "@/lib/format";
import LineList from "./LineList";

const COLS = ["client_name", "client_short", "client_address", "kind_attn", "subject", "intro", "quote_date", "items", "show_total", "show_gst", "notes", "terms", "include_scope", "scope", "client_supply", "our_supply", "signatory"] as const;
const pick = (q: Quote) => Object.fromEntries(COLS.map((k) => [k, (q as any)[k]]));

export default function QuoteEditor({ id }: { id: string }) {
  const router = useRouter(); const isNew = id === "new";
  const [q, setQ] = useState<Quote | null>(null); const [lib, setLib] = useState<QLib[]>([]); const [busy, setBusy] = useState(""); const [msg, setMsg] = useState(""); const [dirty, setDirty] = useState(false); const [tag, setTag] = useState("");
  const loadLib = async () => { const { data } = await supabase().from("quote_library").select("*").eq("active", true).order("sort_order"); setLib((data || []) as QLib[]); return (data || []) as QLib[]; };
  useEffect(() => { (async () => {
    const l = await loadLib();
    if (isNew) { const e = emptyQuote(todayISO()); e.client_supply = l.filter((x) => x.kind === "client_supply" && x.default_on).map((x) => x.body); e.our_supply = l.filter((x) => x.kind === "our_supply" && x.default_on).map((x) => x.body); e.notes = l.filter((x) => x.kind === "note" && x.default_on).map((x) => x.body); setQ(e); return; }
    const { data, error } = await supabase().from("quotations").select("*").eq("id", id).single();
    if (error || !data) { setMsg(error?.message || "Quotation not found"); return; } setQ(data as Quote);
  })(); }, [id]);
  const tags = useMemo(() => [...new Set(lib.filter((l) => l.kind === "scope" && l.tag).map((l) => l.tag!))], [lib]);
  useEffect(() => { if (!tag && tags.length) setTag(tags[0]); }, [tags]);
  if (!q) return <p className={msg ? "warn" : "text-slate-500"}>{msg || "Loading…"}</p>;
  const locked = q.status === "issued"; const t = totals(q.items);
  const set = <K extends keyof Quote>(k: K, v: Quote[K]) => { setQ((p) => ({ ...p!, [k]: v })); setDirty(true); };
  const setItem = (i: number, p: Partial<QItem>) => set("items", q.items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const presets = lib.filter((l) => l.kind === "payment_terms");

  async function save(nav = true): Promise<string | null> {
    if (!q!.client_name.trim()) { setMsg("Enter the client's name first."); return null; }
    setBusy("save"); setMsg("");
    const row = { ...pick(q!), updated_at: new Date().toISOString() };
    const res = q!.id ? await supabase().from("quotations").update(row).eq("id", q!.id).select().single() : await supabase().from("quotations").insert(row).select().single();
    setBusy("");
    if (res.error) { setMsg(res.error.message + " — has the quotations SQL migration been run?"); return null; }
    setQ(res.data as Quote); setDirty(false); setMsg("Saved ✓");
    if (isNew && nav) router.replace(`/quotations/${res.data.id}`);
    return res.data.id;
  }
  async function preview() {
    setBusy("preview"); setMsg("");
    const r = await fetch("/api/quotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quote: q }) }); setBusy("");
    if (!r.ok) { setMsg((await r.json().catch(() => ({}))).error || "Preview failed"); return; }
    window.open(URL.createObjectURL(await r.blob()), "_blank");
  }
  async function issue() {
    if (!q!.items.some((i) => i.desc.trim())) { setMsg("Add at least one line item with a description."); return; }
    if (!confirm("Issue this quotation? It gets the next reference number and can no longer be edited (you can duplicate it to make changes).")) return;
    const sid = await save(false); if (!sid) return;
    setBusy("issue");
    const r = await fetch("/api/quotations/issue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sid }) }); const j = await r.json(); setBusy("");
    if (!r.ok) { setMsg(j.error || "Failed"); return; }
    setQ({ ...q!, id: sid, status: "issued", ref_no: j.ref_no }); setMsg(`Issued ${j.ref_no}`); window.open(`/api/quotations/${sid}/pdf`, "_blank"); if (isNew) router.replace(`/quotations/${sid}`);
  }
  async function duplicate() {
    setBusy("dup");
    const { data, error } = await supabase().from("quotations").insert({ ...pick(q!), quote_date: todayISO(), status: "draft" }).select("id").single(); setBusy("");
    if (error) { setMsg(error.message); return; } router.push(`/quotations/${data.id}`);
  }
  async function remove() { if (!q!.id || !confirm("Delete this draft?")) return; await supabase().from("quotations").delete().eq("id", q!.id); router.push("/quotations"); }
  const payRow = q.terms.findIndex((x) => /payment/i.test(x.label));
  const setTerm = (i: number, p: Partial<{ label: string; value: string }>) => set("terms", q.terms.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">{q.ref_no ? `Quotation ${q.ref_no.split("/").pop()}` : "New quotation"}</h1>
        <span className={`text-xs rounded-full px-2 py-0.5 ${locked ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>{locked ? `Issued · ${q.ref_no}` : "Draft"}</span>
        {locked && <p className="text-sm text-slate-500 w-full">Issued quotations are locked. Use <b>Duplicate</b> to make a changed copy.</p>}
      </div>
      <fieldset disabled={locked} className="space-y-4 min-w-0">
        <div className="card space-y-3">
          <h3 className="font-semibold">Client &amp; subject</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="lbl">Client name</label><input className="inp" value={q.client_name} onChange={(e) => set("client_name", e.target.value)} placeholder="Man Industries (India) Ltd," /></div>
            <div><label className="lbl">Short name <span className="font-normal text-slate-400">(used where the wording says {"{{client}}"})</span></label><input className="inp" value={q.client_short} onChange={(e) => set("client_short", e.target.value)} placeholder="MAN Industries" /></div>
            <div className="sm:col-span-2"><label className="lbl">Address</label><textarea className="inp" rows={3} value={q.client_address} onChange={(e) => set("client_address", e.target.value)} /></div>
            <div><label className="lbl">Kind attention</label><input className="inp" value={q.kind_attn} onChange={(e) => set("kind_attn", e.target.value)} placeholder="Mr Rahul Singla" /></div>
            <div><label className="lbl">Date</label><input className="inp" type="date" value={q.quote_date} onChange={(e) => set("quote_date", e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="lbl">Subject <span className="font-normal text-slate-400">(prints after “Subject:”)</span></label><textarea className="inp" rows={2} value={q.subject} onChange={(e) => set("subject", e.target.value)} placeholder="Quotation for Dismantling of Spiral-Welded Pipe Equipment at Unit - 3" /></div>
            <div><label className="lbl">Signed by</label><input className="inp" value={q.signatory} onChange={(e) => set("signatory", e.target.value)} /></div>
            <div><label className="lbl">Reference no.</label><input className="inp" disabled value={q.ref_no || "Assigned when issued"} /></div>
          </div>
          <details><summary className="text-xs text-blue-700 cursor-pointer">Cover-letter paragraph</summary><textarea className="inp mt-2" rows={4} value={q.intro} onChange={(e) => set("intro", e.target.value)} /></details>
        </div>

        <div className="card space-y-3">
          <h3 className="font-semibold">Line items</h3>
          {q.items.map((it, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
              <div className="flex items-start gap-2"><span className="text-xs text-slate-400 pt-2.5 w-4">{i + 1}</span><textarea className="inp flex-1" rows={2} placeholder="Description" value={it.desc} onChange={(e) => setItem(i, { desc: e.target.value })} />
                {q.items.length > 1 && <button type="button" className="btn btn-danger !px-2" onClick={() => set("items", q.items.filter((_, j) => j !== i))} aria-label="Remove item">✕</button>}</div>
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-5 items-end">
                {it.lump ? <div className="col-span-2 sm:col-span-4"><label className="lbl">Lump-sum amount (₹)</label><input className="inp" inputMode="decimal" value={it.amount} onChange={(e) => setItem(i, { amount: e.target.value })} /></div> : <>
                  <div><label className="lbl">Quantity</label><input className="inp" inputMode="decimal" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} /></div>
                  <div><label className="lbl">Unit</label><input className="inp" value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} placeholder="MT" /></div>
                  <div><label className="lbl">Rate per unit (₹)</label><input className="inp" inputMode="decimal" value={it.rate} onChange={(e) => setItem(i, { rate: e.target.value })} /></div>
                  <div><label className="lbl">Qty remark</label><input className="inp" value={it.note} onChange={(e) => setItem(i, { note: e.target.value })} placeholder="(approx.) plus or minus 10%" /></div></>}
                <div className="text-sm"><div className="lbl">Amount</div><div className="font-semibold py-2">₹{inr(itemAmount(it))}</div></div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={it.lump} onChange={(e) => setItem(i, { lump: e.target.checked })} />Lump sum (prints “01 · LUMSUM”)</label>
            </div>))}
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" className="btn" onClick={() => set("items", [...q.items, { ...BLANK_ITEM }])}>+ Add item</button>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.show_total} onChange={(e) => set("show_total", e.target.checked)} />Show total</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.show_gst} onChange={(e) => set("show_gst", e.target.checked)} />Show GST 18% &amp; grand total</label>
            <span className="text-sm text-slate-500 sm:ml-auto">Total ₹{inr(t.total)}{q.show_gst ? ` · with GST ₹${inr(t.grand)}` : ""}</span>
          </div>
        </div>

        <div className="card space-y-3"><h3 className="font-semibold">Notes</h3><LineList kind="note" value={q.notes} onChange={(v) => set("notes", v)} lib={lib} reload={loadLib} placeholder="Write a note for this quotation…" /></div>

        <div className="card space-y-3">
          <h3 className="font-semibold">Terms &amp; conditions</h3>
          {presets.length > 0 && <div className="flex flex-wrap items-center gap-2"><label className="lbl !mb-0">Payment terms preset</label>
            <select className="inp !w-auto max-w-full" value="" onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (!p) return; if (payRow >= 0) setTerm(payRow, { value: p.body }); else set("terms", [...q.terms, { label: "Payment Terms", value: p.body }]); }}><option value="">Choose…</option>{presets.map((p) => <option key={p.id} value={p.id}>{p.body.replace(/\n/g, " · ").slice(0, 70)}</option>)}</select></div>}
          {q.terms.map((tm, i) => (
            <div key={i} className="flex items-start gap-2"><input className="inp !w-32 sm:!w-44 shrink-0" value={tm.label} onChange={(e) => setTerm(i, { label: e.target.value })} /><textarea className="inp flex-1 min-w-0" rows={Math.max(1, tm.value.split("\n").length)} value={tm.value} onChange={(e) => setTerm(i, { value: e.target.value })} /><button type="button" className="btn btn-danger !px-2" onClick={() => set("terms", q.terms.filter((_, j) => j !== i))} aria-label="Remove term">✕</button></div>))}
          <button type="button" className="btn" onClick={() => set("terms", [...q.terms, { label: "", value: "" }])}>+ Add term</button>
        </div>

        <div className="card space-y-3">
          <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">Scope of work</h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.include_scope} onChange={(e) => set("include_scope", e.target.checked)} />Include a scope-of-work page</label></div>
          {q.include_scope && <>
            <div className="flex flex-wrap items-center gap-2"><label className="lbl !mb-0">Job type</label>
              <input className="inp !w-auto min-w-56" list="scope-tags" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. Press ram cylinder overhaul" /><datalist id="scope-tags">{tags.map((x) => <option key={x} value={x} />)}</datalist>
              <span className="text-xs text-slate-400">Filters the library below, and new lines you save are filed under it.</span></div>
            <LineList kind="scope" tag={tag} value={q.scope} onChange={(v) => set("scope", v)} lib={lib} reload={loadLib} placeholder="Write a scope-of-work step…" /></>}
        </div>

        <div className="card space-y-3"><h3 className="font-semibold">Client to supply, free of cost</h3><LineList kind="client_supply" value={q.client_supply} onChange={(v) => set("client_supply", v)} lib={lib} reload={loadLib} placeholder="Something else the client should provide…" /></div>
        <div className="card space-y-3"><h3 className="font-semibold">Chandrika will provide at the site</h3><LineList kind="our_supply" value={q.our_supply} onChange={(v) => set("our_supply", v)} lib={lib} reload={loadLib} placeholder="Something else we provide…" /></div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 sticky bottom-[var(--bottom-nav-h,0px)] z-10 border-t border-slate-200 bg-[#f6f7fb] py-3">
        {!locked && <button className="btn btn-primary" disabled={!!busy} onClick={() => save()}>{busy === "save" ? "Saving…" : "Save draft"}</button>}
        <button className="btn" disabled={!!busy} onClick={locked ? () => window.open(`/api/quotations/${q.id}/pdf`, "_blank") : preview}>{locked ? "View PDF" : busy === "preview" ? "Preparing…" : "Preview PDF"}</button>
        {!locked && <button className="btn" disabled={!!busy} onClick={issue}>{busy === "issue" ? "Issuing…" : "Issue (assign ref. no.)"}</button>}
        {q.id && <button className="btn" disabled={!!busy} onClick={duplicate}>Duplicate</button>}
        {!locked && q.id && <button className="btn btn-danger sm:ml-auto" onClick={remove}>Delete draft</button>}
        {dirty && !locked && <span className="text-xs text-amber-700">Unsaved changes</span>}
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
