# CIPCO Employee Onboarding

Next.js 15 + Supabase. Enter an employee once → generate the offer letter, appointment letter, joining form,
PF Form 11 and Gratuity Form F (with seal & signature), track the document checklist, draft the e-mails and export the
attendance-system import Excel.

## 1. Create the Supabase project (free tier)
1. supabase.com → **New project** (any name, choose the Mumbai/Singapore region, set a DB password) and wait ~2 min.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
3. New query → paste all of `supabase/seed.sql` → **Run** (sample clauses + mail templates; safe to re-run).
   *Already ran an earlier version of the schema/seed?* Instead run `supabase/migration_002_salary_and_clauses.sql` once (adds the salary columns, makes every clause optional, adds the leave and notice clauses), and then `supabase/migration_003_acceptance_mode.sql` (acceptance by email reply).
4. **Authentication → Users → Add user → Create new user** — your e-mail + password (tick *Auto confirm*).
5. **Authentication → Sign In / Providers → Email** → switch **off** “Allow new users to sign up” (so only you can log in).
6. **Project Settings → API** → copy the **Project URL** and the **anon / publishable key**.

## 2. Run the app
```bash
cp .env.local.example .env.local      # paste the URL and key from step 6
npm install
npm run dev                           # http://localhost:3000
```

## 3. Go live (Vercel, free)
Push to GitHub → vercel.com → Import → add the same two env vars → Deploy.
Supabase → Authentication → URL Configuration → add your Vercel URL as the Site URL.

## 4. Replace the placeholder seal & signature
Overwrite `public/branding/seal.png` and `public/branding/signature.png` with transparent PNGs. Nothing else to change.
Company details on letters live in `src/lib/company.ts`; the letter logo is `assets/logo.png`.

## Salary (CTC / in-hand / gross)
On the employee’s Details tab choose what you fix — **CTC**, **net in-hand** or **gross** — and the structure (basic fixed ₹ or % of gross / CTC, HRA %, PF cap, whether CTC includes employer PF/ESI). The app works out the rest (PF 12%, ESI when gross ≤ ₹21,000, Maharashtra PT, special allowance as the balancing figure) and prints it as **Annexure A**. Logic: `src/lib/salary.ts`; check it with `npx tsx scripts/test-salary.ts`.

## Acceptance: email reply or signed copy
On the Letters tab choose how the employee accepts. **Default: reply on the confidential Gmail thread** (the letter gives them a confirmation sentence to reply with, no signature block). Or **sign and return a copy** (prints the Declaration & Acceptance block). The Offer Validity clause, the closing page, the appointment letter’s acceptance clause and the offer mail template follow the choice. The Annexure A (salary break-up) is optional on both letters.

## Editing letter wording
Every clause is optional. In the Letters tab tick what you want, press **Edit wording** on any section to change it for that letter only, add extra sections, and use **Preview PDF** before issuing.

## Documentation
`docs/SALARY_STRUCTURE.md` explains exactly how salary is calculated and how to change it.

## Where things are
| What | File |
|---|---|
| Offer / appointment letter layout | `src/lib/pdf/letters.ts`, intro/closing wording in `src/lib/letterConfig.ts` |
| Joining form / Form 11 / Form F text positions | `src/lib/pdf/forms.ts` (blank PDFs in `assets/templates/`) |
| Clauses (editable in-app) | Clause library page, seeded from `supabase/seed.sql` |
| Excel import export | `src/lib/excel.ts` |
| Fields on the employee form | `src/lib/fields.ts` |

Test the PDFs without Supabase: `npx tsx scripts/smoke.ts /some/output/folder`
# cipco-onboarding
