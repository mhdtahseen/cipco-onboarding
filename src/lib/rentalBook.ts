import { DEFAULT_VENDOR_TERMS, withReturns, type Rates, type Rental, type RentalItem, type RentalTerms, type VendorTerms } from "./rentals";

// Every live rental delivery with its items (and what has gone back), terms and rates, plus each vendor's billing setting: for the dashboard's reminders
// and Payments due. Works before 2026-11-rentals-vendor.sql too (no returns per vendor, default billing). Errors give an empty book: never in the way.
export type BookRental = Rental & { vendor_name: string; items: RentalItem[]; terms: RentalTerms | null; rates: Rates };
export type RentalBook = { rentals: BookRental[]; vterms: (vendorId: string) => VendorTerms };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = { from: (t: string) => any };
const n = (x: unknown) => Number(x ?? 0);

export async function loadRentalBook(sb: SB, opts: { since?: string } = {}): Promise<RentalBook> {
  const empty: RentalBook = { rentals: [], vterms: DEFAULT_VENDOR_TERMS };
  try {
    let q = sb.from("rentals").select("id, project_id, vendor_id, delivered_on, returned_on, voided_at, gas_vendors(name)").is("voided_at", null);
    if (opts.since) q = q.or(`returned_on.is.null,returned_on.gte.${opts.since}`);
    const { data: rs, error } = await q; if (error || !rs?.length) return empty;
    const ids = (rs as { id: string }[]).map((r) => r.id);
    const [{ data: its }, { data: tms }, { data: vts }, { data: rets }] = await Promise.all([sb.from("rental_items").select("*").in("rental_id", ids), sb.from("rental_terms").select("*").in("rental_id", ids),
      sb.from("rental_vendor_terms").select("*"), sb.from("rental_returns").select("id, returned_on").is("voided_at", null)]);
    const items = ((its || []) as RentalItem[]).map((i) => ({ ...i, qty: n(i.qty), missing_qty: n(i.missing_qty) }));
    const [{ data: rts }, { data: lines }] = await Promise.all([items.length ? sb.from("rental_item_rates").select("item_id, rate").in("item_id", items.map((i) => i.id)) : Promise.resolve({ data: [] }),
      (rets || []).length ? sb.from("rental_return_lines").select("return_id, item_id, qty, missing").in("return_id", (rets as { id: string }[]).map((x) => x.id)) : Promise.resolve({ data: [] })]);
    const on = new Map(((rets || []) as { id: string; returned_on: string }[]).map((x) => [x.id, x.returned_on]));
    const withBack = withReturns(items, ((lines || []) as { return_id: string; item_id: string; qty: number; missing: number }[]).filter((l) => on.has(l.return_id)).map((l) => ({ item_id: l.item_id, qty: n(l.qty), missing: n(l.missing), on: on.get(l.return_id)! })));
    const rates: Rates = Object.fromEntries(((rts || []) as { item_id: string; rate: number }[]).map((x) => [x.item_id, n(x.rate)]));
    const vt = new Map(((vts || []) as VendorTerms[]).map((t) => [t.vendor_id, { ...t, period_days: n(t.period_days), min_days: n(t.min_days), gst_pct: n(t.gst_pct) }]));
    const rentals = (rs as (Rental & { gas_vendors?: { name: string } | null })[]).map((r) => {
      const t = ((tms || []) as RentalTerms[]).find((x) => x.rental_id === r.id) ?? null;
      return { id: r.id, project_id: r.project_id, vendor_id: r.vendor_id, delivered_on: r.delivered_on, returned_on: r.returned_on, voided_at: r.voided_at, vendor_name: r.gas_vendors?.name ?? "Rental vendor",
        items: withBack.filter((i) => i.rental_id === r.id), rates,
        terms: t ? { ...t, period_days: n(t.period_days), min_days: n(t.min_days), gst_pct: n(t.gst_pct), deposit: n(t.deposit), deduction: n(t.deduction), refund_amount: t.refund_amount === null ? null : n(t.refund_amount) } : null };
    });
    return { rentals, vterms: (vid) => vt.get(vid) ?? DEFAULT_VENDOR_TERMS(vid) };
  } catch { return empty; }
}
