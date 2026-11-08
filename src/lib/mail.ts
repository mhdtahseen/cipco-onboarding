import nodemailer from "nodemailer";

// Outgoing mail through the company's own mailbox (Hostinger SMTP). Server only. The password lives in the hosting settings, never in the code.
//   MAIL_USER / MAIL_PASSWORD    the mailbox login (payroll@cipcogroup.com)
//   MAIL_HOST (smtp.hostinger.com), MAIL_PORT (465, SSL)    optional
//   MAIL_FROM_NAME (Chandrika Industrial Projects Company)  optional display name
//   MAIL_BCC                     optional, defaults to the mailbox itself so a copy of every email is kept
export const mailConfigured = () => !!process.env.MAIL_USER && !!process.env.MAIL_PASSWORD;

export function mailTransport() {
  const port = Number(process.env.MAIL_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || "smtp.hostinger.com", port, secure: port === 465,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
}
export const mailFrom = () => `"${process.env.MAIL_FROM_NAME || "Chandrika Industrial Projects Company"}" <${process.env.MAIL_USER}>`;
export const mailBcc = () => process.env.MAIL_BCC || process.env.MAIL_USER;
export const validEmail = (s: string | null | undefined) => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
