# Inventory: purchase bills, expenses and the JSL portal

The **Inventory** page (menu: **Operations → Inventory**) records purchase bills item by item. One bill does three jobs:

| The bill becomes | When | Where |
| --- | --- | --- |
| Lines in the **Received** list | It is recorded | Inventory → Received |
| One **project expense** for the bill's total | It is recorded | Project → Expenses, category Site consumables, marked "From bill" |
| One **MRR** on the JSL portal | An Admin authorizes it, and the portal worker is built | Not sent yet: see "Not built yet" |

## Steps

1. **The bill.** Vendor, bill number, date, the total as printed, and a photo. Freight or a discount printed outside the item lines goes in its own box (minus for a discount).
2. **Items, one at a time.** Name, quantity, unit, rate before GST and GST %. Each item is saved as it is added, so a dropped connection loses nothing. A running total compares the items with the bill.
3. **Record bill.** Allowed only when the items plus GST are within ₹1 of the bill's total (₹1 covers round off) and the photo is attached. The total posts to the project's expenses.
4. **Details for the JSL portal.** How the material was received:
   - **By hand, someone on the project.** The list starts on the person who entered the bill and can be changed to anyone on the project. Their Aadhaar comes from their employee record, and only the last 4 digits are shown.
   - **By hand, someone not on the team.** Choose "Someone not on the team" and type their name, ID type and ID number.
   - **By vehicle.** Vehicle number, driver's name and licence number, and the co-driver's name, ID type and ID number if there is one.
5. **Authorize.** Admin only. The WO comes from the project's active work order, and the Admin chooses if there is more than one. It locks the JSL details. The portal fills in the contractor, address and WO validity itself.

## Who can do what

| | Supervisor / Site Engineer | Operations | Admin | Viewer |
| --- | --- | --- | --- | --- |
| Enter bills and items, record, enter JSL details | own projects | yes | yes | no |
| Discard a draft | own projects | yes | yes | no |
| Reopen or void a recorded bill (the expense comes off) | no | yes | yes | no |
| Authorize for JSL, withdraw authorization | no | no | yes | no |
| See bills, items and amounts | own projects | yes | yes | yes |
| See JSL details | own projects | yes | yes | no |
| See the WO number | no | yes | yes | no |

Supervisors see rates and amounts on this page, unlike Site supplies, because they are copying them from the bill.

## Rules worth knowing

- The same vendor, bill number and date cannot be entered twice, even by someone on another project. Voiding a bill frees it to be entered again.
- A recorded bill and its items cannot be edited: reopen it. Its expense can only be removed by reopening or voiding the bill.
- A bill that has gone to the portal, or may have, cannot be reopened or voided.
- An employee's Aadhaar is never copied onto the bill or sent to the page: only the last 4 digits are. It is looked up when the MRR is sent.
- Numbers typed for outsiders, drivers and co-drivers are stored in full, because the portal needs them, and shown masked except in the edit form.
- The default person is matched on the login's profile name, because logins are not linked to employee records. If no one, or more than one person, has that name, nothing is preselected.
- A project with no active work order can record bills, but they cannot be authorized until one is added.
- The Received list adds up what came in. It does not take off what was issued or used.

## Database

`supabase/migrations/2026-11-inventory.sql`: `inventory_bills`, `inventory_bill_items`, `inventory_gatepass`. The status columns only change through the functions `inventory_record_bill`, `inventory_reopen_bill`, `inventory_void_bill`, `inventory_authorize_jsl` and `inventory_withdraw_jsl`.

Bill photos go through `/api/inventory/upload` and `/api/inventory/view`, not `/api/docs`, because `/api/docs/view` opens any path and must stay closed to site roles.

## Not built yet

**Sending to the portal.** Authorizing only records the decision: nothing reaches JSL. The worker that logs in, fills the form and reads the confirmation still needs the portal's page details. It will move a bill through `sending`, `submitting`, then `submitted`, `failed` or `needs_check`. `needs_check` is never retried by itself, because the MRR may already exist.

## Units and the JSL portal's required fields

The portal accepts only these units, spelled exactly like this: **FT, Inch, Kg, Meter, mm, MT, No, Pcs**. The item form offers only these (no typing, no default, so the unit is always a deliberate choice), and `supabase/migrations/2026-11-inventory-units.sql` makes the database refuse anything else. Capitals are kept as they are: `mm` and `MT` are different units.

Everything the portal marks mandatory is mandatory here before an Admin can authorize:

| Portal field | Here |
|---|---|
| Received by | By hand or by vehicle, chosen on the JSL details |
| Work order | Taken from the project's active WO when authorizing; refused if there is none |
| Department | Always MECHANICAL (the robot sets it) |
| No of persons | Worked out: 1 by hand, 0 by vehicle (1 with a co-driver) |
| Person name, proof type, proof number (by hand) | The project person's record, or typed for someone outside; an Aadhaar number must be 12 digits |
| GPS Required (by vehicle) | Always ticked by the robot |
| Vehicle no, driver name, driver licence no (by vehicle) | Required; the co-driver is optional but needs type and number once a name is given |
| Material name, quantity, unit | Required on every item |
