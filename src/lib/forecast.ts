// The expense forecast for one project and one month: pure sums, so the page can redo them instantly as the what-ifs change, and they can be tested.
// A driver-based forecast, not a statistical one: each cost is worked out from what causes it (people × rate × days, meals × price, rooms × rent, trips × rate).
// With only weeks of history a trend would look precise and be guesswork. Low and high come from the lowest and highest of the last three full weeks.
export type TransportLine = { name: string; billing: string; trips: number; rate: number; monthly: number };
export type OtherEntry = { label: string; amount: number; date: string };
export type ForecastInput = {
  projectId: string; projectName: string; month: string; days: number; asOf: string; windowDays: number;
  salaried: { n: number; monthly: number }; noSalary: number;
  daily: { n: number; monthly: number; low: number; high: number };
  meals: { perDay: number; low: number; high: number; people: number };   // per day
  rooms: { n: number; beds: number; rent: number };
  transport: { lines: TransportLine[]; monthly: number; low: number; high: number };
  other: { monthly: number; low: number; total: number; sinceDays: number; top: OtherEntry[] };
  spent: number; deposits: number; owedNow: number;
};
/** What you change on the page. These only change the sums on screen, never your records. */
export type Scenario = { addDaily: number; dailyCost: number; addSalaried: number; salariedCost: number; mealPerPersonDay: number; extraRooms: number; roomRent: number; transport: number; other: number; includeOther: boolean };
export type Line = { key: string; label: string; basis: string; low: number; likely: number; high: number; changed: number };
export type Forecast = { lines: Line[]; low: number; likely: number; high: number; changed: number; people: number; peopleAfter: number; bedsShort: number; roomsNeeded: number; spareBeds: number; perDaily: number; perSalaried: number; mealPerMonth: number };

const round = (n: number) => Math.round(n);
const inr = (n: number) => round(n).toLocaleString("en-IN");
export const avgDaily = (i: ForecastInput) => (i.daily.n ? i.daily.monthly / i.daily.n : 0);
export const avgSalaried = (i: ForecastInput) => (i.salaried.n ? i.salaried.monthly / i.salaried.n : 0);
export const avgRent = (i: ForecastInput) => (i.rooms.n ? i.rooms.rent / i.rooms.n : 0);
export const mealPerPerson = (i: ForecastInput) => (i.meals.people ? i.meals.perDay / i.meals.people : 0);
export const baseScenario = (i: ForecastInput): Scenario => ({ addDaily: 0, dailyCost: round(avgDaily(i)), addSalaried: 0, salariedCost: round(avgSalaried(i)), mealPerPersonDay: round(mealPerPerson(i)), extraRooms: 0, roomRent: round(avgRent(i)), transport: round(i.transport.monthly), other: round(i.other.monthly), includeOther: true });

export function forecast(i: ForecastInput, s: Scenario): Forecast {
  const people = i.salaried.n + i.daily.n, peopleAfter = Math.max(0, people + s.addDaily + s.addSalaried), bedsPerRoom = i.rooms.n ? i.rooms.beds / i.rooms.n : 0;
  const bedsShort = i.rooms.beds > 0 ? Math.max(0, peopleAfter - i.rooms.beds) : 0, roomsNeeded = bedsShort && bedsPerRoom ? Math.ceil(bedsShort / bedsPerRoom) : 0;
  const base = baseScenario(i); const mealsNow = i.meals.perDay * i.days;
  const mealsChanged = s.mealPerPersonDay === base.mealPerPersonDay && peopleAfter === people ? mealsNow : s.mealPerPersonDay * peopleAfter * i.days;   // no change = exactly the measured figure, not the rounded one
  const lines: Line[] = [
    { key: "salaried", label: "Salaries, salaried staff", basis: `${i.salaried.n} ${i.salaried.n === 1 ? "person" : "people"} at their set salary, with employer PF and ESI`, low: i.salaried.monthly, likely: i.salaried.monthly, high: i.salaried.monthly, changed: i.salaried.monthly + s.addSalaried * s.salariedCost },
    { key: "daily", label: "Salaries, daily wage", basis: `${i.daily.n} ${i.daily.n === 1 ? "person" : "people"}: daily rate × days actually worked recently`, low: i.daily.low, likely: i.daily.monthly, high: i.daily.high, changed: i.daily.monthly + s.addDaily * s.dailyCost },
    { key: "rooms", label: "Accommodation", basis: `${i.rooms.n} room${i.rooms.n === 1 ? "" : "s"}, ${i.rooms.beds} beds: rent as charged`, low: i.rooms.rent, likely: i.rooms.rent, high: i.rooms.rent, changed: i.rooms.rent + (roomsNeeded + s.extraRooms) * s.roomRent },
    { key: "meals", label: "Meals", basis: `${i.meals.people} people × ₹${inr(mealPerPerson(i))} a day × ${i.days} days`, low: i.meals.low * i.days, likely: mealsNow, high: i.meals.high * i.days, changed: mealsChanged },
    { key: "transport", label: "Transport", basis: i.transport.lines.length ? i.transport.lines.map((t) => (t.billing === "monthly" ? `${t.name}: fixed monthly` : `${t.name}: ${t.trips} trips in ${i.windowDays} days × ₹${inr(t.rate)}`)).join("; ") : "No vehicles on this project", low: i.transport.low, likely: i.transport.monthly, high: i.transport.high, changed: s.transport === base.transport ? i.transport.monthly : s.transport },
  ];
  if (s.includeOther) lines.push({ key: "other", label: "Other costs (one-offs)", basis: `Average of ₹${inr(i.other.total)} over ${i.other.sinceDays} days: gas, equipment and anything entered by hand`, low: i.other.low, likely: i.other.monthly, high: i.other.monthly, changed: s.other === base.other ? i.other.monthly : s.other });
  const sum = (k: "low" | "likely" | "high" | "changed") => lines.reduce((t, l) => t + l[k], 0);
  return { lines, low: sum("low"), likely: sum("likely"), high: sum("high"), changed: sum("changed"), people, peopleAfter, bedsShort, roomsNeeded, spareBeds: Math.max(0, i.rooms.beds - people), perDaily: s.dailyCost + s.mealPerPersonDay * i.days, perSalaried: s.salariedCost + s.mealPerPersonDay * i.days, mealPerMonth: s.mealPerPersonDay * i.days };
}

/** The picture in words, from the same figures. */
export function analysis(i: ForecastInput, f: Forecast, s: Scenario): string[] {
  const out: string[] = []; const biggest = [...f.lines].sort((a, b) => b.likely - a.likely)[0]; const salaries = f.lines.filter((l) => l.key === "salaried" || l.key === "daily").reduce((t, l) => t + l.likely, 0);
  if (f.likely > 0) { out.push(`Salaries are ${round((salaries / f.likely) * 100)}% of the forecast, so headcount is what moves it most.`); if (biggest && biggest.key !== "salaried" && biggest.key !== "daily") out.push(`${biggest.label} is the largest single line.`); out.push(`That is about ₹${inr(f.likely / i.days)} a day.`); }
  if (i.daily.n) out.push(`One more daily-wage worker costs about ₹${inr(f.perDaily)} a month: ₹${inr(s.dailyCost)} in wages and ₹${inr(f.mealPerMonth)} in meals.`);
  if (i.salaried.n) out.push(`One more salaried person costs about ₹${inr(f.perSalaried)} a month, with meals.`);
  if (i.rooms.beds > 0) out.push(f.spareBeds > 0 ? `${f.spareBeds} spare bed${f.spareBeds === 1 ? "" : "s"}: after that, each new room adds about ₹${inr(s.roomRent)} a month.` : `No spare beds: the next person needs another room, about ₹${inr(s.roomRent)} a month.`);
  const top = i.other.top[0]; if (s.includeOther && top && i.other.total > 0 && top.amount / i.other.total > 0.3) out.push(`₹${inr(top.amount)} of the other costs is ${top.label} in ${new Date(`${top.date}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long" })}. If that will not repeat, lower the other costs: without it they average ₹${inr(i.other.low)} a month.`);
  if (i.windowDays < 21) out.push(`Only ${i.windowDays} days of history so far, so treat the recent-average lines as rough.`);
  if (i.noSalary) out.push(`${i.noSalary} ${i.noSalary === 1 ? "person has" : "people have"} no salary set and ${i.noSalary === 1 ? "is" : "are"} not counted.`);
  return out;
}
