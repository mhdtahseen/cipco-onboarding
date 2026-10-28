# Payroll: plan and what was built

Status: **built (30 Oct 2026)**: the Payroll page, salary slips, statutory remittances, advances, salary history, left-on date and UPI / pay mode, and the Salary cost panel on the project overview. The current behaviour is described in [PAYROLL.md](PAYROLL.md). Section 13 lists what is handled, the known limits and suggested refinements. Planned 29 Oct and Refined 29 Oct 2026; the pay model is a calendar-month payroll calculated on the **last day of the month** and credited between the **1st and 4th** of the next month (sections 1 to 3). Payroll ties the employee's joining date and salary structure to attendance, works out who is paid what, records the payment, posts it to the project's expenses, and produces a salary slip for each person. It builds on what already exists: the per-employee salary structure (`src/lib/salary.ts`: CTC, in-hand, gross or daily wage, with PF, ESI and Professional Tax), the joining date, and the verified daily attendance.

---

## 1. Decisions taken

| # | Decision |
| --- | --- |
| 1 | **Daily wage workers: weekly off is unpaid.** Pay = rate x days worked (present = 1, half-day = 0.5) |
| 2 | **Salaried staff: pay by calendar days** of the month (30 or 31) |
| 3 | **Unmarked days block payroll** |
| 4 | **Payment mode: bank and UPI** (cash not needed now, the field allows it later) |
| 5 | **Statutory payments (PF, ESI, PT) are remitted by you and recorded in the app** |
| 6 | **Access: Admin only** for now |
| 7 | **A left-on date is added to the employee record** so leavers stop being paid |
| 8 | **Payroll is for the calendar month, calculated on the last day of the month, and credited between the 1st and 4th of the next month.** Anyone who joined **on or before the 20th** is paid for that month; anyone who joined **after the 20th** is paid in the next run: the full following month **plus** the days from their joining date to the previous month end |
| 9 | **Daily wage workers follow the same rule** (they are paid a lump sum monthly for the whole month's work) |

---

## 2. The payroll month, calculation day and pay window

- **Salary month = calendar month** (1st to 30th / 31st). A slip says "October 2026".
- **Calculation day = the last day of the month.** The month is calculated on actual attendance for the **whole month**, so nothing is assumed and there is no advance. Because the Supervisor can enter the last day until 11:00 PM and the Site Engineer the next day, the month becomes calculable once its last day is submitted (normally that evening or the 1st).
- **Credit window = the 1st to the 4th of the next month.** October's salary is credited 1 to 4 November. The Pay screen shows the window and flags anyone still unpaid after the 4th.
- **Who is in a month's run:** everyone who joined **on or before the 20th** of the month and has not left before the 1st, paid from their joining date to the month end (or to the left-on date). This applies to salaried and daily wage staff alike.
- **Joined after the 20th:** not in that month's run. In the **next** run they receive the **full following month plus an arrears line** for their joining date to the previous month end, worked out on actual attendance for those days and the previous month's calendar days.
- A correction found after a month is locked (a mistake in attendance, say) is made as an **adjustment line in the next run**, with a reason.

| Case (gross 31,000; October 31 days, so a day = 1,000) | October run (31 Oct, credited 1 to 4 Nov) | November run (30 Nov, credited 1 to 4 Dec) |
| --- | --- | --- |
| Full attendance | 31,000 | 31,000 |
| Joined 20 Oct | 20 to 31 Oct = 12 days = 12,000 | Full month |
| Joined 24 Oct | Not in the run | 31,000 + 24 to 31 Oct (8 days) 8,000 = **39,000** |
| Absent on 31 Oct | 30,000 (the actual absence counts at once) | none |
| Left on 15 Oct | 1 to 15 Oct = 15,000 | none |

The statutory wage month is the calendar month, so PF, ESI and PT line up with the payroll month.

---

## 3. How pay is worked out

**Salaried staff** (monthly gross, CTC or in-hand): `gross x paid days / calendar days of the month`
- Paid days = days from joining (or the 1st) to month end (or the left-on date), minus **LOP days**, all on actual attendance.
- LOP days = absent days + 0.5 for each half-day. A weekly off is a paid day.
- Example: gross 31,000, October, 1 absent day in the month: 31,000 x 30 / 31 = 30,000.
- **Arrears** for a late joiner use the previous month's calendar days (above).

**Daily wage workers:** `rate x days worked` over the whole month, paid as one lump sum; weekly offs and absent days earn nothing. Example: rate 800, 22 present + 2 half-days = 23 days = 18,400. A daily wage worker who joined after the 20th is paid, in the next run, for the days worked from joining to the previous month end **plus** the whole of the following month.

**Deductions:** PF, ESI and Professional Tax from the existing salary rules, recalculated on the **actual** earnings of the run. Advance recovery and other deductions as entered (section 5).
**Additions:** bonus, arrears, overtime, reimbursements, as entered.
**Rounding:** to the nearest rupee.
**Snapshot:** each person's line stores the salary, rate, days and amounts used, so a later salary change never alters a locked month.

---

## 4. The monthly flow

1. **Readiness check** (once the month's last day is submitted). Lists what blocks the month, each with a link to fix it:
   - person-days **unmarked** or days not submitted / verified, from the 1st to the last day of the month (blocks payroll);
   - a person with no salary structure, no joining date, or no bank / UPI details.
2. **Draft.** Calculate every person for the month. Recalculate any time before approval.
3. **Review.** A table of everyone with days (present / half / absent / weekly off), LOP, gross, deductions and net, with flags for anything unusual. Open a row to see the breakdown and add adjustments (bonus, arrears, advance recovery, fine, **waive LOP** with a reason).
4. **Approve and lock.** Stamps who and when and freezes the numbers. An Admin can reopen the month (logged).
5. **Pay.** Shows exactly whom to pay and how much (section 6), then records the payments.
6. **Slips and reports** (sections 7 and 8).

```
Payroll · MAN Unit 2 · October 2026 (credit 1 to 4 Nov)                [Draft]
Ready ✓   24 people   Gross ₹6,42,300   Net ₹5,81,150   Employer cost ₹7,05,900
Employee      Type      Rate     P / ½ / A / Off   LOP   Gross    Deductions  Net      Pay by
Ajay Mahto    Daily     ₹800     22 / 2 / 3 / 4    –     ₹18,400  ₹1,120      ₹17,280  UPI      ⚑
Amit Kumar    Salaried  ₹31,000  26 / 0 / 1 / 4    1     ₹30,000  ₹3,600      ₹26,400  Bank
```

---

## 5. Adjustments and advances

- **Adjustments** per person per month: earning or deduction, a label, an amount and a reason. Examples: bonus, arrears, overtime, fine.
- **Advances:** record an advance given (amount, date), set an instalment, and payroll recovers it each month until cleared. The balance is visible on the person.
- **Waive LOP:** turn an absent day into a paid day with a reason (until real leave types exist).
- **Salary revisions:** each person's salary has **effective dates** (history). A revision inside a month applies from its date, prorated by days. The person's current single salary is kept as the first entry.

---

## 6. Paying, and posting to project expenses

**Pay screen** (after approval; credit window 1st to 4th, unpaid after the 4th is flagged): name, pay by (Bank or UPI), account / IFSC or UPI ID, net amount, status.
- **Bank:** export a **bank transfer CSV** for a bulk upload.
- **UPI:** a list with the UPI ID and amount, and a **Pay** link that opens the UPI app pre-filled (UPI ID, amount, "Salary Oct 2026"), then you mark it paid with the transaction reference.
- Mark each person, or everyone in a group, as paid with the date, mode and reference. A wrong payment is **voided** and entered again (never edited or deleted), like the other payments.

**Expenses.** Two things become project expenses, so the true cost is right and nothing is counted twice:

| Event | Expense posted | Amount |
| --- | --- | --- |
| Salaries paid | **Salaries & wages** (one row per payment batch, "Salary Oct 2026 · 24 people") | The **net** paid |
| PF / ESI / PT remitted | **Statutory / compliance** | What is remitted: employee deductions + employer share |

Net paid + employee deductions + employer share = the full cost of the people, with the employee deductions appearing only once (inside the remittance). Voiding a payment or a remittance removes its expense. The per-person amounts stay on the payroll page.

**Statutory remittances.** A monthly summary of PF (employee, employer, admin / EDLI), ESI (employee, employer) and Professional Tax from the approved cycle, with due dates (PF and ESI by the 15th of the following month; PT per the state rule). Record each challan (type, amount, date, challan number); it posts the Statutory / compliance expense. The wage month is the calendar month.

---

## 7. Salary slips

A PDF for each person for each month, in the style of the letters, with the company seal and signature. Available only after the cycle is approved, always showing the locked numbers.
- **Header:** company, employee name, employee number, designation, department, joining date, bank / UPI, UAN, PAN, month (October 2026).
- **Attendance:** days in the month, paid days, present, half-days, weekly offs, absent, **LOP days**.
- **Earnings:** basic, HRA, special (salaried) or daily rate x days (daily wage), plus any additions, **arrears** (joined after the 20th) and any **adjustment** lines from the previous month.
- **Deductions:** PF, ESI, PT, advance recovery, others. **Net pay**, also in words.
- **Employer contributions** as a memo line. "Computer generated, no signature required."
- Download one, or all as a single PDF or ZIP; share through the existing mail and WhatsApp templates.

---

## 8. Project overview: CTC and payroll

A **Salary cost** panel on the project overview:
- **Salaried:** headcount, monthly and annual **CTC**.
- **Daily wage:** estimated monthly cost (rate x usual days), shown separately because it varies with attendance.
- **Total monthly cost to company** (including employer PF and ESI), by department.
- For the current month: **paid so far**, **still to pay**, and the cost per head.
Reports: monthly summary per project, year-to-date per person, statutory totals for the CA, and a CSV of every month.

---

## 9. Data

| Table | Holds |
| --- | --- |
| `employees` (new fields) | `left_on` date, `pay_mode` (bank / upi), `upi_id` |
| `salary_history` | Effective-dated salary structure per employee |
| *(no table)* | The joining cut-off day (20) and the credit window (1st to 4th) are constants in `src/lib/payroll.ts`, not per-project settings; the weekly-off rule is fixed (salaried: paid, daily wage: unpaid) |
| `payroll_runs` | One per project and month: dates, status (draft / approved / paid), who and when |
| `payroll_lines` | One per person per run: the snapshot, attendance counts, LOP, earnings, deductions, net, employer cost, flags |
| `payroll_adjustments` | Bonus, arrears, fine, advance recovery, LOP waiver, with reason |
| `employee_advances` | Advances given and instalments |
| `payroll_payments` | Net pay payments (mode, reference), voidable, posting the Salaries & wages expense |
| `statutory_payments` | PF / ESI / PT remittances, voidable, posting the Statutory / compliance expense |

All Admin-only, never edited after approval except by reopening (logged), with the same stamped history as attendance.

---

## 10. Build phases (all built)

| Phase | What | Where |
| --- | --- | --- |
| 1 | Salary history, left-on date, pay mode and UPI ID, readiness check | Employee form (Payroll group; a salary change asks the date it applies from), `salary_history`, readiness panel on the Payroll run tab |
| 2 | Payroll run: calculation from attendance (salaried and daily), review, adjustments, approve and lock | `src/lib/payroll.ts`, **Payroll → Payroll run** |
| 3 | Pay screen: bank CSV, UPI list and links, payments posting expenses, advances and recovery | **Payroll → Pay**, **Payroll → Advances** |
| 4 | Salary slip PDFs, bulk download | `/api/payslips/[id]`, `/api/payslips?run=` |
| 5 | Statutory remittances and the summary | **Payroll → Statutory** |
| 6 | Project overview Salary cost panel | Project page → Overview |

## 11. Assumptions taken (change if wrong)

1. **Moving between projects mid-month:** one payroll line per project (each project carries its own cost), paid together; see the limits in section 13.
2. **Public holidays and leave:** an absent day is LOP unless waived with a reason (a **Waive LOP** adjustment).
3. **Overtime, TDS, minimum-wage warning:** not built; enter overtime or TDS as a manual earning / deduction adjustment.

## 12. Later

Leave types and balances, overtime from attendance hours, full and final settlement, a separate HR / Accounts role, manpower invoices from verified man-days (the quotations are priced per man-day), employee self-service view of slips.

---

## 13. Edge cases and refinements

### Handled in the build
- **Joining:** on the 20th (in the run, 12 days in a 31-day month), after the 20th (next run with arrears), exactly on the 20th of the previous month (no arrears), no joining date (blocks), joined this month (flagged).
- **Leaving:** paid only up to the left-on date; a leaver before the 1st is not in the run; the attendance sheet stops listing someone after their last day; a late joiner who also leaves inside the arrears window is paid only to the left-on date.
- **Attendance:** an unmarked day, including in the previous month's arrears window, blocks the calculation and links to the attendance page; a weekly off with no row counts as off, not unmarked; a half-day is half a LOP day (salaried) or half a day's wage (daily).
- **Salary:** a revision inside the month splits the month at its date (each part at its own salary); a revision before the first payroll keeps earlier months unchanged because each line stores a snapshot; no salary set blocks; the salary change prompt in the employee form refuses to save without an effective date.
- **Statutory:** PF capped at the ₹15,000 wage ceiling separately for each wage month (arrears are a separate month); ESI on actual earnings while the contract gross is ₹21,000 or below, employer share counted in the cost; Professional Tax by the Maharashtra slab (women's exemption below ₹25,000), ₹300 in February, or a fixed override on the salary.
- **Deductions:** an advance recovery is capped at the instalment, at what is still owed and at the net pay available (never negative); a negative net blocks approval; a draft that has gone out of date (attendance, salary or adjustment changed) cannot be approved until recalculated.
- **Locking:** an approved payroll cannot be edited, deleted or have adjustments added; reopening is refused while any salary payment exists (void it first); reopening undoes the advance recoveries.
- **Payments:** only against an approved payroll; never more than the net; a person's pay can be put on hold with a reason (blocks payment); never edited or deleted, only voided; one Salaries & wages expense per run, kept equal to what has been paid (voiding lowers it, voiding the last removes it); a posted expense cannot be edited by hand.
- **Access:** Admin only, enforced in the database (an old Staff login cannot read or change payroll).

### Known limits (not handled yet)
1. **Someone who works on two projects in one month** gets a line in each project's payroll, so **Professional Tax and the PF wage ceiling are applied in each**. Until a combined rule exists, check these people by hand (a deduction adjustment can correct PT).
2. **Rejoining:** one left-on date per person. Someone who leaves and returns needs the left-on date cleared (or a new employee record); days in between would then show as unmarked.
3. **Corrections after approval:** an attendance or salary correction for a locked month does not change it. Make it as an earning, deduction or LOP-waiver adjustment in the next month's payroll. The app does not yet warn that a locked month's attendance changed.
4. **A salary revision effective before an already approved month** (back-dated) does not pay arrears automatically.
5. **Public holidays** are not a concept: an unmarked or absent holiday on a weekday is LOP for salaried staff unless the day is marked present or the LOP is waived.
6. **Present on a weekly off** is paid as an ordinary day (salaried) or a day's wage (daily); no overtime or comp-off.
7. **Closed projects** cannot be chosen on the Payroll page (only active projects are listed), so a final payroll after closing needs the project reopened.
8. **Bank file format:** the transfer CSV has Name, Account, IFSC, Amount, Narration; banks' bulk upload templates differ, so it may need reshaping.
9. **UPI links** open only on a phone with a UPI app, and UPI per-transaction limits apply.
10. **No leave types or balances, notice-period recovery, full and final settlement, gratuity, statutory bonus, TDS calculation, minimum-wage check, or PF / ESI return files.**
11. **Slips** are generated on demand from the locked figures; they are not numbered, emailed or sent on WhatsApp.
12. **A payroll cannot be deleted from the page once calculated**; recalculate it instead (the lines are replaced).

### Suggested refinements (in order of value)
1. **Combine pay across projects** for someone on two projects: one PT, one PF ceiling, one payment.
2. **Warn when a locked month's attendance changes** ("attendance changed after approval for 3 people") with a one-click LOP adjustment for the next run.
3. **Public holiday calendar** (per state or project): holidays are paid days for everyone, and a holiday worked can earn overtime.
4. **Overtime** from hours (needs hours on the attendance sheet) and comp-offs.
5. **Leave types and balances** (casual, sick, earned), with leave encashment at leaving.
6. **Full and final settlement** at the left-on date: pending salary, leave encashment, advance balance, notice recovery, gratuity after 5 years.
7. **Bank file templates** per bank (HDFC, ICICI, SBI, Axis) and a UPI batch file.
8. **PF ECR and ESI return files**, and a yearly TDS summary and Form 16 data for your CA.
9. **Maker-checker approval:** one person calculates, another approves (when a second role exists).
10. **Slip delivery:** WhatsApp / email with a short link, and numbering.
11. **Payroll alerts:** a reminder on the last day ("attendance incomplete"), and on the 4th ("N people unpaid").
12. **Minimum-wage check** per state and skill category.
13. **Cost per head per day** combining salary, meals, transport and accommodation on the project report.
14. **Manpower invoices** from verified man-days (the quotations are priced per man-day).
15. **Include closed projects** and allow a payroll for a project that has just closed.
