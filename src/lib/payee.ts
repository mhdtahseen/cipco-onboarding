// Where a person's salary actually goes. Normally their own bank account; if their record says "pay into another employee's account" (a brother, for example),
// that employee's account. Used by the Pay tab, the bank transfer CSV, the bank letter and the Payments due report.
export type EmpBank = { id: string; full_name: string; bank_name?: string | null; bank_branch?: string | null; account_no?: string | null; ifsc?: string | null; pay_to_employee_id?: string | null };
export type BankAcct = { holder: string; bank: string; branch: string; account: string; ifsc: string; via: string | null };

/** `snap` is the saved payroll line's snapshot (the bank details as they were when the payroll was calculated); the live record fills anything it lacks. */
export function bankFor(employeeId: string, snap: Record<string, any> | null | undefined, emps: EmpBank[]): BankAcct {
  const e = emps.find((x) => x.id === employeeId); const t = e?.pay_to_employee_id ? emps.find((x) => x.id === e.pay_to_employee_id) : undefined;
  if (t) return { holder: t.full_name, bank: t.bank_name || "", branch: t.bank_branch || "", account: (t.account_no || "").replace(/\s/g, ""), ifsc: (t.ifsc || "").toUpperCase(), via: t.full_name };
  return { holder: String(snap?.name ?? e?.full_name ?? ""), bank: String(snap?.bank_name ?? e?.bank_name ?? ""), branch: String(e?.bank_branch ?? ""), account: String(snap?.account_no ?? e?.account_no ?? "").replace(/\s/g, ""), ifsc: String(snap?.ifsc ?? e?.ifsc ?? "").toUpperCase(), via: null };
}
