// What gas deliveries cost. One set of rules used by the Bills tab (what the site records come to for a bill), the order cards and the project's "gas cost to date",
// so the three can never disagree. Pure functions: the callers fetch the data.
export type GMove = { vendor_id: string; product_id: string; order_id: string | null; kind: "delivery" | "return" | "lost" | "damaged"; qty: number; moved_on: string; challan_no: string; voided_at: string | null };
export type GOrder = { id: string; gas_order_lines: { id: string; product_id: string; qty: number }[] };
export type GPricing = { line_id: string; rate: number; gst_pct: number };
export type GRate = { product_id: string; rate: number; gst_pct: number; valid_from: string };
export type GProduct = { id: string; vendor_id: string; name: string; capacity?: string };
export type GTerms = { vendor_id: string; loss_charge_per_cylinder: number; damage_charge_per_cylinder: number; charges_gst_pct: number; transport_per_trip: number };
export type GRent = { vendor_id: string; period_to: string; amount: number };

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** The number of delivery TRIPS in these entries. A trip is the vendor's truck bringing new cylinders AND taking the empties back on the same visit: the delivery is what is charged, and the pick-up
 *  is part of the same trip, so only delivery entries are counted and a pick-up never adds a trip. A truck with oxygen and LPG is recorded as one entry per product, but it is one trip: entries on the
 *  same day with the same challan number are one trip (with no challan number, the same day and the same order). Two trucks on one day need different challan numbers to count as two trips.
 *  A visit that only collects empties (no new cylinders) is not counted as a trip. */
export function countTrips(moves: Pick<GMove, "vendor_id" | "kind" | "moved_on" | "challan_no" | "order_id" | "voided_at">[]): number {
  const trips = new Set<string>();
  moves.forEach((m) => { if (m.kind !== "delivery" || m.voided_at) return; const ch = (m.challan_no || "").trim().toLowerCase(); trips.add(`${m.vendor_id}|${m.moved_on}|${ch || m.order_id || ""}`); });
  return trips.size;
}

export type GasCost = { cylinders: number; cylinderAmount: number; lost: number; lostAmount: number; damaged: number; damagedAmount: number; trips: number; transportAmount: number; rent: number; total: number; unpriced: number; lines: string[] };

/** Everything a vendor can charge for the deliveries and incidents of one project between two dates (or all dates), GST included.
 *  A delivery linked to an order is priced at the rate locked when that order was approved; any other delivery at the rate in force on its delivery date. */
export function gasCost(i: { moves: GMove[]; orders: GOrder[]; pricing: GPricing[]; rates: GRate[]; products: GProduct[]; terms: GTerms[]; rent: GRent[]; vendorId?: string; from?: string; to?: string; label?: (productId: string) => string }): GasCost {
  const live = i.moves.filter((m) => !m.voided_at && (!i.vendorId || m.vendor_id === i.vendorId) && (!i.from || m.moved_on >= i.from) && (!i.to || m.moved_on <= i.to));
  const label = i.label ?? ((id: string) => i.products.find((p) => p.id === id)?.name ?? "?"); const lines: string[] = [];
  const out: GasCost = { cylinders: 0, cylinderAmount: 0, lost: 0, lostAmount: 0, damaged: 0, damagedAmount: 0, trips: 0, transportAmount: 0, rent: 0, total: 0, unpriced: 0, lines };
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
    const lost = mine.filter((m) => m.kind === "lost").reduce((s, m) => s + m.qty, 0), dmg = mine.filter((m) => m.kind === "damaged").reduce((s, m) => s + m.qty, 0), trips = countTrips(mine);
    if (lost && t.loss_charge_per_cylinder > 0) { const c = lost * t.loss_charge_per_cylinder * gstF; lines.push(`${lost} lost × ₹${inr(t.loss_charge_per_cylinder)} + ${t.charges_gst_pct}% GST → ₹${inr(c)}`); out.lost += lost; out.lostAmount += c; }
    if (dmg && t.damage_charge_per_cylinder > 0) { const c = dmg * t.damage_charge_per_cylinder * gstF; lines.push(`${dmg} with valve / cap damaged × ₹${inr(t.damage_charge_per_cylinder)} + ${t.charges_gst_pct}% GST → ₹${inr(c)}`); out.damaged += dmg; out.damagedAmount += c; }
    if (trips && t.transport_per_trip > 0) { const c = trips * t.transport_per_trip * gstF; lines.push(`${trips} delivery trip${trips === 1 ? "" : "s"} × ₹${inr(t.transport_per_trip)} transport + ${t.charges_gst_pct}% GST → ₹${inr(c)}`); out.trips += trips; out.transportAmount += c; }
  });
  out.rent = i.rent.filter((r) => (!i.vendorId || r.vendor_id === i.vendorId) && (!i.from || r.period_to >= i.from) && (!i.to || r.period_to <= i.to)).reduce((s, r) => s + r.amount, 0);
  if (out.rent) lines.push(`Rent the vendor charged (entered under Deposits & rent) → ₹${inr(out.rent)}`);
  out.total = out.cylinderAmount + out.lostAmount + out.damagedAmount + out.transportAmount + out.rent;
  return out;
}
