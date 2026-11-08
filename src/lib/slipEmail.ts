import { COMPANY } from "@/lib/company";

const first = (n: string) => n.trim().split(/\s+/)[0] || n;
const monthLabel = (payMonth: string) => new Date(`${String(payMonth).slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/** The subject and body of one salary-slip email (plain text and simple HTML). */
export function slipEmail(name: string, payMonth: string) {
  const month = monthLabel(payMonth), who = first(name);
  const subject = `Salary slip for ${month} | ${COMPANY.name}`;
  const lines = [
    `Dear ${who},`,
    `Please find attached your salary slip for ${month}.`,
    `This email contains confidential information intended only for you. If you notice any discrepancy, or if you received this by mistake, please contact the office at ${COMPANY.supportEmail}.`,
    `Regards,`,
    `Accounts and Payroll`,
    COMPANY.name,
  ];
  const text = `${lines[0]}\n\n${lines[1]}\n\n${lines[2]}\n\n${lines[3]}\n${lines[4]}\n${lines[5]}\n`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1b2233;line-height:1.5"><p>${esc(lines[0])}</p><p>${esc(lines[1])}</p><p style="color:#4a5470">${esc(lines[2])}</p><p>${esc(lines[3])}<br>${esc(lines[4])}<br><b>${esc(lines[5])}</b></p></div>`;
  const file = `Salary slip ${name.replace(/[^\w ]/g, "").trim()} ${String(payMonth).slice(0, 7)}.pdf`;
  return { subject, text, html, file };
}
