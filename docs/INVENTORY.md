# Inventory: purchase bills, expenses and the JSL portal

The **Inventory** page (menu: **Operations → Inventory**) records purchase bills item by item. One bill does two jobs on its own, and a third only if an Admin chooses it:

| The bill becomes | When | Where |
| --- | --- | --- |
| Lines in the **Received** list | It is recorded | Inventory → Received |
| One **project expense** for the bill's total | It is recorded | Project → Expenses, category Site consumables, marked "From bill" |
| One **MRR** on the JSL portal. **Optional** | An Admin switches "Send to the JSL portal" on for that bill, then authorizes it, and the portal worker is built | Not sent yet: see "Not built yet" |

## Steps

1. **The bill.** Vendor, bill number, date, the total as printed, and a photo. Freight or a discount printed outside the item lines goes in its own box (minus for a discount).
2. **Items, one at a time.** Name, quantity, unit, rate before GST and GST %. Each item is saved as it is added, so a dropped connection loses nothing. A running total compares the items with the bill.
3. **Record bill.** Allowed only when the items plus GST are within ₹1 of the bill's total (₹1 covers round off) and the photo is attached. The total posts to the project's expenses.
4. **Optional: the JSL portal.** A recorded bill is a complete expense as it is. Only an Admin can choose **Also send to the JSL portal** for a bill; until then nobody else sees any portal fields, buttons or labels for it. Once it is on, the details are asked for. How the material was received:
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
| Switch a bill on for the JSL portal (or off again), authorize, withdraw authorization | no | no | yes | no |
| See bills, items and amounts | own projects | yes | yes | yes |
| See JSL details (only on bills an Admin switched on) | own projects | yes | yes | no |
| See the WO number | no | yes | yes | no |

Supervisors see rates and amounts on this page, unlike Site supplies, because they are copying them from the bill.

## Rules worth knowing

- The same vendor, bill number and date cannot be entered twice, even by someone on another project. Voiding a bill frees it to be entered again.
- A recorded bill and its items cannot be edited: reopen it. Its expense can only be removed by reopening or voiding the bill.
- A bill that has gone to the portal, or may have, cannot be reopened or voided.
- An employee's Aadhaar is never copied onto the bill or sent to the page: only the last 4 digits are. It is looked up when the MRR is sent.
- Numbers typed for outsiders, drivers and co-drivers are stored in full, because the portal needs them, and shown masked except in the edit form.
- The default person is matched on the login's profile name, because logins are not linked to employee records. If no one, or more than one person, has that name, nothing is preselected.
- Switching a bill off the portal list is refused once it has gone to the portal, or may have. Switching off a bill that was only authorized takes the authorization back. The expense is never touched either way.
- A project with no active work order can record bills, but they cannot be authorized until one is added.
- The Received list adds up what came in. It does not take off what was issued or used.

## Database

`supabase/migrations/2026-11-inventory-jsl-optional.sql` adds `inventory_bills.jsl_wanted` and `inventory_set_jsl_wanted` (Admin only). Portal details can only be entered, and a bill can only be authorized, while it is on. Bills that were already on their way to the portal when it ran stay on.

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

## Importing a bill from a CSV (Admin only)

**Import CSV**, next to New bill, turns one CSV into one draft bill with every item entered. Only an Admin sees the button. It uses the same rules as typing the bill in by hand: the same duplicate check, the same units, and the bill cannot be recorded until its photo is attached and the items match its total.

1. **Copy the Gemini prompt** from the panel (or from the end of this page), paste it into Gemini, and attach the photo or PDF of the bill. Gemini answers with a CSV in a code block, plus a short check list.
2. Save the CSV as a .csv file. **Choose CSV file** shows a preview: the bill, every item (HSN codes Gemini supplied are marked *guessed*), and the arithmetic against the bill's total.
3. **Create draft**, attach the photo on the next screen, and record it as usual.

**Download the template** gives the SMB invoice 3349/26-27 as a worked example.

### The file

One row per item. The first six columns describe the whole bill and are repeated, identically, on every row.

| Column | What goes in it |
|---|---|
| vendor_name | The seller's name, without a bracketed year, e.g. SMB Trading Corporation |
| vendor_gstin | The seller's GSTIN, or empty |
| bill_no | As printed, e.g. 3349/26-27 |
| bill_date | YYYY-MM-DD (3-11-2026 and 3-Nov-26 are also read, day first) |
| bill_total | The grand total on the bill, including tax and round off |
| other_charges | Freight or packing outside the item lines; a discount as a minus; 0 if none. Not GST, not round off |
| item_name | As printed |
| hsn | 4 to 8 digits, or empty |
| hsn_guessed | yes if Gemini supplied it, otherwise no |
| qty, rate, gst_pct | Plain numbers. Rate is before GST. gst_pct is the whole GST on the line (CGST + SGST added together) |
| unit | FT, Inch, Kg, Meter, mm, MT, No or Pcs. Other spellings are converted (SET to No, FEET to FT, MTR to Meter...) and listed in the preview; an unknown unit stops the import |

What stops an import: a missing column, an empty name, a quantity that is not above zero, an unknown unit, an empty or invalid GST, a date that is not a date, or rows that disagree about the bill. A total that does not match the items only warns: the draft can still be created and fixed before recording. A bill with the same vendor, number and date is refused, as when typing it in.

The photo of the bill, the JSL details and the Admin's authorization are never part of the CSV.

### The Gemini prompt

This is the text the Copy button gives. It lives in `src/lib/inventoryCsv.ts` next to the parser, so it changes together with what the parser accepts.

```text
You are a careful data-entry assistant. I will give you a photo or PDF of an Indian purchase / tax invoice. Read it and give me ONE CSV that I can import into our inventory system.

OUTPUT
1. First, a single code block that contains only the CSV: the header row, then one row per invoice line. Nothing else inside the block.
2. After the block, a short "Check list" (described at the end).

HEADER (exactly this, in this order)
vendor_name,vendor_gstin,bill_no,bill_date,bill_total,other_charges,item_name,hsn,hsn_guessed,qty,unit,rate,gst_pct

ROWS
One row per invoice line, in invoice order. Never merge or split lines, and keep repeated items as separate rows. The first six columns describe the whole bill, so repeat them identically on every row.

BILL COLUMNS
- vendor_name: the SELLER who issued the invoice (not the buyer / "Bill to"). Write it as a normal name: no bracketed year such as "(25-26)", no dots in initials (S.M.B. becomes SMB), and not all capitals. Example: "S.M.B. TRADING CORPORATION (25-26)" becomes "SMB Trading Corporation".
- vendor_gstin: the seller's 15-character GSTIN, in capitals with no spaces. Empty if none is printed.
- bill_no: the invoice number exactly as printed, for example 3349/26-27.
- bill_date: the invoice date as YYYY-MM-DD. Two-digit years are 20xx: 3-Nov-26 becomes 2026-11-03.
- bill_total: the grand total payable, including all taxes and round off, as a plain number such as 15063.00.
- other_charges: freight, packing, loading, transport or similar charges printed OUTSIDE the item lines, as a positive number; a discount as a negative number. 0 if there are none. Do NOT include GST here, and do NOT include "round off".

ITEM COLUMNS
- item_name: the description as printed, in CAPITALS, on one line, with the same spelling and sizes (6", 19KG). No serial number in front of it.
- hsn: the HSN/SAC printed for that line, digits only. If the invoice has no HSN for the line, or it cannot be read, supply the most likely Indian GST HSN code for that product yourself: 8 digits if you are confident, otherwise the 4-digit heading. If you really cannot suggest one, leave it empty.
- hsn_guessed: "no" when the HSN was printed on the invoice. "yes" when you supplied it or left it empty because it was missing.
- qty: the quantity as a plain number (5 or 2.5). No unit in this cell.
- unit: exactly one of FT, Inch, Kg, Meter, mm, MT, No, Pcs. Convert what the invoice says to the closest one: PCS / PC / PIECE becomes Pcs; NOS / NO / SET / PAIR / EACH / LOT becomes No; FEET / FT / FOOT becomes FT; INCH / IN becomes Inch; MTR / METER / METRE / M becomes Meter; MM becomes mm; KG / KGS becomes Kg; MT / TON / TONNE becomes MT. Never write any other unit.
- rate: the price per unit BEFORE GST, as in the invoice's Rate column. If the invoice only shows prices that include GST, divide the GST out and say so in the check list.
- gst_pct: the TOTAL GST percentage on that line: the IGST %, or CGST % plus SGST % added together (9 + 9 = 18). A plain number such as 18.

RULES
- Never invent a number. If a quantity, rate or total cannot be read, leave that cell empty and mention it in the check list.
- Plain numbers only: a dot for decimals, no thousands separators, no currency symbols, no % signs.
- Comma-separated, UTF-8. Wrap any cell that contains a comma or a double quote in double quotes, and double any quote inside it: PU WHEEL 6" is written "PU WHEEL 6""".
- The seller is never our company. Our company is the buyer ("Bill to").

FORMAT EXAMPLE (two rows, for the format only)
vendor_name,vendor_gstin,bill_no,bill_date,bill_total,other_charges,item_name,hsn,hsn_guessed,qty,unit,rate,gst_pct
SMB Trading Corporation,24ABZFS9705N1Z4,3349/26-27,2026-11-03,15063.00,0,EAR PLUG,39269099,no,5,Pcs,15.00,18
SMB Trading Corporation,24ABZFS9705N1Z4,3349/26-27,2026-11-03,15063.00,0,JALI,73144290,no,2,FT,30.00,18

CHECK LIST (after the code block, as short bullets)
1. How many invoice lines you read.
2. The arithmetic: the sum of (qty x rate), plus GST, plus other_charges, against bill_total. Show the figures and the difference. A difference under 1 rupee is round off and is fine.
3. Every unit you converted (invoice unit to the unit you used).
4. Every HSN you supplied yourself (row number, item, code).
5. Anything unreadable, uncertain or left empty.

Now read the invoice I have attached.
```
