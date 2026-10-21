export type FieldDef = { key: string; label: string; type?: "text" | "date" | "number" | "select" | "textarea"; options?: string[]; wide?: boolean; hint?: string };
export const FIELD_GROUPS: { title: string; fields: FieldDef[] }[] = [
  { title: "Employment", fields: [
    { key: "full_name", label: "Full name (as in Aadhaar)" }, { key: "emp_no", label: "Employee no." },
    { key: "designation", label: "Designation / role" }, { key: "department", label: "Department" },
    { key: "project", label: "Project" }, { key: "site_location", label: "Work location / site" },
    { key: "base_location", label: "Base location" },
    { key: "employment_type", label: "Employment type", type: "select", options: ["Employee", "Trainee", "Contract", "Intern"] },
    { key: "join_date", label: "Date of joining", type: "date" }, { key: "probation_months", label: "Probation (months)", type: "number" },
    { key: "week_off", label: "Weekly off", type: "select", options: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] },
  ] },
  { title: "Personal & family", fields: [
    { key: "father_spouse_name", label: "Father's / spouse's name" }, { key: "father_spouse_type", label: "Relation", type: "select", options: ["Father", "Spouse"] },
    { key: "dob", label: "Date of birth", type: "date" }, { key: "gender", label: "Gender", type: "select", options: ["Male", "Female", "Other"] },
    { key: "marital_status", label: "Marital status", type: "select", options: ["Single", "Married", "Widow", "Widower", "Divorced"] },
    { key: "religion", label: "Religion" }, { key: "blood_group", label: "Blood group" },
    { key: "email", label: "Email" }, { key: "phone", label: "Contact number" }, { key: "alt_phone", label: "Alt number" },
  ] },
  { title: "Address", fields: [
    { key: "permanent_address", label: "Permanent address", type: "textarea", wide: true },
    { key: "current_address", label: "Current / local address (blank = same)", type: "textarea", wide: true },
    { key: "city", label: "City" }, { key: "district", label: "District" }, { key: "state", label: "State" }, { key: "pin", label: "PIN" },
  ] },
  { title: "Statutory & bank", fields: [
    { key: "aadhaar", label: "Aadhaar number" }, { key: "pan", label: "PAN" }, { key: "bank_name", label: "Bank name" }, { key: "bank_branch", label: "Branch" },
    { key: "account_no", label: "Account number" }, { key: "ifsc", label: "IFSC" }, { key: "uan", label: "UAN (if any)" }, { key: "prev_pf_no", label: "Previous PF a/c no. (if any)" },
  ] },
  { title: "Nominee & emergency contact", fields: [
    { key: "nominee_name", label: "Nominee full name" }, { key: "nominee_relation", label: "Relationship" }, { key: "nominee_age_dob", label: "Nominee age / DOB" },
    { key: "nominee_phone", label: "Nominee phone" }, { key: "nominee_address", label: "Nominee address", type: "textarea", wide: true },
    { key: "emergency_name", label: "Emergency contact person" }, { key: "emergency_phone", label: "Emergency phone" },
  ] },
];
export const EMPTY: Record<string, any> = { father_spouse_type: "Father", base_location: "Pune, Maharashtra", employment_type: "Employee", probation_months: 6, week_off: "Sunday", status: "onboarding" };

export function validate(e: Record<string, any>): Record<string, string> {
  const w: Record<string, string> = {};
  const a = (e.aadhaar || "").replace(/\s/g, ""); if (a && !/^\d{12}$/.test(a)) w.aadhaar = "Aadhaar should be 12 digits";
  if (e.pan && !/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(e.pan)) w.pan = "PAN format looks wrong (ABCDE1234F)";
  if (e.ifsc && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(e.ifsc)) w.ifsc = "IFSC format looks wrong";
  if (e.uan && !/^\d{12}$/.test(e.uan.replace(/\s/g, ""))) w.uan = "UAN should be 12 digits";
  if (e.phone && !/^\d{10}$/.test(e.phone.replace(/\s/g, ""))) w.phone = "Phone should be 10 digits";
  if (e.pin && !/^\d{6}$/.test(e.pin)) w.pin = "PIN should be 6 digits";
  return w;
}
