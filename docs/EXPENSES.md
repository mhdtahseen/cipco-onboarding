# Expenses: what we owe and what we have spent

**Operations → Expenses** is the one page for company money. It replaces two things that used to live apart:

| Before | Now |
| --- | --- |
| **Payments due** (its own menu item) | The **Due** tab of Expenses. Old links and bookmarks to Payments due open it. |
| The **Expenses** tab inside each project | The **Spent** tab of Expenses, with a project picker. Open a project from Expenses by choosing it in the picker. |

The project page keeps its Overview, People, Forecast and Documents tabs, and the Report. Its Overview still shows "Expenses to date" and the five latest entries, and those link straight to this page for that project.

This guide is for the people who use it. It starts with what is on the screen, then walks through the jobs people actually do, one by one.

---

## 1. Who sees what

This is set on the **Permissions** page (Admin → Permissions), separately for the Due tab and the Spent tab. See [PERMISSIONS.md](PERMISSIONS.md). Out of the box:

| | Admin | Viewer | Operations | Supervisor, Site Engineer |
| --- | --- | --- | --- | --- |
| Open Expenses | yes | yes | yes | no (not in their menu) |
| **Due** tab (reads payroll and bank details) | yes | View | View | no |
| **Spent** tab | yes | View | View | no |
| Add an expense | yes | no | **no** (View only; give them Create to allow it) | no |
| Edit or delete a typed-in expense | yes | no | no (needs Edit / Full) | no |
| Opens on | Due | Due | Due | |

With View, every button that saves or deletes is hidden. If an Admin takes the Due tab away from a role, that role opens on Spent and the page never loads Due for them.

--- | --- | --- | --- | --- |
| Open Expenses | yes | yes | yes | no (not in their menu) |
| **Due** tab (reads payroll and bank details) | yes | yes (look only) | **no** | no |
| **Spent** tab | yes | yes (look only) | yes | no |
| Add, edit, delete a typed-in expense | yes | no | yes | no |
| Opens on | Due | Due | Spent | |

A Viewer can look at everything an Admin can, but every button that saves or deletes is hidden. Operations never see the Due tab, and the page does not load it for them.

---

## 2. The page at a glance

```
Expenses                                   [ All projects v ]  [ + Add expense ]
What we owe and what has been spent, for all projects.

[ Overdue     ] [ Due this month ] [ Spent this month ] [ Forecast next month ]
[ ₹5,96,500   ] [ ₹6,21,000      ] [ ₹31,503          ] [ ₹58,000            ]

  Due (overdue)   Spent
  ───────────────────────────────────────────────
  ...the tab you chose...
```

**The project picker** at the top applies to both tabs and to the four figures. Choose a project and everything on the page narrows to it. Choose "All projects" to go back. The choice is also in the address bar, so you can copy the link and send it to someone.

**The four figures.** Tap one to jump to the tab that explains it.

| Figure | What it adds up | Tab it opens |
| --- | --- | --- |
| Overdue | Everything unpaid whose due date has passed | Due |
| Due this month | Everything unpaid whose due date falls in this month | Due |
| Spent this month | Every expense entry dated this month, from every source | Spent |
| Forecast next month | What is already billed and falls due next month | Due |

Operations see two figures instead: **Spent this month** and **Spent last month**.

"Forecast" here means bills and salaries that already exist and fall due next month. It is not the what-if forecast on a project's Forecast tab, which stays where it is.

---

## 3. The Due tab

Due is the old Payments due report, unchanged in what it calculates. It answers: **who do we pay, how much, by when, and how?**

### 3.1 Three views

| View | Shows | Use it when |
| --- | --- | --- |
| **Pay now** (opens here) | Everything unpaid that is overdue, or falls due this month | Starting a payment run |
| **By month** | One chosen month, by when it falls due, or by the month the cost belongs to | Planning next month, or checking what last month cost |
| **All time** | Everything billed so far | Looking for something old |

**Running costs.** Tick "Show running costs (not billed yet)" to see what this month's meals, trips and hours have cost so far when no bill covers them yet. They are never counted as owed.

### 3.2 Reading a project's table

Each project has its own card: *Billed, Paid, To pay*. Each row is one person or business to pay:

| Column | Meaning |
| --- | --- |
| Pay to | The payee, what it is for, and "show items" to see every amount behind the total |
| Kind | Food, Transport, Accommodation, Gas cylinders, Equipment hire, Salaries, PF/ESI |
| Billed, Paid, To pay | Billed so far, paid so far, and what remains. Money paid beyond the bill is an **advance** and is shown in green |
| Due | "5 days overdue" in red, or "by 9 Nov" |
| How to pay | Bank, account and IFSC, UPI, "Cash", or "Government portal (challan)". "⚠ Bank details missing" means add the details where the payee is set up |

"Month by month" at the top of the page (tap to open) shows what is unpaid by kind and by the month it belongs to.

### 3.3 Leave some payees out, then download the PDF

Every payee has a tick box. Untick the ones you are not paying today; the totals change at once. **Download PDF report** builds the PDF on the server from the same figures and the same ticks, so the PDF and the screen agree to the rupee.

### 3.4 "Not in these totals"

Anything that has no amount yet (for example a bill not approved) is listed at the bottom under "Not in these totals". It is deliberately left out of every figure so a total is never a guess.

---

## 4. The Spent tab

Spent is every expense entry in the company, newest first: what people typed in, what was posted automatically when a payment was made, and what came from an Inventory bill.

### 4.1 The three sources

| Chip | Where it comes from | Can you edit it here? |
| --- | --- | --- |
| **Typed in** | A person added it on this page | Yes: Edit and ✕ |
| 🔒 **From payment** | Posted by itself when a payment was recorded in Meals, Transport, Accommodation, Site supplies (gas, equipment) | No. Open the source (tap the chip) and void the payment there |
| 🔒 **From bill** | Posted by itself when an Inventory bill was recorded | No. Open Inventory and reopen or void the bill there |

The lock is on purpose. If an automatic entry could be edited here it would drift away from the payment or bill it came from.

### 4.2 Filtering

- **Month.** Opens on the current month. Choose "All months" for everything.
- **Category.** One category.
- **Search.** Matches the description, the category and the project name.
- **Source chips.** Switch Typed in, From payment or From bill on and off. A chip that is off hides those entries.
- **Group by.** Date (default), Category, or Project. Each group shows its own subtotal; for Category and Project the biggest comes first.

### 4.3 The total line

At the bottom: **₹31,503 across 6 entries**, and beside it the same sum split by source: *Typed in + From payment + From bill = total*. The total always equals the parts, so if a number looks odd you can see which source it comes from.

### 4.4 CSV

**⬇ CSV** downloads exactly what is on screen (the current filters), with date, project, category, description, source and amount. It opens in Excel with ₹ and names intact.

### 4.5 Bill photos

An entry that has a bill shows a **Bill** button that opens the photo or PDF.

---

## 5. Adding an expense

Press **+ Add expense** (top right on a laptop; the blue button above the bottom bar on a phone). A panel slides in from the right on a laptop, and up from the bottom on a phone.

The fields are in the order people think:

1. **Amount.** Large, and already selected. Type the number.
2. **Category.** Tap a chip. **+ New** adds a category that every project can use.
3. **Project.** Pre-filled if you picked a project at the top, or if only one project is active.
4. **Date.** Today.
5. **What was it for.** Optional, but write something a colleague would understand in a month, such as "Binding wire, 40 kg".
6. **For one person?** Optional. Choose someone on the project to tag the expense to them (advances, tools, boots). Leave as "Whole project" otherwise.
7. **Bill.** Optional. Attach a photo or PDF up to 5 MB. Photos are shrunk on the phone before sending.

**Save** closes the panel. **Save and add another** keeps the project, date and category, clears the amount and the description, and leaves the panel open. It is for a stack of receipts.

If something is missing the panel tells you in plain words ("Enter an amount greater than zero.", "Choose the project.") and keeps what you typed.

---

## 6. Use cases, step by step

### 6.1 Monday payment run (Admin)

1. Open **Expenses**. It opens on **Due → Pay now**.
2. Look at the **Overdue** figure first. If it is not zero, those are the payments that are late.
3. Scroll the project cards. Payees with a red "x days overdue" come first in your head; the due date is shown in every row.
4. Untick anyone you will not pay this week (the figure at the top of the page does not change, but "To pay" in the cards does).
5. Press **Download PDF report** and send it to whoever makes the transfers. It lists the bank details beside every payee.
6. When a payee has "⚠ Bank details missing", add the bank details where that payee is set up (Meals, Transport, Accommodation or the vendor's page), then come back.

### 6.2 "What do we owe in December?" (Admin)

1. Open **Due → By month** and pick December.
2. The **Due in the month** option shows what falls due that month. Choose **Cost belongs to the month** to see what that month cost instead of when it is paid.
3. Or just read **Forecast next month** at the top of the page, which is the same figure for next month.

### 6.3 A supervisor hands over a petty-cash receipt (anyone with Create on Spent)

By default Operations can only look at Expenses. An Admin enters it, or gives Operations **Create** on Expenses → Spent in the Permissions page.

1. Open **Expenses** and the **Spent** tab.
2. **+ Add expense.** Amount first, then category, then the project. Attach the photo of the receipt.
3. **Save and add another** if there are more receipts. **Save** on the last one.
4. The new entry appears at the top of the list marked **Typed in**, and the "Spent this month" figure goes up.

### 6.4 What has one project cost this month? (Admin, Operations, Viewer)

1. Choose the project in the picker at the top.
2. Open **Spent**. The month is already the current one.
3. Read the total line. Change **Group by** to **Category** to see where the money went.
4. **⬇ CSV** if someone wants it in a spreadsheet.

You can also reach this from the project page: **Overview → View all →**, or the **Expenses to date** card. Both land here with the project already chosen.

### 6.5 Checking a number that looks wrong

1. On **Spent**, set **Group by → Category** and find the big one.
2. Look at the source chips. If most of it is 🔒 **From payment**, the amount came from meals, transport, accommodation or gas payments. Tap the chip to go to that page.
3. If it is **From bill**, it came from an Inventory bill. Open Inventory, find the bill, and reopen or void it. The expense comes off by itself.
4. If it is **Typed in**, edit or delete it here.

### 6.6 A typed expense has the wrong amount or project

1. Find it on Spent (search by words in the description).
2. **Edit.** The panel opens with everything filled in. Change what is wrong. If you moved it to another project, the "For one person" tag is cleared because that person belongs to the old project.
3. **Save changes.**

To remove it, use **✕** and confirm. Entries from payments or bills cannot be deleted here; see 6.5.

### 6.7 A new kind of cost

1. Open **+ Add expense.**
2. Tap **+ New** beside the categories, type the name (for example "Safety audit"), and press **Add**.
3. The category is available on every project and in the filter straight away.

### 6.8 A Viewer or an owner reading on a phone

1. Open **Expenses** from **More** in the bottom bar.
2. The four figures sit in two rows. Tap **Overdue** to jump to Due.
3. On Spent, each entry is a card: description on top, then project, category and date underneath. Nothing is editable and no add button appears.

### 6.9 Sending a link to someone

The address always carries the tab and the project, for example `/expenses?tab=spent&project=…`. Copy it from the browser and send it. The other person needs their own login and sees only what their role allows.

---

## 7. Phone, tablet and laptop

| Screen | Spent list | Add panel |
| --- | --- | --- |
| Phone | One card per entry: description, then "project · category · date", amount on the right | Opens from the bottom, 92 % of the screen high |
| Tablet | Same cards, more room | Right-hand panel |
| Laptop | A table-like row: description, project, category, date, amount, source or actions | Right-hand panel, 26 rem wide |

The floating **+ Add expense** button appears only on phones. On a laptop the button is at the top of the page. All fields use 16 px text on touch screens so the page does not zoom when you tap one.

---

## 8. What changed on the project page

- The **Expenses** tab is gone. Its job is done by Expenses → Spent with the project chosen.
- **Overview → Expenses to date** and **Recent expenses → + Add expense / View all** now open Expenses for that project.
- The gas cost card ("what the gas on this project has cost so far") that used to sit at the top of the project's Expenses tab now appears at the top of **Spent** whenever you have chosen a project.
- Forecast, Documents, People and the Report are where they were.

---

## 9. Good to know

- **Nothing in the database changed.** Expenses uses the same tables as before, so no migration is needed and nothing is lost. Existing expenses, categories and bills appear as they were.
- **Due is by payee, not by bill.** It lists who to pay and how much in total, with the individual amounts one click away ("show items"). It does not list every bill as its own line.
- **Dates are India time.** "This month" is the month in India, whatever the phone's setting.
- **Large histories.** The Spent list loads every entry once (in pages of 1,000) and filters on the device, so changing a filter is instant.
- **Spent is what has been recorded as spent.** A cost that is billed but not paid yet shows on Due. It reaches Spent when the payment (or the bill, for Inventory) is recorded.

---

## 10. If something does not look right

| You see | Likely reason | What to do |
| --- | --- | --- |
| No Due tab | You are Operations, or a role without access | Ask an Admin if you need it |
| Spent is empty for a project | The month filter is on the current month | Choose "All months" |
| A typed entry has no Edit button | You are a Viewer | Viewers read only |
| An entry has a lock and no Edit | It came from a payment or an Inventory bill | See 6.5 |
| "has the project-expenses SQL migration been run?" | The expenses table is missing on that database | Tell whoever looks after the database |
| Due says an error and nothing else | The report could not load (a bad row in payroll or accommodation, or a lost connection) | Reload; if it stays, tell whoever looks after the app and quote the message |
| An old Payments due link | The address changed | It forwards to Expenses → Due by itself |
