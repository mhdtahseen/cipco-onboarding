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

## Roles and attendance (agreed 2026-10-27)

Supervisor sees only the Attendance page for their assigned project(s). Work (present / absent / half-day, weekly off automatic) plus breakfast / lunch / dinner with a vendor each (Maruti, Plant Mess). Meal prices optional. A day locks at 11:00 PM India time; only an Admin can change it after that. Site has stable internet (no offline mode).

- [x] Migration: roles (admin / staff / attendance), assigned projects, all existing tables locked to staff, food vendors + meal prices, attendance table with the 11 PM lock enforced in the database (`supabase/migrations/2026-10-roles-attendance.sql`)
- [x] Route guard (middleware) + role-aware menu; supervisors can't reach anything else, including the API
- [x] Users page (admin): set role, assign projects to supervisors
- [x] Daily sheet (tap to save, Everyone present, Copy yesterday's meals, set everyone's meal) and Monthly grid with days worked, meal counts and cost per vendor, CSV export
- [x] Settings → Food vendors: vendors and meal prices (with an “applies from” date)
- [x] Attendance on wide screens: compact roster table + one toolbar (cards stay for phones and tablets)
- [ ] Run the migration, then check you can still sign in and see everything (you become Admin automatically)
- [ ] Create the supervisor's login in Supabase (Authentication → Add user), give them the Supervisor role and a project on the Users page, and try it from their account
- [ ] Try it on a phone at the site
- [ ] Overtime hours, leave types, late arrival (not built; say if needed)
- [ ] Post monthly meal cost into project Food expenses (confirm-and-post)
- [ ] Use actual days worked (not 26) for daily-wage cost and pay
- [ ] Attendance tab on the project page and headcount per day on the project report

## Accountability, transport and sign-off (agreed 2026-10-27)

Roles are now Admin, Site Engineer (sees attendance only) and Supervisor. Every attendance / transport change is stamped with who and when (server time) and written to an append-only log. A Supervisor's entry can be overridden by the Site Engineer (stamped, no reason needed); the Supervisor edits the same day until 11 PM, the Site Engineer that day plus the next, Admin always.

- [x] Migration `supabase/migrations/2026-10-attendance-accountability-transport.sql` (run AFTER `2026-10-roles-attendance.sql`): role rename, names on logins, rank-protected entries, activity log, day sign-off, transport vehicles / trips / passengers / payments, money visible to Admin only
- [x] Daily sheet: "who · time" on every row, Transport card (Pickup / Drop trips with people on board), day bar (Supervisor submits, Site Engineer verifies, reopen) with a review list
- [x] Activity tab (Admin / Site Engineer), Sites today page, Transport page (vehicles, price per trip, payments, balance due)
- [ ] Run the migration in Supabase, then give each person a name and role on the Users page
- [ ] Add vehicles and trip prices on the Transport page
- [ ] Try the Supervisor and Site Engineer logins on a phone at the site
- [x] Update docs/ROLES_AND_ATTENDANCE.md (repo copy)
- [ ] Update the online Claude Doc to match (still shows the old three-role version)

## Platform roadmap — payroll, invoices, inventory (agreed 2026-10-27)

The app is growing from onboarding into an operations platform. Do these in order; each step makes the next one cheaper.

### Step 1 — Navigation that scales
- [x] One list of pages (`src/lib/nav.ts`) drives the sidebar, the phone bar, the slide-out menu **and** the route guard. Adding a module = adding one entry there.
- [x] Desktop (≥1280px): sidebar with section headings, collapsible to an icon rail (remembered). Tablet (768–1279px): permanent icon rail, its menu button opens the labelled menu. Phone (<768px): top bar, bottom bar (4 main pages + More) and a slide-out menu with Sign out.
- [x] Single-purpose logins (supervisor) get no sidebar or bottom bar, just the top bar. Pages that pin a bar to the bottom (employee form, quotation editor, attendance) sit above the phone bar.
- [x] Tested in real Chrome at 1440, 1280, 1180, 1024, 820, 768, 390, 360 and 320px for Admin, Staff, supervisor and no-role logins.
- [ ] Check it on a real phone and tablet (Safari and Chrome)

### Step 2 — Permission-based roles (before payroll or invoices touch sensitive data)
- [ ] Replace the three fixed roles with roles built from permissions per module (e.g. `payroll.view`, `invoices.edit`, `inventory.issue`); `nav.ts` and the database rules read the same permission list
- [ ] Starter roles: Admin, HR, Accounts / Finance, Site engineer, Storekeeper, Supervisor
- [ ] Staff limited to particular projects
- [ ] Block demoting the last Admin; two-step sign-in for Admins
- [ ] Hide meal prices and cost totals from supervisors
- [ ] Add users from the Users page (needs the Supabase service key on the server only) with proper invitation, set-password, reset-password and change-password pages

### Step 3 — Shared “parties” list
- [ ] One list of customers, suppliers and vendors (food vendors included) with GST / PAN / address / contacts, used by quotations, invoices, inventory and expenses (today clients are typed freely on each quotation)

### Step 4 — The new modules
- [ ] **Payroll** (People): monthly salary run from attendance days + salary structure + daily-wage rates; payslips; advances and deductions; lock and approve a month; change history
- [ ] **Invoices** (Sales): convert an accepted quotation into an invoice; GST; numbering series; immutable once issued; payment status and receipts
- [ ] **Inventory** (Operations): items and units, stock in and out with who / when / project, issue to a project, suppliers, low-stock alerts, stock report
- [ ] Add each module's entry to `src/lib/nav.ts` (the placeholder comment lists where they go)

### Across all modules
- [ ] Each module owns its settings (inventory units, invoice terms, payroll components); keep the central Settings for company-wide items (company details, letterhead, numbering series, users)
- [ ] Change history (audit log) on attendance, payroll and invoices
- [ ] Global search / jump box (⌘K) in the top bar
- [ ] Breadcrumbs with real names (Projects › MAN Unit 2), module landing pages
- [ ] Small count badges in the menu (e.g. people still unmarked on Attendance)

## Pending from earlier work — needs running / deciding
- [ ] Run in Supabase (in this order, each is safe to re-run):
  - `supabase/migrations/2026-10-candidate-form-invites.sql` (self-fill links; re-run to get the 7-day expiry and pre-fill)
  - `supabase/migrations/2026-10-quotations.sql`, then `supabase/seed_man_quotations.sql`
  - `supabase/migrations/2026-10-projects-departments.sql`
  - `supabase/migrations/2026-10-daily-wage-wording.sql`
  - `supabase/migrations/2026-10-project-expenses.sql`
  - `supabase/migrations/2026-10-project-documents.sql`
  - `supabase/migrations/2026-10-roles-attendance.sql` (last — it locks the tables above to staff)
- [ ] Add the 8 new employees (SQL was given in chat; it is kept out of the repo because it contains Aadhaar / PAN / bank numbers)
- [x] Commit and push projects, departments, daily wage and expenses (done); project documents still to commit
- [ ] Open a real self-fill link on a phone and check the layout
- [ ] Optional: make self-fill links always use `ops.cipcogroup.com` (needs a `NEXT_PUBLIC_APP_URL` setting)

## Ideas not started
- [ ] Mail template / WhatsApp message for sending quotations
- [ ] Quotation revisions (same number + “R1”)
- [ ] Saved clients list for quotations
- [ ] Rate limiting on the public self-fill upload route
