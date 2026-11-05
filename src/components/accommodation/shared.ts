import { adjustmentFor, chargeOf, chargedUpTo, isOverdueMonth, monthOf, type Adjustment, type Landlord, type Rent, type Room, type RoomPayment } from "@/lib/accommodation";

// What every part of the Accommodation page shares: the project's rooms, rents, payments, month adjustments and landlords, and the helpers to change and reload them.
export type Acc = {
  pid: string; project: string; today: string; thisMonth: string;
  rooms: Room[]; rents: Rent[]; pays: RoomPayment[]; adjs: Adjustment[]; landlords: Landlord[];
  hasBank: Record<string, boolean>;                                   // landlord id → bank or UPI details are saved
  reload: () => Promise<void>;
  run: (p: PromiseLike<{ error: { message: string } | null }>, ok?: string) => Promise<boolean>;   // does a change, shows the result, reloads
  note: (m: string) => void; fail: (m: string) => void;
};
export const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const live = (x: RoomPayment) => !x.voided_at;
export const landlordOf = (a: Acc, r: Room) => a.landlords.find((l) => l.id === r.landlord_id);

export type RentRow = { room: Room; charge: number; paid: number; left: number; adj: Adjustment | undefined; status: "Paid" | "Part paid" | "Due" | "Overdue" | "Not charged" | "—" };
/** One row per room for a month: what is charged, what has been paid for that month, and what is still to pay. */
export function rentRows(a: Acc, ym: string, rooms: Room[] = a.rooms): RentRow[] {
  return rooms.map((room) => {
    const charge = chargeOf(room, a.rents, a.adjs, ym), adj = adjustmentFor(a.adjs, room.id, ym);
    const paid = a.pays.filter((x) => x.room_id === room.id && live(x) && x.for_month && monthOf(x.for_month) === ym).reduce((s, x) => s + x.amount, 0);
    const status: RentRow["status"] = !charge ? (adj ? "Not charged" : "—") : paid >= charge ? "Paid" : isOverdueMonth(ym, a.thisMonth, a.today) ? "Overdue" : paid > 0 ? "Part paid" : "Due";
    return { room, charge, paid, left: Math.max(0, charge - paid), adj, status };
  });
}
/** Everything charged to date for these rooms minus everything paid: what is owed overall. */
export const balanceOf = (a: Acc, rooms: Room[]) => rooms.reduce((s, r) => s + chargedUpTo(r, a.rents, a.adjs, a.thisMonth) - a.pays.filter((x) => x.room_id === r.id && live(x)).reduce((t, x) => t + x.amount, 0), 0);
/** Rent that is late: for each room and month up to this one that is past its grace day, what was charged and not paid for that month. */
export const overdueOf = (a: Acc, rooms: Room[]) => {
  let total = 0; const months = new Set<string>(); rooms.forEach((r) => { for (let m = monthOf(r.rented_from); m <= a.thisMonth; m = monthAfter(m)) months.add(m); });
  months.forEach((m) => { if (isOverdueMonth(m, a.thisMonth, a.today)) rentRows(a, m, rooms).forEach((o) => { total += o.left; }); });
  return total;
};
const monthAfter = (ym: string) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const pill = (s: string) => `rounded-full px-2 py-0.5 text-[11px] ${s === "Paid" ? "bg-emerald-50 text-emerald-700" : s === "Overdue" ? "bg-rose-50 text-rose-700" : s === "Part paid" ? "bg-amber-50 text-amber-800" : s === "Not charged" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"}`;
export type PeopleCount = number | null;
export type { Adjustment, Landlord, Rent, Room, RoomPayment };
