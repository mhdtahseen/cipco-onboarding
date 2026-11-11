"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { gasCost, type GasCost, type GMove, type GOrder, type GPricing, type GProduct, type GRate, type GTerms } from "@/lib/gas";

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
type Sum = { cost: GasCost; approved: number; paid: number; deposit: number };

// What the gas on one project has cost so far, counted when it is delivered (not when it is paid): refills at their rates, delivery trips and lost or damaged cylinders, GST included.
// The project's Expenses list shows only what has been PAID, so this sits beside it for Operations / Admin. Shown only where there is gas activity.
export default function GasCostCard({ projectId }: { projectId: string }) {
  const [s, setS] = useState<Sum | null>(null);
  useEffect(() => { let live = true; (async () => {
    const sb = supabase();
    const [mv, od, tm, rt, pr, bl, py, dp] = await Promise.all([
      sb.from("gas_movements").select("*").eq("project_id", projectId).is("voided_at", null).limit(5000),
      sb.from("gas_orders").select("id, gas_order_lines(id, product_id, qty)").eq("project_id", projectId),
      sb.from("gas_terms").select("*"), sb.from("gas_rates").select("product_id, rate, gst_pct, valid_from"), sb.from("gas_products").select("id, vendor_id, name, capacity, deposit_per_cylinder"),
      sb.from("site_bills").select("approved_amount").eq("project_id", projectId).eq("kind", "gas").eq("status", "approved").is("voided_at", null),
      sb.from("site_payments").select("amount").eq("project_id", projectId).eq("kind", "gas").is("voided_at", null),
      sb.from("gas_deposits").select("kind, amount").eq("project_id", projectId).is("voided_at", null),
    ]);
    if (mv.error || od.error || tm.error || rt.error || pr.error || bl.error || py.error || dp.error) return;   // the gas tables are not there yet: show nothing
    const orders = (od.data || []) as GOrder[]; const ids = orders.flatMap((o) => o.gas_order_lines.map((l) => l.id));
    const { data: pc } = ids.length ? await sb.from("gas_order_pricing").select("line_id, rate, gst_pct").in("line_id", ids) : { data: [] as any[] };
    const n = (v: unknown) => Number(v ?? 0);
    const cost = gasCost({ moves: (mv.data || []) as GMove[], orders, pricing: ((pc || []) as GPricing[]).map((q) => ({ ...q, rate: n(q.rate), gst_pct: n(q.gst_pct) })), rates: ((rt.data || []) as GRate[]).map((q) => ({ ...q, rate: n(q.rate), gst_pct: n(q.gst_pct) })), products: ((pr.data || []) as GProduct[]).map((q) => ({ ...q, deposit_per_cylinder: n(q.deposit_per_cylinder) })),
      terms: ((tm.data || []) as any[]).map((q) => ({ vendor_id: q.vendor_id, loss_charge_per_cylinder: n(q.loss_charge_per_cylinder), damage_charge_per_cylinder: n(q.damage_charge_per_cylinder), charges_gst_pct: n(q.charges_gst_pct), transport_per_trip: n(q.transport_per_trip) })) as GTerms[] });
    if (live) setS({ cost, approved: ((bl.data || []) as any[]).reduce((a, x) => a + n(x.approved_amount), 0), paid: ((py.data || []) as any[]).reduce((a, x) => a + n(x.amount), 0), deposit: ((dp.data || []) as any[]).reduce((a, x) => a + (x.kind === "paid" ? n(x.amount) : -n(x.amount)), 0) });
  })(); return () => { live = false; }; }, [projectId]);
  if (!s || (s.cost.total <= 0 && s.approved <= 0 && s.paid <= 0 && s.deposit === 0)) return null;
  const c = s.cost; const notBilled = Math.max(0, c.total - s.approved); const row = (l: string, v: number, sub?: string) => v > 0 || sub ? <div className="flex items-baseline gap-2 text-sm"><span className="flex-1 text-slate-600">{l}{sub && <span className="text-xs text-slate-400"> · {sub}</span>}</span><span className="tabular-nums">₹{inr(v)}</span></div> : null;
  return (
    <div className="card !p-3 space-y-2" data-gas-cost>
      <div className="flex flex-wrap items-baseline gap-x-3"><h3 className="font-semibold">Gas cost to date</h3><span className="text-xs text-slate-400">counted when delivered, GST included. The list below shows only what has been paid.</span></div>
      {row("Refills delivered", c.cylinderAmount, `${c.cylinders} cylinder${c.cylinders === 1 ? "" : "s"}`)}{row("Delivery trips", c.transportAmount, c.trips ? `${c.trips} trip${c.trips === 1 ? "" : "s"}` : undefined)}{row("Lost or damaged", c.lostAmount + c.damagedAmount, c.lost + c.damaged ? `${c.lost} lost, ${c.damaged} damaged` : undefined)}
      <div className="flex items-baseline gap-2 border-t border-slate-100 pt-1.5"><span className="flex-1 font-medium">Gas cost so far</span><b className="tabular-nums">₹{inr(c.total)}</b></div>
      <div className="grid gap-2 sm:grid-cols-3 text-center">
        <div className="rounded-xl bg-slate-50 p-2"><div className="text-xs text-slate-400">Approved on bills</div><div className="font-medium tabular-nums">₹{inr(s.approved)}</div></div>
        <div className="rounded-xl bg-slate-50 p-2"><div className="text-xs text-slate-400">Paid (in expenses)</div><div className="font-medium tabular-nums">₹{inr(s.paid)}</div></div>
        <div className="rounded-xl bg-slate-50 p-2"><div className="text-xs text-slate-400">Delivered, not yet billed</div><div className={`font-medium tabular-nums ${notBilled > 0 ? "text-amber-700" : ""}`}>₹{inr(notBilled)}</div></div></div>
      {s.deposit !== 0 && <p className="text-xs text-slate-500">Deposit held by vendors: ₹{inr(s.deposit)}. It is refundable, so it is not part of the cost.</p>}
      {c.unpriced > 0 && <p className="warn">{c.unpriced} delivered cylinders have no rate set, so they are not counted.</p>}
    </div>
  );
}
