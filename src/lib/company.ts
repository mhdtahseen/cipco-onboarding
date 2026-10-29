// Company details printed on letters and forms. Edit here.
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
  gstin: "27AAOPI1552K2ZG",
  udyam: "UDYAM-MH-26-0770375",
};
/** PAN is characters 3 to 12 of the GSTIN. */
export const COMPANY_PAN = COMPANY.gstin.slice(2, 12);

// Bank account printed on invoices so clients pay the right account. Fill these in: the block is left off the invoice until the account number is set.
export const BANK = { accountName: "", bank: "", branch: "", accountNo: "", ifsc: "" };
