# Gas cylinders: ordering, deliveries, bills, deposits and cost

A complete, step-by-step guide to the **Gas cylinders** module (menu: **Site consumables → Gas cylinders**): who does what, every screen and button, the money rules with worked examples, where each figure goes, the database behind it, and the limits. Written 4 Nov 2026. The sister guide for cranes, manlifts and trucks is [HIRED_EQUIPMENT.md](HIRED_EQUIPMENT.md). For attendance, meals, transport and rent see [OPERATIONS_GUIDE.md](OPERATIONS_GUIDE.md); for roles see [ROLES_AND_ATTENDANCE.md](ROLES_AND_ATTENDANCE.md).

---

## 1. In one page

Gas (oxygen, LPG) arrives on site in **cylinders that are loaned, not sold**: the vendor brings new full cylinders and takes the empties back on the same visit. The module tracks four things per project:

1. **Orders**: a Site Engineer or Operations asks for cylinders, Operations or Admin approves, and the rate is **locked** on the order.
2. **Deliveries**: each vendor visit (a *trip*) is recorded: new cylinders in, empties out, with the vendor's challan number and photo.
3. **Cylinders at site**: the running count and how long they have been held.
4. **Money**: the vendor's bill is compared with what the site records say, approved, and paid. Paying posts an expense to the project. The **deposit** you pay the vendor is tracked separately, as money the vendor holds for you.

| Question | Where the answer is |
| --- | --- |
| How many cylinders are on site, and how old? | **At site** tab |
| What is on order, and what has arrived? | **Orders** tab |
| What came in and went out, and when? | **Deliveries** tab |
| Does the vendor's bill match what we received? | **Bills** tab (Operations / Admin) |
| What deposit does the vendor hold? | **Deposits & rent** tab |
| What has gas cost on this project so far? | Top of **Bills** tab, and the project's **Expenses** tab |
| What do we still owe the gas vendor? | **Payments due** report |

---

## 2. Who can do what

| | Supervisor | Site Engineer | Operations | Admin | Viewer |
| --- | --- | --- | --- | --- | --- |
| See the Gas pages | not yet (see below) | not yet | yes | yes | yes, read-only |
| Record deliveries, pick-ups, lost / damaged | yes | yes | yes | yes | no |
| Raise an order (edit or cancel it until approved) | no | yes | yes | yes | no |
| Approve or reject an order, mark sent, close, cancel | no | no | yes | yes | no |
| See rates, order amounts, bills, deposits | no | no | yes | yes | yes |
| Record bills and payments, deposits, rent | no | no | yes | yes | no |
| Set up vendors, products, rates, terms | no | no | yes | yes | no |
| Vendor **bank details** | no | no | no | yes | yes (read-only) |

**Supervisors and Site Engineers do not see the Gas pages yet.** The module is built and tuned for phones for them (bottom bar, big buttons, no prices), but it is switched off by one line in `src/lib/nav.ts`: `SITE_ROLES_GET_CONSUMABLES = false`. Set it to `true` and the menu, the phone bottom bar and the page guard all open up for them, with no other change. Until then Operations and Admin enter deliveries themselves.

**Prices are hidden in the database, not just on the page.** Rates, terms, order prices, bills, payments and deposits live in tables that only Operations, Admin and the read-only Viewer can read. Everything a Supervisor or Site Engineer works with (orders as quantities, deliveries, the cylinder count) holds no rupee amounts.

**Role names.** In the database Operations is stored as `staff`. A **Viewer** can look at everything and cannot change anything (see ROLES_AND_ATTENDANCE.md).

---

## 3. First-time setup (Admin or Operations)

### 3.1 Database

Run these in the Supabase SQL editor, in this order. All are safe to run more than once.

1. `2026-11-gas.sql`: vendors, products, orders, deliveries, serial numbers, rates, terms.
2. `2026-11-consumables.sql`: bills, payments, deposits, billed rent, and the equipment tables (shared with Hired equipment). Also lets bank details be stored for gas and equipment vendors.
3. `2026-11-payee-bank.sql`: the Admin-only bank-details table (if not already run).
4. `2026-11-gas-chandan.sql`: per-product deposits, the lost / damaged / transport charges, the vendor's address, and loads **Chandan Gases Co** (replacing Parth Enterprise). Already applied on the live database.

If a page says *"the Gas SQL migration has not been run yet"*, one of these is missing.

### 3.2 The vendor

**Gas cylinders → Rates & terms.** (This tab shows only for Operations, Admin and Viewer.)

1. Under **Vendors for [project]**, tick the vendors that supply the project you picked at the top. Site Engineers can only order from ticked vendors, and a delivery can only be recorded for a ticked vendor.
2. **Add a vendor** (if new): name, contact person, phone, GSTIN, address. Use **Make inactive** to retire one: it disappears from new orders but its history stays.
3. **Vendor bank details** (Admin only): holder name, bank, branch, account number, IFSC, UPI. This feeds the **Payments due** report. The holder name should be exactly what the vendor's account says.
4. **Add a product**: vendor, product name (for example *Oxygen*, *LPG*), capacity (optional), and the **deposit per cylinder** (refundable). Each product has its own deposit.
5. **Rates**: choose the product, the rate **per cylinder before GST**, the GST %, and the date it applies **from**. A new rate applies to orders approved on or after its date. Orders already approved keep the rate that was locked on them. **Rate history** lists every rate.
6. **Terms** (choose the vendor):

| Field | What it means | Used for |
| --- | --- | --- |
| Transport per delivery trip (₹) | Charged on each trip, GST added | Bill comparison, order card, PO |
| Lost cylinder charge (₹ each) | Charged for each cylinder lost on site | Bill comparison, PO |
| Valve + cap damaged (₹ each) | Charged for each cylinder whose valve and cap are damaged | Bill comparison, PO |
| GST on those charges (%) | Added to the three charges above | Same |
| Rent per cylinder per day (₹) | The vendor's monthly rotation rent (see 8.4) | Reference; entered manually |
| Rent after project, per day (₹) | Rent once the project is over and cylinders are not returned in time | Deposits & rent |
| Return within (days) | Grace period after the project closes | Deposits & rent |
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
| Transport | ₹1,500 per delivery trip + 18% GST |
| Lost cylinder | ₹12,500 + 18% GST |
| Valve + cap damaged | ₹1,500 + 18% GST |
| Rent | none in the quotation |
| Payment days | 25th / 10th, **assumed**: the quotation states none. Change under Terms when known. |
| Bank (from the cheque) | RK GAS WORLD, YES Bank, Gandhidham, A/C 045373800000208, IFSC YESB0000453 (check that the account name matches the vendor before paying) |
| Deposit paid | ₹24,000 for 3 oxygen cylinders (3 × ₹8,000) |

---

## 4. Orders

**Gas cylinders → Orders.** An order is a request for cylinders for one project from one vendor. It carries **quantities only**; prices are attached when it is approved.

### 4.1 Raising an order (Site Engineer, Operations or Admin)

1. Open **Orders → New order** (or the **New order** button on the first tab).
2. Choose the **vendor** (only vendors ticked for the project are offered), **Needed by** date (defaults to two days ahead), then one or more **products with a quantity** (**+ Add another product** for more), and an optional note.
3. Warnings you may see: *the vendor asks for N hours' notice, so this date may be too soon*, and *delivery is free from N cylinders; this order is fewer*. Both come from the vendor record and only appear when set.
4. **Send for approval** (for Operations / Admin it reads **Place order**). The order is numbered **GAS-0001, GAS-0002, …** and its status is **Waiting for approval**. Operations and Admin get a phone notification.

Until it is approved, the person who raised it (and Operations / Admin) can **Edit** it or **Cancel order**.

### 4.2 Approving (Operations or Admin)

On the order card:

- **Approve**: the **rate in force today** is locked onto every line. If any product has no rate yet, approval stops with *"No rate is set for X yet. Add it under Rates & terms, then approve."* The Site Engineer who raised it is notified.
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

Built on the server, so it cannot be edited. It shows the order number and date, the vendor (name, phone, address, GSTIN), the project and **Needed by** date, each product with quantity, rate, GST and amount, then **Cylinders ordered**, **Amount before GST**, **GST** and **Order total**. Under the total a line states the transport charge ("Plus transport: ₹1,500.00 per delivery trip + 18% GST = ₹1,770.00, charged on delivery"); transport is **not** in the order total. The **Terms of supply** list the refundable deposit per product, the transport charge, the lost and damaged charges, and the wording from the vendor's terms. There is no seal or payment-days text unless you add it under Terms.

---

## 5. Deliveries, pick-ups, lost and damaged (the **Deliveries** tab)

### 5.1 How a trip works

Each vendor visit is one **trip**: the **new full cylinders come in and the empties go back out on the same visit**. The app records them together so they share one date, challan number and photo. The trip charge is counted **once per trip**, and the pick-up is part of the trip, not a second charge.

### 5.2 Recording a trip (Supervisor, Site Engineer, Operations, Admin)

1. **Deliveries → Record a delivery trip** (also the big button at the top of **At site**).
2. Leave **What happened** on *Delivery trip: new cylinders in, empties out*.
3. Set the **Date** (not in the future), the vendor's **challan number**, optionally the **order** it is for (so the order's *delivered X of Y* updates and the locked rate is used), and optionally a **challan photo** (taken or chosen on the phone, up to 5 MB).
4. For each product enter **New (full) in** and **Empties out**. Leave a box empty or 0 if nothing came or went. Under **Serial numbers (optional)** type the cylinder numbers (commas, spaces or new lines).
5. **Save trip.** The deliveries are saved first, then the pick-ups.

Checks: serial numbers cannot outnumber the cylinders; you cannot take back more empties than are at site (counting what arrives on this trip); the project's vendor must be ticked for the project.

### 5.3 Lost and damaged

Choose **Lost** or **Damaged (valve / cap)** in **What happened**, then the product, how many, and optional serial numbers, challan and note. These reduce the cylinders at site, like a pick-up, and are charged to you at the vendor's lost / damaged charge (see 6.2). A cylinder cannot be marked lost or damaged beyond what is at site.

### 5.4 Fixing a mistake

An entry's cylinders and quantity cannot be edited. **Void** it (it stays in the list, marked void, and the count corrects) and enter it again.

- A **Supervisor** can void their own entry for 24 hours.
- A **Site Engineer, Operations or Admin** can void any entry.

### 5.5 What each entry shows

Date, who entered it and when, the vendor, the challan number, the order it is linked to, serial numbers, a **Challan photo** link, and **Void**. The labels are *Delivered (new, full)*, *Picked up (empties)*, *Lost*, *Damaged (valve / cap)*.

---

## 6. Cylinders at site, and how money is worked out

### 6.1 Cylinders at site (**At site** tab)

For each product on the project: **cylinders at site** = delivered − picked up − lost − damaged. It also shows the totals, and how long the **oldest cylinders** have been held (pick-ups are taken off the oldest deliveries first, so the age is that of what is still here), a **By delivery** breakdown, and **Expected deliveries** (approved orders not yet fully delivered).

### 6.2 Every charge the app calculates

All amounts include GST. Rates before GST come from the rate list; the three charges use the vendor's terms.

| Charge | Rule |
| --- | --- |
| **Cylinders** | quantity × rate × (1 + GST %). A delivery **linked to an order** uses the rate **locked on that order**; an unlinked delivery uses the rate **in force on its delivery date**. |
| **Transport** | **number of trips** × transport charge × (1 + GST %) |
| **Lost** | lost cylinders × lost charge × (1 + GST %) |
| **Valve + cap damaged** | damaged cylinders × damaged charge × (1 + GST %) |
| **Rent** | only what you enter under **Deposits & rent** as the vendor charged |

**What counts as one trip.** Delivery entries on the **same day with the same challan number** are one trip, so a truck bringing oxygen and LPG together is one trip. With no challan number, entries on the same day for the same order are one trip. **Two trucks on one day need different challan numbers to count as two trips.** A pick-up never adds a trip, and a visit that only collects empties, with no new cylinders, is **not counted** as a trip. This is why the challan number should always be entered.

**Worked example** (Chandan Gases Co): 3 oxygen and 2 LPG on one challan, plus 1 cylinder lost.

| | Working | ₹ |
| --- | --- | --- |
| Oxygen | 3 × 280 × 1.18 | 991.20 |
| LPG | 2 × 2,861 × 1.18 | 6,751.96 |
| Lost | 1 × 12,500 × 1.18 | 14,750.00 |
| Transport | 1 trip × 1,500 × 1.18 | 1,770.00 |
| **Total** | | **24,263.16** |

(The deposit is not in this: see section 8.)

---

## 7. Bills and payments (Operations / Admin)

### 7.1 Gas cost to date (top of the **Bills** tab, and the project's **Expenses** tab)

A card showing what the gas has cost so far **counted when it is delivered**: cylinders, trips, lost or damaged, rent, then **Gas cost so far**. Below it:

| Box | Meaning |
| --- | --- |
| Approved on bills | The total of the amounts you approved on vendor bills |
| Paid (in expenses) | What you have paid. This is what the project's Expenses list shows. |
| Delivered, not yet billed | Gas cost so far minus approved, never below zero |

The deposit appears as a note: refundable, so not part of the cost. A warning appears if any delivered cylinders have no rate (they are not counted).

### 7.2 Recording the vendor's bill

**Bills → Record a vendor bill.**

1. Choose the **vendor**, enter the **bill number** and **bill date**, the **dates the bill covers** (from, to), and the **amount on the bill including GST**. Attach a photo or PDF of the bill (up to 5 MB).
2. A live line under the form shows **what the site records come to for those dates** and whether the bill is the same, or how much more or less.
3. **Record bill.** It starts as *To compare and approve*.

### 7.3 Comparing and approving

Each bill card shows **Vendor billed**, **Site records come to** (the figures from section 6.2 for the bill's dates) and the **Difference** (green *Matches* when within ₹1). **How the site records add up** lists the lines. Warnings point out cylinders with no rate.

Then choose:

- **Approve ₹X (as billed)**: you accept the vendor's figure.
- **Approve ₹Y (site records)**: shown when they differ; you pay what the delivery records support.
- **Approve another amount…**: type your own, for example after agreeing a correction with the vendor.

Approval records both the approved amount and the site-records figure at that moment. **Reopen** returns an approved bill to *To compare and approve*; **Void** removes it (it stays listed, marked void); **View bill** opens the attachment.

Only **approved** bills count as owed.

### 7.4 Paying

**Bills → Payments to vendors → Record payment**: vendor, amount, date, and a reference (UTR or cheque number). Saving a payment **posts an expense to the project**, in the category **Gas**, with the vendor and reference in the description. **Void** a payment and its expense is removed. Payments are never edited: void and re-enter.

At the top, each vendor shows **Approved**, **paid**, and either **pending** or **advance**.

### 7.5 The Payments due report

**Operations → Payments due** lists gas as its own category per project: the vendor, the approved total, what is paid, what is pending, the **bank details** (Admin sees them), and how many days overdue. Payments are applied to the **oldest approved bill first**. The due date is worked out from the vendor's terms: a bill dated the 1st–15th is due on the first due day of the same month; a bill dated the 16th or later on the second due day of the next month. Bills not yet approved are listed under "not included".

---

## 8. Deposits and rent (Operations / Admin)

### 8.1 Deposit (a refundable asset, never an expense)

**Deposits & rent → Deposits.** Choose the vendor, **Deposit paid** or **Refund received**, the amount, date and reference. For each vendor a card shows **Deposit held by vendor** (paid − refunded) and, when product deposits are set, **what is expected for the cylinders now at site** (cylinders at site × each product's deposit). Compare them: paid should equal expected once the cylinders have arrived. Voiding an entry keeps it listed, marked void.

Deposits are **not** in project expenses, in gas cost to date, or in Payments due.

### 8.2 Rent after the project

When a project is **closed** (Projects → close), the vendor's **return window** (the *Return within* days) starts. The card shows the **rent calculated**: cylinders still at site × days past the window × the *Rent after project* rate. For an active project it says none yet. For Chandan Gases Co there is no rent in the quotation, so this is ₹0.

### 8.3 Rent the vendor charged

If a vendor bills rent, enter it under **Rent the vendor charged** (vendor, dates, amount, reason). It is counted in the bill comparison, so a bill's difference then shows only gaps in deliveries and charges. The card compares it with the calculated rent and flags a difference.

### 8.4 Not calculated

A vendor rule such as *"rent if a cylinder is not rotated at least 4 times a month"* is **not calculated** (the rule is not yet defined for the app). Enter it as the vendor billed it.

### 8.5 Lost and damaged summary

The card also lists the lost and damaged cylinders and what the vendor can charge for them, with GST. These are already inside the bill comparison.

---

## 9. Where each figure goes

| Event | Project expenses | Gas cost to date | Payments due |
| --- | --- | --- | --- |
| Order approved | no | no | no |
| Cylinders delivered | no | **yes** | no |
| Trip, lost, damaged | no | **yes** | no |
| Vendor bill recorded (not approved) | no | no | listed as "not included" |
| Vendor bill **approved** | no | no | **yes** (billed) |
| Payment recorded | **yes** (category Gas) | no | reduces pending |
| Deposit paid | no | no | no |

Project expenses are **cash-based** (what has been paid); gas cost to date is **accrual-based** (what has been delivered).

---

## 10. A typical day, start to finish

1. **Plan.** A Site Engineer raises *3 Oxygen, needed by tomorrow*. Operations approves; the rate is locked; the PO PDF is sent to the vendor.
2. **Deposit.** Pay the deposit for the new cylinders and record it under **Deposits & rent**.
3. **Delivery day.** The vendor's truck arrives: record a **Delivery trip** with the challan number and photo, new cylinders in, empties out, linked to the order. The order moves to *Delivered*.
4. **Bill arrives.** Record it under **Bills**, check the comparison, approve.
5. **Pay.** Record the payment: the project's Gas expense appears. The Payments due report drops the amount.
6. **At the end.** Close the project; make sure the cylinders go back within the return window; ask for the deposit back and record the **Refund received**.

---

## 11. Troubleshooting

| You see | Cause and fix |
| --- | --- |
| "The Gas SQL migration has not been run yet" | A migration in section 3.1 is missing |
| "No rate is set for X yet" when approving | Add the product's rate under Rates & terms, then approve |
| "That vendor is not set up for this project" | Tick the vendor under **Vendors for [project]** |
| "Only N of these cylinders are at this site" | You are returning / marking lost more than the count; check earlier entries |
| A delivery shows no price in the bill comparison | The product has no rate in force on the delivery date |
| Trips look doubled | Two entries on one day have different challan numbers, or one is blank on a different order |
| Bill difference is not zero | See the lines under **How the site records add up**; typical causes are a different rate, a trip you did not record, or a vendor charge such as rent not yet entered |
| Gas vendor has "Bank details missing" in Payments due | Admin: add them under **Vendor bank details** |

---

## 12. How it is built (for developers)

**Pages and components**

| File | Purpose |
| --- | --- |
| `src/app/gas/page.tsx` | The Gas page and all its tabs |
| `src/components/SiteBills.tsx` | Bills and payments (shared with Hired equipment) |
| `src/components/GasDepositsRent.tsx` | Deposits, post-project rent, vendor-charged rent |
| `src/components/GasCostCard.tsx` | Gas cost to date (Bills tab and project Expenses tab) |
| `src/lib/gas.ts` | **One set of charge rules**: `gasCost()` and `countTrips()`, used by the Bills tab, order cards and the cost card |
| `src/lib/pdf/gasOrder.ts`, `src/app/api/gas/po/route.ts` | The purchase order PDF |
| `src/app/api/gas/upload`, `file`, `notify` | Challan photos and order notifications |
| `src/lib/nav.ts` | Menu, roles, and the `SITE_ROLES_GET_CONSUMABLES` switch |

**Tables**

- Quantities (readable by site roles for their projects): `gas_vendors` (also holds equipment vendors, `kind`), `gas_products`, `gas_project_vendors`, `gas_orders`, `gas_order_lines`, `gas_movements`, `gas_movement_serials`.
- Money (Operations, Admin and Viewer only): `gas_rates`, `gas_terms`, `gas_order_pricing`, `site_bills`, `site_payments`, `gas_deposits`, `gas_rent_billed`.
- Bank details: `payee_bank` (Admin only; Viewer read-only), kind `gas_vendor`.

**Database rules (triggers)**

- `gas_order_guard`: who may move an order to which status; a Site Engineer may only edit or cancel their own order while it is a request.
- `gas_lock_rates`: on approval, copies the rate in force into `gas_order_pricing`.
- `gas_movement_guard`: stamps who entered it; a return, lost or damaged entry cannot exceed what is at site; quantity and kind cannot be edited; a Supervisor may void their own entry for 24 hours.
- `gas_order_progress`: moves an order to partly delivered / delivered as linked deliveries arrive.
- `gas_serial_guard`: serial numbers cannot outnumber the cylinders on the entry.
- `post_site_payment_expense`: a payment posts a project expense in category Gas, and voiding it removes it.

---

## 13. Limits and things to know

- Supervisors and Site Engineers do not see the Gas pages yet (one switch, section 2).
- A trip is counted per delivery date and challan number. Without challan numbers, two trucks on one day look like one trip.
- A pick-up-only visit is not charged by the app. If a vendor charges for one, say so and the rule can be changed.
- Monthly "rotation" rent is not calculated; enter it as billed.
- Payment days default to the 25th and 10th until real terms are entered.
- Cost to date and payments are per project. A vendor serving two projects has separate bills, payments and deposits for each.
- Challan photos are kept in the document store and opened through a signed link; they are not public.
