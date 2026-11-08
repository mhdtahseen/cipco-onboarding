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
  supportEmail: "info@cipcogroup.com",   // where people are sent to reach an admin (the No access page)
  gstin: "27AAOPI1552K2ZG",
  udyam: "UDYAM-MH-26-0770375",
};
/** PAN is characters 3 to 12 of the GSTIN. */
export const COMPANY_PAN = COMPANY.gstin.slice(2, 12);

// The company's own bank account (current account, from the cancelled cheque). Printed on invoices so clients pay the right account, and used as the default account on the
// salary letter to the bank. The branch name is taken from the cheque's address; change it here if the bank calls the branch something else. The block is left off an invoice if accountNo is empty.
export const BANK = { accountName: "Chandrika Industrial Projects Company", bank: "IDBI Bank", branch: "Wanavadi, Pune", accountNo: "65112010000428", ifsc: "IBKL0000651", branchAddress: "Fatima Memory Apartment, Ground Floor, Sr. No. 77, Hissa No. 72, Shivarkar Marg, Wanavadi, Pune - 411040" };
