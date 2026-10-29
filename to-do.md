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
- [x] Post meal payments into project Food expenses (done as automatic posting of each payment)
- [ ] Use actual days worked (not 26) for daily-wage cost and pay
- [ ] Attendance tab on the project page and headcount per day on the project report

## Accountability, transport and sign-off (agreed 2026-10-27)

Roles are now Admin, Site Engineer (sees attendance only) and Supervisor. Every attendance / transport change is stamped with who and when (server time) and written to an append-only log. A Supervisor's entry can be overridden by the Site Engineer (stamped, no reason needed); the Supervisor edits the same day until 11 PM, the Site Engineer that day plus the next, Admin always.

- [x] Migration `supabase/migrations/2026-10-attendance-accountability-transport.sql` (run AFTER `2026-10-roles-attendance.sql`): role rename, names on logins, rank-protected entries, activity log, day sign-off, transport vehicles / trips / passengers / payments, money visible to Admin only
- [x] Daily sheet: "who · time" on every row, Transport card (per vehicle: Pickup and Drop, Showed / No show with a server time), day bar (Supervisor submits, Site Engineer verifies, reopen) with a review list
- [x] Activity tab (Admin / Site Engineer), Sites today page, Transport page per project (vehicles paid per trip or monthly, no-shows, errands, payments, balance due)
- [x] Meals page (Overview, Daily log, People, Vendors & prices, Payments, Reports) and Transport tabs; marking stays on the Attendance page
- [x] Accommodation (rooms per project, rent in advance, capacity vs people, rent payments posting to expenses)
- [x] Vendor bills for meals: record (weekly, fortnightly or monthly: a date range inside one month, several per month, no overlaps), compare with the meals recorded, approve; the approved amount becomes what is due for those days
- [ ] Same bill-and-approve check for transport operators and landlords (only if wanted)
- [x] Meal payments page (what each vendor is owed, record payments) with payments from meals and transport posted to project expenses automatically (Food, Transport / freight); voiding removes the expense
- [x] No per-person locking on attendance or transport records (changes are stamped and logged; overrides flagged)
- [x] Several people at once: live refresh (Realtime + timer), field-only saves, "Last change" note, Refresh banner for an Admin in Override, live Sites today
- [x] Admin view-only by default on the daily sheet; an Override button makes it editable (protects against accidental changes)
- [x] Admin "Clear day" button (wipes a day's attendance, meals and sign-off so the Supervisor can redo it)
- [ ] After re-running the migration, check Supabase → Database → Replication lists attendance, transport_runs and attendance_days (live updates); without it the screens still refresh every 25 seconds
- [ ] Run the migration in Supabase, then give each person a name and role on the Users page
- [ ] Settings → Food vendors: pick each project and add its vendors (e.g. accommodation mess, site canteen) with prices; assign any old vendors listed as "Not assigned"
- [ ] Add the hired vehicles on the Transport page for each project, choosing per trip or monthly and the price
- [ ] Try the Supervisor and Site Engineer logins on a phone at the site
- [x] Update docs/ROLES_AND_ATTENDANCE.md (repo copy) and write docs/OPERATIONS_GUIDE.md (user guide for attendance, meals, transport, accommodation)
- [ ] Update the online Claude Doc to match (still shows the old three-role version)

## Payroll (built 30 Oct 2026; plan and edge cases in docs/PAYROLL_PLAN.md)

- [x] Calendar-month payroll: calculated on the last day, credited 1st to 4th; joined after the 20th paid in the next run with arrears; daily wage and salaried; unmarked days block
- [x] Employee: left-on date, pay mode (bank / UPI / cash), UPI ID, salary history with effective dates
- [x] Payroll run (readiness, draft, adjustments, LOP waiver, approve, reopen), Pay tab (bank CSV, UPI list and links, hold, payments), Statutory tab, Advances tab
- [x] Salary slip PDFs (one, or all in one PDF); project overview Salary cost panel
- [x] Salary payments post one Salaries & wages expense per run; PF / ESI / PT remittances post Statutory / compliance
- [ ] Re-run `2026-10-attendance-accountability-transport.sql`, then run the new `2026-10-accommodation.sql` (rooms and rent moved into their own file), then set each employee's joining date, salary, pay mode and bank / UPI details
- [ ] Try one real month end to end (October 2026) and compare with your own calculation
- [ ] **ESI for the CSL project (decided 30 Oct 2026, not built yet).** ESI becomes a per-project payroll rule instead of the current automatic one (today payroll deducts ESI for anyone with a contract gross of ₹21,000 or less on every project):
  - applies only to the **CSL project**, from the **November 2026 payroll**, to everyone there whose contract gross is **below ₹42,000** (strictly below);
  - **no ESI in payroll before November** or on other projects; **offer letters and CTC figures stay unchanged**;
  - employee 0.75% and employer 3.25%, the employer share always counted where ESI applies; arrears follow the month the wages belong to (October arrears paid in November carry no ESI);
  - a per-project setting on the Payroll page (on/off, first month, gross limit), refused once an approved payroll is covered by the rule;
  - confirm with your CA first: ₹42,000 is above the usual ESI ceiling of ₹21,000, and ESI coverage runs by contribution period (April to September, October to March).
- [ ] Refinements listed in docs/PAYROLL_PLAN.md section 13 (two-project employees, back-dated revisions, holidays, final settlement, bank file templates)

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
- [ ] **Inventory** (Operations; full plan in the "Inventory tracker" section below): items and units, stock in and out with who / when / project, issue to a project, suppliers, low-stock alerts, stock report
- [ ] Add each module's entry to `src/lib/nav.ts` (the placeholder comment lists where they go)

### Across all modules
- [ ] Each module owns its settings (inventory units, invoice terms, payroll components); keep the central Settings for company-wide items (company details, letterhead, numbering series, users)
- [ ] Change history (audit log) on attendance, payroll and invoices
- [ ] Global search / jump box (⌘K) in the top bar
- [ ] Breadcrumbs with real names (Projects › MAN Unit 2), module landing pages
- [ ] Small count badges in the menu (e.g. people still unmarked on Attendance)

## Inventory tracker (planned 2026-10-29; not started, details of the plan are in chat history)
Tools live in one container and go out to project sites. Track what is at each site, who took it, and whether it came back. Source list: "Complete Inventory List.pdf" (about 300 lines, roughly 40 categories).

**Approach:** a ledger of movements, not an editable stock number. Locations: Container, each project site, Repair, Written off. Stock is worked out from the movements.

**Three kinds of item**
- Counted tools (spanners, allen keys, drill bits, clamps): quantity only
- Tagged assets (welding machines, jacks, chain blocks, torque wrenches, harnesses): one ID and QR per unit
- Consumables (grinding wheels, electrodes, cable by the metre): issued and used up, with a reorder level

**Two ways out of the container:** day-use (due back today, flagged at end of day) and stays-at-site (back at project close or on recall).

### Phase 1 — catalogue and stock
- [ ] Categories and items (name, size/spec, type, unit, condition, photo); load the PDF as opening stock
- [ ] Stock page: total, in container, at sites, damaged, lost; low or zero stock highlighted
- [ ] Clean the PDF on import: "Ceiling" probably means sling, "Plums" probably plumb bobs, "Wrinch" is wrench; merge repeated sizes (open spanner 17/19, taps, box spanners); items with "-" quantity (damaged harnesses, nylon rope); open spanner 8-9 is 0; the 26 mm hammer drill is broken so load it as damaged
- [ ] Inventory entry in `src/lib/nav.ts` under Operations (this replaces the "Stock" idea in the roadmap)

### Phase 2 — take out and return
- [ ] Issue slip: project, who took it, who gave it, date and time, day-use or stays-at-site, lines
- [ ] Size-grid picker with +/- steppers for spanners, drill bits and similar (no long dropdowns); phone first
- [ ] Return screen: tick items, partial quantities, condition on return (OK / damaged / lost), "Return all"

### Phase 3 — oversight
- [ ] Today page like the attendance Day view: out, back, overdue; live updates; optional submit and verify
- [ ] Views by project (becomes an "Equipment on site" tab on the project page, also the closure checklist) and by person
- [ ] Site-to-site transfer without going back to the container
- [ ] Overdue and not-returned list; item history

### Phase 4 — polish
- [ ] QR tags and scanning for tagged assets
- [ ] Kits (for example a welding set adds machine, holder, earthing clamp and cable in one tap)
- [ ] Consumable stock and reorder levels
- [ ] Inspection and calibration dates (harnesses, torque wrenches, gauges, jacks)
- [ ] Photos at handover; Excel export

### Questions to settle before phase 1 (defaults in brackets)
- [ ] Who hands items out? [a storekeeper role]
- [ ] Is the container the only store? [yes]
- [ ] Should the receiver confirm on their phone? [no, the storekeeper's record is enough]
- [ ] Track consumables, or tools only? [both]
- [ ] QR stickers on heavy items? [yes]
- [ ] A cost per item, for lost-tool reporting or salary deductions? [no]

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
