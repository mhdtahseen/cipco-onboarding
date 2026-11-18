// Company details printed on letters, invoices and forms.
// The values below are the defaults. An Admin can change any of them on the Company page (profile menu → Company, 2026-11-company-profile.sql); the saved
// changes are laid over these objects on the server before a PDF or an email is made (companyServer.ts) and in the browser once the app has loaded
// (useCompany.ts), so every place that reads COMPANY or BANK prints the current details. Nothing changes until a detail is saved there.
export const COMPANY = {
  name: "Chandrika Industrial Projects Company",
  short: "CIPCO",
  headline1: "Chandrika",
  headline2: "Industrial Projects Company",
  line1: "Office Address : RH 25, Memory Garden Pune - 411048",
  line2: "Phone : +91 98504 95483 | +91 9028747249 | Email : info@cipcogroup.com",
  line3: "GST : 27AAOPI1552K2ZG | Udhyam : UDYAM-MH-26-0770375",
  quoteLine3: "GST : 27AAOPI1552K2ZG", // quotations carry no Udhyam number
  quoteSignatory: "S.A. Inamdar.",
  addressOneLine: "Chandrika Industrial Projects Company, RH 25, Memory Garden, Pune - 411048",
  signatoryLabel: "(Authorised Signatory)",
  signatoryDept: "Human Resources Department",
  signatoryDesignation: "Authorised Signatory",
  city: "Pune",
  supportEmail: "info@cipcogroup.com",
  contractorMobile: "9028747249",   // contractor's mobile on the police verification (PCC) form
  contractorLicense: "UDYAM-MH-26-0770375",   // contractor registration on the PCC form: the Udyam number in its official format
  gstin: "27AAOPI1552K2ZG",
  udyam: "UDYAM-MH-26-0770375",
  pan: "",   // empty = characters 3 to 12 of the GSTIN (companyPan)
};
/** The company's PAN: the one saved on the Company page, else characters 3 to 12 of the GSTIN. */
export const companyPan = () => COMPANY.pan || COMPANY.gstin.slice(2, 12);

// The company's own bank account (current account, from the cancelled cheque). Printed on invoices so clients pay the right account, and used as the default account on the
// salary letter to the bank. The branch name is taken from the cheque's address. The block is left off an invoice if accountNo is empty.
export const BANK = { accountName: "Chandrika Industrial Projects Company", bank: "IDBI Bank", branch: "Wanavadi, Pune", accountNo: "65112010000428", ifsc: "IBKL0000651", branchAddress: "Fatima Memory Apartment, Ground Floor, Sr. No. 77, Hissa No. 72, Shivarkar Marg, Wanavadi, Pune - 411040" };

// ---------- the details an Admin can change on the Company page ----------
// Each field: its default (what prints today), where it appears ("used on"), and whether it is only kept for copying (not printed anywhere yet).
export type CompanyField = { key: string; label: string; group: string; def: string; usedOn: string; secret?: boolean; wide?: boolean; hint?: string };
export const COMPANY_GROUPS = ["Company", "Registrations", "Bank account", "Signatory", "Proprietor"] as const;
export const COMPANY_FIELDS: CompanyField[] = [
  { key: "name", label: "Company name", group: "Company", def: COMPANY.name, wide: true, usedOn: "Every PDF the app makes (letters, invoices, quotations, payslips, forms, statements, challans), payslip and letter emails, Excel exports, contract clauses" },
  { key: "short", label: "Short name", group: "Company", def: COMPANY.short, usedOn: "Letter reference numbers, email subjects, contract clauses" },
  { key: "address", label: "Office address (letterhead)", group: "Company", def: "RH 25, Memory Garden Pune - 411048", wide: true, usedOn: "Letterhead of letters, invoices, payslips, salary slip screen, gas orders, payroll register, payments due, vendor statements" },
  { key: "formAddress", label: "Address on government forms", group: "Company", def: "RH 25, Memory Garden, Pune - 411048", wide: true, usedOn: "Gratuity Form F and the police verification form (after the company name)" },
  { key: "city", label: "City", group: "Company", def: COMPANY.city, usedOn: "Gratuity Form F (place)" },
  { key: "phones", label: "Phone numbers", group: "Company", def: "+91 98504 95483 | +91 9028747249", usedOn: "Letterhead" },
  { key: "email", label: "Email", group: "Company", def: COMPANY.supportEmail, usedOn: "Letterhead, the No access page, the private letter and salary-slip pages, payslip emails" },
  { key: "contractorMobile", label: "Contractor mobile", group: "Company", def: COMPANY.contractorMobile, usedOn: "Police verification form" },
  { key: "gstin", label: "GSTIN", group: "Registrations", def: COMPANY.gstin, usedOn: "Letterhead, invoices, quotations, tool challans" },
  { key: "pan", label: "PAN", group: "Registrations", def: "", hint: "Left empty, it is taken from the GSTIN", usedOn: "Invoices, tool challans" },
  { key: "udyam", label: "Udyam number", group: "Registrations", def: COMPANY.udyam, usedOn: "Letterhead, invoices, police verification form (contractor licence)" },
  { key: "ptrc", label: "Professional tax (PTRC) no.", group: "Registrations", def: "", usedOn: "" },
  { key: "epfo", label: "EPFO establishment code", group: "Registrations", def: "", usedOn: "" },
  { key: "esic", label: "ESIC employer code", group: "Registrations", def: "", usedOn: "" },
  { key: "accountName", label: "Account name", group: "Bank account", def: BANK.accountName, wide: true, usedOn: "Invoices (pay to), invoice screen, payroll bank letter" },
  { key: "bank", label: "Bank", group: "Bank account", def: BANK.bank, usedOn: "Invoices, payroll bank letter" },
  { key: "branch", label: "Branch", group: "Bank account", def: BANK.branch, usedOn: "Invoices, payroll bank letter" },
  { key: "accountNo", label: "Account number", group: "Bank account", def: BANK.accountNo, usedOn: "Invoices, invoice screen, payroll bank letter" },
  { key: "ifsc", label: "IFSC", group: "Bank account", def: BANK.ifsc, usedOn: "Invoices, payroll bank letter" },
  { key: "branchAddress", label: "Branch address", group: "Bank account", def: BANK.branchAddress, wide: true, usedOn: "Payroll bank letter (addressed to the branch)" },
  { key: "signatoryLabel", label: "Signatory line", group: "Signatory", def: COMPANY.signatoryLabel, usedOn: "Letters, exit letters, invoices (under the seal and signature)" },
  { key: "signatoryDept", label: "Signing department", group: "Signatory", def: COMPANY.signatoryDept, usedOn: "Letters, exit letters" },
  { key: "quoteSignatory", label: "Name signing quotations", group: "Signatory", def: COMPANY.quoteSignatory, usedOn: "Quotations" },
  { key: "proprietor", label: "Proprietor's name", group: "Proprietor", def: "", wide: true, usedOn: "" },
  { key: "proprietorAadhaar", label: "Proprietor's Aadhaar", group: "Proprietor", def: "", secret: true, usedOn: "" },
];
export type CompanyData = Record<string, string>;
export const fieldValue = (data: CompanyData, f: CompanyField) => (data[f.key] ?? "").trim() || f.def;

/** Lays saved details over COMPANY and BANK. The composed lines (letterhead) are rebuilt from their parts, so they read exactly as today until a part is changed. */
export function applyCompanyData(data: CompanyData) {
  const v = (k: string) => { const f = COMPANY_FIELDS.find((x) => x.key === k)!; return fieldValue(data, f); };
  const name = v("name"), sp = name.indexOf(" ");
  Object.assign(COMPANY, {
    name, short: v("short"),
    headline1: sp > 0 ? name.slice(0, sp) : name, headline2: sp > 0 ? name.slice(sp + 1) : "",
    line1: `Office Address : ${v("address")}`, line2: `Phone : ${v("phones")} | Email : ${v("email")}`,
    line3: `GST : ${v("gstin")} | Udhyam : ${v("udyam")}`, quoteLine3: `GST : ${v("gstin")}`,
    quoteSignatory: v("quoteSignatory"), addressOneLine: `${name}, ${v("formAddress")}`,
    signatoryLabel: v("signatoryLabel"), signatoryDept: v("signatoryDept"), city: v("city"),
    supportEmail: v("email"), contractorMobile: v("contractorMobile"), contractorLicense: v("udyam"),
    gstin: v("gstin"), udyam: v("udyam"), pan: (data.pan ?? "").trim(),
  });
  Object.assign(BANK, { accountName: v("accountName"), bank: v("bank"), branch: v("branch"), accountNo: v("accountNo"), ifsc: v("ifsc"), branchAddress: v("branchAddress") });
}
/** The details anyone signed in may see (the letterhead and bank block that print on documents anyway): never the proprietor's Aadhaar. */
export const publicCompanyData = (data: CompanyData): CompanyData => Object.fromEntries(Object.entries(data).filter(([k]) => !COMPANY_FIELDS.find((f) => f.key === k)?.secret && k !== "proprietor"));
