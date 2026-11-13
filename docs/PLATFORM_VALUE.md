# CIPCO Digital Platform: Features, Value and USPs

As of 12 Nov 2026. Covers www.cipcogroup.com and ops.cipcogroup.com.

## Summary

If a mid-size Indian agency were hired today to build CIPCO's two digital products, they would be worth about **₹67–90 lakh and take 10–12 months**. The operations app is about 93% of that value.

- **www.cipcogroup.com** is the company website: about 21 pages that present CIPCO's forging-press, steel-plant and turnkey erection work to clients. Building it professionally would cost **₹3–6 lakh** (with copy and photography) and take **8–10 weeks**.
- **ops.cipcogroup.com** is the operations app that runs the company day to day: people, attendance, payroll, meals, transport, site supplies, tools, inventory, quotations, invoices, expenses and approvals. Building it professionally would cost **₹64–84 lakh** over **10–12 months**. Once the usual change requests and the first year of maintenance are added, that becomes **about ₹90 lakh – ₹1.3 crore**.

The ops app today is a working system, not a prototype:

| Measure | Count |
| --- | --- |
| Screens | 37 |
| Server routes | 42 |
| Components | 82 |
| Database migrations | 55 (about 5,700 lines of SQL) |
| App code | about 16,000 lines of TypeScript |
| Generated PDF formats | 13 |
| Roles | 6: Admin, Operations, Site Engineer, Supervisor, Attendance, Viewer (security enforced inside the database) |

All values are estimates at Indian agency rates, not quotes. The method is set out in the last section.

## The website: www.cipcogroup.com

The website is CIPCO's public face for heavy-engineering clients. It has a custom design built around tonnage, specifications and real project references, not a generic template.

### Pages

| Page | What it contains |
| --- | --- |
| Home | A hero section; four animated stat counters; an interactive capacity scale; 3 selected projects; 7 service blocks; an About teaser; client logos; the enquiry form |
| Projects | A portfolio of 11 projects with filter tabs (Forging presses, Steel and rolling mills, Manufacturing, Overseas), a cards/list toggle and an 11-photo "On site" gallery |
| Project pages (11) | A spec sheet (client, location, sector, tonnage, equipment table), photos, WhatsApp and email calls to action, and previous/next navigation |
| Services | Six service cards |
| Service pages (6) | Scope of work, "Where we have done it" project links, related services, and quote and call buttons |
| About | The company story in five chapters, a 4-step process (Design, Manufacture, Erect, Commission), shop equipment, leadership, people and plant (203 staff, 24,000 sq ft, 1,000 kVA), and a 9-question FAQ |

### Features

- **Interactive capacity scale:** a log-scale chart from 200 T to 16,000 T, with markers for actual installations.
- **A filterable portfolio:** filter tabs and a cards/list toggle.
- **An enquiry form:** name, company, email, phone/WhatsApp, equipment type, capacity, site location and requirements.
- **Direct contact:** WhatsApp click-to-chat with a pre-filled message, phone links and pre-subjected email links.
- **Company profile PDF:** a download linked from every page.
- **SEO:** a descriptive title on every page, written around service and location (for example, "Forging Press Re-conditioning and Erection in Pune").
- **Accessibility:** a skip-to-content link.

### Unique aspects

- It speaks the client's language of tonnage, pitch, module, ISI/ASME/DIN/JIS standards and equipment tables. That gives it credibility with plant engineers and buyers.
- Every project is evidence: a named client (Bharat Forge, L&T, ThyssenKrupp, FAW China and others), a location and tonnage figures.
- Each service links to the projects that prove it, and each project links to its services.
- Its call to action is a qualified enquiry. The form captures equipment type, capacity and site, so CIPCO can quote straight away.

**Open items on the site:** three leadership roles are marked "coming soon". Some capacity figures differ between the FAQ and the project cards (Bharat Forge, FAW). Nine client logos are shown as plain text.

## The operations app: ops.cipcogroup.com

The ops app covers 12 modules that run CIPCO's sites end to end. It runs from the first job application to the final exit settlement, and from a gas cylinder at the gate to the vendor's invoice.

### 1. People: onboarding, employees and offboarding

- **Applications by link:** a candidate fills in their own form from a tokenised link, with documents uploaded and compressed on the phone.
- **Candidate review:** review, notes and onboarding into an employee record with an employee number that, once given, can't be changed.
- **Employee file:** documents, letters, bank details, pay history, and mail templates for standard communications.
- **Offboarding:** exit types (resigned, contract end, terminated, absconded) and a 7-point exit checklist, including ESIC and EPFO removal, return of company items and login disabling.
  - Pay is held by default on exit. Only an Admin can forfeit it, and only with a recorded reason.
- **Exit letters:** relieving, experience, recommendation, full and final settlement, and absconding notices, issued only by Admin and Operations under set rules.
- **Offboarded tab:** past employees with their documents, signed share links and one-click rehire.

### 2. Attendance

- **Daily marking:** sheet per project and day, marked by Supervisors and Site Engineers, with a card view on phones and tablets.
- **Proof of where and when:** each entry records its location and time.
- **Day close and verification:** a day is closed and verified, with "verified though incomplete" flagged.
- **Admin day grants:** an Admin can reopen one past day for one person for 1, 3, 6, 12 or 24 hours. It expires automatically.
- **Nudges:** reminders to the Supervisor or Site Engineer by phone notification when a day hasn't been marked.

### 3. Payroll

- **Monthly pay:** worked out from attendance, with advances and deductions.
- **Pay status:** pay, hold, and "don't pay" for people leaving in the month.
- **Payslips:** shared by signed, expiring link.
- **Payroll register:** PDF, plus a bank transfer letter.
- **Phone layouts:** card layouts for paying from a phone.

### 4. Meals

- Meals are marked on the attendance sheet against each food vendor.
- **Prices that change over time:** prices per vendor and meal, with effective dates. Past bills always use the price in force on that day.
- **Vendor bill checking:** bills for any range of days are compared with the meals recorded, then approved as billed, as computed, or at a custom amount.
- **Vendor statement PDF:** a price breakdown, day by day, and optionally names of who ate.
- **Payments:** payments that post to project expenses automatically.

### 5. Transport and accommodation

- **Transport:** errands and vehicles, with costs posted to the project.
- **Gas pickups:** a gas pickup by our own vehicle creates a pending transport errand automatically.
- **Accommodation:** site housing and rent tracking.

### 6. Site supplies: gas

- **Built around runs:** each truck visit is one run, with one vendor and a delivery challan (required), the full cylinders brought and the empties taken back.
- **Stock per site:** full and empty counts per site, with opening stock, "used up", lost and damaged. Supervisors can't record lost or damaged cylinders.
- **Charge per run:** product quantity × rate, plus GST, plus freight with 18% GST. This matches the vendor's invoice to the rupee.
- **Invoices, payments and deposits:** an invoice per run, payments against the vendor, and cylinder deposits.
- **Low-stock alerts:** a phone notification to Operations at most once a day per gas.
- **Corrections:** Admin edits in place with a full change history, and a read-only JSL portal badge.

### 7. Site supplies: equipment

- **Hire log:** cranes and hired machines logged by hours and stretches of work.
- **Billing:** hours verified, with bills and payments per machine and rate.

### 8. Tools and equipment register

- **Stock ledger:** stock by site from a movement ledger, so stock is always worked out from movements, never typed in.
- **Transfers:** two steps (dispatch, then receive), with good and damaged counts.
- **Delivery Challan:** printed in CIPCO's own format. Long lists go on an attached Inventory List.
- **Opening stock:** container opening stock of 380 items loaded at CSL.
- **Link from inventory bills:** bill lines link into the register using fuzzy name matching (spellings, synonyms and sizes) that learns names people actually use.

### 9. Inventory

- **Approvals:** bills and purchases go through submit, review and approve, with photo capture of the bill.
- **Optional fields:** entries without a bill, and an optional portal entry.
- **Matching:** bill lines matched to the catalogue.

### 10. Commercial: quotations, work orders, invoices

- **Quotations:** built from a quote library and standard clauses, then exported to PDF.
- **Work orders and invoices:** work orders per client and invoices as GST-ready PDFs.
- **Records:** clients, vendors, sites and locations.

### 11. Money: expenses, payments due, forecast

- **Expenses:** one page, Due and Spent together, with posts from every module.
- **Payments due:** every unpaid vendor, run and bill, with a PDF report.
- **Forecast:** cash forecast and project reports.

### 12. Administration

- **Users and roles:** link logins to employees and disable logins completely (credentials stop working).
  - Leavers are disabled automatically after their last working day.
- **Permissions matrix:** read/edit per module per role.
- **Activity log:** each user's sessions, with device, IP address, approximate location and pages visited, kept for 1 month.
- **Settings:** settings, mail templates and the JSL portal worker for automated portal entries.

## Platform-wide capabilities

These run under every module, and they are what make the app hard to fool and safe to hand to site staff.

| Capability | What it does |
| --- | --- |
| Roles and permissions | 6 roles and a per-module read/edit matrix. Money is never shown to Supervisors or Site Engineers |
| Security in the database | Rules are enforced by the database itself (row-level security and guard triggers), not just the screens. A bypassed screen still can't change a locked record |
| Audit trail | Who entered, edited, voided or approved what, and when. Records are voided rather than deleted, and edits keep a change history |
| Ledgers, not balances | Stock, dues and balances are always summed from the entries, so a figure can't drift from its records |
| Generated documents (13 PDFs) | Exit letters, payslips, payroll register, bank letter, quotation, invoice, delivery challan with inventory list, vendor meal statement, payments due, gas order and forms |
| Signed share links | Expiring, tamper-proof links for letters and payslips, ready to send on WhatsApp |
| Notifications | Phone push notifications for unmarked days, low gas stock and approvals |
| Location | Entries carry their location; a map view of sites |
| Files | Bill and challan photos compressed on the phone and stored securely |
| Excel | Import and export (staff lists, inventory, reports) |
| Login control | Logins can be fully disabled, sessions ended immediately, and leavers disabled automatically |
| Activity log | Sessions, pages, device, IP address and approximate location per user, kept for 1 month |
| Phone, tablet, desktop | Phone bottom bar, tablet icon rail, full desktop sidebar; card views where tables don't fit |
| Dark mode | Throughout the app |
| Automation | Scheduled jobs: day watch, login cut-off, data pruning, the JSL portal worker |

## Monetary value and build time, feature by feature

At a mid-size Indian agency's blended rate of about ₹3 lakh per person-month, the ops app is worth **₹64–84 lakh** (21–28 person-months). The website is worth **₹3–6 lakh**, which brings both to **₹67–90 lakh**.

### Ops app by module

| Module | Main features | Effort (person-months) | Value (₹ lakh) | Build time, 1 developer (weeks) |
| --- | --- | --- | --- | --- |
| Discovery and specifications | Process mapping of every site workflow, roles and rules | 1.5 – 2 | 4.5 – 6.0 | 6 – 8 |
| UI/UX design | Phone, tablet and desktop layouts, dark mode, card views | 1.5 – 2 | 4.5 – 6.0 | 6 – 8 |
| People: onboarding, employees, offboarding | Application links, employee file, exit checklist, exit letters, rehire | 2 – 2.5 | 6.0 – 7.5 | 8 – 10 |
| Commercial | Quotations, quote library, clauses, work orders, GST invoices, clients | 2 – 2.5 | 6.0 – 7.5 | 8 – 10 |
| Attendance | Daily sheet, location proof, day close and verification, day grants, nudges | 1.5 – 2 | 4.5 – 6.0 | 6 – 8 |
| Payroll | Pay from attendance, advances, hold/don't pay, payslips, register, bank letter | 1.5 – 2 | 4.5 – 6.0 | 6 – 8 |
| Site supplies: gas | Runs, challans, full/empty stock, charges with GST, invoices, low-stock alerts, edit history | 1.5 – 1.75 | 4.5 – 5.25 | 6 – 7 |
| Expenses, payments due, forecast | Unified Due and Spent, payments-due PDF, cash forecast, project reports | 1 – 1.5 | 3.0 – 4.5 | 4 – 6 |
| Users, permissions, activity, login control | Permissions matrix, login disable, activity log with location | 1 – 1.5 | 3.0 – 4.5 | 4 – 6 |
| Documents (13 PDF formats) | Letters, slips, challans, statements, invoices, quotations, registers | 1 – 1.5 | 3.0 – 4.5 | 4 – 6 |
| Meals | Vendor prices with dates, bill vs records, approvals, vendor statement PDF | 1 – 1.25 | 3.0 – 3.75 | 4 – 5 |
| Tools and equipment register | Movement ledger, two-step transfers, delivery challan, fuzzy matching from bills | 1 – 1.25 | 3.0 – 3.75 | 4 – 5 |
| Inventory | Submit/review/approve, bill photos, catalogue matching | 0.75 – 1 | 2.25 – 3.0 | 3 – 4 |
| Transport and accommodation | Errands, vehicles, automatic gas errands, rent | 0.5 – 0.75 | 1.5 – 2.25 | 2 – 3 |
| Site supplies: equipment hire | Crane and machine hours, verification, bills | 0.5 | 1.5 | 2 |
| Testing, project management, deployment | QA across 6 roles, release, training, hosting setup | 3 – 4 | 9.0 – 12.0 | runs throughout |
| **Total, ops app** | | **21 – 28** | **64 – 84** | **10 – 12 months with a team of 4** |

### Website

| Item | Value (₹ lakh) | Build time |
| --- | --- | --- |
| Custom design and 21 pages (home, about, services, 6 service pages, projects, 11 project pages) | 2.5 – 4.5 | 6 – 8 weeks |
| Interactive capacity scale, portfolio filters, enquiry form | included above | included above |
| Copywriting | 0.3 – 0.8 | 2 – 3 weeks |
| Plant and site photography | 0.4 – 1.5 | 1 week |
| **Total, website** | **3 – 6** | **8 – 10 weeks** |

### What the same work would cost elsewhere

| Who builds it | Ops app | Website | Timeline |
| --- | --- | --- | --- |
| Freelancers (2–3 people) | ₹20 – 40 lakh | ₹0.6 – 1.5 lakh | 12–16 months; high risk of stalling partway |
| Mid-size Indian agency (the basis above) | ₹64 – 84 lakh | ₹3 – 6 lakh | 10–12 months |
| Tier-1 Indian product studio | ₹85 lakh – ₹1.4 crore | ₹6 – 12 lakh | 8–10 months |
| US/EU agency | ₹3 – 5.5 crore ($350k – 650k) | ₹12 – 35 lakh | 8–10 months |
| Off-the-shelf (Zoho, ERPNext) customised | ₹15 – 35 lakh in year 1; covers only about half | not applicable | 4–6 months |

Add **25–50%** for change requests, which this app has needed constantly as processes were refined. Add maintenance of 15–20% of the build cost each year. The realistic first-year cost from an agency is then **about ₹90 lakh – ₹1.3 crore**.

## Pros of the application

The app's biggest advantage is that it fits how CIPCO actually works on site, and changes in days when the process changes.

1. **Built for CIPCO's own processes.** Meals by vendor, gas runs with challans, JSL portal entries, the exit hold rule and CIPCO's challan format are built in. No off-the-shelf product has them.
2. **One system instead of many.** HR, attendance, payroll, site supplies, inventory, commercial and expenses share one database. Nothing is re-typed between Excel sheets, WhatsApp and paper.
3. **Money is checked, not trusted.** Vendor bills (meals, gas, equipment) are compared with what was recorded on site before they're approved. Overcharges show up immediately.
4. **Hard to fool.** Rules are enforced in the database. Records are voided rather than deleted, edits keep their history, and entries carry location and time.
5. **Safe to hand to site staff.** Supervisors and Site Engineers see only what their role needs and never see money. Admin can open a past day for 1–24 hours without giving permanent access.
6. **Works on a phone at the site.** Phone, tablet and desktop layouts; photos compressed before upload; push notifications.
7. **Paperwork comes out ready.** 13 document formats (letters, payslips, challans, statements, invoices) are generated from the records and shared by secure link.
8. **Fast to change.** New rules (for example, GST on freight or "don't pay" for leavers) went live in hours or days, not agency change-request cycles.
9. **Low running cost.** About ₹4,000–7,000 a month in hosting, against ₹8–15 lakh a year for an agency maintenance contract.
10. **CIPCO owns it.** The code, the data and the database belong to CIPCO. There are no per-user licence fees and no vendor lock-in.

## Unique selling points

CIPCO's platform is unusual because it ties site reality to money: what happens at the gate, in the mess and on the attendance sheet decides what gets paid.

| USP | Why it matters | Who else offers it |
| --- | --- | --- |
| **Vendor bill verification from site records** (meals, gas, equipment) | CIPCO knows the correct bill before the vendor sends it, and can hand the vendor the breakdown to bill against | Generic ERPs record the bill; they don't check it against site records |
| **Gas managed by truck run** | Challan, cylinders in and out, full/empty stock and the invoice per run, matched to the rupee including freight GST | No product handles industrial gas this way |
| **Exit process that protects the company** | Pay held by default, a 7-point checklist (ESIC, EPFO, items, login), letters only by rule, logins cut automatically | Most HR tools stop at a resignation date |
| **Time-boxed access** | One past day opened for one person for 1–24 hours, then it closes by itself | Rare even in large HR suites |
| **Location-stamped site entries** | Attendance and entries carry where and when they were made | Usually a paid add-on |
| **Tools register that understands site language** | Fuzzy matching links a bill line like "grinder 4in" to the catalogue's "Angle Grinder 4 inch" and learns names | Inventory tools need exact item codes |
| **CIPCO-format paperwork** | Delivery challans, letters and statements come out in the company's own format | Templates in generic tools rarely match |
| **Client-portal ready** | JSL portal entries recorded alongside site records, with automation under way | Specific to CIPCO's clients |
| **Full login control with an activity trail** | Disable a login completely; see each user's sessions, pages, device and location | Usually enterprise-tier only |
| **Website that sells engineering** | Tonnage scale, named client projects and spec sheets that link to services, with a qualified enquiry form | Most industrial sites are brochure pages |

## Running costs and how the values were worked out

Keeping both products online costs about **₹4,000–8,500 a month**, whoever built them.

| Item | Monthly cost |
| --- | --- |
| Database, logins and storage (Supabase Pro) | ₹2,100 – 4,000 |
| App hosting (Vercel Pro) | about ₹1,700 per seat |
| File storage and email | ₹200 – 1,000 |
| Website hosting | ₹0 – 1,500 |
| Domain | about ₹100 (₹1,200 a year) |

**Method and assumptions**

- The ops app's scope was measured from its code on 12 Nov 2026: 37 screens, 42 server routes, 82 components, 55 migrations, about 16,000 lines of TypeScript and 5,700 lines of SQL. The code is written densely; an agency would typically produce 35,000–45,000 lines for the same features.
- Effort was estimated per module in person-months for a mid-size Indian agency: discovery, design, build, testing and project management.
- Value = effort × a blended rate of ₹3 lakh per person-month (the typical range is ₹2.5–3.5 lakh).
- The website's scope comes from a review of www.cipcogroup.com on 12 Nov 2026. Its platform and hosting could not be confirmed from outside.
- Rates are market estimates, not quotes. Actual agency quotes vary with the city, the team and how fixed the scope is. Getting two or three quotes against this document would confirm them.
- Prices exclude GST.
