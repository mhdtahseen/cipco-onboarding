import { promises as fs } from "fs";
import { buildImportExcel } from "../src/lib/excel";
(async () => {
  const e: any = { emp_no: "CIPCO-0107", full_name: "Rahul Sonagara", father_spouse_name: "Mahesh Sonagara", dob: "2001-03-14", gender: "Male", marital_status: "Single", phone: "9876543210",
    permanent_address: "Mota Varachha", city: "Surat", state: "Gujarat", pin: "394101", aadhaar: "983113704791", pan: "HLWPM8742K", bank_name: "SBI", account_no: "285101000011831", ifsc: "SBIN0001234",
    join_date: "2026-10-12", week_off: "Sunday", designation: "Trainee Engineer", department: "Erection Engineering", nominee_name: "Mahesh", nominee_relation: "Father", nominee_phone: "9000000001", emergency_phone: "9000000001" };
  await fs.writeFile(process.argv[2], await buildImportExcel([e, { ...e, full_name: "Second Person" }]));
})();
