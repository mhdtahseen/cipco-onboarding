# Site supplies: gas cylinders and hired equipment

A step-by-step guide to the **Site supplies** page (menu: **Operations → Site supplies**), which brings gas cylinders and hired cranes, manlifts and trucks together: who does what, every tab, the money rules with worked examples, where each figure goes, the database behind it, and the limits. Written 5 Nov 2026; it replaces the separate gas and hired-equipment guides. For attendance, meals, transport and rent see [OPERATIONS_GUIDE.md](OPERATIONS_GUIDE.md); for roles see [ROLES_AND_ATTENDANCE.md](ROLES_AND_ATTENDANCE.md).

---

## 1. In one page

The page covers two kinds of supply, for the project picked at the top:

- **Gas (oxygen, LPG).** **Cylinders are not rented.** You pay a **deposit** once per cylinder, and pay for each **refill**. When the truck comes it brings full cylinders and takes the empties, so the number of cylinders you hold does not change on a normal swap. There is no rent, and it does not matter how long a cylinder has been with you.
- **Hired equipment.** Machines billed by **hours or days**. They are logged with **Start** and **Stop**, verified, and checked against the vendor's bill. No booking is needed.

The page is organised by the job, not by the supply:

| Tab | What it is for | Who sees it |
| --- | --- | --- |
| **Today** | Start and stop machines, see the cylinder count, record a truck visit, see today's entries | Everyone with access |
| **Orders** | Gas orders: raise, approve, purchase order PDF | Everyone with access (Supervisors view only) |
| **Log** | Every entry by date for a month, with an All / Gas / Equipment filter; verify hours; void mistakes | Everyone with access |
| **Bills & payments** | Gas cost to date, vendor bills compared with site records, payments, for both supplies with a filter | Operations, Admin, Viewer |
| **Deposits** | The deposit each gas vendor holds, checked against the cylinders you hold | Operations, Admin, Viewer |
| **Setup** | Vendors, products, machines, rates and terms | Operations, Admin, Viewer |

| Question | Where the answer is |
| --- | --- |
| Is a machine working right now? How many cylinders do we hold? | **Today** |
| What is on order, and what has arrived? | **Orders** |
| What came, went or worked on a given day? Which hours need verifying? | **Log** |
| Does a vendor's bill match our records? | **Bills & payments** |
| Is the deposit the vendor holds the right amount? | **Deposits** |
| What do we still owe? | **Payments due** report |

The old `/gas` and `/equipment` links still work and open this page.

---

## 2. Who can do what

| | Supervisor | Site Engineer | Operations | Admin | Viewer |
| --- | --- | --- | --- | --- | --- |
| See the page | not yet (see below) | not yet | yes | yes | yes, read-only |
| Start, stop, add a stretch of work | yes | yes | yes | yes | no |
| Record truck visits, lost and damaged cylinders | yes | yes | yes | yes | no |
| Correct or void an entry | their own, for 24 hours | any | any | any | no |
| **Verify** equipment hours | no | yes | yes | yes | no |
| Raise a gas order (edit or cancel it until approved) | no | yes | yes | yes | no |
| Approve or reject an order, mark sent, close, cancel | no | no | yes | yes | no |
| See rates, amounts, bills, deposits | no | no | yes | yes | yes |
| Record bills, payments and deposits | no | no | yes | yes | no |
| Set up vendors, products, machines, rates, terms | no | no | yes | yes | no |
| Vendor **bank details** | no | no | no | yes | yes (read-only) |

**Supervisors and Site Engineers do not see the page yet.** It is built for phones for them (big buttons, no prices), but one line in `src/lib/nav.ts` keeps it off: `SITE_ROLES_GET_CONSUMABLES = false`. Set it to `true` and the menu, the phone bottom bar and the page guard all open up, with no other change. They then see only Today, Orders and Log. Until then Operations and Admin make the entries.

**Prices are hidden in the database, not just on the page.** Rates, terms, order prices, bills, payments and deposits live in tables that only Operations, Admin and the read-only Viewer can read.

**Role names.** In the database Operations is stored as `staff`. A **Viewer** can look at everything and cannot change anything.

---

## 3. First-time setup (Admin or Operations)

### 3.1 Database

Run these in the Supabase SQL editor, in this order. All are safe to run more than once, and all are already applied on the live database.

1. `2026-11-gas.sql`: vendors, products, orders, cylinder entries, serial numbers, rates, terms.
2. `2026-11-consumables.sql`: bills, payments, deposits, and the equipment tables.
3. `2026-11-payee-bank.sql`: the Admin-only bank-details table.
4. `2026-11-gas-chandan.sql`: per-product deposits, the lost / damaged / transport charges, the vendor's address, and **Chandan Gases Co**.

The old rent columns and the `gas_rent_billed` table are still in the database, unused and out of sight. Nothing reads them.

### 3.2 Gas vendor (**Setup → Gas: rates & terms**)

1. Under **Vendors for [project]**, tick the vendors that supply the project you picked at the top. Site Engineers can only order from ticked vendors, and a delivery can only be recorded for a ticked vendor.
2. **Add a vendor** (if new): name, contact person, phone, GSTIN, address. Use **Make inactive** to retire one: it disappears from new orders but its history stays.
3. **Vendor bank details** (Admin only): holder name, bank, branch, account number, IFSC, UPI. This feeds the **Payments due** report. The holder name should be exactly what the vendor's account says.
4. **Add a product**: vendor, product name (for example *Oxygen*, *LPG*), capacity (optional), and the **deposit per cylinder** (paid once per cylinder, and refundable when the cylinder goes back). Each product has its own deposit.
5. **Rates**: choose the product, the rate **per cylinder before GST**, the GST %, and the date it applies **from**. A new rate applies to orders approved on or after its date. Orders already approved keep the rate that was locked on them. **Rate history** lists every rate.
6. **Terms** (choose the vendor):

| Field | What it means | Used for |
| --- | --- | --- |
| Transport per delivery trip (₹) | Charged on each trip, with no GST | Bill comparison, order card, PO |
| Lost cylinder charge (₹ each) | Charged for each cylinder lost on site | Bill comparison, PO (the deposit the vendor keeps is taken off: see 6.2) |
| Valve + cap damaged (₹ each) | Charged for each cylinder whose valve and cap are damaged | Bill comparison, PO |
| GST on lost and damaged charges (%) | Added to the lost and damaged charges, not to transport | Same |
| Pay 1st–15th bills by day | Due day (same month) for bills dated the 1st to the 15th | Payments due |
| Pay 16th–end bills by day | Due day (next month) for bills dated the 16th onwards | Payments due |
| Wording printed on the purchase order | Free text shown at the foot of the terms | PO PDF |

The vendor's notice period and free-delivery minimum are stored on the vendor (not shown in this form). When set, they produce warnings on a new order; for Chandan Gases Co both are 0, so no warnings appear.

### 3.3 Current live setup: Chandan Gases Co

| | |
| --- | --- |
| Vendor | Chandan Gases Co, Plot No. 235-236-237, GIDC Anjar, +91 99099 77099 |
| Project | CSL |
| Oxygen | ₹280 per cylinder + 18% GST, deposit ₹8,000 |
| LPG | ₹2,861 per cylinder + 18% GST ("as on today's rate": add a new rate whenever it changes), deposit ₹3,000 |
| Transport | ₹1,500 per delivery trip, no GST |
| Lost cylinder | ₹12,500 + 18% GST |
| Valve + cap damaged | ₹1,500 + 18% GST |
| Payment days | 25th / 10th, **assumed**: the quotation states none. Change under Terms when known. |
| Bank (from the cheque) | RK GAS WORLD, YES Bank, Gandhidham, A/C 045373800000208, IFSC YESB0000453 (check that the account name matches the vendor before paying) |
| Deposit paid | ₹24,000 for 3 oxygen cylinders (3 × ₹8,000) |

### 3.4 Equipment vendor, machines and rates (**Setup → Equipment & rates**)

1. **Vendors for [project]**: tick the vendors whose machines may be logged on the project you picked at the top. A machine cannot be logged on a project unless its vendor is ticked.
2. **Add an equipment vendor**: name, contact person, phone, GSTIN. **Make inactive** retires a vendor without losing history.
3. **Vendor bank details** (Admin only, under each vendor): holder, bank, branch, account number, IFSC, UPI. This feeds **Payments due**.
4. **Add equipment**: the vendor, a **name** (for example *50T crane*, *Manlift A*), the **type** (Crane, Manlift, Truck, Other) and an optional **number / ID** (registration or the vendor's unit number). Manlifts and trucks are added the same way as cranes.
5. **Rates**: choose the machine and set:

| Field | Meaning |
| --- | --- |
| Billed per | **Hour** or **Day** |
| Rate (₹) | Per hour, or per day |
| Minimum hours per day | Hourly only: a day with any work is billed for at least this many hours |
| Round up to (min) | Hourly only: the day's time is rounded **up** to a multiple of 15, 30 or 60 minutes (or *Exact*) |
| Overtime after (h/day) | Hours in a day after which the overtime rate applies (leave blank for none) |
| Overtime rate (₹/h) | The rate for each hour past that threshold |
| GST % | Added to the day's charge (default 18) |
| From | The first day this rate applies |

A new rate applies to work from its date. Earlier work keeps the earlier rate. Each machine in the list shows its current rate in words, or **no rate yet** in amber.

---

## 4. Gas orders (the **Orders** tab)

An order is a request for cylinders for one project from one vendor. It carries **quantities only**; prices are attached when it is approved.

### 4.1 Raising an order (Site Engineer, Operations or Admin)

1. Open **Orders → New order** (or the **New order** button on **Today**).
2. Choose the **vendor** (only vendors ticked for the project are offered), **Needed by** date (defaults to two days ahead), then one or more **products with a quantity** (**+ Add another product** for more), and an optional note.
3. Warnings you may see: *the vendor asks for N hours' notice, so this date may be too soon*, and *delivery is free from N cylinders; this order is fewer*. Both come from the vendor record and only appear when set.
4. **Send for approval** (for Operations / Admin it reads **Place order**). The order is numbered **GAS-0001, GAS-0002, …** and its status is **Waiting for approval**. Operations and Admin get a phone notification.

Until it is approved, the person who raised it (and Operations / Admin) can **Edit** it or **Cancel order**.

### 4.2 Approving (Operations or Admin)

On the order card:

- **Approve**: the **rate in force today** is locked onto every line. If any product has no rate yet, approval stops with *"No rate is set for X yet. Add it under Rates & terms, then approve."* The Site Engineer who raised it is notified. Rates & terms is under **Setup → Gas: rates & terms**.
- **Reject**: asks for a reason, which the Site Engineer sees.

After approval:

- **Purchase order PDF**: opens the order as a PDF to send to the vendor (see 4.4).
- **Mark as sent to vendor**, **Close order**, **Cancel order**.

### 4.3 Order statuses

| Status | Meaning |
| --- | --- |
| Waiting for approval | Raised, not yet decided. Editable. |
| Approved | Rates locked. Waiting to be sent or delivered. |
| Sent to vendor | You marked it sent. |
| Partly delivered | Some of the ordered cylinders have arrived (linked deliveries). |
| Delivered | Deliveries linked to the order cover the whole quantity. |
| Closed | You closed it. |
| Rejected / Cancelled | Not going ahead. |

The order card shows, line by line, *delivered X of Y*. For Operations / Admin it also shows the locked rate, the **order total including GST**, and the transport charge (see 6.2).

### 4.4 The purchase order PDF

Built on the server, so it cannot be edited. It shows the order number and date, the vendor (name, phone, address, GSTIN), the project and **Needed by** date, each product with quantity, rate, GST and amount, then **Cylinders ordered**, **Amount before GST**, **GST** and **Order total**. Under the total a line states the transport charge ("Plus transport: ₹1,500.00 per delivery trip, no GST, charged on delivery"); transport is **not** in the order total. The **Terms of supply** list the refundable deposit per product, the transport charge, the lost and damaged charges, and the wording from the vendor's terms. There is no seal or payment-days text unless you add it under Terms.

---

## 5. Truck visits, lost and damaged cylinders

### 5.1 How a trip works

Each vendor visit is one **trip**: the **new full cylinders come in and the empties go back out on the same visit**. The app records them together so they share one date, challan number and photo. The trip charge is counted **once per trip**, and the pick-up is part of the trip, not a second charge.

### 5.2 Recording a trip (Supervisor, Site Engineer, Operations, Admin)

1. **Today → + A truck came: cylinders in / out**.
2. Leave **What happened** on *Delivery trip: new cylinders in, empties out*.
3. Set the **Date** (not in the future), the vendor's **challan number**, optionally the **order** it is for (so the order's *delivered X of Y* updates and the locked rate is used), and optionally a **challan photo** (taken or chosen on the phone, up to 5 MB).
4. For each product enter **New (full) in** and **Empties out**. Leave a box empty or 0 if nothing came or went. Under **Serial numbers (optional)** type the cylinder numbers (commas, spaces or new lines).
5. **Save trip.** The deliveries are saved first, then the pick-ups.

Checks: serial numbers cannot outnumber the cylinders; you cannot take back more empties than you hold (counting what arrives on this trip); the project's vendor must be ticked for the project.

### 5.3 Lost and damaged

Choose **Lost** or **Damaged (valve / cap)** in **What happened**, then the product, how many, and optional serial numbers, challan and note. These reduce the count of cylinders with us, like a pick-up, and are charged at the vendor's lost / damaged charge (see 6.2). A cylinder cannot be marked lost or damaged beyond what you hold.

### 5.3a Inventory and the JSL portal

Each trip with cylinders delivered makes **one entry in Inventory** (kind *Gas delivery*), already recorded, with the products, the challan number, the order and the challan photo. It adds nothing to expenses. An Admin can send it to the JSL portal from there. Voiding the delivery here takes it off that entry, unless it has already gone to the portal. See "Gas deliveries" in `INVENTORY.md`.

### 5.4 Fixing a mistake

In the **Log** tab, an entry's cylinders and quantity cannot be edited. **Void** it (it stays in the list, marked void, and the count corrects) and enter it again.

- A **Supervisor** can void their own entry for 24 hours.
- A **Site Engineer, Operations or Admin** can void any entry.

### 5.5 What each entry shows

Date, who entered it and when, the vendor, the challan number, the order it is linked to, serial numbers, a **Challan photo** link, and **Void**. The labels are *Delivered (new, full)*, *Picked up (empties)*, *Lost*, *Damaged (valve / cap)*.

---

## 6. The cylinder count and gas charges

### 6.1 Cylinders with us (**Today** tab)

For each product on the project: **with us** = full cylinders in − empties out − lost − damaged. A normal swap (3 in, 3 out) leaves the count unchanged. **Today** also lists **Expected deliveries**: approved orders not yet fully delivered. The app does not track how many of the cylinders you hold are full or empty.

### 6.2 Every charge the app calculates

Refills and the lost and damaged charges include GST; transport has none. Rates before GST come from the rate list; the three charges use the vendor's terms.

| Charge | Rule |
| --- | --- |
| **Refills** | quantity × rate × (1 + GST %). An entry **linked to an order** uses the rate **locked on that order**; an unlinked one uses the rate **in force on its date**. |
| **Transport** | **number of trips** × transport charge, with no GST |
| **Lost** | lost cylinders × (lost charge × (1 + GST %) − that product's deposit), never below zero. **The vendor keeps the deposit**, so only the extra is paid. |
| **Valve + cap damaged** | damaged cylinders × damaged charge × (1 + GST %) |

**What counts as one trip.** Delivery entries on the **same day with the same challan number** are one trip, so a truck bringing oxygen and LPG together is one trip. With no challan number, entries on the same day for the same order are one trip. **Two trucks on one day need different challan numbers to count as two trips.** A pick-up never adds a trip, and a visit that only collects empties, with no new cylinders, is **not counted** as a trip. This is why the challan number should always be entered.

**A lost oxygen cylinder at Chandan Gases Co:** ₹12,500 + 18% GST = ₹14,750, less the ₹8,000 deposit the vendor keeps = **₹6,750** to pay. This treatment is our understanding of how the vendor will settle it; check it against their first such bill.

**Worked example:** 3 oxygen and 2 LPG on one challan, plus 1 oxygen cylinder lost.

| | Working | ₹ |
| --- | --- | --- |
| Oxygen refills | 3 × 280 × 1.18 | 991.20 |
| LPG refills | 2 × 2,861 × 1.18 | 6,751.96 |
| Lost oxygen | 1 × 12,500 × 1.18 − 8,000 | 6,750.00 |
| Transport | 1 trip × 1,500, no GST | 1,500.00 |
| **Total** | | **15,993.16** |

---

## 7. Logging equipment hours

### 7.1 The **Today** tab (Supervisor, Site Engineer, Operations, Admin)

One card per machine on the project:

- **Not running / Running since 09:15 · 1 h 20 m**, and **Today so far** (all of today's time for that machine).
- **▶ Start** begins the clock (the time is taken from the phone, in Indian time). **■ Stop** ends it. The running time updates by itself.
- A machine can only run once at a time: starting it again says *"is already running"*.
- A running entry can be stopped by anyone working on the project, even if someone else started it.

Below the cards, **Today's entries** lists every stretch with its times, hours, who entered it and whether it is verified.

### 7.2 Adding a stretch afterwards

Forgot to tap Start? Use **Add a stretch afterwards** (also **Add a stretch of work** on the **Log** tab):

1. Choose the **machine** and the **date** (not in the future), then the **start** and **stop** times.
2. Optionally tick **Machine broke down** and add a note (for example *lifting the boiler section*).
3. **Save.**

Rules: the stop must be after the start on the same date (for a stretch across midnight, enter two entries); one entry cannot be longer than 24 hours; times cannot be in the future.

### 7.3 Verifying (Site Engineer, Operations, Admin)

On a stopped entry press **Verify**. It then shows *verified by [name]*. Entries not yet verified show **not verified** in amber. A running machine cannot be verified. **Any change to the times clears the verification**, so verified hours are always the ones as saved.

### 7.4 Correcting and voiding

- **Correct** changes the start and stop times, the breakdown flag and the note. The machine, project and who entered it cannot change.
- **Void** removes an entry from the calculation (it stays listed, marked void).
- A **Supervisor** can correct or void **their own** entry for 24 hours; a **Site Engineer, Operations or Admin** can correct or void any entry.

### 7.5 The **Log** tab

Pick a **month**. Each day with work is a card listing the entries; the header shows how many hours were logged that month and how many are **to verify**. For Operations / Admin, each day card also shows the **amount before GST** per machine for that day.

---

## 8. How hours become money

### 8.1 The rules

1. All of a machine's entries **that start on the same day** (Indian time) are added together. Voided entries and entries still **running** are left out.
2. That day's total is charged **once**:
   - **Hourly:** round the day up to the rounding step, raise it to the minimum hours, then charge the normal rate for the hours up to the overtime threshold and the overtime rate for the hours past it.
   - **Daily:** one day's rate for any day with work, plus overtime hours past the threshold at the overtime rate.
3. GST at the rate's GST % is added.
4. A day with **no rate in force** is not counted, and **Bills & payments** warns you.

### 8.2 Worked examples (crane at ₹1,500/h)

| Day's work | Setting | Billable hours | Before GST |
| --- | --- | --- | --- |
| 3 h | minimum 4 h | 4 | ₹6,000 |
| 5 h 10 min | rounded up to 30 min | 5.5 | ₹8,250 |
| 9 h | overtime after 8 h at ₹2,000 | 8 + 1 overtime | ₹14,000 |
| Day-rate machine, 2 h | ₹12,000 per day | (one day) | ₹12,000 |
| Day-rate machine, 10 h | ₹12,000/day, overtime after 8 h at ₹1,800/h | one day + 2 overtime | ₹15,600 |

**A month in full** (hourly ₹1,500; minimum 4 h; round up to 30 min; overtime after 8 h at ₹2,000; GST 18%):

| | Working | ₹ |
| --- | --- | --- |
| Day 1: 09:00–11:00 and 14:00–15:30 | 3.5 h, raised to the 4 h minimum → 4 × 1,500 | 6,000 |
| Day 2: 9 h 20 min | rounded up to 9.5 h → 8 × 1,500 + 1.5 × 2,000 | 15,000 |
| Before GST | | 21,000 |
| GST 18% | | 3,780 |
| **Total** | | **24,780** |

---

## 9. Bills and payments (Operations / Admin)

Gas and equipment share one list. The **Show** filter narrows bills and payments to **Gas** or **Equipment**, each bill carries a badge saying which it is, and the vendor list is grouped by supply.

### 9.1 Gas cost to date

The card at the top of **Bills & payments** (also on the project's **Expenses** tab) shows what gas has cost so far, **counted when it is delivered**: refills, trips, lost or damaged, then **Gas cost so far**.

| Box | Meaning |
| --- | --- |
| Approved on bills | The total of the amounts you approved on vendor bills |
| Paid (in expenses) | What you have paid. This is what the project's Expenses list shows. |
| Delivered, not yet billed | Gas cost so far minus approved, never below zero |

The deposit appears as a note: it is refundable, so it is not part of the cost.

### 9.2 Recording a vendor's bill

**Record a vendor bill.**

1. Choose the **vendor**, enter the **bill number** and **bill date**, the **dates the bill covers** (from, to), and the **amount on the bill including GST**. Attach a photo or PDF of the bill (up to 5 MB).
2. A live line under the form shows **what the site records (cylinder entries or logged hours) come to for those dates** and whether the bill is the same, or how much more or less.
3. **Record bill.** It starts as *To compare and approve*.

### 9.3 Comparing and approving

Each bill shows **Vendor billed**, **Site records come to** and the **Difference** (green *Matches* when within ₹1). **How the site records add up** lists the lines. For gas these are the charges in 6.2; for equipment, per machine, the days, billable hours and amount. Warnings tell you when:

- cylinders or days of work have **no rate set** (they are not counted),
- some hours are **not verified yet**,
- a machine is **still running** (it is not counted until stopped).

Then choose:

- **Approve ₹X (as billed)**: you accept the vendor's figure.
- **Approve ₹Y (site records)**: shown when they differ; you pay what the delivery records support.
- **Approve another amount…**: type your own, for example after agreeing a correction with the vendor.

Anything on a vendor's bill that the app does not calculate (mobilisation, operator, fuel) shows up as a difference you can accept or question.

Approval records both the approved amount and the site-records figure at that moment. **Reopen** returns an approved bill to *To compare and approve*; **Void** removes it (it stays listed, marked void); **View bill** opens the attachment.

Only **approved** bills count as owed.

### 9.4 Paying

**Payments to vendors → Record payment**: vendor, amount, date, and a reference (UTR or cheque number). Saving **posts an expense to the project**, in the category **Gas** or **Equipment hire**. **Void** a payment and its expense is removed. Payments are never edited: void and re-enter. Each vendor shows **Approved**, **paid**, and either **pending** or **advance**.

### 9.5 The Payments due report

**Operations → Expenses → Due tab** (formerly Payments due) lists gas and equipment hire as separate categories per project, from **approved bills** only, with what is paid, what is pending, the **bank details** (Admin sees them), and how many days overdue. Payments are applied to the oldest approved bill first. For gas, a bill dated the 1st–15th is due on the first due day of the same month, and one dated the 16th or later on the second due day of the next month. Equipment has no payment-days rule, so the due date is the bill date. Bills not yet approved are listed under "not included".

---

## 10. Deposits (Operations / Admin)

A deposit is **refundable money the vendor holds for you, never an expense**. It is not in project expenses, gas cost to date or Payments due.

Record each one under **Deposits**: vendor, **Deposit paid** or **Refund received**, amount, date and reference. For each vendor the tab shows:

- **Paid**, **Refunded**, **Kept for lost cylinders**, and **Vendor holds**.
- What is expected for the cylinders you hold, per product, for example *3 with us × ₹8,000 = ₹24,000*.
- A check of the two: they match; more is due (you hold more cylinders than the deposit covers); or the vendor holds more than needed (due back, unless more cylinders are coming). A deposit paid before any cylinder is recorded shows as paid in advance.

Voiding an entry keeps it listed, marked void.

**A lost cylinder:** the vendor keeps its deposit, and you pay the rest of the lost charge (see 6.2). **A damaged cylinder** reduces the count, so its deposit shows as due back, and the damage charge is billed separately.

---

## 11. Where each figure goes

| Event | Project expenses | Gas cost to date | Payments due |
| --- | --- | --- | --- |
| Order approved | no | no | no |
| Refills delivered, trip, lost, damaged | no | **yes** | no |
| Cylinders delivered (an Inventory entry is made, stock only) | no | no | no |
| Equipment hours logged or verified | no | no | no |
| Vendor bill recorded (not approved) | no | no | listed as "not included" |
| Vendor bill **approved** | no | no | **yes** (billed) |
| Payment recorded | **yes** (Gas / Equipment hire) | no | reduces pending |
| Deposit paid or refunded | no | no | no |

Project expenses are **cash-based** (what has been paid); gas cost to date is **accrual-based** (what has been delivered). The project's expense projection still treats gas and equipment as other running costs.

---

## 12. A typical day

1. **Morning.** The crane arrives at 9:30: tap **Start** on **Today**. At 12:30 tap **Stop**.
2. **Truck.** The gas truck comes: **+ A truck came**, with the challan number and photo, full cylinders in, empties out, linked to the order.
3. **Evening.** The Site Engineer opens **Log** and presses **Verify** on the hours.
4. **Bills.** Record each bill under **Bills & payments**, read the comparison, approve, then record the payment when paid.
5. **New cylinders.** If you now hold more cylinders than before, **Deposits** shows the extra deposit due.
6. **End of the project.** Send the cylinders back and record the **Refund received**.

---

## 13. Troubleshooting

| You see | Cause and fix |
| --- | --- |
| "The Gas SQL migration has not been run yet" or "the 2026-11-consumables.sql migration has not been run yet" | A migration in section 3.1 is missing |
| "No rate is set for X yet" when approving | Add the rate under **Setup → Gas: rates & terms**, then approve |
| "That vendor is not set up for this project" | Tick the vendor under **Vendors for [project]** in Setup |
| "Only N of these cylinders are at this site" | You are taking back or marking lost more than you hold; check earlier entries in **Log** |
| A delivery shows no price in the bill comparison | The product has no rate in force on that date |
| Trips look doubled | Two entries on one day have different challan numbers, or one is blank on a different order |
| "[Machine] is already running" | Stop the running entry first |
| "The end time must be after the start time" | Fix the times; split a stretch across midnight into two entries |
| "A Supervisor can correct their own entry for 24 hours. Ask the Site Engineer" | Ask a Site Engineer, Operations or Admin |
| "Stop the machine before verifying its hours" | Stop it, then verify |
| "N days of work have no rate set" | Add the rate under **Setup → Equipment & rates**, with a **From** date on or before those days |
| Bill difference is not zero | See **How the site records add up**. Typical causes are a different rate, an entry nobody made, different rounding or minimum hours, or a charge the app does not calculate |
| A vendor has "Bank details missing" in Payments due | Admin: add them under **Vendor bank details** in Setup |
| No Start button on a machine | The project is closed: history and bills stay, but no new work is logged |

---

## 14. How it is built (for developers)

| File | Purpose |
| --- | --- |
| `src/app/site-supplies/page.tsx` | The page: project picker, role-based tabs, merged Today and Log |
| `src/components/supplies/useGas.tsx` | Gas data and actions, and the content of each gas screen |
| `src/components/supplies/useEquipment.tsx` | Equipment data and actions, and the content of each equipment screen |
| `src/app/gas/page.tsx`, `src/app/equipment/page.tsx` | Redirects to the page, for old links |
| `src/components/SiteBills.tsx` | Bills and payments, for any list of sources (`BillSource`) |
| `src/components/GasDeposits.tsx` | Deposits and the check against cylinders held |
| `src/components/GasCostCard.tsx` | Gas cost to date (Bills & payments, and the project's Expenses tab) |
| `src/lib/gas.ts` | Gas charge rules: `gasCost()` and `countTrips()` |
| `src/lib/equipment.ts` | Equipment charge rules: `dayCharge()`, `chargeFor()`, `rateOn()`, `minutesOf()` |
| `src/lib/pdf/gasOrder.ts`, `src/app/api/gas/po/route.ts` | The purchase order PDF |
| `src/app/api/gas/upload`, `file`, `notify` | Challan photos and order notifications |
| `src/lib/nav.ts` | Menu, roles and the `SITE_ROLES_GET_CONSUMABLES` switch |

**Tables**

- Quantities (readable by site roles for their projects): `gas_vendors` (holds both kinds of vendor, `kind`), `gas_products`, `gas_project_vendors`, `gas_orders`, `gas_order_lines`, `gas_movements`, `gas_movement_serials`, `equipment_items`, `equipment_logs`.
- Money (Operations, Admin and Viewer only): `gas_rates`, `gas_terms`, `gas_order_pricing`, `equipment_rates`, `site_bills`, `site_payments`, `gas_deposits`.
- Bank details: `payee_bank` (Admin only; Viewer read-only), kinds `gas_vendor` and `equipment_vendor`.

**Database rules (triggers)**

- `gas_order_guard`: who may move an order to which status; a Site Engineer may only edit or cancel their own order while it is a request.
- `gas_lock_rates`: on approval, copies the rate in force into `gas_order_pricing`.
- `gas_movement_guard`: stamps who entered it; a return, lost or damaged entry cannot exceed what is at site; quantity and kind cannot be edited; a Supervisor may void their own entry for 24 hours.
- `gas_order_progress`: moves an order to partly delivered / delivered as linked deliveries arrive.
- `gas_serial_guard`: serial numbers cannot outnumber the cylinders on the entry.
- `post_site_payment_expense`: a payment posts a project expense in category Gas or Equipment hire, and voiding it removes it.
- `equipment_log_guard`: stamps who entered an entry and in which role, rejects future times and entries over 24 hours, lets anyone on the site stop a running entry, limits corrections to the Site Engineer and above (or a Supervisor's own entry for 24 hours), allows only a Site Engineer, Operations or Admin to verify, and clears verification when times change. A unique index allows only **one running entry per machine**.

---

## 15. Limits and things to know

- Supervisors and Site Engineers do not see the page yet (one switch, section 2).
- The app counts cylinders held, not which are full or empty.
- A trip is counted per date and challan number. Without challan numbers, two trucks on one day look like one trip.
- A visit that only collects empties is not charged by the app. If a vendor charges for one, say so and the rule can be changed.
- Payment days for gas default to the 25th and 10th until real terms are entered.
- Equipment rates are **per hour or per day**. Per-trip, monthly or lump-sum hire, mobilisation, operator and fuel are not modelled; they appear as a difference on a bill.
- An equipment entry cannot span midnight; use two entries. The day an entry belongs to is the day it **started**. Equipment entries carry no photo and no location stamp.
- A bill's dates decide which days are compared: keep bills for consecutive periods so no day is compared twice.
- Costs, bills, payments and deposits are per project. A vendor serving two projects has separate ones for each.
- Challan photos are kept in the document store and opened through a signed link; they are not public.
