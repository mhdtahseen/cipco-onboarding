import { COMPANY } from "./company";
export const LETTER = {
  offer: {
    subject: (v: Record<string, string>) => `Subject: Offer of Employment at ${COMPANY.short}`,
    intro: (v: Record<string, string>) =>
      `With reference to your application and subsequent interviews with ${COMPANY.name} (${COMPANY.short}), we are pleased to offer you the position of ${v.designation}${v.department ? ` in the ${v.department} Department` : ""}, under the terms and conditions outlined below:`,
    closingTitle: "Acceptance of Offer",
    closingText: (v: Record<string, string>): string[] => v.accept_mode === "signed" ? [
      "Please sign and return the duplicate copy of this letter as a token of your acceptance of this offer and confirm your date of joining.",
      `We welcome you to the ${COMPANY.short} team and look forward to a mutually beneficial association.`,
    ] : [
      "This offer letter has been sent to you as a confidential email. To accept, please reply to the same email thread with the following confirmation:",
      `**“I, ${v.full_name}, accept the offer of employment on the terms and conditions stated above, and I confirm that I will join duty on ${v.join_date}.”**`,
      "Your reply on the same email thread will be treated as your written acceptance of this offer. A signed copy is not required.",
      `We welcome you to the ${COMPANY.short} team and look forward to a mutually beneficial association.`,
    ],
    declaration: (v: Record<string, string>): string | null => v.accept_mode === "signed"
      ? `I, ${v.full_name}, hereby accept the offer of employment on the terms and conditions stated above. I confirm that I will join duty on ${v.join_date}.` : null,
  },
  appointment: {
    subject: (v: Record<string, string>) => `Subject: Appointment Letter for the position of ${v.designation}`,
    intro: (v: Record<string, string>) =>
      `We are thrilled to welcome you to ${COMPANY.short}. Following our recent discussions, we are pleased to offer you formal employment as a ${v.designation} on the following terms and conditions:`,
    closingTitle: "",
    closingText: (_v: Record<string, string>): string[] => [],
    declaration: (v: Record<string, string>): string | null => v.accept_mode === "signed"
      ? `I, ${v.full_name}, hereby accept this appointment on the terms and conditions stated above and confirm that I will join duty on ${v.join_date}.` : null,
  },
};
