"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { istToday } from "@/lib/attendance";
import { MAX_UPLOAD, prepareUpload } from "@/lib/compress";
import { useRole } from "@/lib/roles";
import UnitSelect from "@/components/UnitSelect";
import BillPhoto from "./BillPhoto";
import ReviewNotes from "./ReviewNotes";
import ReviewBar from "./ReviewBar";
import { BLANK_GATEPASS, billSums, gatepassGaps, ID_TYPES, inr, JSL_LABEL, lineAmount, maskId, maskLast4, stageOf, UNITS, type BillEvent, type Gatepass, type InvBill, type InvItem, type ProjectPerson, type ProjectWo, type ReviewNote } from "@/lib/inventory";

const BLANK_ITEM = { name: "", qty: "", unit: "", rate: "", gst_pct: "18", hsn: "" };
const friendly = (e: { code?: string; message: string }) => (e.code === "23505" ? "This bill is already entered: same vendor, bill number and date." : e.message);

// One bill, top to bottom in the order the work happens: the bill's header, then its items one at a time. Once it is recorded: the details the JSL portal asks for, then the Admin's authorization.
export default function BillEditor({ projectId, bill, newKind = "bill", approval = true, items, pastBills, pastItems, onClose, onChanged, onCreated }: { projectId: string; bill: InvBill | null; newKind?: "bill" | "no_bill"; approval?: boolean; items: InvItem[]; pastBills: InvBill[]; pastItems: InvItem[]; onClose: () => void; onChanged: () => Promise<void>; onCreated: (id: string) => void }) {
  const { role, admin, staff, viewer } = useRole(); const canEnter = !!role && role !== "none" && !viewer;
  // an entry made from a gas delivery ("generated") looks like one without a bill, and is not edited here
  const kind = bill?.kind ?? newKind; const generated = kind === "gas"; const noBill = kind !== "bill"; const st = bill?.status;
  const blank = { ...BLANK_ITEM, gst_pct: noBill ? "0" : "18" };
  const mineOpen = canEnter && (!bill || ((st === "draft" || st === "returned") && !bill.voided_at));   // whoever enters entries may change a draft, or one that was sent back
  const reviewing = approval && staff && st === "submitted" && !bill?.voided_at;                                   // Operations and Admin review what was submitted, and may correct it themselves
  const editable = mineOpen || reviewing;
  const canSubmit = approval && mineOpen && !!bill && (!staff || st === "returned");                                 // Operations and Admin record their own drafts directly, which is the same as approving
  const [h, setH] = useState({ vendor_name: bill?.vendor_name ?? "", vendor_gstin: bill?.vendor_gstin ?? "", bill_no: bill?.bill_no ?? "", bill_date: bill?.bill_date ?? istToday(), bill_total: bill ? String(bill.bill_total) : "", other_charges: bill && Number(bill.other_charges) ? String(bill.other_charges) : "", note: bill?.note ?? "" });
  const [photo, setPhoto] = useState<File | null>(null); const [f, setF] = useState(blank); const [editItem, setEditItem] = useState<string | null>(null); const nameRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [g, setG] = useState<Gatepass>(BLANK_GATEPASS); const [gSaved, setGSaved] = useState<Gatepass | null>(null); const [showGate, setShowGate] = useState(false);
  const [addOpen, setAddOpen] = useState(false);   // for a reviewer, the add-item form opens on request
  const [editHead, setEditHead] = useState(false);   // once saved the bill's header folds away, so on a phone the item form is the first thing on screen

  const [notes, setNotes] = useState<ReviewNote[]>([]); const [events, setEvents] = useState<BillEvent[]>([]); const [target, setTarget] = useState("");
  const loadExtras = useCallback(async () => {
    if (!bill || !approval) return; const sb = supabase();
    const [n, e] = await Promise.all([sb.from("inventory_review_notes").select("*").eq("bill_id", bill.id).order("created_at"), sb.from("inventory_bill_events").select("*").eq("bill_id", bill.id).order("created_at")]);
    if (!n.error) setNotes((n.data ?? []) as ReviewNote[]); if (!e.error) setEvents((e.data ?? []) as BillEvent[]);   // an error just means there is nothing to show
  }, [bill?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadExtras(); }, [loadExtras, bill?.status]);

  const [people, setPeople] = useState<ProjectPerson[]>([]); const [wos, setWos] = useState<ProjectWo[]>([]); const [wo, setWo] = useState("");

  // the JSL details: this bill's own, or by hand from whoever entered the bill. A Viewer cannot read any of this. Only the office is told the WO.
  useEffect(() => { if (!bill || !canEnter) return; (async () => {
    const sb = supabase(); const [gp, pp] = await Promise.all([sb.from("inventory_gatepass").select("*").eq("bill_id", bill.id).maybeSingle(), sb.rpc("inventory_project_people", { p_bill: bill.id })]);
    if (gp.error || pp.error) { setErr((gp.error ?? pp.error)!.message); return; }
    const list = (pp.data ?? []) as ProjectPerson[]; setPeople(list);
    if (gp.data) { const d = { ...BLANK_GATEPASS, ...(gp.data as Gatepass) }; setG(d); setGSaved(d); }
    else setG((x) => ({ ...x, person_employee_id: list.find((p) => p.is_default)?.employee_id ?? null }));
    if (staff) { const w = await sb.rpc("inventory_project_wos", { p_project: bill.project_id }); if (w.error) { setErr(w.error.message); return; } const l = (w.data ?? []) as ProjectWo[]; setWos(l); if (l.length === 1) setWo(l[0].wo_no); }
  })(); }, [bill?.id, canEnter, staff]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sums = billSums(items, Number(h.other_charges || 0), Number(h.bill_total || 0));
  const vendors = useMemo(() => [...new Set(pastBills.map((b) => b.vendor_name))].sort(), [pastBills]);
  const names = useMemo(() => [...new Set(pastItems.map((i) => i.name))].sort(), [pastItems]);
  const setItem = (p: Partial<typeof BLANK_ITEM>) => setF((x) => ({ ...x, ...p }));
  const setGate = (p: Partial<Gatepass>) => setG((x) => ({ ...x, ...p }));
  const flash = (t: string) => { setMsg(t); setErr(""); };

  async function uploadPhoto(): Promise<string | null | undefined> {   // undefined = it failed, and the message is already showing
    if (!photo) return bill?.bill_path ?? null;
    const file = await prepareUpload(photo);
    if (file.size > MAX_UPLOAD) { setErr("The bill is larger than 5 MB: please send a smaller photo or compressed PDF."); return undefined; }
    const fd = new FormData(); fd.set("file", file); fd.set("projectId", projectId);
    const r = await fetch("/api/inventory/upload", { method: "POST", body: fd });
    if (!r.ok) { setErr(await r.text()); return undefined; }
    return (await r.json()).path as string;
  }
  async function saveHeader() {
    const total = Number(h.bill_total || 0); setMsg(""); setErr("");
    if (noBill) { if (!h.bill_date) return setErr("Choose the date."); if (!(total >= 0)) return setErr("The amount paid cannot be below zero."); if (!h.note.trim()) return setErr("Give the reason for this entry: where the items came from."); }
    else { if (!h.vendor_name.trim()) return setErr("Enter the vendor's name."); if (!h.bill_no.trim()) return setErr("Enter the bill number."); if (!h.bill_date) return setErr("Choose the bill's date."); if (!(total > 0)) return setErr("Enter the bill's total, as printed."); }
    setBusy(true);
    const bill_path = await uploadPhoto(); if (bill_path === undefined) { setBusy(false); return; }
    const row = noBill ? { vendor_name: h.vendor_name.trim(), vendor_gstin: "", bill_no: "", bill_date: h.bill_date, bill_total: total, other_charges: 0, note: h.note.trim(), bill_path }
      : { vendor_name: h.vendor_name.trim(), vendor_gstin: h.vendor_gstin.trim().toUpperCase(), bill_no: h.bill_no.trim(), bill_date: h.bill_date, bill_total: total, other_charges: Number(h.other_charges || 0), bill_path };
    const sb = supabase();
    if (bill) { const { error } = await sb.from("inventory_bills").update(row).eq("id", bill.id); setBusy(false); if (error) return setErr(friendly(error)); setPhoto(null); setEditHead(false); flash("Saved ✓"); await onChanged(); return; }
    const { data, error } = await sb.from("inventory_bills").insert({ ...row, ...(approval ? { kind } : {}), project_id: projectId }).select("id").single(); setBusy(false);
    if (error) return setErr(friendly(error));
    await onChanged(); onCreated((data as { id: string }).id);
  }
  async function saveItem() {
    if (!bill) return; const qty = Number(f.qty), rate = Number(f.rate), gst = Number(f.gst_pct); setMsg(""); setErr("");
    if (!f.name.trim()) return setErr("Enter the item's name."); if (!(qty > 0)) return setErr("Enter the quantity."); if (!UNITS.includes(f.unit)) return setErr("Choose the unit."); if (!(rate >= 0) || (f.rate === "" && !noBill)) return setErr("Enter the rate, before GST."); if (!(gst >= 0 && gst <= 40)) return setErr("GST must be between 0 and 40%.");
    setBusy(true);
    const row = { name: f.name.trim().replace(/\s+/g, " "), qty, unit: f.unit, rate, gst_pct: gst, hsn: f.hsn.trim() }; const sb = supabase();
    const { error } = editItem ? await sb.from("inventory_bill_items").update(row).eq("id", editItem) : await sb.from("inventory_bill_items").insert({ ...row, bill_id: bill.id, line_no: Math.max(0, ...items.map((i) => i.line_no)) + 1 });
    setBusy(false); if (error) return setErr(error.message);
    // every item is saved as it is entered, so a dropped connection loses nothing. Unit and GST stay for the next line because most bills repeat them.
    flash(`${editItem ? "Updated" : "Added"}: ${row.name}`); setEditItem(null); setF((x) => ({ ...BLANK_ITEM, unit: x.unit, gst_pct: x.gst_pct })); await onChanged(); nameRef.current?.focus();
  }
  async function delItem(i: InvItem) { if (!confirm(`Remove ${i.name}?`)) return; const { error } = await supabase().from("inventory_bill_items").delete().eq("id", i.id); if (error) return setErr(error.message); if (editItem === i.id) { setEditItem(null); setF(blank); } await onChanged(); }
  // ---- sending to the JSL portal ----
  const [refIn, setRefIn] = useState("");
  async function sendNow() {
    if (!bill) return; setBusy(true); setMsg(""); setErr("");
    const r = await fetch("/api/inventory/jsl-send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bill: bill.id }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (!r.ok) { setErr(j.error || `Could not send (${r.status}).`); await onChanged(); return; }
    flash("Sent to the robot. It takes about a minute."); await onChanged(); await loadExtras();
  }
  // While the robot works, look again every few seconds. A run that has gone quiet is settled by the "Check status" button.
  const running = bill?.jsl_status === "sending" || bill?.jsl_status === "submitting";
  useEffect(() => { if (!running) return; const t = setInterval(() => { onChanged(); }, 6000); return () => clearInterval(t); }, [running]);   // eslint-disable-line react-hooks/exhaustive-deps
  async function checkStatus() {
    if (!bill) return; setBusy(true); setMsg(""); setErr("");
    const { data, error } = await supabase().rpc("inventory_jsl_settle", { p_bill: bill.id }); setBusy(false);
    if (error) return setErr(error.message);
    flash(data === "nothing to settle" ? "Still running: give it a few more minutes." : data === "failed" ? "The robot never got as far as Save, so nothing is on the portal." : "The robot went quiet after Save: check the portal."); await onChanged();
  }
  async function act(fn: string, args: Record<string, unknown>, done: string) { setBusy(true); setMsg(""); setErr(""); const { error } = await supabase().rpc(fn, args); setBusy(false); if (error) return setErr(error.message); flash(done); await onChanged(); await loadExtras(); }
  const headChanged = !!bill && (Number(h.bill_total || 0) !== Number(bill.bill_total) || Number(h.other_charges || 0) !== Number(bill.other_charges) || h.note.trim() !== (bill.note ?? "").trim());
  async function record() { if (!bill) return; if (headChanged) return setErr("You changed the details. Save them first."); await act("inventory_record_bill", { p_bill: bill.id }, Number(bill.bill_total) > 0 ? "Recorded ✓ The total is now in the project's expenses." : "Recorded ✓ The items are counted as received."); }
  async function submit() { if (!bill) return; if (headChanged) return setErr("You changed the details. Save them first."); await act("inventory_submit_bill", { p_bill: bill.id }, "Submitted ✓ Operations or an Admin will review it. You will see it here if it is sent back."); }
  async function sendBack(message: string) { if (!bill) return; await act("inventory_return_bill", { p_bill: bill.id, p_note: message }, "Sent back ✓ It is with the person who entered it, with your marks."); }
  async function approve(portal: boolean) { if (!bill) return; if (headChanged) return setErr("You changed the details. Save them first."); await act("inventory_record_bill", { p_bill: bill.id, p_portal: portal }, portal ? "Approved ✓ It can now go to the JSL portal: enter the details below." : "Approved ✓ It is an inventory entry."); }
  async function discard() { if (!bill || !confirm("Discard this draft and its items?")) return; const { error } = await supabase().from("inventory_bills").delete().eq("id", bill.id); if (error) return setErr(error.message); await onChanged(); onClose(); }
  async function voidBill() { if (!bill) return; const reason = prompt("Why is this bill being voided? Its expense comes off the project.")?.trim(); if (!reason) return; await act("inventory_void_bill", { p_bill: bill.id, p_reason: reason }, "Voided. The expense has come off the project."); }
  async function saveGate() {
    if (!bill) return; setBusy(true); setMsg(""); setErr("");
    const hand = g.received_by === "hand"; const typed = hand && g.person_source === "other"; const clean = (s: string) => s.trim();   // a project person's name is filled in by the database, and their ID stays on their employee record
    const row = { received_by: g.received_by, person_source: g.person_source, person_employee_id: hand && !typed ? g.person_employee_id : null, person_name: typed ? clean(g.person_name) : "", person_id_type: typed ? g.person_id_type : "", person_id_no: typed ? clean(g.person_id_no).toUpperCase() : "", vehicle_no: hand ? "" : clean(g.vehicle_no).toUpperCase().replace(/\s+/g, ""), driver_name: hand ? "" : clean(g.driver_name), driver_dl_no: hand ? "" : clean(g.driver_dl_no).toUpperCase(), codriver_name: hand ? "" : clean(g.codriver_name), codriver_id_type: hand ? "" : g.codriver_id_type, codriver_id_no: hand ? "" : clean(g.codriver_id_no).toUpperCase() };
    const { data, error } = await supabase().from("inventory_gatepass").upsert({ ...row, bill_id: bill.id }).select().single(); setBusy(false);
    if (error) return setErr(error.message); const saved = { ...BLANK_GATEPASS, ...(data as Gatepass) }; setG(saved); setGSaved(saved); setShowGate(false); flash("JSL details saved ✓");
  }

  const j = bill ? JSL_LABEL[bill.jsl_status] : null; const recorded = bill?.status === "recorded" && !bill.voided_at;
  const wanted = !!bill?.jsl_wanted;   // sending to the JSL portal is optional: an Admin switches it on for a bill, and until then nobody sees or fills in any portal details
  const gateOpen = !!bill && !bill.voided_at && canEnter && ["none", "failed"].includes(bill.jsl_status);
  const gaps = gatepassGaps(gSaved, people); const takeBack = staff && !!bill && !bill.voided_at && !generated && ["none", "authorized", "failed"].includes(bill.jsl_status);
  const notesMode: "review" | "rework" | "read" = reviewing ? "review" : st === "returned" && canEnter ? "rework" : "read";
  const hasSide = mineOpen || (recorded && (wanted || admin || takeBack)) || events.length > 0 || (notesMode === "read" && notes.length > 0);
  // ready to submit or record: the items add up to the bill's total and its photo is there; for an entry without a bill, it has items and a reason
  const ready = !!bill && items.length > 0 && (noBill ? !!h.note.trim() : sums.matches && !!bill.bill_path);
  const sv = bill ? billSums(items, Number(bill.other_charges), Number(bill.bill_total)) : null;
  const savedReady = !!bill && items.length > 0 && (noBill ? !!(bill.note ?? "").trim() : !!sv?.matches && !!bill.bill_path);   // what the database will check when it is approved
  const savedMsg = items.length === 0 ? "Add the items first." : noBill ? "It needs a reason." : !bill?.bill_path ? "It needs the photo of the bill." : "The items do not add up to the bill's total yet.";
  const effectText = canSubmit ? "Submitting sends this to Operations or an Admin to review. Nothing is added to expenses until they approve it." : Number(h.bill_total || 0) > 0 ? `Recording adds ₹${inr(Number(h.bill_total))} to this project's expenses under Site consumables. Sending the items to the JSL portal is optional: an Admin decides that afterwards.` : "Recording counts these items as received. No expense is added.";
  const needText = !bill ? "" : noBill ? (!h.note.trim() ? " Give the reason for this entry first." : "") : (!bill.bill_path ? " Attach the photo of the bill first." : "");
  const actionLabel = canSubmit ? (st === "returned" ? "Submit again" : "Submit for approval") : "Record bill";
  const stage = bill ? stageOf(bill) : null; const lastReturn = [...events].reverse().find((e) => e.kind === "returned");
  const openNotes = notes.filter((n) => n.state === "open").length;
  const gateForm = showGate || (gateOpen && !gSaved);
  const chosen = people.find((p) => p.employee_id === g.person_employee_id); const savedPerson = people.find((p) => p.employee_id === gSaved?.person_employee_id);
  const fromTeam = g.person_source === "employee";
  const idBad = (type: string, no: string) => type === "Aadhaar" && no.trim() !== "" && !/^\d{12}$/.test(no.replace(/\s/g, ""));

  const totalsBox = (items.length > 0 && !noBill && <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-1 tabular-nums">
          <div className="flex justify-between"><span>Items</span><span>₹{inr(sums.taxable)}</span></div><div className="flex justify-between"><span>GST</span><span>₹{inr(sums.tax)}</span></div>
          {Number(h.other_charges || 0) !== 0 && <div className="flex justify-between"><span>Freight or discount</span><span>₹{inr(Number(h.other_charges))}</span></div>}
          <div className="flex justify-between font-semibold border-t border-slate-200 pt-1"><span>Items come to</span><span>₹{inr(sums.computed)}</span></div><div className="flex justify-between"><span>Bill says</span><span>₹{inr(Number(h.bill_total || 0))}</span></div>
          <div className={`flex justify-between font-medium ${sums.matches ? "text-green-700" : "text-amber-700"}`}><span>{sums.matches ? (sums.diff === 0 ? "Matches" : "Matches, with round off") : "Difference: an item is missing or wrong"}</span><span className="whitespace-nowrap ml-2">{sums.diff > 0 ? "+" : sums.diff < 0 ? "−" : ""}₹{inr(Math.abs(sums.diff))}</span></div></div>);

  const sec1 = (<>
      {/* 1. the bill */}
      <section className="card !p-3 space-y-3"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{noBill ? "1. The entry" : "1. The bill"}</h2><span className="ml-auto flex gap-2">{bill?.bill_path && !editHead && <a className="btn btn-sm" href={`/api/inventory/view?bill=${bill.id}`} target="_blank" rel="noreferrer">{generated ? "View challan" : noBill ? "View photo" : "View bill"}</a>}{editable && bill && (noBill || bill.bill_path) && !editHead && <button className="btn btn-sm" onClick={() => setEditHead(true)}>Edit</button>}</span></div>
        {editable && (!bill || editHead || (!noBill && !bill.bill_path)) ? <>
          {noBill ? <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="lbl">Reason: where did these items come from?</label><textarea className="inp !min-h-20" value={h.note} onChange={(e) => setH({ ...h, note: e.target.value })} placeholder="For example: cash purchase, the shop gave no bill. Or: transferred from the MAN site." /></div>
            <div><label className="lbl">From <span className="font-normal text-slate-400">(supplier or place, optional)</span></label><input className="inp" list="inv-vendors" value={h.vendor_name} onChange={(e) => setH({ ...h, vendor_name: e.target.value })} /><datalist id="inv-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist></div>
            <div><label className="lbl">Date received</label><input className="inp" type="date" value={h.bill_date} onChange={(e) => setH({ ...h, bill_date: e.target.value })} /></div>
            <div><label className="lbl">Amount paid (₹) <span className="font-normal text-slate-400">(optional)</span></label><input className="inp" type="number" inputMode="decimal" min="0" step="0.01" value={h.bill_total} onChange={(e) => setH({ ...h, bill_total: e.target.value })} /></div>
            <div><label className="lbl">Photo <span className="font-normal text-slate-400">(optional)</span></label><label className="filebtn"><span aria-hidden>📎</span><span className="flex-1 truncate">{photo ? photo.name : bill?.bill_path ? "Photo attached" : "Take or attach photo"}</span><span className="text-xs font-medium text-blue-700 shrink-0">{photo || bill?.bill_path ? "Change" : "Choose"}</span><input type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label></div>
          </div> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2"><label className="lbl">Vendor</label><input className="inp" list="inv-vendors" value={h.vendor_name} onChange={(e) => setH({ ...h, vendor_name: e.target.value })} /><datalist id="inv-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist></div>
            <div><label className="lbl">Vendor GSTIN <span className="font-normal text-slate-400">(optional)</span></label><input className="inp uppercase" value={h.vendor_gstin} onChange={(e) => setH({ ...h, vendor_gstin: e.target.value })} /></div>
            <div><label className="lbl">Bill number</label><input className="inp" value={h.bill_no} onChange={(e) => setH({ ...h, bill_no: e.target.value })} /></div>
            <div><label className="lbl">Bill date</label><input className="inp" type="date" value={h.bill_date} onChange={(e) => setH({ ...h, bill_date: e.target.value })} /></div>
            <div><label className="lbl">Total on the bill (₹)</label><input className="inp" type="number" inputMode="decimal" min="0" step="0.01" value={h.bill_total} onChange={(e) => setH({ ...h, bill_total: e.target.value })} /></div>
            <div><label className="lbl">Freight or discount (₹)</label><input className="inp" type="number" inputMode="decimal" step="0.01" placeholder="Minus for a discount" value={h.other_charges} onChange={(e) => setH({ ...h, other_charges: e.target.value })} /></div>
            <div><label className="lbl">Photo of the bill</label><label className="filebtn"><span aria-hidden>📎</span><span className="flex-1 truncate">{photo ? photo.name : bill?.bill_path ? "Photo attached" : "Take or attach photo"}</span><span className="text-xs font-medium text-blue-700 shrink-0">{photo || bill?.bill_path ? "Change" : "Choose"}</span><input type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label></div>
          </div>}
          <div className="flex flex-wrap gap-2 form-actions"><button className="btn btn-primary" disabled={busy} onClick={saveHeader}>{busy ? "Saving…" : bill ? (noBill ? "Save entry details" : "Save bill details") : "Save and add items"}</button>{editHead && <button className="btn" onClick={() => { setEditHead(false); setPhoto(null); setH({ vendor_name: bill!.vendor_name, vendor_gstin: bill!.vendor_gstin, bill_no: bill!.bill_no, bill_date: bill!.bill_date, bill_total: String(bill!.bill_total), other_charges: Number(bill!.other_charges) ? String(bill!.other_charges) : "", note: bill!.note ?? "" }); }}>Cancel</button>}{bill?.bill_path && <a className="btn" href={`/api/inventory/view?bill=${bill.id}`} target="_blank" rel="noreferrer">{generated ? "View challan" : noBill ? "View photo" : "View bill"}</a>}</div>
        </> : bill && noBill ? <div className="text-sm space-y-2">
          <div className="grid gap-2 grid-cols-3"><div><div className="text-xs text-slate-400">From</div>{bill.vendor_name || "—"}</div><div><div className="text-xs text-slate-400">Date</div>{new Date(bill.bill_date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>{generated ? <div><div className="text-xs text-slate-400">Challan</div>{bill.bill_no || "—"}</div> : <div><div className="text-xs text-slate-400">Amount paid</div>{Number(bill.bill_total) > 0 ? <b className="tabular-nums">₹{inr(Number(bill.bill_total))}</b> : "None"}</div>}</div>
          <div><div className="text-xs text-slate-400">{generated ? "Delivery" : "Reason"}</div><div className="break-words">{bill.note || "—"}</div></div>
        </div> : bill && <div className="text-sm space-y-1">
          <div className="grid gap-2 grid-cols-3 lg:grid-cols-4"><div className="hidden lg:block"><div className="text-xs text-slate-400">Vendor</div>{bill.vendor_name}</div><div><div className="text-xs text-slate-400">Bill</div>{bill.bill_no}</div><div><div className="text-xs text-slate-400">Date</div>{new Date(bill.bill_date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div><div><div className="text-xs text-slate-400">Total</div><b className="tabular-nums">₹{inr(Number(bill.bill_total))}</b></div></div>
        </div>}
      </section>
  </>);
  const sec2 = (<>
      {/* 2. items, one at a time */}
      {bill && <section className="card !p-3 space-y-3"><h2 className="text-sm font-semibold">2. Items ({items.length})</h2>
        {reviewing && !addOpen && !editItem && <div><button className="btn btn-sm" onClick={() => setAddOpen(true)}>+ Add a missing item</button></div>}
        {editable && (!reviewing || addOpen || !!editItem) && <form className="rounded-xl border border-slate-200 p-3 space-y-3" onSubmit={(e) => { e.preventDefault(); void saveItem(); }}>
          <div><label className="lbl">{editItem ? "Change this item" : `Item ${items.length + 1}: name${noBill ? "" : ", as on the bill"}`}</label><input ref={nameRef} className="inp" list="inv-names" autoFocus autoCapitalize="characters" value={f.name} onChange={(e) => setItem({ name: e.target.value })} /><datalist id="inv-names">{names.map((n) => <option key={n} value={n} />)}</datalist></div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
            <div><label className="lbl">Quantity</label><input className="inp" type="number" inputMode="decimal" min="0" step="any" value={f.qty} onChange={(e) => setItem({ qty: e.target.value })} /></div>
            <div><label className="lbl">Unit</label><UnitSelect list={UNITS} blank="Select" value={f.unit} onChange={(u) => setItem({ unit: u })} /></div>
            <div><label className="lbl">{noBill ? "Rate (₹, optional)" : "Rate (₹, before GST)"}</label><input className="inp" type="number" inputMode="decimal" min="0" step="0.01" value={f.rate} onChange={(e) => setItem({ rate: e.target.value })} /></div>
            <div><label className="lbl">GST %</label><input className="inp" type="number" inputMode="decimal" min="0" max="40" step="0.01" value={f.gst_pct} onChange={(e) => setItem({ gst_pct: e.target.value })} /></div>
            <div className="hidden sm:block"><label className="lbl">HSN <span className="font-normal text-slate-400">(optional)</span></label><input className="inp" inputMode="numeric" value={f.hsn} onChange={(e) => setItem({ hsn: e.target.value })} /></div><details className="col-span-2 sm:hidden" open={!!f.hsn}><summary className="lbl cursor-pointer select-none text-[#1e4fa3]">+ HSN <span className="font-normal text-slate-400">(optional)</span></summary><input className="inp mt-1" inputMode="numeric" value={f.hsn} onChange={(e) => setItem({ hsn: e.target.value })} /></details>
          </div>
          <div className="flex flex-wrap items-center gap-2 form-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : editItem ? "Save item" : "Add item"}</button>{editItem && <button type="button" className="btn" onClick={() => { setEditItem(null); setF(blank); }}>Cancel</button>}{Number(f.qty) > 0 && f.rate !== "" && <span className="text-sm text-slate-500 tabular-nums">Amount ₹{inr(lineAmount(Number(f.qty), Number(f.rate)))}</span>}</div>
        </form>}
        {items.length > 0 && <ol className="divide-y divide-slate-100">{[...items.keys()].reverse().map((n) => { const i = items[n]; return <li key={i.id} className="py-2 flex flex-wrap sm:flex-nowrap items-start gap-2 text-sm"><span className="text-slate-400 tabular-nums w-5 shrink-0">{n + 1}</span><div className="min-w-0 flex-1"><div className="font-medium break-words">{i.name}</div><div className="text-xs text-slate-500 tabular-nums">{Number(i.qty).toLocaleString("en-IN", { maximumFractionDigits: 3 })} {i.unit}{noBill && Number(i.rate) === 0 ? "" : ` × ₹${inr(Number(i.rate))} · GST ${Number(i.gst_pct)}%`}{i.hsn ? ` · HSN ${i.hsn}` : ""}</div>{notes.filter((x) => x.item_id === i.id).map((x) => <div key={x.id} className={`text-xs mt-0.5 ${x.state === "done" ? "text-green-700" : "text-amber-800"}`}>⚑ {x.note}{x.state === "done" ? " (fixed)" : ""}</div>)}</div>{(!noBill || Number(i.amount) > 0) && <b className="tabular-nums whitespace-nowrap">₹{inr(Number(i.amount))}</b>}
          {editable && <span className="flex gap-1 shrink-0 w-full sm:w-auto justify-end">{reviewing && <button className="btn btn-sm" onClick={() => { setTarget("i:" + i.id); document.getElementById("review-notes")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Flag</button>}<button className="btn btn-sm" onClick={() => { setEditItem(i.id); setF({ name: i.name, qty: String(i.qty), unit: i.unit, rate: String(i.rate), gst_pct: String(i.gst_pct), hsn: i.hsn }); nameRef.current?.focus(); }}>Edit</button><button className="btn btn-sm btn-danger" aria-label={`Remove ${i.name}`} onClick={() => delItem(i)}>✕</button></span>}</li>; })}</ol>}
        {totalsBox && <div className="lg:hidden">{totalsBox}</div>}
        {mineOpen && bill && <>
          <p className="text-xs text-slate-500 lg:hidden">{effectText}{needText && <span className="text-amber-700">{needText}</span>}</p>
          <div className="lg:hidden"><button className="btn btn-danger btn-sm" disabled={busy} onClick={discard}>Discard {st === "returned" ? "entry" : "draft"}</button></div>
          <div className="lg:hidden sticky bottom-[var(--bottom-nav-h,0px)] z-10 -mx-3 -mb-3 px-3 py-2 border-t border-slate-200 bg-white/95 backdrop-blur rounded-b-xl flex items-center gap-3">
            <div className="min-w-0 flex-1 text-xs tabular-nums leading-snug">
              <div className={`font-semibold ${items.length === 0 ? "text-slate-500" : ready ? "text-green-700" : "text-amber-700"}`}>{items.length === 0 ? "No items yet" : noBill ? `${items.length} item${items.length === 1 ? "" : "s"}` : `${items.length} item${items.length === 1 ? "" : "s"} · ₹${inr(sums.computed)}`}</div>
              <div className="text-slate-500 truncate">{noBill ? (Number(h.bill_total || 0) > 0 ? `Paid ₹${inr(Number(h.bill_total))}` : "No amount paid") : `Bill ₹${inr(Number(h.bill_total || 0))}${items.length > 0 && !sums.matches ? ` · ₹${inr(Math.abs(sums.diff))} ${sums.diff > 0 ? "short" : "over"}` : ""}`}</div>
            </div>
            <button className="btn btn-primary shrink-0" disabled={busy || !ready} onClick={canSubmit ? submit : record}>{actionLabel}</button>
          </div>
        </>}
        {recorded && (Number(bill.bill_total) > 0 ? <p className="text-sm text-green-700">₹{inr(Number(bill.bill_total))} is in this project's expenses under Site consumables. The items are counted as received.</p> : <p className="text-sm text-green-700">The items are counted as received. No expense was added.</p>)}
      </section>}
  </>);
  const rightCards = (<>
      {mineOpen && bill && <section className="card !p-3 space-y-3 hidden lg:block"><h2 className="text-sm font-semibold">{noBill ? "Check the entry" : "Check against the bill"}</h2>
        {totalsBox || <p className="text-sm text-slate-500">{noBill ? (items.length ? `${items.length} item${items.length === 1 ? "" : "s"} entered.` : "Add the items that came in.") : "Add the items from the bill. They are checked against its total here."}</p>}
        <p className="text-xs text-slate-500">{effectText}{needText && <span className="text-amber-700">{needText}</span>}</p>
        <div className="flex gap-2"><button className="btn btn-primary flex-1 justify-center" disabled={busy || !ready} onClick={canSubmit ? submit : record}>{actionLabel}</button><button className="btn btn-danger" disabled={busy} onClick={discard}>Discard</button></div>
      </section>}

      {/* the portal is optional: only an Admin can switch it on */}
      {recorded && admin && !wanted && bill && <section className="card !p-3 space-y-2"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">JSL portal</h2><span className="text-[11px] rounded-full px-2 py-0.5 bg-slate-100 text-slate-600">Optional</span></div>
        <p className="text-sm text-slate-600">This {generated ? "delivery" : noBill ? "entry" : "bill"} is complete as it is. If you also want its items raised as one MRR on the JSL portal, switch that on for it. The person or vehicle details are then asked for.</p>
        <button className="btn" disabled={busy} onClick={() => act("inventory_set_jsl_wanted", { p_bill: bill.id, p_on: true }, "Switched on: this bill can now go to the JSL portal.")}>Also send to the JSL portal</button></section>}

      {/* 3. what the portal asks for before any material */}
      {recorded && !viewer && wanted && <section className="card !p-3 space-y-3"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">3. Details for the JSL portal</h2>{gSaved && gateOpen && !gateForm && <button className="btn btn-sm ml-auto" onClick={() => setShowGate(true)}>Edit</button>}</div>
        {gateForm && gateOpen ? <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="lbl">Received by</label><select className="inp" value={g.received_by} onChange={(e) => setGate({ received_by: e.target.value as Gatepass["received_by"] })}><option value="hand">By hand</option><option value="vehicle">By vehicle</option></select></div></div>
          {g.received_by === "hand" ? <div className="space-y-3">
            <div><label className="lbl">Who is bringing it?</label><select className="inp" value={fromTeam ? g.person_employee_id ?? "" : "__other"} onChange={(e) => (e.target.value === "__other" ? setGate({ person_source: "other", person_employee_id: null }) : setGate({ person_source: "employee", person_employee_id: e.target.value || null }))}><option value="">Choose…</option>{people.map((p) => <option key={p.employee_id} value={p.employee_id}>{p.full_name}{p.designation ? ` · ${p.designation}` : ""}</option>)}<option value="__other">Someone not on the team…</option></select>
              {fromTeam && chosen && (chosen.aadhaar_last4 ? <p className="text-xs text-slate-500 mt-1">Aadhaar {maskLast4(chosen.aadhaar_last4)}, from the employee record.</p> : <p className="warn">No Aadhaar on {chosen.full_name}'s employee record. Ask the office to add it, or choose someone else.</p>)}</div>
            {!fromTeam && <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-2"><div><label className="lbl">Person's name</label><input className="inp" value={g.person_name} onChange={(e) => setGate({ person_name: e.target.value })} /></div>
            <div><label className="lbl">ID type</label><select className="inp" value={g.person_id_type} onChange={(e) => setGate({ person_id_type: e.target.value })}><option value=""></option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label className="lbl">ID number</label><input className="inp uppercase" autoComplete="off" value={g.person_id_no} onChange={(e) => setGate({ person_id_no: e.target.value })} />{idBad(g.person_id_type, g.person_id_no) && <p className="warn">An Aadhaar number has 12 digits.</p>}</div></div>}
          </div> : <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-2">
            <div><label className="lbl">Vehicle number</label><input className="inp uppercase" value={g.vehicle_no} onChange={(e) => setGate({ vehicle_no: e.target.value })} /></div>
            <div><label className="lbl">Driver's name</label><input className="inp" value={g.driver_name} onChange={(e) => setGate({ driver_name: e.target.value })} /></div>
            <div><label className="lbl">Driver's licence number</label><input className="inp uppercase" autoComplete="off" value={g.driver_dl_no} onChange={(e) => setGate({ driver_dl_no: e.target.value })} /></div></div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-2">
            <div><label className="lbl">Co-driver's name <span className="font-normal text-slate-400">(if any)</span></label><input className="inp" value={g.codriver_name} onChange={(e) => setGate({ codriver_name: e.target.value })} /></div>
            <div><label className="lbl">Co-driver's ID type</label><select className="inp" value={g.codriver_id_type} onChange={(e) => setGate({ codriver_id_type: e.target.value })}><option value=""></option>{ID_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label className="lbl">Co-driver's ID number</label><input className="inp uppercase" autoComplete="off" value={g.codriver_id_no} onChange={(e) => setGate({ codriver_id_no: e.target.value })} />{idBad(g.codriver_id_type, g.codriver_id_no) && <p className="warn">An Aadhaar number has 12 digits.</p>}</div></div></div>}
          <div className="flex flex-wrap gap-2 form-actions"><button className="btn btn-primary" disabled={busy || (g.received_by === "hand" && !fromTeam && idBad(g.person_id_type, g.person_id_no)) || (g.received_by === "vehicle" && idBad(g.codriver_id_type, g.codriver_id_no))} onClick={saveGate}>Save JSL details</button>{gSaved && <button className="btn" onClick={() => { setG(gSaved); setShowGate(false); }}>Cancel</button>}</div>
        </div> : gSaved ? <div className="text-sm grid gap-2 grid-cols-2">
          <div><div className="text-xs text-slate-400">Received by</div>{gSaved.received_by === "hand" ? "By hand" : "By vehicle"}</div>
          {gSaved.received_by === "hand" ? <><div><div className="text-xs text-slate-400">Person</div>{gSaved.person_name || "—"}</div><div><div className="text-xs text-slate-400">{gSaved.person_source === "employee" ? "Aadhaar" : gSaved.person_id_type || "ID"}</div>{gSaved.person_source === "employee" ? (savedPerson?.aadhaar_last4 ? maskLast4(savedPerson.aadhaar_last4) : "—") : maskId(gSaved.person_id_no) || "—"}</div></>
            : <><div><div className="text-xs text-slate-400">Vehicle</div>{gSaved.vehicle_no || "—"}</div><div><div className="text-xs text-slate-400">Driver</div>{gSaved.driver_name || "—"}</div><div><div className="text-xs text-slate-400">Licence</div>{maskId(gSaved.driver_dl_no) || "—"}</div>{gSaved.codriver_name && <div><div className="text-xs text-slate-400">Co-driver</div>{gSaved.codriver_name} · {gSaved.codriver_id_type} {maskId(gSaved.codriver_id_no)}</div>}</>}
        </div> : <p className="text-sm text-slate-500">No details entered.</p>}
      </section>}

      {/* 4. the Admin's decision */}
      {recorded && j && wanted && <section className="card !p-3 space-y-2"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">4. Send to the JSL portal</h2><span className={`text-[11px] rounded-full px-2 py-0.5 ${j.cls}`}>{j.text}</span></div>
        {["none", "failed"].includes(bill.jsl_status) && <>
          {bill.jsl_status === "failed" && <p className="warn">The last attempt failed before anything was saved on the portal{bill.jsl_error ? `: ${bill.jsl_error}` : "."}</p>}
          {!viewer && gaps.length > 0 && <p className="text-sm text-amber-700">Still needed: {gaps.join(", ")}.</p>}
          {staff && (wos.length === 0 ? <p className="text-sm text-amber-700">This project has no active work order. Add one under Work orders first.</p> : wos.length === 1 ? <p className="text-sm text-slate-600">WO {wos[0].wo_no}</p> : admin ? <div><label className="lbl">Work order</label><select className="inp" value={wo} onChange={(e) => setWo(e.target.value)}><option value="">Choose…</option>{wos.map((w) => <option key={w.wo_no} value={w.wo_no}>{w.wo_no} · {w.title}</option>)}</select></div> : <p className="text-sm text-slate-600">This project has {wos.length} active work orders. The Admin chooses one when authorizing.</p>)}
          {admin ? <button className="btn btn-primary" disabled={busy || gaps.length > 0 || !wo} onClick={() => confirm(`Authorize ${items.length} item${items.length === 1 ? "" : "s"} from bill ${bill.bill_no} as one MRR on the JSL portal, against WO ${wo}?`) && act("inventory_authorize_jsl", { p_bill: bill.id, p_wo: wo }, "Authorized ✓")}>Authorize for JSL portal</button> : <p className="text-sm text-slate-500">Waiting for an Admin to authorize.</p>}</>}
        {bill.jsl_status === "authorized" && <><p className="text-sm text-slate-600">Authorized{staff && wo ? ` against WO ${wo}` : ""}. It has not been sent yet.</p>
          {admin && <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy} onClick={() => confirm(`Send ${items.length} item${items.length === 1 ? "" : "s"} from bill ${bill.bill_no} to the JSL portal now?\n\nThis raises a real Material Requisition on the portal. Once it is saved it cannot be undone from here.`) && sendNow()}>Send to the JSL portal now</button><button className="btn" disabled={busy} onClick={() => act("inventory_withdraw_jsl", { p_bill: bill.id }, "Authorization withdrawn.")}>Withdraw authorization</button></div>}</>}
        {running && <div className="space-y-2"><p className="text-sm text-slate-700" role="status">{bill.jsl_status === "sending" ? "The robot is logging in and filling in the form. Nothing is saved on the portal yet." : "The robot has pressed Save and is checking the portal's Report for the new requisition."} This page updates by itself.</p>
          {admin && <button className="btn btn-sm" disabled={busy} onClick={checkStatus}>Check status</button>}</div>}
        {bill.jsl_status === "needs_check" && <div className="space-y-2"><p className="text-sm text-amber-800">The robot pressed Save but could not confirm it, so the MRR may or may not exist. Look on the JSL portal (Report) and then tell the app what you found. Nothing is sent again by itself.{bill.jsl_error ? ` (${bill.jsl_error})` : ""}</p>
          {admin && <div className="flex flex-wrap items-end gap-2"><div><label className="lbl" htmlFor="jsl-ref">Requisition No on the portal</label><input id="jsl-ref" className="inp !w-48" placeholder="e.g. 07112026-004" value={refIn} onChange={(e) => setRefIn(e.target.value)} /></div>
            <button className="btn btn-primary" disabled={busy || !/^\d{8}-\d+$/.test(refIn.trim())} onClick={() => act("inventory_jsl_resolve", { p_bill: bill.id, p_exists: true, p_ref: refIn.trim() }, "Recorded as on the portal.")}>It is on the portal</button>
            <button className="btn" disabled={busy} onClick={() => confirm("Only choose this if you have looked at the portal's Report and the requisition is NOT there. The bill can then be authorized and sent again.") && act("inventory_jsl_resolve", { p_bill: bill.id, p_exists: false, p_ref: null }, "Marked as not sent. You can authorize it again.")}>It is not there</button></div>}</div>}
        {bill.jsl_status === "submitted" && <p className="text-sm text-green-800">JSL reference: <b>{bill.jsl_ref || "—"}</b></p>}
        {admin && ["none", "authorized", "failed"].includes(bill.jsl_status) && <button className="btn btn-sm" disabled={busy} onClick={() => confirm("Take this bill off the JSL portal? It stays an expense. Any authorization is withdrawn; the portal details stay saved.") && act("inventory_set_jsl_wanted", { p_bill: bill.id, p_on: false }, "Switched off: this bill is an expense only.")}>Don't send this bill to the portal</button>}
      </section>}

      {bill && takeBack && recorded && <div className="flex flex-wrap gap-2 form-actions"><button className="btn" disabled={busy} onClick={() => confirm("Reopen this bill? Its expense comes off until it is recorded again.") && act("inventory_reopen_bill", { p_bill: bill.id }, "Reopened. The expense has come off the project.")}>Reopen bill</button><button className="btn btn-danger" disabled={busy} onClick={voidBill}>Void bill</button></div>}
  </>);
  const historyPanel = events.length > 0 ? <details className="card !p-3 text-sm"><summary className="cursor-pointer font-semibold">History</summary><ul className="mt-2 space-y-1.5">{events.map((e) => <li key={e.id}><span className="font-medium">{({ submitted: "Submitted for review", returned: "Sent back", approved: "Approved", recorded: "Recorded", reopened: "Reopened", voided: "Voided" } as const)[e.kind]}</span> <span className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>{e.note && <div className="text-slate-600 whitespace-pre-wrap break-words">{e.note}</div>}</li>)}</ul></details> : null;
  const notesPanel = bill && (notes.length > 0 || reviewing) ? <ReviewNotes billId={bill.id} kind={noBill ? "no_bill" : "bill"} notes={notes} items={items} mode={notesMode} target={target} setTarget={setTarget} onChanged={loadExtras} /> : null;


  return (
    <div className="space-y-4">
      <div className="space-y-1"><button type="button" className="text-sm text-blue-700" onClick={onClose}>← Bills</button><div className="flex items-center gap-2"><div className="min-w-0"><h1 className="text-xl font-bold truncate">{bill ? (generated ? "Gas delivery" : noBill ? "Entry without a bill" : bill.vendor_name) : noBill ? "New entry without a bill" : "New bill"}</h1>{bill && <div className="text-sm text-slate-500 truncate">{generated ? `${bill.vendor_name}${bill.bill_no ? ` · challan ${bill.bill_no}` : ""}` : noBill ? (bill.vendor_name ? `From ${bill.vendor_name}` : new Date(bill.bill_date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })) : `Bill ${bill.bill_no}`}</div>}</div>{stage && <span className={`ml-auto shrink-0 text-[11px] rounded-full px-2 py-0.5 ${stage.cls}`}>{stage.text}</span>}</div></div>
      {err && <p className="warn" role="alert">{err}</p>}{msg && <p className="text-sm text-green-700" role="status">{msg}</p>}
      {bill?.voided_at && <p className="text-sm rounded-xl px-3 py-2 bg-slate-50 text-slate-700">This bill is void: {bill.void_reason}. It is not in expenses or in the received list.</p>}
      {bill && generated && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm"><b className="text-blue-800">From a gas delivery.</b> This entry was made when the truck visit was recorded on <a className="underline" href="/site-supplies">Site supplies</a>. To change or remove it, void the delivery there. The gas money goes through the vendor's bills and payments, so nothing is added to expenses here.</div>}
      {bill && st === "returned" && !bill.voided_at && canEnter && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm space-y-1"><b className="text-red-800">Sent back for rework</b>{lastReturn && <p className="whitespace-pre-wrap break-words">{lastReturn.note}</p>}<p className="text-xs text-slate-600">Fix what is marked below, tick each correction off, then submit it again.</p></div>}
      {bill && st === "submitted" && !bill.voided_at && !staff && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm"><b className="text-blue-800">Waiting for review.</b> Operations or an Admin will approve it or send it back. It cannot be changed until then.</div>}

      {reviewing && bill ? (
        <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start">
          <div className="min-w-0 lg:sticky lg:top-20"><BillPhoto bill={bill} /></div>
          <div className="space-y-4 min-w-0">
            <ReviewBar variant="card" ready={savedReady} readyMsg={savedMsg} admin={admin} busy={busy} amount={Number(bill?.bill_total ?? 0)} itemCount={items.length} openNotes={openNotes} onReturn={sendBack} onApprove={approve} />
            {sec1}{sec2}{notesPanel}{historyPanel}
            <ReviewBar variant="bar" ready={savedReady} readyMsg={savedMsg} admin={admin} busy={busy} amount={Number(bill?.bill_total ?? 0)} itemCount={items.length} openNotes={openNotes} onReturn={sendBack} onApprove={approve} />
          </div>
        </div>
      ) : (
        <div className={bill && hasSide ? "space-y-4 lg:space-y-0 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5 lg:items-start" : "space-y-4 max-w-3xl"}>
          <div className="space-y-4 min-w-0">{notesMode === "rework" && notesPanel}{sec1}{sec2}</div>
          <div className="space-y-4 min-w-0 lg:sticky lg:top-20">{rightCards}{notesMode === "read" && notesPanel}{historyPanel}</div>
        </div>
      )}
    </div>
  );
}
