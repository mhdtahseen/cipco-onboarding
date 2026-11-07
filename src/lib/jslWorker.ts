import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

// The robot that raises MRRs on the JSL portal (jsl-worker/, run by GitHub Actions) talks to the app through two routes, /api/jsl-worker/job and /report.
// It has no login: it proves itself with a shared key (JSL_WORKER_KEY, set in the app's hosting settings and in the GitHub repository secrets). Without the key set, nobody is let in.
export function workerAllowed(req: NextRequest): boolean {
  const secret = process.env.JSL_WORKER_KEY || ""; const got = req.headers.get("x-worker-key") || "";
  if (secret.length < 24) return false;   // a short or missing key is as good as none
  const a = Buffer.from(secret), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** What is needed to start the robot from the app. Checked before anything is queued, so a missing setting never leaves a bill waiting. */
export function sendSetupProblem(): string | null {
  if ((process.env.JSL_WORKER_KEY || "").length < 24) return "JSL_WORKER_KEY is not set (24 characters or more) in the app's settings.";
  if (!process.env.GITHUB_DISPATCH_TOKEN) return "GITHUB_DISPATCH_TOKEN is not set in the app's settings.";
  return null;
}
export const githubRepo = () => process.env.GITHUB_REPO || "mhdtahseen/cipco-onboarding";
export const githubRef = () => process.env.GITHUB_REF_NAME || "main";

/** Ask GitHub to start the sender for one bill. Returns an error text, or null when GitHub accepted it. */
export async function startRobot(bill: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${githubRepo()}/actions/workflows/jsl-send.yml/dispatches`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "content-type": "application/json" },
      body: JSON.stringify({ ref: githubRef(), inputs: { bill } }),
    });
    if (r.status === 204) return null;
    return `GitHub refused to start the robot (${r.status}). ${r.status === 401 || r.status === 403 ? "Check the token." : r.status === 404 ? "Check the repository name and that the workflow is on the main branch." : ""}`.trim();
  } catch (e) { return `Could not reach GitHub: ${(e as Error).message}`; }
}
