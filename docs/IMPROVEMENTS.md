# Improvements and enhancements: review of the whole app

Reviewed 13 Nov 2026 by reading the code. The live app and database were not tested. Two findings were re-checked by hand: the Viewer's read access to `app_settings`, and the Sites today link. Nothing was changed while reviewing.

**Tags:**
- **QW** = quick win (under half a day)
- **M** = medium
- **B** = bigger
- 🐞 = bug
- 🔒 = security

**Suggested order:**
1. The "Fix first" list.
2. Attendance reliability: the reminders gate, the 23:00 lock and unsaved taps.
3. Payroll statutory work.

Several fixes need small migrations. Each one is run only with your go-ahead.

---

## Fix first (bugs and security)

- [ ] 🔒 **The Viewer can read secrets and everyone's location.** The Viewer's "read every table" rule (`supabase/migrations/2026-11-viewer-role.sql:27-34`) includes `app_settings`, which holds `cron_secret`, and probably `usage_sessions` (location and IP), `usage_events` and `role_permission_log`. Switch to a list of tables the Viewer may read. **QW**
- [ ] 🔒 **The Permissions page is only enforced in the browser, except for payroll.** Database rules use `is_staff()` for every action, for example `2026-10-quotations.sql:35`. If Operations is set to View on Quotations, Clients or Inventory, a direct call to Supabase can still write. Add database rules that check the Permissions page (`perm_open_rank`) for every module. **B**
- [ ] 🔒 **`/api/docs/view` signs any storage path for any Operations or Viewer login** (`src/app/api/docs/view/route.ts:9-11`). That includes Aadhaar, PAN and bank files. Check that the caller can see the record holding the file before signing it. **QW**
- [ ] 🔒 **`/api/payslips/[id]` lets any staff login open any person's salary slip with the service key** (`src/app/api/payslips/[id]/route.ts:11-12`). Limit it to people with an exit, or check `perm_level('payroll.slips')`. **QW**
- [ ] 🔒 **The page guard treats everyone as Admin when the roles table can't be found** (`middleware.ts:76-78`, error PGRST205). Remove the fallback. **QW**
- [ ] 🐞 **Professional Tax uses Maharashtra slabs, but the sites are in Gujarat** (`src/lib/salary.ts:38-43`, `payroll.ts:115`):
  - Men earning ₹7,500–12,000 are charged; Gujarat charges nothing.
  - Women earning ₹12,000–25,000 aren't charged; Gujarat charges ₹200.
  - A February extra is added that Gujarat doesn't have.
  - The PT due date should probably be the 15th of the next month.
  - The offer letter notes print "Maharashtra".

  Pick the slab from `projects.state_code`. **QW**
- [ ] 🐞 **Project cost counts salaries twice.** It adds the estimated CTC to expenses that already contain the payroll entries (`projectData.ts:45-49`). "Cost per head" divides cumulative cost by today's headcount (`report/page.tsx:50`). Use approved payroll for paid months and the estimate only for the rest, and show cost per man-day. **QW**
- [ ] 🐞 **A late joiner who leaves the next month is never paid** (`src/lib/payroll.ts:33-45,95`). The arrears window is never reached because the "left" check exits first. **QW**
- [ ] 🐞 **The Pay tab can crash when you switch months.** A `useState` comes after an early return (`PayTab.tsx:21-24`). **QW**
- [ ] 🐞 **"Copy yesterday's meals" overwrites meals already set today** (`AttendanceSheet.tsx:144`). Copy only into empty meal columns. **QW**
- [ ] 🐞 **Sites today opens the wrong site.** The card links to `/attendance` without the project (`src/app/sites/page.tsx:38`). Use `/attendance?p=…&d=…`. **QW**
- [ ] 🐞 **Lists quietly stop at 1,000 rows.** Totals come out short with no warning. Page through the rows, as `payrollData.ts:34` does. **QW each**
  - Employee document counts and exit checklist progress (`EmployeeList.tsx:38,44`)
  - Transport totals (`src/app/transport/page.tsx:25`)
  - The Locations map (`src/app/locations/page.tsx:15,28,31`)
  - Equipment logs, which stop at 5,000 (`useEquipment.tsx:46`)
- [ ] 🐞 **Tool stock can go below zero when a bill is reopened.** The `tool_bill_taken_back` trigger skips `tool_check` (`2026-11-tools-from-bills.sql:64-67`). **QW**
- [ ] 🐞 **Gas voids have no stock check and no record of who or why** (`2026-11-gas-site-roles.sql:29`, `useGas.tsx:186`). An Admin can also hard-delete movements (`2026-11-gas.sql:172`). Void through a function that requires a reason, and drop the delete policy. **QW**
- [ ] 🐞 **Wrong units when bill lines go into the tools register** (`ToolsLink.tsx:13`). MT becomes Kg with no ×1000; FT, inch and mm become "Nos". **QW**
- [ ] 🐞 **Gas deliveries never link to their order.** `order_id: null` is hard-coded (`useGas.tsx:173`), so orders never move to delivered and charges use the day's rate, not the agreed one. **QW**

---

## People: onboarding, employees and documents

- [ ] 🐞 **Saving an employee sends all ~40 fields, so the last person to save wipes the other's changes** (`EmployeeForm.tsx:91,125`). Send only the changed fields, or refuse the save if `updated_at` has moved. **QW**
- [ ] 🐞 **A failed salary-history write is ignored**, so payroll applies the new salary to old months (`EmployeeForm.tsx:125-130`). **QW**
- [ ] 🐞 **The two Documents counts disagree.** The tab badge doesn't count "not required" as done; DocsTab does. Also:
  - DocsTab's `upsert()` ignores errors.
  - The file input has no `accept` filter and isn't reset after a pick.

  **QW**
- [ ] 🐞 **Applying a self-fill turns verified documents back into "received"** (`InviteCard.tsx:38`). Add tick-boxes for files and never downgrade. Also check that marking the link "applied" worked (line 40). **QW**
- [ ] 🐞 **An offer or appointment letter can be issued with blank fields, using up a permanent reference** (`LettersTab.tsx:111,115`). Block issuing, or confirm with the list of what's missing. **QW**
- [ ] 🐞 **Bulk "Assign to project" on head-office people** shows the change on screen, but the database clears it (`EmployeeList.tsx:81`). **QW**
- [ ] **Checks before Onboarded.** Show what's missing first: joining date, project or head office, salary, Aadhaar, bank or UPI, key documents. Require a reason to go ahead, and limit bulk onboarding. The employee number can't be taken back. **M**
- [ ] **Duplicate check:**
  - Also warn on a shared bank account number.
  - Say "not to be rehired" or "absconded" in the message.
  - Confirm the unique indexes from `2026-10-pipeline-onboarded-notes-unique.sql` actually exist.

  **QW**
- [ ] **Validation:**
  - Aadhaar checksum (Verhoeff)
  - "Re-enter account number" on the self-fill form
  - IFSC lookup that fills in bank name and branch

  **QW**
- [ ] **Expiry dates and reminders.** Add `valid_until` for police verification, Form 32/33 medicals and the ESIC medical, and a number and expiry for gate passes. Add an "Expiring soon" chip and push reminders 30 and 7 days ahead. **M**
- [ ] **Self-fill draft.** Autosave the self-fill form in the browser, so a reload doesn't lose the answers. **QW**
- [ ] **Self-fill overview.** Add "Waiting on candidate" and "Form filled" chips to the employee list, plus a one-tap WhatsApp reminder. **QW**
- [ ] **Send from the app.** Send the offer, appointment letter and joining kit from the app, with the PDF attached or a signed link, and keep a record of what was sent. Today it's a mailto link. **M**
- [ ] **Permissions on people routes.** Map `/api/docs`, `/api/letters`, `/api/forms`, `/api/export` and `/api/exit-letters` to the Employees module on the Permissions page. Split Employees into tabs (Details, Bank & ID, Salary, Letters, Documents, Exit) so sensitive data can be limited per role. **M**
- [ ] **Logins.** Add a password reset and re-enable from the app. Disable a leaver's login automatically after their last working day, from the scheduled job. **QW**
- [ ] **Export of rejected candidates** and their reasons. **QW**

---

## Attendance and sites

- [ ] 🐞 **On weak internet the reminders gate can lock a Supervisor out of the app** (`NotificationGate.tsx:22,53`, `pushClient.ts:24`). Let them in after one failed try, retry in the background, and check the `save_push_subscription` error. **QW**
- [ ] **The sheet doesn't lock itself at 23:00.** Add a timer that redraws the screen at 23:00 IST (`AttendanceSheet.tsx:44`). **QW**
- [ ] **A tap that fails on a weak network is lost.** Keep a queue of unsaved changes with "N not saved yet, retrying", and warn near 23:00 (`AttendanceSheet.tsx:94-102`). **M**
- [ ] **Each tap triggers several network calls.** Combine them into one `day_state` call (`DayBar.tsx:25-33`, `AttendanceSheet.tsx:49-57`). **M**
- [ ] **Holiday / site closed day.** Add its own status, skip reminders and the transport check, and let payroll tell it apart from a weekly off. **M**
- [ ] **Monthly view.** Add per-day totals and a "Not marked" column, on screen and in the CSV (`AttendanceMonth.tsx:63-72,111-114`). **QW**
- [ ] **Sites today:**
  - It reloads every project on any change at any site. Use `day_watch_snapshot`.
  - Add a date picker so you can review yesterday.

  (`src/app/sites/page.tsx:15-29`) **M**
- [ ] **Operations dashboard:**
  - Headcount trend per site
  - Absentee patterns
  - Meal cost per head
  - Vehicle no-show rate
  - How often each Supervisor submits on time
  - "Verified incomplete" days

  Build it as one server-side query. **B**
- [ ] **Locations.** Add a site pin and radius to each project, and flag entries made more than about 1 km away or with no location. **M**
- [ ] **Small:**
  - The next-day arrow lets non-admins open future days.
  - The 10:30 reminder nags about breakfast at sites with no breakfast vendor (`reminders.ts:55`).
  - A past "showed" vehicle gets a made-up 07:00 or 18:00 time (`TransportCard.tsx:19`).

  **QW**

---

## Meals

- [ ] **The page downloads every attendance row the project has ever had**, on each month change (`src/app/meals/page.tsx:42-47,71`). Total it on the server, or fetch only the month. **M**
- [ ] **Breakdown before the bill.** Make a weekly "our count" PDF per vendor automatically once the days are verified. Flag meals recorded for people marked absent or no longer on the roster. **M**

---

## Transport

- [ ] **Monthly vehicles bill the full month for any month with a single record.** Add pro-rating for mid-month starts and subtract no-show days (`transport/page.tsx:39`). **M**

---

## Payroll

- [ ] 🐞 **A mid-month transfer probably blocks payroll for both projects.** Attendance is loaded for one project, but the whole month is counted (`payrollData.ts:30-35`, `payroll.ts:97-98`). Check it with a test first. **M**
- [ ] 🐞 **Adjustments sit outside the PF and ESI base.** A loss-of-pay (LOP) waiver, overtime and incentives are left out (`payroll.ts:112-127`). Give each adjustment a kind and recalculate PF and ESI. **QW**
- [ ] **Labour Codes (confirm with your CA):**
  - The "wages must be at least 50% of pay" rule likely means PF on more than basic. Add a warning to the salary builder (`salary.ts:56,64`).
  - Fixed-term staff now get gratuity after 1 year.

  **M**
- [ ] **Double-payment and approval guards:**
  - Lock the line when marking paid (`payroll_payment_guard`).
  - Keep a `payroll_run_events` log of approve and reopen, with who and when.
  - Flag bank details changed after approval (`PayTab.tsx:23`).

  **QW–M**
- [ ] 🐞 **Salary advances never reach project costs.** Unrecovered advances are invisible losses, and advances aren't recovered after a transfer (`payrollData.ts:26`). **M**
- [ ] **Company-wide statutory month:**
  - Roll up all approved runs into one month view.
  - Generate the PF ECR file. This needs the EPS 8.33% / EPF 3.67% split and the EDLI cap.
  - Generate the ESIC upload. Add `esic_no` to the snapshot.
  - Record one challan and split it across projects automatically.

  **M–B**
- [ ] **Statutory bonus accrual (Bonus Act).** It's missing from CTC and the forecast, so margins look about 8% better than they are. Add a monthly accrual and a yearly bonus register. **M**
- [ ] **The Run tab has no phone view.** It's a wide table (`RunTab.tsx`). **QW**

---

## Expenses and money

- [ ] **The Due tab is a dead end.** Link each row to where that payment is made. It also loads every payroll line ever (`DueView.tsx:43`, `paymentsDueData.ts:42`). **M**
- [ ] **Typed expenses are hard-deleted with no trace, and the delete ignores errors** (`SpentView.tsx:82,88`). Use void instead, show who changed what, and warn on likely duplicates. **QW**
- [ ] **Project P&L by wage month:**
  - Billed amounts against accrued cost (payroll gross plus employer share, meals, rooms, transport, other).
  - Quoted rate against actual cost per man-day.

  **M**

---

## Gas, equipment, tools and inventory

- [ ] **Gas runs and order edits are saved as many separate writes.** A failure leaves half a run, and a retry doubles it. Use one all-or-nothing save each (`useGas.tsx:120-122,149,173-174`). **M**
- [ ] **Low-stock alerts only fire after someone taps "emptied"**, and fail silently until `2026-11-gas-site-roles.sql` is run. Add a daily check and a "days of gas left" figure. **M**
- [ ] **Equipment charges count breakdown hours, and overnight logs get billed** (`src/lib/equipment.ts:28-35`). Show breakdown as "to dispute" and push an alert for logs running more than 12 hours. **QW**
- [ ] **Loading:**
  - Gas loads every project's movement edits (`useGas.tsx:79`).
  - Every supplies screen reloads all user profiles.

  Filter by project and month. **M**
- [ ] **Tools transfers.** Let the receiving site's Site Engineer confirm transfers and record usage. Record short receipts as "lost in transit". **M**
- [ ] **Inventory review inbox.** One list of entries waiting across all projects, with a count in the menu and a push on submit and send-back. **M**
- [ ] **Bills:**
  - Validate the GSTIN.
  - Duplicate check on GSTIN plus bill number within the financial year.
  - Fill in the vendor name from the GSTIN.
  - Limit GST rates to 0/5/12/18/28.

  **QW**
- [ ] **GST in cost.** Book cost before GST and keep input GST in its own ledger, with the CGST + SGST / IGST split. Today the posting includes GST, so cost is about 18% too high (`2026-11-inventory-approval.sql:153`). **M**
- [ ] **Proof and portal:**
  - More than one file per bill, plus a site receipt photo.
  - Settle stuck JSL portal sends on a schedule, and push on failures.
  - `department: 'MECHANICAL'` is hard-coded.
  - `api/inventory/view/route.ts:14` returns a 500 instead of a 404 for a missing bill.

  **QW–M**
- [ ] **Reports:**
  - A "bills not yet in the tools register" queue
  - A stock ledger CSV
  - Consumption per project per month
  - Vendor-wise spend

  `/vendors` only redirects to Meals. **M–B**

---

## Quotations, invoices and receivables

- [ ] 🐞 **Issued quotations can still be edited or deleted outside the screen, and two overlapping issues can lose a number** (`QuoteEditor.tsx:85`, `api/quotations/issue/route.ts:16-20`). Move issuing into an `issue_quotation` database function and add a guard trigger. **M**
- [ ] **Quotation GST is fixed at 18% and the total isn't rounded** (`src/lib/quote.ts:16,33`). **QW**
- [ ] 🐞 **"Other deduction" stays outstanding and overdue forever** (`src/lib/invoice.ts:62-64`, `invoices/page.tsx:57-58`). **QW**
- [ ] 🐞 **Cancelling an earlier bill leaves the next draft's "billed earlier" quantities wrong** (`invoiceData.ts:19-25`, `cancel_invoice`). **M**
- [ ] 🐞 **Issuing an invoice trusts the browser's totals and accepts any date** (`2026-10-invoicing.sql:211-224`, `InvoiceView.tsx:61-65,86`). Recalculate the amounts in the database, refuse future dates and dates before the last invoice, and make saving all-or-nothing. **M**
- [ ] **Payment follow-ups:**
  - A weekly overdue digest
  - A statement of account PDF per client
  - "Last / next follow-up" notes on each invoice

  **M**
- [ ] **Retention.** Add a defect-liability period, a release date, and a "retention due for release" list. **M**

---

## Platform

- [ ] **No error page.** Add `src/app/error.tsx` and `global-error.tsx`. `ErrorBoundary` is only used on Attendance, so a crash elsewhere shows a blank "Application error". **QW**
- [ ] **Migrations can run in the wrong order.** Names only carry the month: sorted by name, `2026-11-gas-runs.sql` comes before files it needs. Re-running `2026-10-quotations.sql` undoes the `next_ref` staff check from `2026-10-function-permissions.sql`. Use timestamped names and keep a record of what has been run. **M**
- [ ] **The Invoices page is slow.** It loads every invoice, receipt and work order, and rescans receipts for each invoice (`invoices/page.tsx:32,45,50,57`). `InvoiceView.tsx:31-44` makes three calls one after another. Add an `invoice_balances` database view. **M**
- [ ] **Every server route re-asks Supabase Auth who you are**, including the once-a-minute `/api/usage/beat`. Use `getClaims()` instead. **QW**
