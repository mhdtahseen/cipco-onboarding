export type Status = "present" | "absent" | "half" | "off";
export type Meal = "breakfast" | "lunch" | "dinner";
export const MEALS: { key: Meal; label: string; col: "breakfast_vendor_id" | "lunch_vendor_id" | "dinner_vendor_id" }[] = [
  { key: "breakfast", label: "Breakfast", col: "breakfast_vendor_id" }, { key: "lunch", label: "Lunch", col: "lunch_vendor_id" }, { key: "dinner", label: "Dinner", col: "dinner_vendor_id" },
];
export const STATUS_LABEL: Record<Status, string> = { present: "Present", absent: "Absent", half: "Half-day", off: "Weekly off" };
export const STATUS_SHORT: Record<Status, string> = { present: "P", absent: "A", half: "½", off: "W" };

export type Vendor = { id: string; project_id: string | null; name: string; active: boolean; sort_order: number };
export type MealRate = { id: string; vendor_id: string; meal: Meal; price: number; effective_from: string };
export type Person = { employee_id: string; emp_no: string | null; full_name: string; designation: string | null; week_off: string | null; join_date: string | null };
export type AttRow = { id?: string; employee_id: string; project_id: string; work_date: string; status: Status | null; breakfast_vendor_id: string | null; lunch_vendor_id: string | null; dinner_vendor_id: string | null; rank?: number; set_by_role?: string | null; updated_by?: string | null; updated_at?: string | null };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const dayName = (iso: string) => DAYS[new Date(iso + "T00:00:00").getDay()];
export const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return toISO(d); };
export const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// India time, whatever the device's own clock zone is. Attendance locks at 11:00 PM IST on the day itself.
const istParts = () => new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" });   // "YYYY-MM-DD HH:MM:SS"
export const istToday = () => istParts().slice(0, 10);
export const isLocked = (iso: string) => istParts() >= `${iso} 23:00:00`;
export const isFuture = (iso: string) => iso > istToday();

export const isWeeklyOff = (p: Person, iso: string) => !!p.week_off && dayName(iso) === p.week_off;
/** What the sheet shows for a person with no saved row: weekly off on their off day, otherwise nothing marked yet. */
export const effectiveStatus = (p: Person, iso: string, row?: AttRow): Status | null => row?.status ?? (isWeeklyOff(p, iso) ? "off" : null);

export const rateFor = (rates: MealRate[], vendorId: string | null, meal: Meal, iso: string): number | null => {
  if (!vendorId) return null;
  const hit = rates.filter((r) => r.vendor_id === vendorId && r.meal === meal && r.effective_from <= iso).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  return hit ? Number(hit.price) : null;
};
export const daysWorked = (rows: AttRow[]) => rows.reduce((s, r) => s + (r.status === "present" ? 1 : r.status === "half" ? 0.5 : 0), 0);

// ── who may change which day (mirrors the database rule; the database is what really enforces it) ──
//   Supervisor: that day until 11:00 PM India time.  Site Engineer: that day and the next, until 11:00 PM.  Admin: always.
export const isSupervisorRole = (r: string | null | undefined) => r === "supervisor" || r === "attendance";
export const isLockedFor = (role: string | null | undefined, iso: string) => { if (role === "admin") return false; return istParts() >= `${isSupervisorRole(role) ? iso : addDays(iso, 1)} 23:00:00`; };
export const canWriteDay = (role: string | null | undefined, iso: string) => role === "admin" || (!isFuture(iso) && !isLockedFor(role, iso));

// ── transport ──
export type Leg = "pickup" | "drop";
export type Billing = "per_trip" | "monthly";
export type Vehicle = { id: string; project_id: string | null; name: string; operator: string; billing: Billing; active: boolean; sort_order: number };
/** One vehicle, one direction, one day: it showed up (with the time) or it did not. */
export type Run = { id: string; project_id: string; work_date: string; leg: Leg; vehicle_id: string; status: "showed" | "no_show"; at: string | null; created_by?: string | null; rank?: number; updated_by?: string | null; updated_at?: string | null };
export type TransportRate = { id: string; vehicle_id: string; price: number; effective_from: string };
export type DayRow = { project_id: string; work_date: string; submitted_by: string | null; submitted_at: string | null; verified_by: string | null; verified_at: string | null };
export const LEG_LABEL: Record<Leg, string> = { pickup: "Pickup", drop: "Drop" };
/** "07:42" in India time. */
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
/** An India-time date + "HH:MM" as a full timestamp the database understands. */
export const istISO = (date: string, hhmm: string) => `${date}T${hhmm}:00+05:30`;
/** The price in force on a day: per trip, or per month for a monthly vehicle. */
export const tripRate = (rates: TransportRate[], vehicleId: string, iso: string): number | null => {
  const mine = rates.filter((r) => r.vehicle_id === vehicleId).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const hit = [...mine].reverse().find((r) => r.effective_from <= iso) ?? mine[0];   // days before the first price use the first price, so setting a price late still prices earlier trips
  return hit ? Number(hit.price) : null;
};
