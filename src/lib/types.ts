import type { AnnexureRow, SalaryCfg } from "./salary";
export type Employee = {
  id: string; emp_no: string | null; full_name: string; father_spouse_name: string | null; father_spouse_type: string | null;
  dob: string | null; gender: string | null; marital_status: string | null; religion: string | null; blood_group: string | null;
  email: string | null; phone: string | null; alt_phone: string | null; permanent_address: string | null; current_address: string | null;
  city: string | null; district: string | null; state: string | null; pin: string | null;
  aadhaar: string | null; pan: string | null; bank_name: string | null; bank_branch: string | null; account_no: string | null; ifsc: string | null;
  uan: string | null; prev_pf_no: string | null;
  nominee_name: string | null; nominee_relation: string | null; nominee_age_dob: string | null; nominee_address: string | null; nominee_phone: string | null;
  emergency_name: string | null; emergency_phone: string | null;
  designation: string | null; department: string | null; project: string | null; project_id?: string | null; site_location: string | null; base_location: string | null;
  employment_type: string | null; join_date: string | null; probation_months: number | null; monthly_ctc: number | null; salary: Partial<SalaryCfg> | null;
  week_off: string | null; status: string | null; notes: string | null;
  call_notes: string | null; interview_notes: string | null;
  stage: string; outcome: "active" | "rejected"; closed_reason: string | null; closed_note: string | null; closed_stage: string | null; closed_at: string | null;
};

export type Clause = {
  id: string; letter_type: "offer" | "appointment"; key: string; title: string; body: string;
  is_core: boolean; default_on: boolean; sort_order: number; active: boolean;
  rules: { designations?: string[]; departments?: string[]; projects?: string[]; employment_types?: string[] } | null;
};
export type Section = { title: string; body: string };
export type MailTemplate = { id: string; key: string; name: string; subject: string; body: string; sort_order: number };
export type LetterRow = {
  id: string; employee_id: string; kind: "offer" | "appointment"; ref_no: string; issued_on: string;
  sections: Section[]; vars: Record<string, string>; with_seal: boolean; created_at: string; annexure: AnnexureSnapshot | null;
};

export const DOC_TYPES: { key: string; label: string }[] = [
  { key: "aadhaar", label: "Aadhaar card" },
  { key: "pan", label: "PAN card" },
  { key: "bank", label: "Bank passbook / cancelled cheque" },
  { key: "uan", label: "UAN / previous PF details" },
  { key: "photo", label: "Passport-size photographs" },
  { key: "form32", label: "Medical Form 32" },
  { key: "form33", label: "Medical Form 33" },
  { key: "pcc", label: "Police Clearance Certificate (PCC)" },
  { key: "offer_signed", label: "Signed offer letter" },
  { key: "joining_signed", label: "Signed joining form" },
  { key: "form11_signed", label: "Signed PF Form 11" },
  { key: "gratuity_signed", label: "Signed Gratuity Form F" },
];

export type AnnexureSnapshot = { rows: AnnexureRow[]; notes: string[]; name: string; designation: string; department: string };

export type Project = { id: string; name: string; location: string; description: string; status: "active" | "closed"; closed_on: string | null; created_at: string };
export type Department = { id: string; name: string; active: boolean };
export type ExpenseCategory = { id: string; name: string; active: boolean; sort_order: number };
export type ProjectExpense = { id: string; project_id: string; category_id: string; expense_date: string; amount: number; description: string; employee_id: string | null; bill_path: string | null; created_at: string; source?: string | null };
export type DocType = { id: string; name: string; active: boolean; sort_order: number };
export type ProjectDocument = { id: string; project_id: string; type_id: string | null; title: string; doc_date: string; recipient: string; ref_no: string; notes: string; file_path: string; file_name: string; created_at: string };
