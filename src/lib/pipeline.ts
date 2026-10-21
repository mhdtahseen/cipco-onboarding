export const STAGES = [
  { key: "resume", label: "Resume" }, { key: "call", label: "Call" }, { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" }, { key: "appointment", label: "Appointment" }, { key: "forms", label: "Forms" }, { key: "onboarded", label: "Onboarded" },
] as const;
export type StageKey = (typeof STAGES)[number]["key"];
export const stageIndex = (k: string) => STAGES.findIndex((s) => s.key === k);
export const stageLabel = (k: string | null | undefined) => STAGES.find((s) => s.key === k)?.label ?? "—";

export const REJECT_REASONS = [
  "Candidate declined the offer", "Not shortlisted from resume", "Rejected after call", "Rejected after interview",
  "Not reachable / no response", "Salary expectation mismatch", "Other",
];
export const pileOf = (e: { outcome?: string | null; stage?: string | null }): "process" | "onboarded" | "rejected" => e.outcome === "rejected" ? "rejected" : e.stage === "onboarded" ? "onboarded" : "process";
