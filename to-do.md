# To-do

Working list for the CIPCO onboarding / operations app. Tick items as they are done.

## Project expenses (agreed 2026-10-25)

Track recurring and one-off costs per project (accommodation, travel, food, and everything else).

**Defaults chosen:** the office enters expenses · bills are optional · project-level costs with an optional employee tag · actuals only (no budgets yet).

### Phase 1 — expenses and cost totals
- [x] `to-do.md` created
- [x] Migration: expense categories (seeded) + project expenses table (`supabase/migrations/2026-10-project-expenses.sql`)
- [x] Expense categories: add / rename / hide (Projects page), plus “+ Add new category…” from the entry form
- [x] Expenses section on each project page: add, edit, delete, optional bill upload, optional employee tag
- [x] Filter by category and month, CSV export
- [x] Project report: expenses by category and by month, estimated salary cost to date, total project cost, cost per head
- [ ] Run the migration in Supabase and try it with a real project
- [ ] Check the project page on a phone

### Phase 2 — recurring expenses
- [ ] Recurring templates (fixed monthly, e.g. rent; per head per day, e.g. food; weekly)
- [ ] “Due this month” list on the project page: confirm the real amount, which creates a normal expense
- [ ] Optional `recurring_id` on expenses so entries show which template they came from

### Phase 3 — budgets and wider reporting
- [ ] Budget per project and category; actual vs budget
- [ ] Link a project to its quotation: quoted value vs actual cost
- [ ] All-projects cost summary screen
- [ ] Decide whether expenses need restricted access (the app has no user roles yet)

### Later, only if needed
- [ ] GST split on expense amounts
- [ ] Attendance-based per-head costs (needs daily attendance data)

## Project documents (agreed 2026-10-27)

Keep letters, Job Safety Analyses, POs, emails etc. against a project for later reference.
Defaults: one file per document · 5 MB per file · search within a project.

- [x] Migration: document types (seeded: Letter, Permission / authorisation letter, JSA, PO, Email, Report, Drawing, Certificate, Contract, Other) + project documents (`supabase/migrations/2026-10-project-documents.sql`)
- [x] Documents section on each project page: add, open, edit, replace file, delete, search, filter by type
- [x] Manage document types on the Projects page, plus “+ Add new type…” from the form
- [x] Project screens simplified: Projects list → project overview (tabs: Overview / People / Expenses / Documents) → separate Report page; dropdown lists moved to Settings
- [ ] Run the migration in Supabase and try it with a real project
- [ ] Check the new project screens on a phone
- [ ] Larger files (drawings / big scans) — needs direct-to-storage upload instead of the 5 MB limit
- [ ] Search across all projects at once
- [ ] Draft letters in the app on company letterhead and save them straight to a project (optional)
- [ ] Link quotations to their project so they appear here automatically

## Pending from earlier work — needs running / deciding
- [ ] Run in Supabase (in this order, each is safe to re-run):
  - `supabase/migrations/2026-10-candidate-form-invites.sql` (self-fill links; re-run to get the 7-day expiry and pre-fill)
  - `supabase/migrations/2026-10-quotations.sql`, then `supabase/seed_man_quotations.sql`
  - `supabase/migrations/2026-10-projects-departments.sql`
  - `supabase/migrations/2026-10-daily-wage-wording.sql`
  - `supabase/migrations/2026-10-project-expenses.sql`
  - `supabase/migrations/2026-10-project-documents.sql`
- [ ] Add the 8 new employees (SQL was given in chat; it is kept out of the repo because it contains Aadhaar / PAN / bank numbers)
- [x] Commit and push projects, departments, daily wage and expenses (done); project documents still to commit
- [ ] Open a real self-fill link on a phone and check the layout
- [ ] Optional: make self-fill links always use `ops.cipcogroup.com` (needs a `NEXT_PUBLIC_APP_URL` setting)

## Ideas not started
- [ ] Mail template / WhatsApp message for sending quotations
- [ ] Quotation revisions (same number + “R1”)
- [ ] Saved clients list for quotations
- [ ] Rate limiting on the public self-fill upload route
