import { calcSalary, PRESETS } from "../src/lib/salary";
const P = (k: string) => PRESETS.find((p) => p.key === k)!.cfg;
const show = (name: string, c: ReturnType<typeof calcSalary>, expect: Record<string, number>) => {
  if (!c) { console.log(name, "null"); return; }
  const m = c.monthly as any; const bad = Object.entries(expect).filter(([k, v]) => m[k] !== v).map(([k, v]) => `${k}: got ${m[k]} expected ${v}`);
  console.log(`${bad.length ? "DIFF" : "OK  "} ${name}  gross ${m.gross} basic ${m.basic} hra ${m.hra} special ${m.special} pf ${m.pf} pt ${m.pt} net ${m.net} erTotal ${m.erTotal} ctc ${m.ctc} annualNet ${c.annual.net} ${bad.length ? "→ " + bad.join("; ") : ""}`, c.warnings.length ? "\n      " + c.warnings.join("\n      ") : "");
};
show("Barad (in-hand 33,000, fixed 15k basic)", calcSalary({ ...P("fixed15"), basis: "inhand", amount: 33000 }, "Male"), { gross: 35000, basic: 15000, hra: 6000, special: 14000, pf: 1800, esi: 0, pt: 200, net: 33000 });
show("Rohitkumar (in-hand 30,000, fixed 15k basic)", calcSalary({ ...P("fixed15"), basis: "inhand", amount: 30000 }, "Male"), { gross: 32000, special: 11000, net: 30000 });
show("Gourhari (in-hand 25,000, 50% of gross)", calcSalary({ ...P("pct_gross"), basis: "inhand", amount: 25000 }, "Male"), { gross: 26809, basic: 13404, hra: 5362, special: 8043, pf: 1609, net: 25000, erTotal: 1743, ctc: 28552 });
show("Sanjivan (CTC 7,00,000/yr, 50% of CTC)", calcSalary({ ...P("pct_ctc"), basis: "ctc", amount: 700000, period: "year" }, "Male"), { basic: 29167, hra: 11667, special: 15509, gross: 56343, net: 54343, erTotal: 1989, ctc: 58333 });
show("CTC 3,00,000/yr, 50% of gross", calcSalary({ ...P("pct_gross"), basis: "ctc", amount: 300000, period: "year" }, "Male"), {});
show("Gross 40,000/month fixed 15k", calcSalary({ ...P("fixed15"), basis: "gross", amount: 40000 }, "Male"), {});
show("In-hand 18,000 (ESI range)", calcSalary({ ...P("pct_gross"), basis: "inhand", amount: 18000 }, "Male"), {});
// Daily wage: ₹800/day × 26 days = 20,800 gross; PF on the ₹15,000 cap = 1,800; ESI 0.75% = 156; PT 200 → net 18,644
show("Daily wage ₹800 × 26 days", calcSalary({ basis: "daily", amount: 800, pf_applicable: true, pf_cap: true, employer_in_ctc: false }, "Male"), { gross: 20800, pf: 1800, esi: 156, pt: 200, net: 18644, ctc: 20800 });
show("Daily wage ₹1,000 × 30 days (weekly off paid), no PF", calcSalary({ basis: "daily", amount: 1000, days_per_month: 30, pf_applicable: false, employer_in_ctc: false }, "Male"), { gross: 30000, pf: 0, esi: 0, pt: 200, net: 29800 });
