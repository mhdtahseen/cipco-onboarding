// What each approved site bill (gas, equipment) has received. Payments made for a bill count first; the vendor's other payments (advances, or payments
// recorded before bills could be picked) are spread over that vendor's approved bills, oldest first. Shared by Bills & payments and the machine log.
type B = { id: string; vendor_id: string; bill_date: string; status: string; approved_amount: number | null; voided_at: string | null };
type P = { vendor_id: string; site_bill_id?: string | null; amount: number; voided_at: string | null };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function paidByBill(bills: B[], pays: P[]): Map<string, number> {
  const m = new Map<string, number>(); const ok = bills.filter((b) => !b.voided_at && b.status === "approved").sort((x, y) => x.bill_date.localeCompare(y.bill_date));
  const lp = pays.filter((p) => !p.voided_at); const okIds = new Set(ok.map((b) => b.id));
  const direct = (id: string) => lp.filter((p) => p.site_bill_id === id).reduce((s, p) => s + Number(p.amount), 0);
  const pool = new Map<string, number>(); lp.forEach((p) => { if (!p.site_bill_id || !okIds.has(p.site_bill_id)) pool.set(p.vendor_id, (pool.get(p.vendor_id) ?? 0) + Number(p.amount)); });
  ok.forEach((b) => { const d = direct(b.id); const need = Math.max(0, Number(b.approved_amount ?? 0) - d); const free = pool.get(b.vendor_id) ?? 0; const take = Math.min(need, free); pool.set(b.vendor_id, free - take); m.set(b.id, r2(d + take)); });
  return m;
}
