import { promises as fs } from "fs";
import { buildVars, renderSections } from "../src/lib/clauses";
import { buildLetterPdf } from "../src/lib/pdf/letters";
import { buildKit, fillForm11, fillGratuity, fillJoiningForm } from "../src/lib/pdf/forms";
import type { Clause, Employee } from "../src/lib/types";
import { annexureNotes, annexureRows, calcSalary, PRESETS } from "../src/lib/salary";

const out = process.argv[2];
const e = { id: "x", emp_no: "CIPCO-0107", full_name: "Rahul Sonagara", father_spouse_name: "Mahesh Sonagara", father_spouse_type: "Father", dob: "2001-03-14", gender: "Male",
  marital_status: "Single", religion: "Hindu", blood_group: "B+", email: "rahul@example.com", phone: "9876543210", alt_phone: "9123456780",
  permanent_address: "At Post Mota Varachha, Surat, Gujarat - 394101", current_address: null, city: "Surat", district: "Surat", state: "Gujarat", pin: "394101",
  aadhaar: "983113704791", pan: "HLWPM8742K", bank_name: "State Bank of India", bank_branch: "Varachha", account_no: "285101000011831", ifsc: "SBIN0001234", uan: "101234567890", prev_pf_no: null,
  nominee_name: "Mahesh Sonagara", nominee_relation: "Father", nominee_age_dob: "52 yrs", nominee_address: "At Post Mota Varachha, Surat, Gujarat - 394101", nominee_phone: "9000000001",
  emergency_name: "Mahesh Sonagara", emergency_phone: "9000000001", designation: "Trainee Engineer", department: "Erection Engineering", project: "Mundra", site_location: "Mundra, Gujarat",
  base_location: "Pune, Maharashtra", employment_type: "Trainee", join_date: "2026-10-12", probation_months: 6, monthly_ctc: null, salary: { ...PRESETS[0].cfg, basis: "inhand", amount: 25000 }, week_off: "Sunday", status: "onboarding", notes: null } as Employee;

const mk = (k: string, t: string, b: string, o: number): Clause => ({ id: k, letter_type: "offer", key: k, title: t, body: b, is_core: true, default_on: true, sort_order: o, active: true, rules: {} });
const clauses = [
  mk("a", "Position & Work Location", "- **Designation:** {{designation}}\n- **Department:** {{department}}\n- **Work Location / Site:** {{site_location}}\n- **Head Office / Base Location:** {{base_location}}", 1),
  mk("b", "Date of Joining & Probation", "- **Date of Joining:** {{join_date}}\n- **Probation Period:** You will be on probation for a period of {{probation}} from your date of joining. Upon successful completion of the probation period, your employment will be confirmed in writing.", 2),
  mk("c", "{{comp_heading}}", "Your {{comp_label}} will be **{{comp_figure}} ({{comp_words}})** per month{{comp_suffix}}. {{comp_annexure_ref}}", 3),
  mk("d", "Mandatory PPE & Site Safety", "- **Provision of PPE:** CIPCO will provide all necessary high-grade Personal Protective Equipment (PPE)—including safety helmet, safety boots, high-visibility vest, and safety harness—at zero cost to you.\n- **Mandatory Usage:** Wearing the prescribed PPE at all active erection/project sites at {{site_location}} is strictly mandatory.\n- **Non-Compliance:** Bypassing safety regulations or failing to wear required safety gear will attract strict disciplinary action.", 4),
  mk("e", "Code of Conduct & Confidentiality", "You will be governed by the rules, regulations, and policies of CIPCO as enforced from time to time. You shall maintain strict confidentiality regarding all project blueprints, client data, technical specifications, and business operations of the company.", 5),
  mk("f", "Offer Validity", "This offer of employment is valid for twenty-four (24) hours from the date and time of issue. If written acceptance and a signed copy of this letter are not received within 24 hours, this offer shall automatically lapse.", 6),
];
(async () => {
  const vars = buildVars(e, { annexure: true }); const sections = renderSections(clauses, vars);
  const calc = calcSalary(e.salary as any, e.gender)!; const annexure = { rows: annexureRows(calc), notes: annexureNotes(calc, true), name: e.full_name, designation: e.designation!, department: e.department! };
  await fs.writeFile(out + "/offer.pdf", await buildLetterPdf({ kind: "offer", sections, vars, refNo: "CIPCO/HR/OL/2026/0001", issuedOn: "2026-10-21", withSeal: true, annexure }));
  const e2 = { ...e, full_name: "Sanjivan Kumar Baitha", designation: "Site Engineer", salary: { ...PRESETS[2].cfg, basis: "ctc", amount: 700000, period: "year" } } as Employee;
  const v2 = buildVars(e2, { annexure: true }); const c2 = calcSalary(e2.salary as any, "Male")!;
  await fs.writeFile(out + "/offer_ctc.pdf", await buildLetterPdf({ kind: "offer", sections: renderSections(clauses, v2), vars: v2, refNo: "CIPCO/HR/OL/2026/0002", issuedOn: "2026-10-21", withSeal: true, annexure: { rows: annexureRows(c2), notes: annexureNotes(c2, true), name: e2.full_name, designation: "Site Engineer", department: "Erection Engineering" } }));
  const vS = buildVars(e, { annexure: false, accept_mode: "signed" }); const vE = buildVars(e, { annexure: false, accept_mode: "email" });
  const valid = mk("v", "Offer Validity", "This offer of employment is valid for twenty-four (24) hours from the date and time of issue. If {{acceptance_condition}} within 24 hours, this offer shall automatically lapse, become null and void.", 9);
  const secsE = renderSections([...clauses.slice(0, 3), valid], vE), secsS = renderSections([...clauses.slice(0, 3), valid], vS);
  await fs.writeFile(out + "/offer_email.pdf", await buildLetterPdf({ kind: "offer", sections: secsE, vars: vE, refNo: "CIPCO/HR/OL/2026/0003", issuedOn: "2026-10-21", withSeal: true }));
  await fs.writeFile(out + "/offer_signed.pdf", await buildLetterPdf({ kind: "offer", sections: secsS, vars: vS, refNo: "CIPCO/HR/OL/2026/0004", issuedOn: "2026-10-21", withSeal: true }));
  const accE = mk("acc", "Acceptance of Offer", "To confirm your acceptance of this offer and the terms outlined above, {{appt_accept_instruction}} We look forward to a mutually rewarding association.", 7);
  await fs.writeFile(out + "/appt_email.pdf", await buildLetterPdf({ kind: "appointment", sections: [...renderSections(clauses.slice(0, 3), vE), ...renderSections([accE], vE)], vars: vE, refNo: "CIPCO/HR/APPT/2026/0002", issuedOn: "2026-10-21", withSeal: true }));
  await fs.writeFile(out + "/appt_signed.pdf", await buildLetterPdf({ kind: "appointment", sections: [...renderSections(clauses.slice(0, 3), vS), ...renderSections([accE], vS)], vars: vS, refNo: "CIPCO/HR/APPT/2026/0003", issuedOn: "2026-10-21", withSeal: true }));
  await fs.writeFile(out + "/appt.pdf", await buildLetterPdf({ kind: "appointment", sections: sections.slice(0, 3), vars, refNo: "CIPCO/HR/APPT/2026/0001", issuedOn: "2026-10-21", withSeal: true }));
  await fs.writeFile(out + "/joining.pdf", await fillJoiningForm(e, true));
  await fs.writeFile(out + "/form11.pdf", await fillForm11(e, true));
  await fs.writeFile(out + "/gratuity.pdf", await fillGratuity(e, true));
  await fs.writeFile(out + "/kit.pdf", await buildKit(e, true));
  console.log("ok");
})().catch((x) => { console.error(x); process.exit(1); });
