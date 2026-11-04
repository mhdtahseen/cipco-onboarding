# Hired equipment: cranes, manlifts and trucks

A complete, step-by-step guide to the **Hired equipment** module (menu: **Site consumables → Hired equipment**): who does what, every screen and button, how hours turn into money (with worked examples), where each figure goes, the database behind it, and the limits. Written 4 Nov 2026. The sister guide for gas is [GAS_CYLINDERS.md](GAS_CYLINDERS.md). For roles see [ROLES_AND_ATTENDANCE.md](ROLES_AND_ATTENDANCE.md).

---

## 1. In one page

Machines hired from a vendor for a time (a crane for a few hours, a manlift for a day) are billed by **hours or days**. The module works like this:

1. The supervisor **logs the time each machine works**: tap **Start**, then **Stop** (or add the stretch afterwards).
2. The Site Engineer **verifies** the hours.
3. Operations or Admin enters the **vendor's bill** and the app shows, next to it, **what the logged hours come to** at the agreed rate. You approve the amount you will pay.
4. Paying posts an expense to the project, and the amount shows in the **Payments due** report until it is paid.

**No booking is needed.** If a crane is called at short notice and works two hours, it is simply logged. The bill is checked against the hours logged, not against a booking.

| Question | Where the answer is |
| --- | --- |
| Is a machine working right now, and for how long today? | **Today** tab |
| What did each machine do on each day? | **Log** tab |
| Which hours still need verifying? | **Log** tab ("N to verify") |
| Does the vendor's bill match the hours? | **Bills** tab (Operations / Admin) |
| What do we still owe? | **Payments due** report |

---

## 2. Who can do what

| | Supervisor | Site Engineer | Operations | Admin | Viewer |
| --- | --- | --- | --- | --- | --- |
| See the Equipment pages | not yet (see below) | not yet | yes | yes | yes, read-only |
| Start, stop, add a stretch | yes | yes | yes | yes | no |
| Correct or void an entry | their own, for 24 hours | any | any | any | no |
| **Verify** hours | no | yes | yes | yes | no |
| See rates and amounts | no | no | yes | yes | yes |
| Record bills and payments | no | no | yes | yes | no |
| Add vendors, machines, rates | no | no | yes | yes | no |
| Vendor **bank details** | no | no | no | yes | yes (read-only) |

**Supervisors and Site Engineers do not see these pages yet.** The module is built for phones for them (a large green **Start** and red **Stop** on each machine, no prices), but it is switched off by one line in `src/lib/nav.ts`: `SITE_ROLES_GET_CONSUMABLES = false`. Set it to `true` and it opens for them, with the menu, phone bottom bar and page guard all following. Until then Operations and Admin log the hours themselves.

**Rates are hidden in the database**, not just on the page: they live in a table only Operations, Admin and the read-only Viewer can read.

---

## 3. First-time setup (Admin or Operations)

### 3.1 Database

Run `2026-11-consumables.sql` in the Supabase SQL editor (after `2026-11-gas.sql`). It is safe to run more than once, and it is already applied on the live database. It adds the machines, the time log, the rates, and the shared bills and payments. If a page says *"the 2026-11-consumables.sql migration has not been run yet"*, this is the cause. Bank details also need `2026-11-payee-bank.sql`.

### 3.2 The vendor, the machines and the rates

**Hired equipment → Equipment & rates.**

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

## 4. Logging hours

### 4.1 The **Today** tab (Supervisor, Site Engineer, Operations, Admin)

One card per machine on the project:

- **Not running / Running since 09:15 · 1 h 20 m**, and **Today so far** (all of today's time for that machine).
- **▶ Start** begins the clock (the time is taken from the phone, in Indian time). **■ Stop** ends it. The running time updates by itself.
- A machine can only run once at a time: starting it again says *"is already running"*.
- A running entry can be stopped by anyone working on the project, even if someone else started it.

Below the cards, **Today's entries** lists every stretch with its times, hours, who entered it and whether it is verified.

### 4.2 Adding a stretch afterwards

Forgot to tap Start? Use **Add a stretch afterwards** (also **Add a stretch** on the **Log** tab):

1. Choose the **machine** and the **date** (not in the future), then the **start** and **stop** times.
2. Optionally tick **Machine broke down** and add a note (for example *lifting the boiler section*).
3. **Save.**

Rules: the stop must be after the start on the same date (for a stretch across midnight, enter two entries); one entry cannot be longer than 24 hours; times cannot be in the future.

### 4.3 Verifying (Site Engineer, Operations, Admin)

On a stopped entry press **Verify**. It then shows *verified by [name]*. Entries not yet verified show **not verified** in amber. A running machine cannot be verified. **Any change to the times clears the verification**, so verified hours are always the ones as saved.

### 4.4 Correcting and voiding

- **Correct** changes the start and stop times, the breakdown flag and the note. The machine, project and who entered it cannot change.
- **Void** removes an entry from the calculation (it stays listed, marked void).
- A **Supervisor** can correct or void **their own** entry for 24 hours; a **Site Engineer, Operations or Admin** can correct or void any entry.

### 4.5 The **Log** tab

Pick a **month**. Each day with work is a card listing the entries; the header shows how many hours were logged that month and how many are **to verify**. For Operations / Admin, each day card also shows the **amount before GST** per machine for that day.

---

## 5. How hours become money

### 5.1 The rules

1. All of a machine's entries **that start on the same day** (Indian time) are added together. Voided entries and entries still **running** are left out.
2. That day's total is charged **once**:
   - **Hourly:** round the day up to the rounding step, raise it to the minimum hours, then charge the normal rate for the hours up to the overtime threshold and the overtime rate for the hours past it.
   - **Daily:** one day's rate for any day with work, plus overtime hours past the threshold at the overtime rate.
3. GST at the rate's GST % is added.
4. A day with **no rate in force** is not counted, and the Bills tab warns you.

### 5.2 Worked examples (crane at ₹1,500/h)

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

## 6. Bills and payments (Operations / Admin)

### 6.1 Recording the vendor's bill

**Hired equipment → Bills → Record a vendor bill.**

1. Choose the **vendor**, the **bill number** and **bill date**, the **dates the bill covers**, and the **amount on the bill including GST**. Attach a photo or PDF of the bill.
2. A live line shows **what the logged hours come to for those dates** and whether the bill is the same, or how much more or less.
3. **Record bill.**

### 6.2 Comparing and approving

Each bill card shows **Vendor billed**, **Site records come to** (the logged hours priced as in section 5, GST included) and the **Difference**. **How the site records add up** lists, per machine, the days, billable hours and amount. Warnings tell you when:

- some days of work have **no rate set** (they are not counted),
- some hours are **not verified yet** (the total of those hours is shown),
- a machine is **still running** (it is not counted until stopped).

Choose **Approve ₹X (as billed)**, **Approve ₹Y (site records)** when they differ, or **Approve another amount…**. Anything else on a vendor's bill that is not hours (mobilisation, operator, fuel) simply shows up as a difference you can accept or question. **Reopen**, **Void** and **View bill** work as for gas.

### 6.3 Paying

**Bills → Payments to vendors → Record payment.** Saving posts an expense to the project in the category **Equipment hire**. **Void** the payment and the expense is removed. Each vendor shows **Approved**, **paid** and **pending** or **advance** at the top.

### 6.4 Payments due

**Payments due** lists **Equipment hire** as its own category per project, from **approved bills** only, with what is paid, what is pending and the vendor's bank details. Payments are applied to the oldest approved bill first. Equipment has no payment-days rule, so the due date is the **bill date**. Bills not yet approved appear under "not included".

---

## 7. Where each figure goes

| Event | Project expenses | Payments due |
| --- | --- | --- |
| Hours logged / verified | no | no |
| Vendor bill recorded (not approved) | no | listed as "not included" |
| Vendor bill **approved** | no | **yes** (billed) |
| Payment recorded | **yes** (Equipment hire) | reduces pending |

Project expenses are cash-based: they show what has been paid.

---

## 8. A typical day and month

1. **Setup once:** vendor, ticked for the project, the crane, its rate.
2. **Crane arrives at 9:30.** The supervisor taps **Start** on the crane card. At 12:30 they tap **Stop**. If they forget, they add the stretch later.
3. **End of the day:** the Site Engineer checks the **Today** entries and presses **Verify**.
4. **Bill arrives** (weekly or monthly): record it under **Bills** with the dates it covers, read the comparison, approve.
5. **Pay:** record the payment; the project's Equipment hire expense appears.

---

## 9. Troubleshooting

| You see | Cause and fix |
| --- | --- |
| "The 2026-11-consumables.sql migration has not been run yet" | Run that migration (section 3.1) |
| "No equipment vendor is set up for this project yet" | Tick the vendor under **Vendors for [project]**, and add the machine |
| "That vendor is not set up for this project" | Same: tick the vendor for this project |
| "[Machine] is already running" | Stop the running entry first |
| "The end time must be after the start time" | Fix the times; split a stretch across midnight into two entries |
| "A Supervisor can correct their own entry for 24 hours. Ask the Site Engineer" | Ask a Site Engineer, Operations or Admin |
| "Stop the machine before verifying its hours" | Stop it, then verify |
| "N days of work have no rate set" | Add the rate under **Equipment & rates**, with a **From** date on or before those days |
| "Some hours are not verified yet" | Verify them on the **Log** or **Today** tab before approving the bill |
| Bill difference is not zero | See **How the site records add up**; typical causes are rounding or minimum hours differing from the vendor's, a stretch nobody logged, or a charge that is not hours (mobilisation, fuel) |

---

## 10. How it is built (for developers)

| File | Purpose |
| --- | --- |
| `src/app/equipment/page.tsx` | The Equipment page: Today, Log, Equipment & rates, Bills |
| `src/lib/equipment.ts` | The money rules: `dayCharge()`, `chargeFor()`, `rateOn()`, `minutesOf()` |
| `src/components/SiteBills.tsx` | Bills and payments (shared with Gas) |
| `src/lib/nav.ts` | Menu, roles and the `SITE_ROLES_GET_CONSUMABLES` switch |

**Tables:** `equipment_items` and `equipment_logs` (readable by site roles for their projects); `equipment_rates`, `site_bills`, `site_payments` (Operations, Admin and Viewer only); the vendor is a row in `gas_vendors` with `kind = 'equipment'`, linked to projects through `gas_project_vendors`. Bank details: `payee_bank`, kind `equipment_vendor`.

**Database rules:** `equipment_log_guard` stamps who entered an entry and in which role, rejects future times and entries over 24 hours, lets anyone on the site stop a running entry, limits corrections to the Site Engineer and above (or a Supervisor's own entry for 24 hours), allows only a Site Engineer, Operations or Admin to verify, and clears verification when times change. A unique index allows only **one running entry per machine**. `post_site_payment_expense` posts the project expense for a payment (category Equipment hire).

---

## 11. Limits and things to know

- Supervisors and Site Engineers do not see these pages yet (one switch, section 2).
- Rates are **per hour or per day**. Per-trip, monthly or lump-sum hire is not a rate type; an extra charge on a bill appears as a difference.
- Mobilisation, operator and fuel charges are not modelled.
- An entry cannot span midnight; use two entries. The day an entry belongs to is the day it **started**.
- Equipment entries carry no photo and no location stamp.
- The vendor's bill dates decide which days are compared: choose them carefully, and keep bills for consecutive periods so no day is compared twice.
- Bills and payments are per project. A vendor on two projects has separate bills and payments for each.
