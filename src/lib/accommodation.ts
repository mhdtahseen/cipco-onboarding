// Accommodation: rooms rented for a project, rent paid a full month in advance, capacity in beds.
export type Room = { id: string; project_id: string; name: string; room_type: "ac" | "non_ac"; capacity: number; landlord: string; rented_from: string; vacated_on: string | null; notes: string; sort_order: number };
export type Rent = { id: string; room_id: string; rent: number; effective_from: string };
export type RoomPayment = { id: string; batch_id?: string | null; bill_path?: string | null; room_id: string; project_id: string | null; for_month: string | null; paid_on: string; amount: number; reference: string; note: string; voided_at: string | null };
export const ROOM_TYPE: Record<Room["room_type"], string> = { ac: "AC", non_ac: "Non-AC" };
/** Rent for a month is due on the 1st (paid in advance) and shown as overdue after this day of the month. */
export const RENT_GRACE_DAY = 5;

export const monthOf = (iso: string) => iso.slice(0, 7);                                   // "2026-10"
export const monthFirst = (ym: string) => `${ym}-01`;
export const addMonths = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });

/** The rent in force on the 1st of a month (a rent set later than that month does not apply to it; before the first rent, the first rent is used). */
export const rentFor = (rents: Rent[], roomId: string, ym: string): number => {
  const mine = rents.filter((r) => r.room_id === roomId).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const hit = [...mine].reverse().find((r) => r.effective_from <= monthFirst(ym)) ?? mine[0];
  return hit ? Number(hit.rent) : 0;
};
/** Is a full month's rent due for this room in that month? From the month it was rented to the month it was vacated (a part month is billed in full). */
export const billedIn = (room: Room, ym: string) => monthOf(room.rented_from) <= ym && (!room.vacated_on || monthOf(room.vacated_on) >= ym);
/** Every month billed up to and including `upto`. */
export const monthsBilled = (room: Room, upto: string) => { const out: string[] = []; for (let m = monthOf(room.rented_from); m <= upto && out.length < 600; m = addMonths(m, 1)) if (billedIn(room, m)) out.push(m); return out; };
export const isActive = (room: Room, today: string) => !room.vacated_on || room.vacated_on >= today;
