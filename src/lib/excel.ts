import ExcelJS from "exceljs";
import { COMPANY } from "./company";
import type { Employee } from "./types";
import { readAsset } from "./pdf/common";

const d = (s?: string | null) => { if (!s) return null; const [y, m, dd] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)); };

/** Fills your existing ImportEmployee template (attendance system import) from employee records. */
export async function buildImportExcel(emps: Employee[]): Promise<Buffer> {
  // Rebuilt from the layout of your ImportEmployee template (same sheet name, same 53 columns, same DataOptions lists).
  const tpl = JSON.parse((await readAsset("templates", "import_employee.json")).toString("utf8")) as { sheetName: string; headers: string[]; options: (string | null)[][] };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(tpl.sheetName);
  const opt = wb.addWorksheet("DataOptions");
  tpl.options.forEach((r) => opt.addRow(r));
  opt.getRow(1).font = { bold: true };
  ws.addRow(tpl.headers);
  ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDE6F5" } };
  ws.columns = tpl.headers.map((h) => ({ width: Math.max(12, h.length + 4) }));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const headers: Record<string, number> = {};
  tpl.headers.forEach((h, i) => (headers[h] = i + 1));
  emps.forEach((e, idx) => {
    const m: Record<string, any> = {
      EmployeeNo: e.emp_no, EmployeeName: e.full_name, FatherName: e.father_spouse_name, Company: COMPANY.name, Department: e.department,
      Designation: e.designation, Address: e.permanent_address, City: e.city || e.district, Pin: e.pin, PhoneNo: e.phone,
      JoinDate: d(e.join_date), BirthDate: d(e.dob), WeekOff1: e.week_off, Gender: e.gender, MaritalStatus: e.marital_status,
      AadhaarNo: e.aadhaar, state: e.state, BloodGrp: e.blood_group, NormineeName: e.nominee_name, NormineeRelation: e.nominee_relation,
      NormineePhone: e.nominee_phone, Emergencycontract: e.emergency_phone, NormineeAddress: e.nominee_address, Contractor: COMPANY.name,
      BnkAcctNo: e.account_no, BnkName: e.bank_name, IFSCCode: e.ifsc, PFNo: e.uan, PANNo: e.pan,
    };
    const row = ws.getRow(2 + idx);
    for (const [k, v] of Object.entries(m)) if (headers[k] && v != null && v !== "") row.getCell(headers[k]).value = v;
    ["AadhaarNo", "PhoneNo", "BnkAcctNo", "Pin", "NormineePhone", "Emergencycontract"].forEach((k) => { if (headers[k]) row.getCell(headers[k]).numFmt = "@"; });
    row.commit();
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
