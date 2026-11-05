"use client";
import { addMonths, billedIn, chargeOf, isActive, monthLabel } from "@/lib/accommodation";
import { balanceOf, inr, overdueOf, rentRows, type Acc } from "./shared";

// "Is anything wrong?": this month's rent, what is late, next month's advance, whether the rooms hold everyone, and a summary per landlord.
export default function Overview({ a, people, go }: { a: Acc; people: number | null; go: (tab: "landlords" | "rent" | "payments", landlord?: string) => void }) {
  const active = a.rooms.filter((r) => isActive(r, a.today)); const thisRows = rentRows(a, a.thisMonth);
  const due = thisRows.reduce((s, o) => s + o.charge, 0), paid = thisRows.reduce((s, o) => s + Math.min(o.paid, o.charge || o.paid), 0), left = thisRows.reduce((s, o) => s + o.left, 0);
  const late = overdueOf(a, a.rooms), next = addMonths(a.thisMonth, 1), nextRent = a.rooms.reduce((s, r) => s + chargeOf(r, a.rents, a.adjs, next), 0);
  const monthly = active.reduce((s, r) => s + (billedIn(r, a.thisMonth) ? chargeOf(r, a.rents, [], a.thisMonth) : 0), 0);
  const beds = active.reduce((s, r) => s + r.capacity, 0), unset = active.filter((r) => !r.capacity).length, withBeds = active.filter((r) => r.capacity);
  const avgBeds = withBeds.length ? beds / withBeds.length : 0; const short = people !== null && beds > 0 ? Math.max(0, people - beds) : 0; const moreRooms = short && avgBeds ? Math.ceil(short / avgBeds) : 0;
  const unassigned = a.rooms.filter((r) => !r.landlord_id && isActive(r, a.today)); const noBank = a.landlords.filter((l) => l.active && !a.hasBank[l.id] && a.rooms.some((r) => r.landlord_id === l.id));
  const card = (l: string, v: string, sub?: string, tone = "") => <div className="rounded-2xl bg-white border border-slate-200/80 p-3"><div className="text-xs text-slate-400">{l}</div><div className={`text-lg font-medium tabular-nums ${tone}`}>{v}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
  const rowsFor = (id: string | null) => a.rooms.filter((r) => (id ? r.landlord_id === id : !r.landlord_id));
  const groups = [...a.landlords.filter((l) => a.rooms.some((r) => r.landlord_id === l.id)).map((l) => ({ id: l.id as string | null, name: l.name })), ...(unassigned.length ? [{ id: null as string | null, name: "No landlord set" }] : [])];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {card(`${monthLabel(a.thisMonth)} rent`, `₹${inr(due)}`, `₹${inr(paid)} paid · ₹${inr(left)} still to pay`)}
        {card("Late", `₹${inr(late)}`, late > 0 ? "past the 5th and not paid" : "nothing overdue", late > 0 ? "text-rose-700" : "text-emerald-700")}
        {card(`${monthLabel(next)} (advance)`, `₹${inr(nextRent)}`, "due on the 1st")}
        {card("Rooms", String(active.length), `${active.filter((r) => r.room_type === "ac").length} AC · ${active.filter((r) => r.room_type === "non_ac").length} non-AC · ₹${inr(monthly)} a month at full rent`)}
      </div>

      {(unassigned.length > 0 || noBank.length > 0 || late > 0) && <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 space-y-1 text-sm text-amber-900" data-alerts>
        <div className="font-medium">Needs your attention</div>
        {late > 0 && <div>• ₹{inr(late)} of rent is late. <button className="underline" onClick={() => go("rent")}>Open rent</button></div>}
        {noBank.map((l) => <div key={l.id}>• {l.name} has no bank details yet, so Payments due can't show where to pay. <button className="underline" onClick={() => go("landlords", l.id)}>Add them</button></div>)}
        {unassigned.length > 0 && <div>• {unassigned.length} room{unassigned.length > 1 ? "s have" : " has"} no landlord ({unassigned.map((r) => r.name).join(", ")}). <button className="underline" onClick={() => go("landlords")}>Assign</button></div>}</section>}

      <section className="card space-y-2"><h2 className="font-medium">By landlord</h2>
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[36rem]"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="text-left py-1">Landlord</th><th className="text-right">Rooms</th><th className="text-right">This month</th><th className="text-right">Paid</th><th className="text-right">Still to pay</th><th className="text-right">Owed to date</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">{groups.map((g) => { const rooms = rowsFor(g.id); const rr = rentRows(a, a.thisMonth, rooms); const lft = rr.reduce((s, o) => s + o.left, 0); const bal = balanceOf(a, rooms); const l = g.id ? a.landlords.find((x) => x.id === g.id) : undefined; return (
            <tr key={g.id ?? "none"}><td className="py-2 font-medium">{g.name}{l && !a.hasBank[l.id] && <span className="ml-2 text-[11px] font-normal text-amber-700">no bank details</span>}{l?.phone && <div className="text-xs font-normal text-slate-400">{l.phone}</div>}</td>
              <td className="text-right tabular-nums">{rooms.filter((r) => isActive(r, a.today)).length}</td><td className="text-right tabular-nums">₹{inr(rr.reduce((s, o) => s + o.charge, 0))}</td><td className="text-right tabular-nums">₹{inr(rr.reduce((s, o) => s + o.paid, 0))}</td>
              <td className="text-right tabular-nums">{lft > 0 ? <b className="text-amber-800">₹{inr(lft)}</b> : <span className="text-emerald-700">Nothing</span>}</td><td className={`text-right tabular-nums ${bal > 0 ? "text-rose-700 font-medium" : bal < 0 ? "text-sky-700" : "text-slate-400"}`}>{bal > 0 ? `₹${inr(bal)}` : bal < 0 ? `₹${inr(-bal)} ahead` : "Clear"}</td>
              <td className="text-right pl-2 whitespace-nowrap">{lft > 0 && g.id && <button className="btn btn-sm btn-primary" onClick={() => go("rent", g.id!)}>Pay</button>} <button className="text-xs text-blue-700 underline ml-1" onClick={() => go("payments", g.id ?? undefined)}>History</button></td></tr>); })}</tbody></table></div>
        {!groups.length && <p className="text-sm text-slate-400">No rooms for this project yet. Add the landlord and rooms under Landlords &amp; rooms.</p>}
        <p className="text-xs text-slate-400">"Owed to date" is everything charged so far minus everything paid. A month charged in part, or not at all, counts only for what was charged (see Adjust on the Rent tab).</p></section>

      <section className="card space-y-2" data-capacity><h2 className="font-medium">Do the rooms hold everyone?</h2>
        <div className="grid grid-cols-3 gap-3 text-center">{[["Beds", beds ? String(beds) : "not set"], ["People on this project", people === null ? "…" : String(people)], [short ? "Short by" : "Spare beds", beds && people !== null ? String(short || Math.max(0, beds - people)) : "—"]].map(([l, v]) => <div key={l} className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">{l}</div><div className={`text-lg font-medium ${l === "Short by" && short ? "text-rose-700" : ""}`}>{v}</div></div>)}</div>
        {unset > 0 && <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-3 py-2">{unset} room{unset > 1 ? "s have" : " has"} no bed count yet. Set it under Landlords &amp; rooms so this comparison is right.</p>}
        {short > 0 && <p className="text-sm text-rose-800 bg-rose-50 rounded-xl px-3 py-2">The rooms are short by <b>{short}</b> bed{short > 1 ? "s" : ""}{moreRooms ? <>: roughly <b>{moreRooms} more room{moreRooms > 1 ? "s" : ""}</b> at your current {avgBeds.toFixed(1)} beds per room.</> : "."} <button className="underline" onClick={() => go("landlords")}>Add rooms</button></p>}
        {!short && beds > 0 && people !== null && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl px-3 py-2">The rooms hold everyone, with {beds - people} spare bed{beds - people === 1 ? "" : "s"}.</p>}
        <p className="text-xs text-slate-400">People = everyone on this project with a joining date up to today, from the employee records.</p></section>
    </div>
  );
}
