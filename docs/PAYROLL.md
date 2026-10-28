# Payroll: what the app does today

A complete description of the payroll module as built on 30 Oct 2026: the rules it follows, every screen and button, the maths with worked examples, what it records and where it posts money, who can use it, how it was tested, its limits, and what to build next. For the design thinking and the longer edge-case list see [PAYROLL_PLAN.md](PAYROLL_PLAN.md); for the day-to-day routine see section 9b of [OPERATIONS_GUIDE.md](OPERATIONS_GUIDE.md).

---

## 1. In one page

- **Where:** People → **Payroll** (Admin only). One payroll per **project** per **calendar month**.
- **When:** calculated on the **last day of the month**; salary is **credited between the 1st and 4th** of the next month.
- **Who is in a month:** everyone who joined **on or before the 20th**, paid from their joining date. Anyone who joined **after the 20th** is paid in the **next** run: the full next month **plus** arrears for the days from joining to the previous month end.
- **How pay is worked out:** from the verified attendance. Salaried: `gross × paid days ÷ calendar days`. Daily wage: `rate × days worked`. PF, ESI and Professional Tax are taken per each person's salary structure.
- **Flow:** readiness check → calculate draft → adjust → approve (locks) → pay (bank CSV, UPI links, per person or in batches) → salary slips → remit PF / ESI / PT.
- **Money:** each salary payment adds to **one Salaries & wages expense** per month on the project; each statutory remittance posts a **Statutory / compliance** expense. Voiding removes or lowers them.
- **Slips:** a PDF per person, or all in one PDF, from the locked figures.
- **Project overview:** a **Salary cost** panel with salaried CTC, estimated daily-wage cost and the latest payroll status.

---

## 2. The rules

### 2.1 Month, calculation day, pay window
| | |
| --- | --- |
| Salary month | The calendar month, 1st to 30th / 31st (a slip says "October 2026") |
| Calculation | Once the month's **last day** is marked; every day of the month must be marked (unmarked days block) |
| Credit window | The **1st to the 4th** of the next month (October's salary is credited 1 to 4 November). The Pay tab flags anyone unpaid after the 4th |
| Default month on the page | The month whose last day has come; in the first days of a month, the month just ended. Change it with the month box |

### 2.2 Who is in a month's payroll
| Situation | Treatment |
| --- | --- |
| Joined on or before the 20th | In the run, paid from the joining date (joined 20 Oct: 12 days in October) |
| Joined after the 20th | Not in that month. The next run pays the **full following month plus an "Arrears" line** for joining date to previous month end |
| Joined exactly on the 20th of the previous month | In the previous month's run, so **no arrears** |
| No joining date | Listed as "no joining date", not paid; shown as a blocker |
| Left before the 1st (left-on date earlier) | Not in the run |
| Left during the month | Paid only up to the **last working day** |
| Moved to another project | Appears on this project's payroll for the days recorded here (see limits) |

### 2.3 Salaried staff (monthly gross, CTC or in-hand)
`gross × paid days ÷ calendar days of the month`
- **Paid days** = days from joining (or the 1st) to the end of the month (or last working day), minus **LOP days**.
- **LOP days** = absent days + 0.5 for each half-day. An unmarked day also counts as LOP but is blocked before it can be paid.
- A **weekly off is a paid day** (it is part of the calendar days).
- The components (basic, HRA, special allowance) are prorated by the same ratio.

### 2.4 Daily wage workers
`rate × days worked`, paid as one lump sum for the month.
- A **present** day counts 1 and a **half-day** 0.5. **Weekly off and absent days earn nothing** (a worker marked present on their weekly off is paid for that day).
- The same joining rule applies: someone who joined after the 20th gets, in the next run, the days worked from joining to the previous month end plus the whole next month.

### 2.5 Deductions and employer cost (from each person's salary structure)
| Item | Rule |
| --- | --- |
| **Provident fund (employee)** | 12% of basic (salaried) or of wages (daily wage), **capped at ₹15,000 wage** if the structure says so. Calculated separately for the current month and for an arrears month |
| **ESI (employee)** | 0.75% of earnings, only if the person's **contract monthly gross is ₹21,000 or below** (for a daily wage worker, rate × 26 days) |
| **Professional Tax** | Maharashtra slab on the month's earnings: men ₹0 up to ₹7,500, ₹175 up to ₹10,000, ₹200 above; women ₹0 up to ₹25,000, ₹200 above. **₹300 in February** when the slab is ₹200. A fixed PT amount on the salary overrides the slab |
| **Employer PF** | 12% of the same wage, plus **admin / EDLI 1%**, when the structure counts employer cost in CTC |
| **Employer ESI** | 3.25% when ESI applies and employer cost is in CTC |
| **Rounding** | To the nearest rupee (ESI rounds up) |

### 2.6 Salary changes inside a month
A revision with an effective date splits the month: days before it use the old structure, days from it use the new one, each at its own gross, then added. The first payroll after a revision is therefore correct for part-months.

### 2.7 Adjustments
Entered per person per month, **before approval** (they are closed once the month is approved):
- **Bonus / earning:** an amount added to the gross.
- **Deduction / fine:** an amount subtracted.
- **Waive LOP days:** gives back some LOP days (`daily value × days`); needs a reason.
- **Advance recovery** is automatic (section 6), not an adjustment.

---

## 3. Worked examples

All use a salaried gross of ₹31,000 (basic 50% = ₹15,500, HRA 40% of basic = ₹6,200, special ₹9,300; PF on the ₹15,000 cap; employer cost in CTC). October has 31 days, so one day is ₹1,000.

| Case | Gross | Deductions | Net |
| --- | --- | --- | --- |
| Full October | 31,000 | PF 1,800 + PT 200 = 2,000 | **29,000** |
| 1 absent day | 30,000 (31,000 × 30 ÷ 31) | PF 1,800 + PT 200 = 2,000 | **28,000** |
| Half-day absent | 30,500 | 2,000 | 28,500 |
| Joined **20 Oct** (12 days) | 12,000 (basic 6,000) | PF 720 + PT 200 = 920 | **11,080** |
| Joined **24 Oct**: October run | not in the run | | |
| Joined **24 Oct**: **November** run (30 days, full) | 31,000 + arrears 8,000 = **39,000** | PF 1,800 (November) + 480 (arrears) + PT 200 = 2,480 | **36,520** |
| Left on 15 Oct (15 days) | 15,000 (basic 7,500) | PF 900 + PT 200 = 1,100 | **13,900** |

**Daily wage, rate ₹800:** 22 present + 2 half-days = 23 days → gross **₹18,400**. ESI applies (rate × 26 = ₹20,800 ≤ ₹21,000): ESI 0.75% = ₹138; PT ₹200 (no PF in this structure) → net **₹18,062**.

**Employer cost** on the full-month salaried example: PF 1,800 + admin 150 = ₹1,950, so the cost to the company is ₹32,950.

---

## 4. The screens

### 4.1 Payroll run
Choose the **project** and **month**. A chip shows the state: *Not started*, *Draft saved*, *Draft · out of date*, or *Approved* (with the date).

**Readiness panel** (before approval). Red "Not ready" lists everything that blocks the month; green "Ready to calculate" when nothing does.
- **Blockers:** unmarked days for any person (this month, and last month's arrears window for a late joiner), no joining date, no salary. Each unmarked-day line links to the attendance page.
- **Warnings** (do not block): a bank-paid person with no account or IFSC, a UPI-paid person with no UPI ID.
- **Notes:** people paid in the next run (joined after the 20th) and people with no joining date.

**Buttons**
| Button | What it does |
| --- | --- |
| **Calculate draft / Recalculate draft** | Works out everyone and saves the lines (replacing any earlier draft). Disabled while something blocks the month |
| **Approve payroll** | Locks the figures (after a confirmation showing the net total). Disabled until a draft is saved, up to date, and nothing blocks |
| **Reopen** | Unlocks an approved payroll and undoes its advance recoveries. Refused while any salary payment exists (void them first) |
| **⬇ CSV** | Downloads the run (name, type, paid days, LOP, gross, deductions, net, employer cost) |
| **All salary slips (PDF)** | One PDF, a page per person (approved payroll only) |

**Summary cards:** people, gross, deductions, net to pay, and **cost to company** (gross + employer PF / ESI).

**The table:** employee, type (Salaried / Daily), P / ½ / A / Off counts, LOP days, gross, deductions, net, pay by, with ⚑ flags for anything unusual: many LOP days, few days worked, arrears, joined or leaving this month, salary revised, advance recovery, nothing to pay. **Tap a row** for:
- every earning and deduction line (with notes), the net, and the arrears window with its attendance counts;
- the person's adjustments for the month, with **Void**, and a form to add a bonus, a deduction or waive LOP days (before approval);
- after approval, a **Salary slip (PDF)** button.

**Out of date:** if attendance, a salary, an advance or an adjustment changes after the draft was saved, the chip says so and Approve stays disabled until you recalculate.

### 4.2 Pay
Available after approval. Shows net to pay, paid and still to pay, and a banner: the credit window, or "N people are still unpaid after the credit window".

Per person: pay by, payee details (bank / account / IFSC or UPI ID, with a red note if missing), net, paid, left, and a status:
**Unpaid · Part paid · Paid · On hold · Nothing to pay.**

| Action | What it does |
| --- | --- |
| **Pay** | Opens a small form (amount defaults to what is left, date, reference / UTR) and records a payment |
| **UPI app** | For UPI people: opens the UPI app on a phone pre-filled with the UPI ID, amount and "Salary Oct 2026" |
| **Hold / Release** | Puts someone's pay on hold with a reason (no payment can be recorded while held) |
| **Slip** | Opens that person's salary slip |
| **⬇ Bank transfer CSV** | Name, employee no., bank, account, IFSC, amount, narration for everyone unpaid by bank |
| **⬇ UPI list CSV** | Name, employee no., UPI ID, amount, narration for everyone unpaid by UPI |
| **Mark all bank paid / Mark all UPI paid** | Records a payment for everyone left in that group, today, with one batch reference you type |

**Payments list:** every payment with date, person, amount, mode and reference, and **Void** (the project's salary expense goes down by that amount). Payments are never edited or deleted; a wrong one is voided and entered again. A payment can never exceed the person's net.

### 4.3 Statutory
For the selected month, from the **approved** payroll:
| Item | Made up of | Due by |
| --- | --- | --- |
| Provident fund | employee + employer + admin / EDLI | 15th of the next month |
| ESI | employee + employer | 15th of the next month |
| Professional tax | deducted from employees | last day of the payroll month |

Each row shows the amount due, what has been remitted, and what is left (red when late). **Record a remittance:** type (PF, ESI, PT, TDS, other), amount (defaults to what is left), date, challan number, note. It posts a **Statutory / compliance** expense on the project; **Void** removes it. You can record a remittance even before approval.

### 4.4 Advances
Record an advance to a person: amount, monthly **instalment**, date, note. The list shows recovered and still owed.
- In every draft calculation the app deducts `min(instalment, still owed, net pay available)`, never more, and never making the net negative.
- The recovery is **recorded when the payroll is approved**; reopening undoes it.
- An advance already recovered from **cannot be voided**. Giving the money itself is not recorded here.

---

## 5. Salary slips

A one-page PDF per person (`/api/payslips/<id>`), or all in one PDF (`/api/payslips?run=<id>`). Only for an **approved** payroll, always showing the locked figures.
- **Header:** company name and address; "SALARY SLIP" and the month.
- **Employee block:** name, employee no., designation, department, project, date of joining, PAN, UAN, pay month, and how paid (bank name and masked account, or UPI ID, or cash).
- **Attendance:** salaried: days in the month, paid days, LOP days, present, weekly offs. Daily wage: days worked, present, half-days, absent, weekly offs. An arrears note when the slip includes arrears.
- **Earnings and deductions** in two columns with totals, **net pay** in figures and words.
- **Employer contributions** (PF, admin / EDLI, ESI) as a memo line.
- The company seal and authorised signature, and "computer-generated" footer.

---

## 6. Where the money goes

| Event | Expense on the project | Amount |
| --- | --- | --- |
| Salary payments recorded | **Salaries & wages**: one row per payroll month, e.g. "Salaries · Oct 2026 · 24 people paid" | The sum of the non-voided payments; updated on every payment or void; removed when it reaches zero; dated the latest payment |
| PF / ESI / PT remitted | **Statutory / compliance**: one row per remittance, e.g. "PF payment · Oct 2026 · CH-9" | The amount remitted |

The salary expense is the **net** paid; the remittances are the employee deductions plus the employer share. Together they equal the full cost of the people (net + employee deductions + employer contributions) with nothing counted twice. These expenses show on the project's Expenses tab with a **From payment** tag and cannot be edited by hand (void the payment instead). Categories are created if missing.

---

## 7. Where it appears elsewhere

- **Employee form → Payroll group** (internal form only, never the self-fill link): **Last working day**, **Paid by** (bank / UPI / cash), **UPI ID**. Bank, PAN and UAN stay in the Statutory & bank group.
- **Changing a salary** in the employee form asks **from which date the new salary applies** (and will not save without it), so earlier payroll months keep the old salary. The previous salary is stored as the first history entry.
- **Attendance sheet:** a person is no longer listed after their last working day (unless they have a record in the range).
- **Project overview → Salary cost:** salaried **CTC** per month and per year, the **estimated** monthly cost of daily-wage workers (rate × usual working days), the total monthly cost to the company by department, people without a salary, and the latest payroll's state ("₹2,13,156 paid of ₹2,13,156 net"). A **Payroll →** button opens the page.
- **Menu:** Payroll is under People, Admin only.

---

## 8. Security and records

- **Admin only.** Enforced in the database: an old Staff login, a Site Engineer or a Supervisor cannot read or change payroll. (Salary history can be read by Admin and Staff, like an employee's salary.)
- **Approval locks** a payroll: its lines and its month's adjustments cannot change; the only edit allowed is putting someone's pay on hold. Reopening needs no payments to exist.
- **Never edited or deleted, only voided:** payments, advances, adjustments, remittances. A payment cannot exceed the net, cannot be recorded before approval, and cannot be recorded for someone on hold.
- **Snapshot:** each line stores the employee details, salary, attendance counts and every earning and deduction as calculated, so later changes never alter a locked month or a slip.
- **Posted expenses** are protected from hand edits; the payroll expense is kept equal to the payments by a database function.
- **Stamps:** approval records who and when.

Tables: `salary_history`, `payroll_runs`, `payroll_lines`, `payroll_adjustments`, `employee_advances`, `advance_recoveries`, `payroll_payments`, `statutory_payments`; new employee columns `left_on`, `pay_mode`, `upi_id`. Functions: `payroll_approve`, `payroll_reopen`, `sync_payroll_expense`. All in `supabase/migrations/2026-10-attendance-accountability-transport.sql` (re-run that one file; it is safe to run again).

---

## 9. How it was tested

- **Calculation rules (33 checks):** full month, an absent day, a half-day, joined on the 20th, joined after the 20th with arrears, exactly on the 20th, leavers, unmarked days, weekly off, daily wage (including a late joiner), ESI and employer contributions, February Professional Tax, a mid-month salary revision, bonus / fine / advance / LOP waiver, advance recovery caps, missing bank / UPI / joining date / salary, the credit window, statutory totals.
- **Database rules (all checks in the suite, including about 30 for payroll):** run creation and approval, empty and negative-net approval blocked, lock after approval, hold, no payment before approval or above the net, the single expense per run and its updates on payment and void, reopen refused with payments, advance recovery and its limits, remittances posting and voiding, the Admin-only rule, salary history, and the roster stopping at the last working day.
- **Browser (Chromium, desktop and phone):** the October month end to end: the not-ready block, calculating, an adjustment making the draft out of date, approval, a salary slip PDF and the all-slips PDF, one payment then everyone paid with the single expense equal to the total net, reopen refused, a PF remittance, an advance; the Salary cost panel; the employee Payroll fields.
- **Not tested:** the "salary changed: effective date" prompt in the employee form, real bank or UPI transfers, other banks' bulk-upload formats, and the slip layout beyond one sample page.

---

## 10. What it cannot do yet (limits)

1. **Someone on two projects in one month** gets a line in each project's payroll, so **Professional Tax and the PF wage ceiling are applied in each**. Check these people by hand.
2. **Rejoining:** one left-on date per person; someone who leaves and returns needs it cleared (or a new record).
3. **Corrections after approval** are made as adjustments in the next month's payroll; there is no warning that a locked month's attendance changed.
4. **A back-dated salary revision** does not pay arrears automatically.
5. **No public-holiday calendar:** an unmarked or absent weekday holiday is LOP for salaried staff unless the day is marked present or the LOP is waived.
6. **No overtime or comp-off:** a weekly off worked is paid as an ordinary day.
7. **Closed projects** are not selectable on the page.
8. **Bank file:** one generic CSV; banks' bulk-upload templates differ.
9. **UPI links** need a phone with a UPI app; UPI per-transaction limits apply.
10. **Not built:** leave types and balances, notice-period recovery, full and final settlement, gratuity, statutory bonus, TDS calculation, minimum-wage check, PF ECR / ESI return files, Form 16 data.
11. **Slips** are not numbered, emailed or sent on WhatsApp.
12. **Maharashtra only:** the Professional Tax slab is Maharashtra's.

---

## 11. Suggestions

**Highest value**
1. **Combine pay across projects** for someone on two projects: one PT, one PF ceiling, one payment.
2. **Warn when a locked month's attendance changes** ("attendance changed after approval for 3 people") with a one-click adjustment for the next run.
3. **Public holiday calendar** (state or project): holidays are paid days; a holiday worked can earn overtime.
4. **Final settlement** at the last working day: pending salary, leave encashment, advance balance, notice recovery, gratuity after 5 years.
5. **Bank file templates** per bank, and a UPI batch file.

**Useful next**
6. **Overtime** from hours (needs hours on the attendance sheet) and comp-offs.
7. **Leave types and balances** (casual, sick, earned) with encashment at leaving.
8. **PF ECR and ESI return files**, a yearly TDS summary and Form 16 data for your CA.
9. **Payroll history on each employee's page** (every month's slip in one place).
10. **Slip delivery:** WhatsApp or email with a short link, and slip numbering.
11. **Alerts:** on the last day ("attendance incomplete for N people"), and on the 4th ("N people unpaid").
12. **Month navigation and a project-wide view:** previous / next month buttons, and one page showing every project's payroll status.

**Later**
13. **Maker-checker approval** (one calculates, another approves) when a second role exists.
14. **Minimum-wage check** per state and skill category.
15. **Cost per head per day** combining salary, meals, transport and accommodation.
16. **Manpower invoices** from verified man-days (the quotations are priced per man-day).
17. **Include closed projects** and a payroll for a project that has just closed.

---

## 12. Messages you may see

| Message | Meaning and what to do |
| --- | --- |
| "Not ready: N things to fix" | Something blocks the month: open each item (unmarked days link to the attendance day) |
| "N days not marked (…)" | Mark those days on the Attendance page first (Override, then mark) |
| "no joining date" / "no salary set" | Complete the employee's record |
| "Draft · out of date" | Something changed since the draft was saved: **Recalculate draft** |
| "Someone's net pay is negative" | A deduction exceeds the earnings: fix the adjustments, then recalculate |
| "Salary payments have been recorded for this payroll. Void them first." | Reopen needs every payment voided first |
| "That is more than the net pay" | A payment cannot exceed what the person is owed |
| "This person's pay is on hold: …" | Release the hold before paying |
| "Approve the payroll before recording payments." | Pay is only available after approval |
| "That month's payroll is approved. Reopen it to change adjustments." | Adjustments close at approval |
| "Part of this advance has already been recovered…" | An advance already used in a payroll cannot be voided |
| "Only an Admin can approve payroll." | Payroll is Admin only |
