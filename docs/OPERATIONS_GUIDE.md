# Operations guide: attendance, meals, transport and accommodation

How to run a site in the CIPCO app: who does what, every screen, and the rules behind them. For the technical detail (database tables, security review, how it was tested) see [ROLES_AND_ATTENDANCE.md](ROLES_AND_ATTENDANCE.md). Written 29 Oct 2026.

---

## 1. The big picture

Five things are tracked for every project (site), and everything that costs money ends up in the project's expenses without being typed twice.

| Topic | Who records it, and where | Who reviews and pays, and where |
| --- | --- | --- |
| **Attendance** (work status) | Supervisor, on the **Attendance** page | Admin and Site Engineer, same page; Admin also **Monthly** and **Sites today** |
| **Meals** (which vendor each person ate with) | Supervisor, on the **Attendance** page | Admin, on the **Meals** page |
| **Transport** (did each hired vehicle show up) | Supervisor, on the **Attendance** page | Admin, on the **Transport** page |
| **Accommodation** (rooms, rent) | Admin | Admin, on the **Accommodation** page |
| **Payroll** (who is paid what) | Admin | Admin, on the **Payroll** page (People menu) |

The rule of thumb: **marking happens on the Attendance page** (the only page Supervisors and Site Engineers have); **everything about money is the Admin's**, on the Operations pages.

Money flow: meals and transport and rent are *owed* as they happen. You record a **payment**; the app posts the matching expense on the project (Food, Transport / freight, Accommodation). Voiding a payment removes that expense.

---

## 2. First-time setup (Admin)

1. **Database.** In the Supabase SQL editor run, in order: the other 2026-10 migrations if not run yet, then `2026-10-roles-attendance.sql` (**once only**), then `2026-10-attendance-accountability-transport.sql` (safe to re-run any time; re-run it whenever it changes), then `2026-10-accommodation.sql` (rooms and rent; run after the previous one; also safe to re-run). `2026-10-project-expenses.sql` must exist before payments can post to expenses. Do **not** re-run the older migrations after the roles migration.
2. **Users.** Create each login in Supabase (Authentication → Add user). Then open **Users** in the app: give each person a **name** (this is what stamps show), a **role** and, for a Supervisor or Site Engineer, tick their **sites**. Save.
3. **Vendors.** **Meals → Vendors & prices** (or Settings → Food vendors): pick the project, add every place people eat (for example the accommodation mess and the site canteen) and set each meal's price. Any old vendors under "Not assigned to a project yet" need **Assign to this project**.
4. **Vehicles.** **Transport → Vehicles & prices**: pick the project, add each hired vehicle with its operator, **Per trip** or **Monthly**, and the price. Old vehicles under "not assigned to a project yet" need **Assign to this project**.
5. **Rooms.** **Accommodation → Rooms → Add rooms**: for example 4 non-AC rooms at ₹7,000, then 1 AC room at ₹13,000, with beds per room and the landlord.
6. **People.** Make sure each employee has a **Project** and a **joining date**: they only appear on a site's attendance sheet from their joining date.

---

## 3. Roles at a glance

| | Admin | Site Engineer | Supervisor |
| --- | --- | --- | --- |
| Pages they have | Everything | Attendance only | Attendance only |
| Sites | All | Assigned sites | Assigned sites |
| Mark attendance, meals, vehicle show-ups | Any day (after **Override**) | Today and the next day until 11:00 PM | Today until 11:00 PM |
| Submit the day | Yes | Yes | Yes |
| Verify or reopen the day | Yes | Yes | No |
| Activity tab (who changed what) | Yes | Yes | No |
| Clear a whole day | Yes | No | No |
| Money (prices, bills, payments, rent, errands) | Yes | No | No |

Nothing is locked per person: any role with access to the site can change an entry another role made. Every change is stamped with the person and the time and written to the Activity log, and a higher role's change over a lower role's is flagged as an **override**.

---

## 4. The Attendance page (Supervisor, Site Engineer, Admin)

Open **Attendance**, choose the project (if you have more than one) and the **Daily sheet**.

### 4.1 Work status
Each person has four buttons: **Present**, **Absent**, **Half-day**, **Off**. A person with no mark shows an amber dot ("not marked"). Their **weekly off** day is automatic. Tap Present to override it.

### 4.2 Meals (breakfast, lunch, dinner)
Each person has three meal buttons showing the **vendor**. One tap cycles *none → vendor 1 → vendor 2 → none*; each vendor has its own colour. With more than three vendors a dropdown is used.
- **Meals are recorded for everyone, whatever their work status.** An absent or weekly-off worker still eats, and the company still pays. The buttons are always shown.
- Tapping a meal on someone who is not marked records the meal **without marking them present**. Presence at the job site stays a separate record.
- The vendor is the **place** they ate (accommodation mess or site canteen), which is also who is paid.

### 4.3 Vehicles: did they show up?
The **Transport** card on the sheet lists the project's vehicles. For each vehicle and each direction (**Pickup**, **Drop**) tap **Showed** or **No show**.
- Showed stamps the time from the server's clock. Tap the small time to correct it (for example if recorded later).
- Tapping the chosen button again clears it. For a past day the time starts as a placeholder (07:00 pickup, 18:00 drop) to correct.
- The card summarises "2 showed · 1 didn't show · 1 not recorded".
- Workers' own alternative transport is not recorded, only whether the vehicle showed up.

### 4.4 Quick actions and shortcuts
- **Everyone present**: marks everyone still open as Present (skips weekly off).
- **Quick actions**: *Copy yesterday's attendance*; *Mark as* (Present, Absent, Half-day, Off) for people still open or for everyone (asks first); *Copy yesterday's meals*; *Set a meal for everyone* (one vendor for one meal, for everyone, whatever their status).
- With more than six people: a **search** box and **Open only** (only people still unmarked).
- Every tap saves at once. Bulk actions save, then re-read what is stored.

### 4.5 The day bar: submitting and verifying
Above the transport card:
1. **Day open**: anyone with access can work.
2. **Submit day** (Supervisor, Site Engineer or Admin): "Submitted by Ravi · 18:40, waiting for the Site Engineer". If anything changes afterwards the day goes back to open and needs submitting again.
3. **Verify day** (Site Engineer or Admin): "Verified by Meera · 19:10". The Supervisor can no longer change the day. **Reopen** (Site Engineer or Admin) undoes it.
- **N to review** lists what to check first: people not yet marked, vehicle show-ups not recorded, vehicles that did not show.
- **Clear day** (Admin only, red button): removes everyone's attendance and meals for that project and day and resets the sign-off, after a confirmation. Use it to start a day again from scratch. Vehicle show-ups are kept. It is logged.

### 4.6 Who changed it, and last change
Each row shows who last changed it and when ("Ravi · 08:02", India time from the server). A line under the date shows "Last change: Ravi · 14:32" with a green dot when the live connection is up.

### 4.7 Time windows (enforced by the database)
| Role | May change a day |
| --- | --- |
| Supervisor | That day, until **11:00 PM India time**. Not once the Site Engineer has verified it |
| Site Engineer | That day and the **next** day, until 11:00 PM (one extra day for corrections) |
| Admin | Any day, including future days |

Nobody except an Admin can enter a future day. You can only mark people who are on the project and sites you are assigned to.

### 4.8 Several people at once
The Supervisor at the plant, the Site Engineer and the Admin can have the same day open together.
- Other people's changes **appear by themselves** (live connection, with a check every 25 seconds as a fallback, and when you return to the tab).
- Saves send **only the field you changed**, so two people changing different things for the same person both stay. If two people change the *same* field, the last save wins and both are in the Activity log.

### 4.9 The Monthly tab
Totals per person for a month (days worked = present + ½ per half-day, absent days, breakfasts, lunches, dinners), a calendar per person on phones, the everyone grid on computers, meals by vendor, and two CSV downloads (Totals, Daily). Meal costs are shown to Admins only.

### 4.10 The Activity tab (Admin and Site Engineer)
Every change, newest first: who, their role, what, old → new, the day it was for, and an **overrode Supervisor / Site Engineer** flag. Use **Overrides only** to see just those. The log is written by the database and cannot be edited.

---

## 5. Admin on the Attendance page: view-only and Override

To stop an Admin changing something by accident, the daily sheet opens **view only** for an Admin: all work, meal and vehicle buttons, Everyone present, Quick actions and the day-bar actions are disabled or hidden. A bar says "View only. Tap **Override** to change anything on this day."
- Tap **Override** to make the day editable (the bar turns amber). Your changes are stamped as Admin. Tap **Done** to go back.
- It returns to view only whenever you change the project or the date.
- **Clear one person's day (Override on):** a person who has a record for the day shows a small red **Clear** link. It removes their attendance and meals for that day on this project (after a confirmation), for example someone marked on the wrong project. If they have no other days on the project they also drop off its monthly view and its payroll. Use **Clear day** (section 4.5) to clear everyone.
- While viewing, other people's changes appear on their own. **With Override on** the screen never shifts under you: a blue banner says "Someone else changed this day. Refresh to see it." and **Refresh** applies it. Your own changes never raise the banner.

---

## 6. Sites today (Admin)

**Operations → Sites today**: one card per active project: marked count, how many are working, whether the day is *Not started / In progress / Submitted / Verified* (with the time), and vehicle no-shows. It updates live. Tap a card to open Attendance.

---

## 7. Meals (Admin)

**Operations → Meals**, per project. Marking meals stays on the Attendance page. Tabs:

| Tab | Use it to |
| --- | --- |
| **Overview** | See meals and cost this month, paid and due, a per-vendor table and cost per person per day. Alerts: past days with no meals recorded, meals with no price, bills waiting for approval |
| **Daily log** | See each day's meals by vendor (breakfast · lunch · dinner), total and cost. A "!" marks a past day with no meals. **Open** jumps to that day on the Attendance page to correct it |
| **People** | See each person's meals and cost for the month |
| **Vendors & prices** | Add vendors, hide or show them, set prices (with an "applies from" date; earlier days keep the earlier price) |
| **Bills** | Check a vendor's bill against the meals recorded (see 7.1) |
| **Payments** | Record and void payments (see 7.2) |
| **Reports** | A vendor statement for a month, day by day with amounts, and CSV downloads: statement, food summary, per person |

**How the amount owed is worked out:** every meal recorded on the sheet (whatever the person's work status) × that vendor's price on the day. A meal with no price is counted but not billed. For a month with an approved bill, the approved amount is used instead.

### 7.1 Vendor bills
A vendor may bill you every **week, fortnight or month**, and the bill may differ from what the recorded meals come to. On **Bills**, for the month chosen, each vendor has a card with its bills for the month, a **coverage strip** (one small block per day: green = covered by an approved bill, amber = covered by a bill waiting for approval, grey = meals recorded but no bill yet), and a row per bill showing the **days it covers**, the **meals recorded** for those days, the **vendor's bill**, the **difference** ("Matches", "+₹400 charged more" or "−₹… charged less") and a status.
1. **Record a bill:** choose the vendor; the **From** and **To** days are suggested (the first uncovered stretch of the month, up to a week). Adjust them, or use **week**, **fortnight** or **to month end**. Enter the amount, an optional bill number and note, and a photo or PDF of the bill (up to 5 MB). After recording, the next stretch is suggested, so a month of weekly bills is quick to enter.
2. Use **See the meals** on a bill to open the vendor statement for exactly those days and find where it differs; the Daily log shows each day.
3. **Approve bill** (use the vendor's amount), **Approve meals** (use the computed amount) or **Other…** (your own amount). That becomes **what is due for those days**; the app keeps what the meals came to at the time and who approved.
4. A received bill can be corrected. An approved one must be **Reopened** first. **Void** cancels a bill: its days are free again and the computed amount is used for them.
- **A bill never crosses a month end** (record it as two bills, one for each month) and **two live bills of one vendor never cover the same day** (the database refuses an overlap and says which days). Bills are never deleted.
- **What is due:** for each day covered by an approved bill, the approved amount; for every other day, the computed meal cost. Totals and Due on the Overview follow this however the bills are split.
- Bills do not create expenses, only payments do. Earlier monthly bills became a bill covering their whole month.

### 7.2 Paying vendors
**Payments** tab: choose the vendor, amount, date, reference (UTR) and note, then **Record payment**.
- It posts a **Food** expense on the project by itself (for example "Meals payment · Maruti · UTR123"). **Void** removes the payment's expense.
- Payments are never edited or deleted; a wrong one is voided and entered again.
- The Overview and Daily log show **Billed (all)**, **Paid** and **Due** (all time).

---

## 8. Transport (Admin)

**Operations → Transport**, per project. Tabs:

| Tab | Use it to |
| --- | --- |
| **Overview** | This month by vehicle: showed, no-show, no-show rate, cost, due; days with show-ups not recorded |
| **Daily log** | A day-by-day grid of pickup and drop for every vehicle (✓ showed, ✗ no show, – not recorded). **Open** jumps to that day on the Attendance page |
| **Vehicles & prices** | Add vehicles, choose **Per trip** or **Monthly**, set the price |
| **Errands** | Record extra jobs a vehicle ran that the operator quoted separately |
| **Payments** | Record and void payments |

- **Per trip:** billed only for trips that **showed up**, at the price in force that day.
- **Monthly:** the fixed amount is billed for each month that has records. The **No-show** column shows what to raise with the operator; nothing is deducted automatically.
- **Prices:** the first price you set also applies to earlier days. A later change applies from the date in "New prices apply from" (earlier days keep the old price).
- **Errands:** vehicle, date, what it was for and the quoted amount. They add to that vehicle's balance. Never edited, only voided.
- **Payments:** vehicle, amount, date, reference, note. Posts a **Transport / freight** expense; voiding removes it. **Balance due** per vehicle = billed (trips or months, plus errands) minus paid.

---

## 9. Accommodation (Admin)

**Operations → Accommodation**, per project: the rooms rented for the people on site, whether they hold everyone, and the rent. Rent is paid a **full month in advance**: a month's rent is due on the 1st and shows as overdue after the 5th; a part month is billed in full.

| Tab | Use it to |
| --- | --- |
| **Overview** | Rooms (AC / non-AC), rent per month (and next month), this month's rent paid, outstanding rent, and **Do the rooms hold everyone?** |
| **Rooms** | Add rooms, set beds, landlord and rent, vacate or reopen a room |
| **Rent & payments** | Pay a month's rent and see the status of each room |

- **Do the rooms hold everyone?** compares the total beds with the people on the project (employees with a joining date up to today). If short it says by how many beds and roughly how many more rooms are needed at the current beds per room, with a link to add rooms. Rooms with no bed count are flagged.
- **Add rooms** adds one or several of a kind at once: how many, type, rent, beds each, landlord, date rented. Rooms are named Room 1, Room 2, … and can be renamed. Example: 4 non-AC at ₹7,000, then 1 AC at ₹13,000 gives ₹41,000 a month.
- **Changing the rent:** type the new rent and press **Set**; it applies from the date in "A changed rent applies from" (earlier months keep the old rent). **Vacate** stops rent after the current month; **Reopen** undoes it.
- **Landlord** is a free-text name per room: who is paid. It appears on the payment's expense and helps match bank transfers. It can be left blank.
- **Rent & payments:** pick the month. Each room shows rent, paid, left and status (**Paid / Part paid / Due / Overdue**). **Pay** on a single room, or **tick several rooms** (quick buttons: **Select Non-AC**, **Select AC**, **Select all unpaid**) and make **one cumulative payment**: edit the amount for each ticked room if it is only a part payment, add the paid-on date and reference, then **Record payment (₹total)**. A multi-room payment is one line in the list ("4 rooms", click it to see each room) and posts **one** Accommodation expense (for example "Rent (Oct 2026) · Room 1, Room 2, Room 3, Room 4 · UTR…"); each room still shows its own paid/left. A single-room payment posts "Rent (Oct 2026) · Room 1 · Mr Sharma". **Bills:** attach the landlord's bill or receipt when you record the payment (the **Bill** picker), or later with **Attach bill** on the payment line (**Replace** swaps the file). The bill also shows as **Bill** on the matching expense in the project's Expenses tab. Meals and Transport payments work the same way. **Void** removes the expense; **Void all** on a multi-room line voids the whole payment, or open it and void one room, and the expense is recalculated. **⬇ CSV** exports the month.
- Who sleeps in which room is **not** tracked, only capacity against headcount.

---

## 9b. Payroll (Admin)

**People → Payroll**, per project and month. Everything it does, with worked examples, limits and suggestions: [PAYROLL.md](PAYROLL.md). Design and edge cases: [PAYROLL_PLAN.md](PAYROLL_PLAN.md).

**The rules**
- Salary is for the **calendar month**, calculated on the **last day** of the month on actual attendance, and credited between the **1st and 4th** of the next month.
- Anyone who joined **on or before the 20th** is paid for the month (from their joining date). Anyone who joined **after the 20th** is not in that month's run; the next run pays the **full following month plus the days from joining to the previous month end** (an "Arrears" line).
- **Salaried:** gross × paid days ÷ calendar days (30 or 31). A weekly off is paid; absent and half-days are LOP (a half-day is half a day). **Daily wage:** rate × days worked (a half-day counts half; weekly off unpaid). PF, ESI and Professional Tax follow each person's salary structure, on the actual earnings.
- **Unmarked days block payroll**, so every day of the month must be marked first.

**Set up each person once** (Employees → the person)
1. **Date of joining** and **Project** (they appear on the project's payroll).
2. **Salary** (as for the offer letter: CTC, in-hand, gross or daily wage). Changing it later asks **from which date the new salary applies**, so earlier months keep the old one.
3. **Payroll group:** **Paid by** (bank, UPI or cash), **UPI ID** if UPI, and **Last working day** when they leave (pay and the attendance sheet stop after it).
4. Bank name, account number and IFSC (Statutory & bank group), plus PAN and UAN for the slip.

**Each month**
1. Open **Payroll**, choose the project and month. The **readiness check** lists anything blocking the month: unmarked days (with a link to the attendance day), a missing joining date or salary. Warnings (bank account or UPI ID missing) do not block. People who joined after the 20th are listed as "paid in the next run".
2. **Calculate draft.** Everyone appears with days (present / half / absent / off), LOP, gross, deductions, net and how they are paid; ⚑ flags anything unusual (many LOP days, arrears, joined or leaving this month, salary revised, advance recovery). Tap a person to see every earning and deduction.
3. **Adjust** a person if needed (tap the row): a bonus or other earning, a deduction or fine, or **Waive LOP days** with a reason. After any change the draft shows **out of date**; **Recalculate draft** before approving.
4. **Approve payroll.** It locks the figures, stamps who and when, and records advance recoveries. **Reopen** undoes it (not allowed while salary payments exist; void them first).
5. **Pay tab:** the list of whom to pay: pay by, bank or UPI details, net, paid, left, status (Unpaid / Part paid / Paid / On hold). **⬇ Bank transfer CSV** for a bulk upload; **⬇ UPI list CSV**; per person **Pay** (amount, date, reference), **UPI app** (opens your UPI app pre-filled), **Hold** / **Release** (with a reason), **Slip**. **Mark all bank paid** and **Mark all UPI paid** record a batch with one reference. A banner flags people still unpaid after the 4th.
6. **Salary slips:** on the run tab, **Salary slip (PDF)** per person or **All salary slips (PDF)** (one page each). They show the locked figures: attendance, earnings, deductions, net pay in words and employer contributions.

**Money and expenses**
- Each salary payment adds to **one Salaries & wages expense** for that month on the project (for example "Salaries · Oct 2026 · 24 people paid"); voiding a payment lowers it. The expense is the **net** paid.
- **Statutory tab:** what is to be remitted for the month from the approved payroll (PF: employee + employer + admin / EDLI; ESI: employee + employer; Professional Tax), with due dates (PF and ESI by the 15th of the next month, PT by month end), what has been remitted and what is left. **Record** each remittance (challan number); it posts a **Statutory / compliance** expense. Together the two give the true cost of the people with nothing counted twice.
- **Advances tab:** record an advance (amount, monthly instalment). It is recovered through payroll each month, never more than what is owed or than the net pay available; an advance already recovered from cannot be voided.
- **Project overview → Salary cost:** salaried **CTC** per month and a year, the estimated monthly cost of daily-wage workers, the total cost to the company, by department, and where the latest payroll stands.

---

## 10. Project expenses

The project's **Expenses** tab lists everything, including expenses posted from payments. Those rows show a **From payment** tag instead of Edit and Delete: their amount, date and category cannot be changed. To fix one, **void the payment** (the expense is removed) and record it again. Their note and bill can still be edited. Hand-entered expenses work as before.

Only what is **paid** becomes an expense. What is merely owed (billed meals, trips, errands, unpaid rent) shows as **Due** on its page but is not an expense until it is paid. A vendor, vehicle or room that is not assigned to a project cannot be paid until you assign it.

---

## 11. Routines

**Every day (Supervisor)**
1. Open Attendance; mark everyone (Everyone present, then fix exceptions).
2. Set each person's meals (Set a meal for everyone, then fix exceptions).
3. Mark each vehicle's Pickup and Drop as Showed or No show.
4. Check "N to review", then **Submit day** before 11:00 PM.

**Every day (Site Engineer)**
- Review the submitted day, correct anything, then **Verify day** (until 11:00 PM the next day).

**Weekly (Admin)**
- **Sites today** for any day not submitted or verified. **Meals → Overview** and **Transport → Overview** alerts (days with nothing recorded). **Accommodation → Overview** for capacity.

**Monthly (Admin)**
0. **Payroll:** from the last day of the month, calculate, adjust, approve; pay between the 1st and 4th; record PF / ESI / PT remittances.
1. **Meals → Bills**: record each vendor's bill, compare, approve. Then **Payments**.
2. **Transport**: check no-shows, add errands, record payments.
3. **Accommodation → Rent & payments**: **Select all unpaid** and record one payment for the coming month (rent is in advance).
4. **Meals → Reports** and **Attendance → Monthly** for CSVs; the project's Expenses tab for the cost view.

---

## 12. Messages you may see

| Message | Meaning and what to do |
| --- | --- |
| "Attendance for 26 Oct is locked …" | Outside your time window (section 4.7). Ask the Site Engineer (for a Supervisor) or an Admin |
| "This day has been verified by the Site Engineer." | The Supervisor cannot change a verified day. Ask them to **Reopen** it |
| "That person is not on this project." | The employee's Project on their record is different. Fix it on the employee, or assign them to the project |
| "That vendor is not set up for this project." | Meals can only use the project's own vendors. Add the vendor to this project |
| "That vehicle does not belong to this project." | Same, for vehicles |
| "This vendor or vehicle is not assigned to a project yet." | Assign it to a project first (Meals → Vendors & prices, Transport → Vehicles & prices) |
| "This expense comes from a payment …" | Void the payment instead of editing the expense |
| "This vendor already has a bill covering some of 12 Oct to 16 Oct." | Bills of one vendor cannot overlap. Void that bill first, or choose other days |
| "A bill cannot cross a month end." | Record two bills, one for each month |
| "Only an Admin can clear a day." | Clear day is for Admins |
| No vehicles / vendors listed on the sheet | The Admin has not added any for that project yet |

If a Supervisor sees "No project has been assigned to you yet", tick their site on the Users page. If someone sees "No access yet", give them a role there.

---

## 13. Good to know

- **Time** is India time and comes from the database's clock, not the phone.
- **Money is hidden** from Supervisors and Site Engineers: they never see prices, bills, payments, rent or errands.
- **Weekly off** is worked out from the employee's weekly-off day; changing it later changes how past unsaved days look.
- **One row per person per day**: someone who moves projects mid-day is recorded on one project only.
- **Live updates** need the three attendance tables switched on for Realtime (the migration does it). If the green dot never appears, check Supabase → Database → Replication; the screens still refresh every 25 seconds.
- **Not built:** overtime, leave types, late arrival, per-person alternate transport, room occupancy, vendor-bill checks for transport operators and landlords, offline mode. For payroll, see section 13 of the payroll plan (two-project employees, back-dated revisions, holidays, final settlement).
