// What gas deliveries cost. One set of rules used by the Bills tab (what the site records come to for a bill), the order cards and the project's "gas cost to date",
// so the three can never disagree. Pure functions: the callers fetch the data.
export type GKind = "delivery" | "return" | "lost" | "damaged" | "opening" | "emptied";

/** The cylinders of one product at a site. total = opening + delivered − taken back − lost − damaged (full and empty together). A swap (one full in, one empty out) leaves the total unchanged.
 *  empty = what was used up, less the empties already taken back, never below 0 and never more than the total; full = total − empty. Voided entries must be left out by the caller.
 *  The same rule is in the database (gas_stock_total / gas_stock_full in 2026-11-gas-stock.sql), which is what refuses an entry that does not fit. */
export function stockOf(moves: { kind: string; qty: number }[]): { total: number; full: number; empty: number; opening: number; delivered: number; returned: number; lost: number; damaged: number; emptied: number } {
  const n = (k: string) => moves.filter((m) => m.kind === k).reduce((s, m) => s + Number(m.qty), 0);
  const opening = n("opening"), delivered = n("delivery"), returned = n("return"), lost = n("lost"), damaged = n("damaged"), emptied = n("emptied");
  const total = opening + delivered - returned - lost - damaged; const empty = Math.max(0, Math.min(total, emptied - returned));
  return { total, full: total - empty, empty, opening, delivered, returned, lost, damaged, emptied };
}
export type GMove = { vendor_id: string; product_id: string; order_id: string | null; kind: GKind; qty: number; moved_on: string; challan_no: string; voided_at: string | null; carrier?: string | null };   // carrier: who brought it (vendor | own | none); missing = vendor (before 2026-11-gas-own-transport.sql)
export type GOrder = { id: string; gas_order_lines: { id: string; product_id: string; qty: number }[] };
export type GPricing = { line_id: string; rate: number; gst_pct: number };
export type GRate = { product_id: string; rate: number; gst_pct: number; valid_from: string };
export type GProduct = { id: string; vendor_id: string; name: string; capacity?: string; deposit_per_cylinder?: number };
export type GTerms = { vendor_id: string; loss_charge_per_cylinder: number; damage_charge_per_cylinder: number; charges_gst_pct: number; transport_per_trip: number };

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** The number of delivery TRIPS in these entries. A trip is the vendor's truck bringing new cylinders AND taking the empties back on the same visit: the delivery is what is charged, and the pick-up
 *  is part of the same trip, so only delivery entries are counted and a pick-up never adds a trip. A truck with oxygen and LPG is recorded as one entry per product, but it is one trip: entries on the
 *  same day with the same challan number are one trip (with no challan number, the same day and the same order). Two trucks on one day need different challan numbers to count as two trips.
 *  A visit that only collects empties (no new cylinders) is not counted as a trip. Only the vendor's own trips are counted (and charged): a delivery brought by one of our
 *  transport vehicles is paid as that vehicle's errand under Transport, and a collected one costs nothing. */
export function countTrips(moves: Pick<GMove, "vendor_id" | "kind" | "moved_on" | "challan_no" | "order_id" | "voided_at" | "carrier">[], carrier: "vendor" | "own" | "none" = "vendor"): number {
  const trips = new Set<string>();
  moves.forEach((m) => { if (m.kind !== "delivery" || m.voided_at || (m.carrier || "vendor") !== carrier) return; const ch = (m.challan_no || "").trim().toLowerCase(); trips.add(`${m.vendor_id}|${m.moved_on}|${ch || m.order_id || ""}`); });
  return trips.size;
}

export type GasCost = { cylinders: number; cylinderAmount: number; lost: number; lostAmount: number; damaged: number; damagedAmount: number; trips: number; transportAmount: number; total: number; unpriced: number; lines: string[] };

/** Cylinders are not rented: a deposit is paid per cylinder (tracked apart, not a cost) and refills are paid for as they arrive. Everything a vendor can charge for the deliveries and incidents of one project between two dates (or all dates), GST included.
 *  A delivery linked to an order is priced at the rate locked when that order was approved; any other delivery at the rate in force on its delivery date. */
export function gasCost(i: { moves: GMove[]; orders: GOrder[]; pricing: GPricing[]; rates: GRate[]; products: GProduct[]; terms: GTerms[]; vendorId?: string; from?: string; to?: string; label?: (productId: string) => string }): GasCost {
  const live = i.moves.filter((m) => !m.voided_at && (!i.vendorId || m.vendor_id === i.vendorId) && (!i.from || m.moved_on >= i.from) && (!i.to || m.moved_on <= i.to));
  const label = i.label ?? ((id: string) => i.products.find((p) => p.id === id)?.name ?? "?"); const lines: string[] = [];
  const out: GasCost = { cylinders: 0, cylinderAmount: 0, lost: 0, lostAmount: 0, damaged: 0, damagedAmount: 0, trips: 0, transportAmount: 0, total: 0, unpriced: 0, lines };
  const priceOf = (lineId: string) => i.pricing.find((p) => p.line_id === lineId);
  i.products.filter((p) => !i.vendorId || p.vendor_id === i.vendorId).forEach((p) => {
    let qty = 0, sum = 0;
    live.filter((m) => m.kind === "delivery" && m.product_id === p.id).forEach((m) => {
      const o = m.order_id ? i.orders.find((x) => x.id === m.order_id) : undefined; const ol = o?.gas_order_lines.find((l) => l.product_id === p.id); let pr: { rate: number; gst_pct: number } | undefined = ol ? priceOf(ol.id) : undefined;
      if (!pr) { const r = i.rates.filter((x) => x.product_id === p.id && x.valid_from <= m.moved_on).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]; if (r) pr = { rate: r.rate, gst_pct: r.gst_pct }; }
      if (!pr) { out.unpriced += m.qty; return; } qty += m.qty; sum += m.qty * pr.rate * (1 + pr.gst_pct / 100);
    });
    if (qty) { lines.push(`${qty} × ${label(p.id)} delivered → ₹${inr(sum)} incl. GST`); out.cylinders += qty; out.cylinderAmount += sum; }
  });
  // charges are per vendor: their own terms apply
  const vendors = [...new Set(live.map((m) => m.vendor_id))];
  vendors.forEach((vid) => {
    const t = i.terms.find((x) => x.vendor_id === vid); if (!t) return; const gstF = 1 + (t.charges_gst_pct ?? 0) / 100; const mine = live.filter((m) => m.vendor_id === vid);
    const dmg = mine.filter((m) => m.kind === "damaged").reduce((s, m) => s + m.qty, 0), trips = countTrips(mine);
    // a lost cylinder: the vendor keeps its deposit and we pay the rest of the lost-cylinder charge
    if (t.loss_charge_per_cylinder > 0) i.products.filter((p) => p.vendor_id === vid).forEach((p) => { const n = mine.filter((m) => m.kind === "lost" && m.product_id === p.id).reduce((s, m) => s + m.qty, 0); if (!n) return; const dep = Number(p.deposit_per_cylinder ?? 0), c = Math.max(0, n * (t.loss_charge_per_cylinder * gstF - dep)); lines.push(`${n} ${label(p.id)} lost × ₹${inr(t.loss_charge_per_cylinder)} + ${t.charges_gst_pct}% GST${dep ? `, less the ₹${inr(dep)} deposit the vendor keeps` : ""} → ₹${inr(c)}`); out.lost += n; out.lostAmount += c; });
    if (dmg && t.damage_charge_per_cylinder > 0) { const c = dmg * t.damage_charge_per_cylinder * gstF; lines.push(`${dmg} with valve / cap damaged × ₹${inr(t.damage_charge_per_cylinder)} + ${t.charges_gst_pct}% GST → ₹${inr(c)}`); out.damaged += dmg; out.damagedAmount += c; }
    const own = countTrips(mine, "own"); if (own) lines.push(`${own} delivery trip${own === 1 ? "" : "s"} brought by our own transport: no trip charge from the vendor (paid as an errand under Transport)`);
    if (trips && t.transport_per_trip > 0) { const c = trips * t.transport_per_trip; lines.push(`${trips} delivery trip${trips === 1 ? "" : "s"} × ₹${inr(t.transport_per_trip)} transport, no GST → ₹${inr(c)}`); out.trips += trips; out.transportAmount += c; }
  });
  out.total = out.cylinderAmount + out.lostAmount + out.damagedAmount + out.transportAmount;
  return out;
}
