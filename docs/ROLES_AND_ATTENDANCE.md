# Roles & attendance — how it works

*Documentation for the role-based access (Admin / Site Engineer / Supervisor), the attendance tracker, hired-vehicle transport tracking, the activity log and day sign-off. Read this before changing who can see what, or how attendance is saved. Written 27 Oct 2026; updated the same day for roles, accountability and transport.*

- **Database:** `supabase/migrations/2026-10-roles-attendance.sql` (tables, functions, access rules, the 11 PM lock), then `supabase/migrations/2026-10-attendance-accountability-transport.sql` (new roles, activity log, sign-off, transport; run it second).
- **The list of pages and who may open them:** `src/lib/nav.ts` (one list, read by the menu and the route guard) · **Route guard:** `src/middleware.ts` · **Role helper:** `src/lib/roles.ts` · **Menu and page frame:** `src/components/AppShell.tsx`.
- **Users page:** `src/app/users/page.tsx` · **No-access page:** `src/app/no-access/page.tsx`.
- **Attendance:** `src/app/attendance/page.tsx`, `src/components/AttendanceSheet.tsx`, `src/components/AttendanceMonth.tsx`, `src/components/TransportCard.tsx`, `src/components/DayBar.tsx`, `src/components/ActivityFeed.tsx`, `src/lib/attendance.ts` · **Admin pages:** `src/app/sites/page.tsx` (Sites today), `src/app/transport/page.tsx` (vehicles, prices, payments) · **Food vendors and prices:** `src/components/VendorSettings.tsx` (Settings → Food vendors).

---

## 1. Overview

There are three working roles. The **Supervisor** marks attendance, meals and transport for the site. The **Site Engineer** leads the site: sees attendance only (no employee records, documents or other details), can correct the Supervisor and verify the day. The **Admin** runs several sites, sees everything, and sees who changed what. (An older **Staff** role still works like a Site Engineer with access to everything except Users; it is no longer offered on the Users page.)

Every attendance and transport change is stamped with the person, their role and the server's time, and written to a log that nothing can edit.

Short answers:

- **How do I add a user?** Create the login in Supabase (Authentication → Users), then on the app's **Users** page give it a name, a role and, for a Supervisor or Site Engineer, the sites. Section 5.
- **What will they see?** Admin: everything plus Users, Sites today and Transport. Site Engineer and Supervisor: the Attendance page for their assigned sites only. A login with no role sees "No access yet". Section 6.
- **How do I see who changed attendance?** Each row shows "name · time". The **Activity** tab lists every change with old and new value, and flags overrides. Section 9a.

---

## 2. Roles at a glance

Every login has exactly one role. Higher roles can overrule lower ones; a lower role cannot change what a higher role set (Supervisor < Site Engineer < Admin).

| Capability | Admin | Site Engineer | Supervisor | No role |
| --- | --- | --- | --- | --- |
| Employees, letters, forms, documents, salary, Aadhaar and bank details | Yes | No | No | No |
| Quotations, projects, expenses, project documents, settings | Yes | No | No | No |
| Users page (name, role, assigned sites) | Yes | No | No | No |
| Sites today overview, Transport page (set up vehicles, prices, errands, payments) | Yes | No | No | No |
| Attendance page, Monthly view, CSV downloads | Yes, all projects | Assigned sites | Assigned sites | No |
| Meal prices and meal cost | Yes | No | No | No |
| Mark attendance, meals and transport show-ups (Showed / No show) | Any day | Today and yesterday until 11:00 PM | Today until 11:00 PM | No |
| Change an entry the Supervisor set (attendance, meals or transport) | Yes (stamped) | Yes (stamped) | Yes | No |
| Change an entry the Site Engineer set | Yes | Yes | No | No |
| Change an entry the Admin set | Yes | No | No | No |
| Submit the day | Yes | Yes | Yes | No |
| Verify or reopen the day | Yes | Yes | No | No |
| Edit a verified day | Yes | Yes | No, until reopened | No |
| Activity tab (who changed what) | Yes | Yes | No | No |
| Enter a future day | Yes | No | No | No |

(The Site Engineer's "yesterday" window runs until 11:00 PM the next day. Staff are treated as Site Engineers with access to everything except Users.)

The public candidate form needs no login and is not affected. A login with no role is stopped at "No access yet".

---

## 3. How access is enforced

Access is checked in three places, and only the third cannot be bypassed from a browser. Each one assumes the one before it might fail.

1. **The menu (convenience only).** The sidebar (desktop), icon rail (tablet) and bottom bar with slide-out menu (phone) show just the links a role may use. Hiding a link does not stop someone typing an address, so it is not a security measure. The pages and the roles allowed on each are declared once, in `src/lib/nav.ts`; the route guard in the next step reads the same list, so the menu and the guard cannot disagree.
2. **The route guard (the server, on every request).** Before any page or data call is served, the app looks up the signed-in user's role and applies these rules:
    - Admin: everything.
    - Staff: everything except the Users page.
    - Supervisor and Site Engineer: only the Attendance pages. Any other page redirects to Attendance; any other data call is refused with "Not allowed" (403). This includes the file upload and file viewing routes.
    - No role: only the "No access yet" page.
    - The public candidate form is exempt, because candidates have no login.
3. **The database rules (the real lock).** Supabase applies a rule to every table that decides who may read or write each row. After the roles migration, all the earlier tables (employees, letters, documents, quotations, projects, expenses and the rest) accept only Admin and Staff. The Supervisor's or Site Engineer's browser talks to Supabase directly under the supervisor's own login, so even someone who got past the menu and the guard would be refused the data.

A Supervisor or Site Engineer still needs names to mark attendance. One database function, `attendance_roster`, hands back only name, employee number, designation, weekly-off day and joining date, and only for people on a project the supervisor is assigned to. Aadhaar, bank details, salary and documents are never part of that answer.

If the roles table does not exist yet (the migration has not been run), the guard treats every login as Admin, so deploying the new code before the database change locks nobody out. Once the migration runs, the guard does one small role lookup per request.

---

## 4. The Users page

The Users page is where an Admin decides what each login can do. Only Admins can open it; Staff are redirected away, and the database refuses anyone else the data behind it.

What it shows and does:

- Lists every login in the system with its email and the date of its last sign-in. The list comes from a database function that only Admins can call, because emails live in Supabase's own login table, which the app cannot read directly.
- Each login has a **Name** box (this is what stamps and the activity log show, so "Ravi", not an email), a role dropdown (Admin, Site Engineer, Supervisor or No access; "Staff (old)" appears only for logins that still have it) and a Save button enabled only when something changed.
- Choosing Supervisor or Site Engineer reveals a checkbox list of the active projects. Tick the sites that person handles.
- Saving stores the name and role and replaces that login's project assignments with the ticked ones. Choosing No access removes the role and the assignments.
- A short card row explains what each role can do.

Safeguards built in:

- You cannot change your own role. Your row is marked "you" and its dropdown is disabled, so you cannot demote yourself by accident.
- Only Admins can read or change the role tables, enforced in the database as well as on the page.
- Closed projects are not offered for assignment.

What it does not do: it does not create logins, delete logins, or reset passwords. Those are done in Supabase (see section 5).

How the first Admin came about: when the roles migration ran, it gave the Admin role to every login that already existed. Any login created after that has no role, and sees "No access yet", until an Admin sets one here.

A role change applies on the person's next request. The menu updates the next time they load a page, and the database rules apply immediately to anything they query.

---

## 5. Creating a new user

The reliable way today is two steps: create the login in Supabase with a password, then give it a role in the app. Inviting by email does not work end to end yet, because the app has no page to finish an invitation.

**Steps that work now**

1. Open your Supabase project, then **Authentication → Users → Add user → Create new user**.
2. Enter the person's email and a password. Tick **Auto Confirm User** so no confirmation email is needed. Click Create.
3. Sign in to the app as an Admin and open **Users**. The new email is listed with the role "No access".
4. Choose the role. Enter their name (it appears on every change they make). For a Supervisor or Site Engineer, tick the sites they handle. Click **Save**.
5. Give the person the site address, their email and the password, by a private channel. They sign in on the normal login page and land on what their role allows.

If they sign in and see "No access yet", no role was saved. If they see "No project has been assigned to you yet", no site was ticked.

**Can I use an email that is already in the database?**

Yes for the email as text; no for any automatic link. Employees have an email field, and you can copy it into the Supabase Add user form. But logins and employees are separate: the app does not connect a login to an employee record, so a Supervisor's login is not "the employee" in the system. Two practical limits: each login email must be unique, and an employee with no email on file has nothing to copy.

**Why "Invite user" does not work smoothly yet**

Supabase's Invite button emails a link. That link opens your site with a one-time token in the address and expects the site to turn it into a signed-in session and ask for a password. The app's login page only handles email and password; it has no page for invitation links, no password-reset page and no change-password page. The login page itself says "Forgot your password? Ask an administrator to reset it." So invited people would arrive at the login page with no way to set a password, and the same applies to Supabase's password recovery email. Until that page exists, an Admin sets or resets passwords in Supabase directly.

| Way to add a login | Works today | What happens |
| --- | --- | --- |
| Create new user with a password in Supabase | Yes | Person signs in at once; you share the password privately |
| Invite user by email in Supabase | Not end to end | Email arrives, but the app cannot finish the invitation or set a password |
| Add user from the Users page | Not built | Needs a server-side feature (see section 14) |

**Why the app cannot create logins itself.** Creating a login needs Supabase's service key, a very powerful secret that can bypass every rule in the database. The app does not hold it, on purpose. Adding it as a server-only feature is possible and is the first improvement suggested in section 14.

---

## 6. What each role sees

A Supervisor or Site Engineer signs in, lands on Attendance, and has no other page to go to. Admin sees everything.

| Role | Lands on after sign-in | Menu | On the Attendance page |
| --- | --- | --- | --- |
| Admin | Employees list | Employees, Attendance, Sites today, Transport, Projects, Quotations, Clause library, Mail templates, Quotation wording, Settings, Users | Every project; Daily sheet, Monthly, Activity |
| Staff (old role) | Employees list | The same, without Users | Every project |
| Site Engineer | Attendance | Attendance only (no sidebar or bottom bar), plus Sign out in the account menu | Assigned sites; Daily sheet, Monthly, Activity |
| Supervisor | Attendance | Attendance only | Assigned sites; Daily sheet and Monthly only |
| No role | "No access yet" page | None; Sign out in the account menu | Not reachable |

**What a Supervisor or Site Engineer sees in detail**

- A project dropdown listing only their assigned sites. If none is assigned: "No project has been assigned to you yet. Please ask an admin."
- Tabs: **Daily sheet**, **Monthly** and (Site Engineer only) **Activity**.
- On the Daily sheet: the day bar, the Transport card, and the people with their work and meal buttons. Meal prices and costs are not shown to them.
- On the Monthly tab: totals per person, calendars, the everyone grid, meal counts per vendor and the two CSV downloads, without cost figures.

**What they cannot reach:** employee records, salary, Aadhaar, PAN, bank details, letters, forms, uploaded documents, quotations, projects, expenses, settings, Users, Sites today, Transport page, prices and payments. A page typed into the address bar redirects back to Attendance and a data request is answered "Not allowed".

**The "No access yet" page** says the login works but an Admin has not given it a role.

---

## 7. The daily attendance sheet

The daily sheet shows one card per person on the chosen project and date. Each card has a work status and, for each meal, the vendor who served it. Every tap saves immediately.

**Who changed it.** Every row shows who last changed it and when ("Ravi · 08:02", India time from the server). On a computer this is the last column, "Ride · last change", which also notes whether the person was on a pickup or drop. On a phone it sits at the top right of the card. An entry set by a more senior role is shown but its buttons are disabled for a lower role ("Ravi can't change what the Site Engineer set"). In bulk actions, such rows are skipped.

**Who appears.** People assigned to the project (the Project field on their employee record) who are not rejected and have a joining date on or before the day. People with no joining date do not appear. Someone who already has an attendance row on that project and day stays visible even if they have since moved.

**The date.** It opens on today in India time, with previous and next buttons, a date picker and a "Go to today" link. Supervisors and Staff cannot pick a future day; Admins can.

**Work status.** Four buttons per person:

| Status | Counts toward days worked |
| --- | --- |
| Present | 1 |
| Half-day | 0.5 |
| Absent | 0 |
| Off (weekly off) | 0, not a working day |

A person with no saved row shows "not marked". The weekly off is automatic: if the day matches the weekly-off day on the employee record (Sunday unless changed), the card shows weekly off without saving anything. Tapping Present overrides it.

**Meals are separate from work status.** Whatever a person's status (Present, Half-day, Absent, Off, or not marked at all), their meals are the company's responsibility, so the three meal buttons (Breakfast, Lunch, Dinner) are shown for **everyone**, on phones and computers. Each meal records the **vendor**, which is where the person ate (for example the accommodation mess or the site canteen) and so who is paid. One tap cycles none, then the first vendor, then the second, then none again, and each vendor has its own colour so a column can be scanned. With more than three vendors a dropdown is used instead. Tapping a meal for someone not yet marked records the meal only; it does **not** mark them present, so presence at the job site stays a separate record. A person can therefore have a meal with no work status.

**Summary and shortcuts**

- A summary at the top. On a phone: "N of M marked" with a thin progress bar, small counts for Present, Half-day, Absent and Off, and one line of meal counts. On a computer: a one-line strip of the same counts plus "Open" (not yet marked).
- **Everyone present** in the bottom bar marks everyone still open as Present, skipping people on their weekly off. The bar also shows "N still open" or "All marked".
- **Quick actions** (a drop-down on a computer, a collapsible section on a phone), in two groups:
    - **Attendance:** **Copy yesterday's attendance** gives each person still open the status they had yesterday (present, half-day or absent; yesterday's weekly off is not carried over). **Mark as** sets a status (Present, Absent, Half-day or Off) for **People still open** or for **Everyone**. Choosing Everyone changes people already marked, so it asks "This changes N people who are already marked. Continue?" first. Meals are left as they are.
    - **Meals:** **Copy yesterday's meals** repeats yesterday's vendors for everyone who had a meal recorded yesterday, whatever their work status, and **Set a meal for everyone** applies one vendor (or no meal) to one meal for everyone on the sheet, including people who are absent, on a weekly off or not marked.
- With more than six people, a search box and an **Open only** button appear, so the last few unmarked names are easy to find.

**How saving behaves.** One row is kept per person per day. A single tap updates the screen at once and reverts with a red message if the database refuses it, for example because the day is locked. Bulk actions save, then re-read what is stored and compare, so the screen cannot disagree with the database; if fewer rows saved than expected it says "Only X of Y were saved". When a bulk action has nothing to do, it says why, for example "Everyone is on their weekly off (Sunday)".

**On a phone.** A calm layout with colour used sparingly. The date is a large centred label with previous and next arrows; tapping it opens the date picker. Each person is a white card with a name, role and a soft segmented control for Present, Absent, Half-day and Off (the chosen one is a white pill with a coloured label). A small amber dot beside a name means not yet marked. The three meal buttons are shown on every card, whatever the person's status, each showing the vendor with a small coloured dot. All tap targets are at least 44 px, text in fields is 16 px so iPhones do not zoom in, and a bar pinned at the bottom shows how many are still open with the **Everyone present** button.

**On a computer (1024 px and wider).** The sheet becomes a compact roster instead of a card per person, so a whole crew fits on screen. Each person is one row of about 50 px: name and role, the four work buttons joined into one small control (the chosen one is tinted green, red, amber or grey), and a chip per meal showing the vendor in its colour (a dashed chip means no meal). One toolbar holds the date controls, search, **Open only**, **Quick actions** (a drop-down with Copy yesterday's meals and Set a meal for everyone) and **Everyone present**, with a one-line summary (Present, Half-day, Absent, Off, Open, and meal counts) under it. On screens 1280 px and wider the toolbar stays pinned while you scroll. Buttons here are about 32 to 36 px high because a mouse needs smaller targets than a thumb; phones and tablets keep 44 px.

**On a tablet (768 to 1023 px).** Two cards per row with the same 44 px touch targets as a phone.

---

## 7a. Transport (hired vehicles: did they show up?)

Workers are ferried from their accommodation to the job site and back by autos, jeeps or buses hired locally. The transport tracker answers one question each day: **did each vehicle show up, or did the workers have to find their own way?** It sits inside the daily sheet, above the roster, and is independent of attendance (people can be marked present whether or not the vehicle came).

- **Transport is project based.** A vehicle is set up under one project; the Supervisor and Site Engineer see only their own site's vehicles. A vehicle used on two sites is added once per site.
- **Per vehicle, per direction.** Each vehicle has a **Pickup** and a **Drop**, each marked **Showed** or **No show**. Marking Showed stamps the time from the server's clock (tap the small time to correct it, for example if recorded later). Tapping the chosen button again clears it. For a past day the time starts as a placeholder (07:00 pickup, 18:00 drop) to correct. The card summarises "2 showed · 1 didn't show · 1 not recorded". No passenger list is kept.
- **The Site Engineer has the same transport access as the Supervisor on the daily sheet**: mark Showed / No show and correct times. Neither can set up vehicles, prices, errands or payments; that is the Admin's. **The Site Engineer can overrule the Supervisor's transport record** (stamped, flagged "overrode Supervisor" in the activity log, no reason needed); the Supervisor cannot change a record the Site Engineer or Admin set. Each leg shows who recorded it.
- **Windows and locks** are the same as attendance: Supervisor that day until 11:00 PM, Site Engineer that day and the next, Admin always; nothing for the future; nothing for the Supervisor once the day is verified. Every record, switch, time correction and clearing is stamped with who and when, and appears in the activity log ("Pickup · Auto 1 · showed up 07:02").
- **How vehicles are paid.** Set per vehicle on the **Transport** page (Admin): **per trip** or **monthly**, with a price (per trip, or per month). The first price set for a vehicle also applies to any earlier days; a later change applies from the chosen date (today by default) and earlier days keep the price in force.
    - *Per trip:* billed only for trips that showed up, at the price in force on that day.
    - *Monthly:* the fixed amount is billed for each month that has records (at the price in force on that month's first record). The **No-show** column shows days the vehicle missed, so a deduction can be raised with the operator; nothing is deducted automatically.
- **Errands.** Extra jobs a vehicle runs that the operator quotes separately are entered by the Admin under **Errands**: vehicle, date, what it was for and the quoted amount. They add to that vehicle's balance. Like payments they are never edited or deleted, only voided.
- **Payments** are recorded per vehicle (amount, date, reference such as a UTR, note) and belong to the vehicle's project. They are never edited or deleted; a wrong one is voided and re-entered. **Balance due** per vehicle = billed (trips or months, plus errands) minus paid.
- **Who sees money.** Only Admin (and old Staff) see prices, errands, payments and balances. The Supervisor and Site Engineer only mark Showed / No show.

---

## 7b. Day sign-off

The **day bar** above the transport card shows the state of the day:

1. **Day open.** Anyone with access can work.
2. **Submitted** by the Supervisor ("Submitted by Ravi · 18:40 — waiting for the Site Engineer"). If anything changes afterwards (a status, meal or transport record) the day returns to open and needs submitting again.
3. **Verified** by the Site Engineer or Admin ("Verified by Meera · 19:10"). The Supervisor can no longer change the day; the Site Engineer or Admin can, or can **Reopen** it.

The "N to review" link lists exceptions before signing off: people not yet marked, transport not recorded (a vehicle direction with no Showed / No show) and vehicles that did not show. These are prompts, not blocks; the day can still be submitted. Submit, verify and reopen are stamped and appear in the activity log.

---

## 8. Meals, vendors and prices

A meal belongs to a vendor, a vendor can have a price per meal, and the monthly view multiplies the two. Prices are optional: without them meals are still counted, only the cost is left out. **Prices and meal costs are visible to Admin (and old Staff) only**; the Supervisor and Site Engineer see meal counts without costs.

**Vendors are project based.** Each project has its own vendors and so its own prices; a Supervisor or Site Engineer sees only their project's vendors, and a meal can only use a vendor of its own project (the database refuses another). Managed in **Settings → Food vendors**, with a project selector at the top: add, rename, hide or show. Because a meal records where the person ate, add every place people eat (for example the accommodation mess and the site canteen) as a vendor of the project. The older vendors Maruti and Plant Mess are assigned to the project that used them most when the migration runs; any left over appear under "Not assigned to a project yet" with an **Assign to this project** button. A hidden vendor disappears from the daily sheet buttons but stays on past records, and stays visible on a person's card if it was already chosen for them.

**Prices.** Each vendor has three price boxes: breakfast, lunch and dinner, in rupees. Fill in only the meals that vendor serves; an empty box means no price. The page has a **Prices apply from** date, set to today by default.

- Saving writes a new price record dated from that day. Days before it keep the earlier price, so changing a price never rewrites an old month.
- The price used for a day is the latest record dated on or before that day.
- Saving again with the same date updates that record rather than adding another.
- To enter a price that applies to a month already under way, set the date to the start of that month first.
- A price cannot be cleared from the page once set; change it to the right figure instead.

The example prices mentioned when this was designed (Maruti breakfast 50, Plant Mess lunch 53, Maruti lunch 100, Maruti dinner 100) have not been entered. They go in these boxes, with the date they started.

**Cost.** For each meal with a vendor on a day, cost is that vendor's price for that meal on that day. In a month with 69 Maruti lunches at ₹100 and 69 Maruti dinners at ₹100, Maruti's cost is ₹13,800. A meal with a vendor but no price for its date is counted and left out of the cost, and the monthly view says so: "Some meals have no price set for their date, so they aren't in the cost."

---

## 9. The rules, windows and who can overrule whom

Rules live in the database, not just on the screen, so a phone with a wrong clock or a tampered page cannot get around them. Time is India time from the database's clock.

**Windows**

| Role | May change a day |
| --- | --- |
| Supervisor | That day, until 11:00 PM. Not once the Site Engineer has verified it |
| Site Engineer | That day and the next day, until 11:00 PM (one extra day for corrections) |
| Admin | Any day, including future days |

Nobody except Admin can enter a future day. The lock applies to new entries as well as edits and to transport records. A person must currently be on the project (not checked for Admin). Supervisors and Site Engineers must be assigned to the site.

**Ranks.** Each attendance entry remembers the rank of whoever last set it (Supervisor 1, Site Engineer 2, Admin 3). A role can change entries at its own rank or lower; it cannot change a higher one. When a higher role changes a lower role's entry, the entry takes the higher rank, so the Supervisor cannot silently undo the correction, and the log marks it as an override. No reason is required.

**Messages from the database**, shown in red if a change is refused:

- "Attendance for 26 Oct is locked (it locks at 11:00 PM that day). Ask the Site Engineer or an Admin to change it." (Site Engineer: "…the next day. Ask an Admin…")
- "This day has been verified by the Site Engineer. Ask them to reopen it."
- "This entry was set by the Site Engineer and can't be changed by a Supervisor."
- "Attendance cannot be entered for a future date."
- "You are not assigned to this project." / "That person is not on this project." / "You do not have access to attendance."
- "Only the Site Engineer or an Admin can verify a day."

**What the screen shows.** An amber banner "Locked at 11:00 PM · view only", a blue "Verified by the Site Engineer · view only", and for Admin a blue "Locked for others, you're editing as Admin".

---

## 9a. The activity log (who changed what)

Every change is written to `attendance_log` by the database itself (triggers), so it cannot be skipped from the app and nothing can edit or delete a line. Each line holds: time, user name and role, site, the day it was for, person, what changed (work, breakfast, lunch, dinner, pickup, drop, trip, trip time, trip vehicle, day), old value, new value, the action (create, change, delete, submit, verify, reopen) and, for overrides, the role that was overruled. Changes made in one bulk action share a transaction number.

The **Activity** tab (Admin and Site Engineer) shows the newest first, with an **Overrides only** filter and "Show more". Example: "Meera (Site Engineer) work: Ajay Mahto absent → present · for 2026-10-26 · overrode Supervisor". Names come from the Users page; if none is set the email is used.

---

## 10. The monthly view and exports

The Monthly tab turns a month of daily taps into days worked per person and meals and cost per vendor. It is read-only and is open to every role with attendance access, limited to the projects each can see. Meal cost columns appear for Admin only.

**Controls.** Month and year dropdowns with previous and next buttons, and two downloads: **Totals CSV** (one line per person) and **Daily CSV** (one line per person per saved day).

**Per person.** Days worked is present days plus half a day for each half-day. Weekly off and absent days add nothing. Each person also shows absent days, and breakfast, lunch and dinner counts, plus meal cost where prices exist.

**On a computer**, a grid with a row per person and a column per day, coloured letters for the status (P, A, ½, W), and Days, Absent, B, L, D columns at the right. The name column stays in place while you scroll sideways. Days before someone joined and days still ahead are left blank; a past day with nothing saved shows a dot.

**On a phone**, a card per person with the same totals. Tapping a card opens that person's month as a calendar: each day shows its number, the status letter and three small dots for breakfast, lunch and dinner, coloured by vendor (grey means no meal). Tapping a day shows its status and the vendor for each meal. A button, "Show everyone's grid (swipe sideways)", opens the full grid for everyone.

**Meals by vendor.** A table of breakfasts, lunches and dinners per vendor with the cost and a total row. If any meal has no price for its date, a note says so.

| Download | Columns |
| --- | --- |
| Totals CSV | Name, Emp no., Days worked, Absent days, Breakfasts, Lunches, Dinners, Meal cost |
| Daily CSV | Name, Emp no., Date, Status (empty if only meals were recorded), Breakfast vendor, Lunch vendor, Dinner vendor |

Both files are named after the project and the month, for example "MAN Unit 2 - attendance totals 2026-10.csv", and open in Excel. They contain names and employee numbers only; no Aadhaar, bank or salary details.

---

## 11. What was added to the database

Everything is in one migration file, `supabase/migrations/2026-10-roles-attendance.sql`, which is safe to run more than once. It adds five tables, six functions and a lock, and changes the access rules on the existing tables.

**New tables**

| Table | Holds | Key points |
| --- | --- | --- |
| user_roles | One role per login | Role is admin, staff or attendance; deleted automatically if the login is deleted |
| user_projects | Which projects a Supervisor or Site Engineer may handle | One row per login and project |
| food_vendors | Vendor names | Name unique ignoring case; active flag; sort order |
| meal_rates | Price per vendor, meal and start date | Meal is breakfast, lunch or dinner; price not negative; one row per vendor, meal and date |
| attendance | One row per person per day | Status is present, absent, half or off; three optional vendor columns; who last changed it and when; unique per person and date |

**New functions**

| Function | What it does |
| --- | --- |
| app_role | Returns the signed-in login's role |
| is_admin, is_staff | True for Admin; true for Admin or Staff |
| can_attend | True for Admin or Staff, or a Supervisor or Site Engineer assigned to that project |
| admin_list_users | Admins only: every login with email, last sign-in, role and projects |
| attendance_roster | Names, employee numbers, designations, weekly-off days and joining dates of people on a project, for a date range |
| attendance_guard | A trigger on attendance that enforces the lock and the project rules |

**Who can read and write what**

| Tables | Read | Write |
| --- | --- | --- |
| Employees, letters, mail templates, clauses, employee documents, candidate links, quotations and wording, departments, expense categories and expenses, document types and project documents | Admin, Staff | Admin, Staff |
| Projects | Admin, Staff, and a Supervisor or Site Engineer for assigned projects | Admin, Staff |
| user_roles, user_projects | Each login its own row; Admin all | Admin |
| food_vendors | Admin, Staff, and a Supervisor or Site Engineer for vendors of their assigned projects | Admin, Staff |
| meal_rates | Admin, Staff | Admin, Staff |
| attendance | Admin, Staff, Supervisor or Site Engineer for assigned projects | Same, plus the lock rules |

The migration also seeds every existing login as Admin, adds the vendors Maruti and Plant Mess, and tightens an old unused file-storage rule to Admin and Staff.

**Second migration: `2026-10-attendance-accountability-transport.sql`** (run after the first; safe to re-run)

| Change | What it does |
| --- | --- |
| Roles | Allowed roles become admin, staff, site_engineer, supervisor; existing "attendance" logins are renamed supervisor. `role_rank`, `rank_name`, `app_rank` give the ranking; `can_attend` now covers supervisor and site_engineer |
| user_profiles | A display name per login; `user_label` returns the name (or email); `admin_list_users` now returns names |
| meal_rates | Readable by Admin and Staff only (was any role) |
| food_vendors | New `project_id`: vendors belong to a project (name unique within a project); readable only for the user's own projects; existing vendors go to the project that uses them most |
| attendance.status | May now be empty, so a meal can be recorded for someone not marked (the status default is removed). A meal's vendor must belong to the row's project |
| attendance_days | Per site and day: submitted by/at, verified by/at. Written only by `day_submit`, `day_verify`, `day_reopen` |
| attendance_log | Append-only log, written by triggers; readable by Admin, Staff and Site Engineer for assigned sites; no insert, update or delete policy |
| attendance | New columns `rank`, `set_by_role`; `attendance_guard` enforces windows, ranks and the verified-day lock; `attendance_audit` writes the log and returns a submitted day to open |
| transport_vehicles, transport_rates | Vehicles belong to a project (`project_id`; a name is unique within a project) paid per trip or monthly (`billing`), with a price and effective date. Vehicles readable by Admin/Staff and by assigned Supervisors and Site Engineers for their own project only, written by Admin/Staff; rates Admin/Staff only |
| transport_runs | One row per vehicle, day and direction (pickup / drop): showed (with a server time) or no_show. Same windows and locks as attendance, only a vehicle of the same project, correction and clearing logged |
| transport_errands | Extra jobs quoted by the operator and paid by us; Admin/Staff only; never edited or deleted, only voided; each takes its vehicle's project |
| transport_payments | Ledger, Admin/Staff only; each payment takes its vehicle's project. Cannot be edited or deleted; can be voided once |
| Functions | `check_write`, `write_window_end`, `log_change`, `touch_day`, `day_submit`, `day_verify`, `day_reopen` |

---

## 12. Security review: what is protected and what is not

A Supervisor or Site Engineer cannot read personal or financial data, change another project's attendance, or edit a locked day, and the database enforces each of these on its own. A handful of smaller exposures remain, listed below with their real impact.

**What is protected**

| Risk | How it is stopped |
| --- | --- |
| A Supervisor or Site Engineer reads employee records, salary, Aadhaar, bank details | Database rules refuse the query; the guard refuses the page and data routes |
| They open uploaded documents or bills | The file routes are behind the guard; files are private and served by short-lived links |
| They mark attendance for a project they do not handle | Refused by the database ("You are not assigned to this project") |
| Entering or editing a day outside their window, or a future day | Refused by the database for everyone except Admins |
| A Supervisor overwrites a Site Engineer's or Admin's entry | Refused by the database; Admin overrides are stamped and logged |
| Editing the activity log or a payment | No write policy on the log; a trigger blocks edits and deletes of payments |
| They change roles, vendors or prices | Role tables accept writes only from Admins; vendor and price tables only from Admin and Staff |
| A login with no role | Stopped at "No access yet"; the database returns nothing |
| Candidates using the public form | Unchanged; it still works only through its own limited functions |

**Gaps and honest notes**

1. ~~Supervisors can see meal prices.~~ Fixed by the second migration: meal prices, transport prices and payments are Admin/Staff only.
2. **A Supervisor or Site Engineer can read the full record of an assigned project** (name, location, description, status), not just its name.
3. **A Supervisor or Site Engineer can use the reference-number function.** The number counter function that quotations use is callable by any signed-in user. It exposes no data, but a direct call could skip a quotation number.
4. **Old Staff logins are not limited to particular projects.** New logins should use Site Engineer, which is.
5. ~~No history of changes.~~ Fixed by the second migration: the activity log keeps who, when, old and new value. Note that the log holds names and roles as they were at the time.
6. **An Admin can demote another Admin.** The only guard is that nobody can change their own role. Keep the recovery SQL in section 15 to hand.
7. **No two-step sign-in and no in-app password management.** Passwords are set by an Admin in Supabase and shared by hand.
8. **Future tables must opt in.** Any new table should use the new role rules (`is_staff()`); copying the older "any logged-in user" pattern would expose it to supervisors.

---

## 13. Known limits

The tracker records who worked and who ate where, and stops there. It does not yet turn that into pay, expenses or alerts.

**Attendance itself**

- No overtime hours, leave types, late arrival or early leave; the work states are Present, Absent, Half-day and Off.
- No in and out times, shifts, location check, photo or biometric proof. Transport stamps record when a show-up was logged, not GPS.
- No reminders for people left unmarked. The approval step is submit then verify; it does not block anything downstream yet.
- No fuel or distance, no automatic deduction for no-show days on monthly vehicles, no per-person alternate-transport record, and transport cost is not posted into project expenses.
- No way to edit several days at once or to import a month of attendance.
- One row per person per day, so someone moving projects mid-day is recorded on one project only.
- The weekly off is worked out, not stored. If an employee's weekly-off day is changed later, past unsaved days will show the new off day.
- The lock time (11:00 PM) and the time zone (India) are fixed in the database, not settings.

**Connections to the rest of the app**

- Days worked do not yet feed daily-wage cost or pay; the daily-wage estimate still assumes a fixed number of days a month.
- Meal cost is not posted into project expenses; the Food expense is still entered by hand.
- Attendance is not shown on the project page or in the project report.
- Someone appears on a sheet only if they have a Project and a joining date on their employee record.

**Roles and users**

- One role per login: Admin, Site Engineer, Supervisor (and the old Staff). No custom roles or per-permission settings.
- Site Engineers and Supervisors are limited to assigned sites; old Staff are not.
- Logins are created, reset and deleted in Supabase; the app has no invite, password-reset or change-password pages.
- A login is not linked to an employee record.

**Smaller points**

- A meal price cannot be cleared after it is set, only corrected.
- Vendors can be hidden but not deleted, which protects past records.
- Deleting an employee deletes their attendance records with them.

---

## 14. How it can be better

The first three items would make the biggest difference: adding users without leaving the app, protecting the last Admin, and handling late entries. The effort figures are estimates in working days.

| # | Improvement | Why it matters | Effort (days) |
| --- | --- | --- | --- |
| 1 | Add users from the Users page: email, role and projects in one form, plus proper invitation, set-password, reset and change-password pages | Removes the trip to Supabase and makes invitation emails work. Needs the Supabase service key kept on the server only | 1 to 1.5 |
| 2 | Block demoting the last Admin, and require two-step sign-in for Admins | Prevents a lock-out and protects the most powerful logins | 0.5 |
| 3 | A way to handle late entries: a grace period after 11:00 PM, or a Supervisor's request that an Admin approves | The last hour of the day is currently closed to supervisors | 0.5 |
| 4 | ~~Hide meal prices and cost totals from supervisors~~ | Done in the second migration | – |
| 5 | Use real attendance for daily-wage cost and pay | Replaces the fixed 26-day estimate with days actually worked | 1 |
| 6 | Post the monthly meal cost into project Food expenses, with a confirm step | Ends double entry and keeps project cost current | 0.5 |
| 7 | ~~A change history for attendance~~ | Done: activity log | – |
| 7b | Post transport cost and payments into project expenses; per-site transport report | Ends double entry, shows cost per site | 0.5 to 1 |
| 7c | Alerts on unverified days and vehicles that did not show several days running | Catch gaps earlier than the Admin's manual look | 0.5 |
| 8 | An Attendance tab on the project page and headcount per day in the project report | Puts attendance beside people and costs | 0.5 |
| 9 | Optionally link a login to an employee, and invite from an employee's record using the email on file | Makes "supervisor" a known person, not just a login | 0.5 |
| 10 | Overtime hours, leave types and late arrival | Needed if pay depends on them | 1 |
| 11 | Evening reminders listing who is not yet marked | Fewer gaps before the lock | 1, plus a messaging service |
| 12 | More roles, such as HR without salary access, or Finance with expenses only, and Staff limited to projects | Fits a larger team | 1.5 to 2 |
| 13 | Keep the role lookup in a short-lived cookie | Saves one small query per request; matters only at much larger scale | 0.25 |
| 14 | Offline mode with later sync | Only worth it if site signal becomes unreliable; today it is stable | 2 or more |

Items 1 to 3 can be done together in about two days and leave the system comfortable to hand to a Supervisor without supervision.

---

## 15. Setup and recovery

Run the database change last, then check you can still sign in. The code can go out before the database change safely, because until the roles table exists the guard treats everyone as an Admin.

**Order**

1. Run the other 2026-10 migrations first (candidate links, quotations, projects and departments, daily-wage wording, expenses, project documents). The roles migration locks the tables that exist when it runs.
2. Run `2026-10-roles-attendance.sql` in the Supabase SQL editor once, before the accountability migration. Do not run it again afterwards: it would try to restore the older versions of functions the accountability migration replaced. If you need to apply later changes, re-run only `2026-10-attendance-accountability-transport.sql`. Every existing login becomes an Admin.
3. Sign in and confirm you see **Users** in the menu and can open Employees.
4. Make sure the code for these screens is committed and deployed; it is separate from the database change.
5. Run `2026-10-attendance-accountability-transport.sql` (it renames existing "Attendance clerk" logins to Supervisor and adds the activity log, sign-off and transport).
6. On the Users page give everyone a name, set Site Engineer or Supervisor and tick their sites. On **Transport** add the vehicles and how each is paid (per trip or monthly) and its price.
7. Create the Supervisor's and Site Engineer's logins, and try each from their own account on a phone.

**Recovery commands.** Run these in the Supabase SQL editor, which works whatever the app's own rules say. Replace the example emails and project name.

See who has which role:

```sql
select u.email, r.role
from auth.users u left join public.user_roles r on r.user_id = u.id
order by u.email;
```

Make a login an Admin (also fixes a locked-out Admin):

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'your-login-email@example.com'
on conflict (user_id) do update set role = 'admin';
```

Assign a site to a Supervisor or Site Engineer:

```sql
insert into public.user_projects (user_id, project_id)
select u.id, p.id from auth.users u, public.projects p
where u.email = 'supervisor@example.com' and p.name = 'MAN Unit 2'
on conflict do nothing;
```

Remove someone's access:

```sql
delete from public.user_roles
where user_id = (select id from auth.users where email = 'supervisor@example.com');
```

**Loading attendance by SQL.** The guard triggers also block writes from the SQL editor, because there is no signed-in user. To load or correct many rows that way, pause them, then restore them straight after. Changes made this way are not stamped with a person (the log records no user):

```sql
alter table public.attendance disable trigger attendance_guard_trg;
-- your inserts or updates here
alter table public.attendance enable trigger attendance_guard_trg;
-- (the exact trigger names are in the migration files; check with: select tgname from pg_trigger where tgrelid = 'public.attendance'::regclass;)
```

**Undoing the access rules.** This puts the earlier "any signed-in user can do anything" rule back on every older table, which exposes employee data to supervisors. Use it only as an emergency step, and afterwards review the attendance screens, which assume the new rules.

```sql
do $$ declare t text; begin
  foreach t in array array['employees','clauses','letters','mail_templates','employee_documents','form_invites','quotations','quote_library','projects','departments','expense_categories','project_expenses','document_types','project_documents'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "staff all" on public.%I', t);
      execute format('create policy "auth all" on public.%I for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;
```

---

## 16. How it was tested

The security rules and the attendance screens were tested against a copy of the real database rules, not against the live Supabase project, so a first look at the live system is still worthwhile.

**What was tested**

- **The migration**, run on a fresh in-memory Postgres database with stand-ins for Supabase's login pieces. It ran without errors.
- **The database rules**, exercised as an Admin, a Staff login and a supervisor. A supervisor could not read employees, could read the roster of their own project only, could save and update attendance for it, and was refused for another project's person, a future day and a locked day. An Admin could edit a locked day. A supervisor could not list users or change vendors.
- **The attendance screens**, run with the real code against those rules: Everyone present, setting a meal for everyone, the one-tap meal buttons, search and Open only, the Monthly tab with correct totals and cost, the month and year dropdowns, and the everyone grid.
- **The app in real Chrome** with iPhone 13 emulation and real touch taps, using the real route guard and the real Supabase library against a stand-in server: tapping Monthly, opening a person's calendar, tapping a day, and Everyone present, with no errors.
- **The date, lock and price logic**, checked directly: today in India time, locked and future days, weekly off, the price in force on a date, and days worked.

**Second round (roles, transport, sign-off).** The accountability migration was run in an in-memory Postgres after the first one (63 checks pass), covering: rank protection and override logging, the Supervisor and Site Engineer windows, the verified-day lock, future days, one pickup and one drop per person, append-only log and payments, and money hidden from non-Admin roles. The screens were run in real Chromium at 1440 and 390 px as Supervisor and as Admin: marking vehicles Showed / No show, stamps on rows, the review list, submitting and verifying, the Activity tab, Sites today, the Transport page with a recorded payment and errand, and the Users page. No sideways scroll or page errors.

**What was not tested**

- The live Supabase project, including real sign-in, invitation and password emails, and the second migration on real data.
- The Site Engineer login as its own browser run, time corrections in the browser, and the Transport page below 390 px.
- The Users page and the Food vendors settings, in a browser with real data.
- A real phone, and Safari or Firefox specifically; native date pickers vary by browser.
- The exact moment of the 11:00 PM cut-off in real time. The rule was checked for yesterday (locked), today (open) and tomorrow (refused), but not by waiting for 11:00 PM.
- Heavy use: many Supervisors, or projects with hundreds of people.
