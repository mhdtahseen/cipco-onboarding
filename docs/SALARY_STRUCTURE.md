# Salary structure & calculation method

*Documentation for CIPCO's offer / appointment letters (Annexure A). Read this before changing how salary is calculated.*

- **Code:** `src/lib/salary.ts` (all maths, labels, Annexure rows) — nothing else in the app does salary arithmetic.
- **Editor UI:** `src/components/SalaryEditor.tsx` (Details tab) · **Letter wording variables:** `buildVars()` in `src/lib/clauses.ts` · **PDF table:** `drawAnnexure()` in `src/lib/pdf/letters.ts`
- **Check after any change:** `npx tsx scripts/test-salary.ts` (compares the engine with the four letters issued in Oct 2026).

---

## 1. The idea in one paragraph

You fix **one** number — the **CTC**, the **net in-hand**, or the **gross** — and choose a **structure** (how basic is decided, HRA %, PF rules, whether CTC includes employer contributions). The app works out every other figure. When you fix the *in-hand* or *CTC*, it solves backwards (by search) for the gross that produces exactly that figure, so the number you promised in the letter is the number that comes out.

## 2. Inputs (stored per employee in `employees.salary`, JSON)

| Field | Values | Default | Meaning |
|---|---|---|---|
| `basis` | `ctc` · `inhand` · `gross` | `inhand` | Which figure you fix. |
| `amount` | number | — | The figure. For `inhand` always **per month**. |
| `period` | `month` · `year` | `month` | For `ctc` / `gross` only. Yearly amounts are divided by 12 and rounded to the nearest rupee. |
| `basic_mode` | `pct_gross` · `pct_ctc` · `fixed` | `pct_gross` | How Basic is decided (see §4). |
| `basic_value` | number | 50 | `%` for the two percentage modes, **₹ per month** for `fixed` (e.g. 15,000). |
| `hra_pct` | number | 40 | HRA as % of Basic. |
| `pf_applicable` | true/false | true | If false: no employee PF and no employer PF/admin. |
| `pf_cap` | true/false | true | PF is calculated on Basic **capped at ₹15,000**. If false, PF is on the full Basic. |
| `employer_in_ctc` | true/false | true | **true:** CTC = Gross + employer PF + PF admin/EDLI + employer ESI (the Trainee and Site-Engineer letters). **false:** CTC simply equals Gross (the Fitter letters: "Gross Salary / Total Cost to Company"). |
| `pt_monthly` | number / blank | blank | Overrides Professional Tax per month. Blank = Maharashtra slab. |

The editor has three presets that reproduce the letters issued so far:

| Preset | basic_mode / value | HRA | PF cap | employer_in_ctc | Used for |
|---|---|---|---|---|---|
| Basic = 50% of gross | `pct_gross` / 50 | 40% | yes | yes | Trainee Engineer (Gourhari Manna, Rahul Sonagara) |
| Basic fixed ₹15,000 | `fixed` / 15000 | 40% | yes | **no** | Fitter (Barad Manubhai, Rohitkumar Barad) |
| Basic = 50% of CTC | `pct_ctc` / 50 | 40% | yes | yes | Site Engineer (Sanjivan Kumar Baitha) |

## 3. Constants (top of `salary.ts`)

| Constant | Value | Notes |
|---|---|---|
| `PF_WAGE_CEILING` | ₹15,000 | Statutory PF wage ceiling used when `pf_cap` is on. |
| `PF_EE` / `PF_ER` | 12% / 12% | Employee and employer PF on the PF wage. |
| `ADMIN_EDLI` | 1% | Employer PF admin + EDLI charges, on the PF wage. Printed as "~1%". |
| `ESI_CEILING` | ₹21,000 | ESI applies when **gross ≤ ₹21,000**. |
| `ESI_EE` / `ESI_ER` | 0.75% / 3.25% | On gross. **Rounded up** to the next rupee. |
| Professional Tax (Maharashtra) | see below | `ptSlab()` |

**Professional Tax — `ptSlab(gross, gender)`**

| Gender | Gross per month | PT per month |
|---|---|---|
| Male / other | up to ₹7,500 | ₹0 |
| | ₹7,501 – ₹10,000 | ₹175 |
| | above ₹10,000 | ₹200 (₹300 in February) |
| Female | up to ₹25,000 | ₹0 |
| | above ₹25,000 | ₹200 (₹300 in February) |

Annual PT = ₹2,500 when the monthly PT is ₹200 (₹200 × 11 + ₹300); otherwise monthly × 12. **Verify the slabs with your CA before relying on them** — your issued letters use a flat ₹200.

## 4. Forward calculation (given the unknown scalar *x*)

Internally one function, `build(cfg, gender, x)`, computes a full salary from a single number *x*: **x = gross** for `pct_gross` and `fixed`, **x = CTC** for `pct_ctc`. All rounding is `Math.round` (half-up) except ESI (round **up**).

### 4a. `basic_mode = pct_gross` or `fixed`  (x = Gross)

1. `Gross = x`
2. `Basic` = `round(Gross × basic_value%)`  — or for `fixed`: `min(basic_value, Gross)`
3. `PF wage` = `min(Basic, 15,000)` if `pf_cap`, else `Basic`
4. If `employer_in_ctc`: `Employer PF = round(PF wage × 12%)`, `Admin/EDLI = round(PF wage × 1%)`, `Employer ESI = ceil(Gross × 3.25%)` if Gross ≤ 21,000 else 0. If not `employer_in_ctc`, all three are 0.
5. `HRA = min(round(Basic × hra%), Gross − Basic)`
6. `Special allowance = Gross − Basic − HRA`  *(balancing figure — it absorbs all rounding)*
7. Deductions: `PF = round(PF wage × 12%)` (0 if PF not applicable) · `ESI = ceil(Gross × 0.75%)` if Gross ≤ 21,000 · `PT = pt_monthly` or slab
8. `Net = Gross − PF − ESI − PT`
9. `CTC = Gross + Employer PF + Admin/EDLI + Employer ESI`

### 4b. `basic_mode = pct_ctc`  (x = CTC)

1. `Basic = round(CTC × basic_value%)`
2. Employer PF and Admin/EDLI from the PF wage, as above.
3. If `employer_in_ctc`: employer ESI depends on gross which depends on employer ESI, so it is iterated 4 times: `g = CTC − erPF − erAdmin`, then `erESI = ceil(g × 3.25%)` if g ≤ 21,000, `g = CTC − erPF − erAdmin − erESI`. `Gross = CTC − erPF − erAdmin − erESI`.
   If not `employer_in_ctc`: `Gross = CTC`, no employer contributions.
4. HRA, Special, deductions, Net: as 4a.

### 4c. If a value goes negative
If Special allowance or Net would be negative (amount too low for the structure), a warning is shown: *"This amount is too low for the chosen structure."* Reduce the Basic % or HRA %.

## 5. Working backwards from the figure you fix (`calcSalary`)

| You fix | Structure | How it is solved |
|---|---|---|
| **Gross** | `pct_gross` / `fixed` | Direct: x = gross. |
| **CTC** | `pct_ctc` | Direct: x = CTC. |
| **Net in-hand** | any | Search for x. |
| **CTC** | `pct_gross` / `fixed` | Search for x (gross). |
| **Gross** | `pct_ctc` | Search for x (CTC). |

**Search:** find the smallest whole-rupee *x* whose result (net / CTC / gross) is ≥ the target by binary search, then check the 6 values either side and take the one closest to the target (ties → the larger *x*). Upper bound for the search = 2 × target + 5,000.

**ESI discontinuity:** at gross ₹21,000 ESI switches off, so net jumps up and CTC drops. For `pct_gross` / `fixed` the search therefore runs on **two ranges** — gross ≤ 21,000 (with ESI) and gross > 21,000 (without) — and keeps the better match. If both give the exact amount, the higher-gross, no-ESI result is shown and a warning says so. (For `pct_ctc` a single range is searched; very low CTCs around the ESI limit may need a manual check.)

**Exactness:** the figure you fix normally comes out exactly. Occasionally whole-rupee rounding of PF/ESI makes it ₹1 off; the screen then shows *"Rounding: … ₹1 above the target"*.

## 6. Annual figures

- Every annual figure = monthly × 12, **except**:
  - **PT annual** = ₹2,500 (for ₹200/month), else monthly × 12.
  - **Net annual** = Gross annual − Deductions annual (so it already reflects the ₹300 February PT).
  - **CTC annual** = the amount you typed when you fixed a **yearly CTC** (e.g. ₹7,00,000), even though 12 × the rounded monthly CTC differs by a few rupees.

## 7. What prints in Annexure A

Rows (in order) — wording is generated from the structure, see `labels` and `annexureRows()` in `salary.ts`:

1. **A. Earnings:** Basic *(label shows the rule: "50% of Gross", "50% of CTC" or "Capped at statutory limit" for fixed ₹15,000)* · HRA *(HRA – 40% of Basic)* · Special Allowance · **Gross Salary (A)** (when `employer_in_ctc` is off the label becomes **"Gross Salary / Total Cost to Company (A)"**)
2. **B. Employee Deductions:** Employee PF *(label adds ", capped at ₹15k statutory ceiling" when Basic > 15,000)* · Employee ESI · Professional Tax · **Total Deductions (B)**
3. **C. Net In-Hand Salary (A − B)**
4. **D. Employer Contributions** *(only when `employer_in_ctc` is on)*: Employer PF · PF Admin & EDLI · Employer ESI · **Total (D)** · **Total Cost to Company – CTC (A + D)**
5. **Notes** (editable per letter on the Letters tab): the Maharashtra PT note, and the "site travel, food, lodging … over and above" note when the Site Allowances clause is ticked.

The Annexure is saved with the letter (`letters.annexure`), so re-downloading an issued letter never changes it even if you change the salary rules later.

## 8. Wording in the letter body

`buildVars()` turns the structure into placeholders used by the *Compensation* clause:

| Placeholder | Example |
|---|---|
| `{{comp_label}}` | "Net In-Hand salary" · "Cost to Company (CTC)" · "Gross salary" |
| `{{comp_figure}}` / `{{comp_words}}` | "₹33,000/-" · "Rupees Thirty-Three Thousand Only" (monthly figure of the basis you fixed) |
| `{{comp_suffix}}` | in-hand: ", after applicable statutory deductions (Employee PF and Professional Tax)" · CTC: " (₹7,00,000/- per annum)" |
| `{{annexure_sentence}}` / `{{comp_annexure_ref}}` | "The detailed salary structure is specified in Annexure A." when the Annexure is attached |
| `{{comp_heading}}` | "Compensation & Compensation Break-Up" with Annexure, "Compensation" without |
| `{{ctc_figure}}`, `{{inhand_figure}}`, `{{gross_figure}}`, `{{annual_ctc_figure}}` (+ `_words`) | available if you write a custom clause |

The Annexure is **optional** on both letters (tick box on the Letters tab). Without it, the compensation paragraph still states the figure you fixed.

## 9. Worked examples (all reproduced by `scripts/test-salary.ts`)

**Trainee — net in-hand ₹25,000, Basic 50% of gross** → gross **₹26,809**
Basic round(13,404.5) = 13,405 · HRA round(5,362) = 5,362 · Special 26,809 − 13,405 − 5,362 = 8,042 · PF round(13,405 × 12%) = 1,609 · ESI 0 · PT 200 → Net 26,809 − 1,609 − 200 = **25,000**. Employer: PF 1,609 + admin 134 = 1,743 → **CTC ₹28,552**.

**Fitter — net in-hand ₹33,000, fixed Basic ₹15,000, CTC = gross** → gross **₹35,000**
Basic 15,000 · HRA 6,000 · Special 14,000 · PF 1,800 · PT 200 → Net **33,000**. (Fitter at ₹30,000 in-hand → gross ₹32,000, Special ₹11,000.)

**Site Engineer — CTC ₹7,00,000 per year, Basic 50% of CTC** → monthly CTC 58,333
Basic round(29,166.5) = 29,167 · HRA 11,667 · PF wage min(29,167, 15,000) = 15,000 → employer PF 1,800, admin 150, ESI 0 → Gross 58,333 − 1,950 = **56,383** · Special 15,549 · Net 56,383 − 1,800 − 200 = **54,383**.

**ESI band — net in-hand ₹18,000, Basic 50% of gross** → gross 19,518
Basic 9,759 · HRA 3,904 · Special 5,855 · PF 1,171 · **ESI ceil(19,518 × 0.75%) = 147** · PT 200 → Net 18,000. Employer: PF 1,171 + admin 98 + **ESI ceil(19,518 × 3.25%) = 635** = 1,904 → CTC 21,422.

### Where the app differs from the letters issued so far
| Letter | Letter says | App gives | Reason |
|---|---|---|---|
| Gourhari (Trainee) | Basic 13,404, Special 8,043 | 13,405, 8,042 | The letter rounded 13,404.5 down; the app rounds half-up. Gross, PF, Net and CTC are identical. |
| Sanjivan (Site Engineer) | Admin/EDLI ₹189 → Gross 56,343 | ₹150 → Gross 56,383 | 1% of the ₹15,000 PF wage is ₹150. The ₹189 in the letter does not follow from the "~1%" it prints (looks like a spreadsheet slip). To reproduce it exactly, change `ADMIN_EDLI` or add an override. |
| Barad Manubhai (Fitter) | Annual net ₹3,96,000 | ₹3,95,900 | The letter's annual net ignored the annual deductions (₹24,100). The app always uses Gross − Deductions. |

## 10. Not included (by design, so far)

Gratuity / bonus / variable pay, LWF, TDS, conveyance or other allowances, employer-paid insurance, notice-pay or LOP calculations. The employer PF admin charge is a flat 1% simplification (the statutory split is ~0.5% admin + 0.5% EDLI with their own minimums/maximums) — confirm with your CA / PF consultant if exact figures matter.

## 11. How to change the structure — cookbook

| I want to… | Change |
|---|---|
| PF wage ceiling, PF %, admin %, ESI limit/rates change in law | The constants block at the top of `salary.ts` (`PF_WAGE_CEILING`, `PF_EE`, `PF_ER`, `ADMIN_EDLI`, `ESI_*`). Also update label text containing "₹15k" / "₹21,000" in `calcSalary()` labels and the warning messages. |
| Professional Tax slab changes / another state | `ptSlab()` and `ptYear()`; update the note in `annexureNotes()` and the label "Maharashtra Standard". |
| Add a new preset (e.g. "Basic 40% of gross, HRA 50%") | Add an entry to `PRESETS` — it appears as a button in the editor automatically. |
| Add a new Basic rule | Add a value to `basic_mode` in `SalaryCfg`; handle it in `build()` (and the `direct` check in `calcSalary()` if it is directly solvable); add an `<option>` in `SalaryEditor.tsx`; add its label in `calcSalary()` labels. |
| Add a new component (e.g. conveyance ₹1,600, medical) | Add the field to `Month`, compute it in `build()` (decide if it is part of gross, and whether it reduces Special), add it to `annual`, to `annexureRows()` and to the live table in `SalaryEditor.tsx`. Keep `special = gross − (all other earnings)` as the balancing line. |
| Change rounding | `build()` — the `R = Math.round` calls (and `Math.ceil` for ESI). |
| Change the wording of the compensation paragraph | `buildVars()` in `clauses.ts` (`comp_*` variables) or edit the *Compensation* clause in the Clause library. |
| Change Annexure labels / layout / notes | `annexureRows()` / `annexureNotes()` in `salary.ts`; table drawing in `drawAnnexure()` (`pdf/letters.ts`). |

**After any change:** (1) run `npx tsx scripts/test-salary.ts` and update the expected numbers in that file *deliberately* if the rules changed; (2) run `npx tsx scripts/smoke.ts <folder>` and look at the Annexure page it renders; (3) check one real employee in the app.

**Existing data is safe:** `employees.salary` is schema-less JSON, so new options simply default for older records. Issued letters keep their own snapshot of the Annexure and wording.

## 12. Data

- `employees.salary` — the inputs in §2. `employees.monthly_ctc` — kept in sync with the calculated monthly CTC (used in lists/export).
- `letters.annexure` — the exact rows and notes printed on that letter; `letters.vars` — the wording variables used.

## 13. Daily-wage workers (`basis = "daily"`)

For site workers paid per day worked: **6 working days a week, one weekly off.** You fix the **daily rate**; nothing is split into basic / HRA / special.

- **Monthly estimate** = daily rate × working days per month (`days_per_month`, default **26** = 30 days less 4 weekly offs). The weekly off is *not* a working day, so it is unpaid by default. If the weekly off is paid for a worker, set 30.
- **Deductions** use the same rules as other staff, applied to the estimated monthly wages: PF 12% (wage capped at ₹15,000 when "cap PF wage" is ticked), ESI 0.75% when the estimate is ₹21,000 or below, Professional Tax by the Maharashtra slab (or the override).
- **Employer contributions** are excluded from the cost by default for daily wage (the editor switches "CTC includes employer PF / EDLI / ESI" off); tick it to include them.
- `employees.monthly_ctc` stores the monthly estimate (plus employer contributions if included), so project reports show an estimate for daily-wage staff.
- **Letters**: `{{comp_label}}` = "Daily wage", `{{comp_figure}}` = the daily rate, `{{comp_period}}` = "per day" (it is "per month" for everyone else), and `{{comp_suffix}}` adds the six-day-week wording. Annexure A prints the daily rate, working days, estimated monthly wages and deductions, with a note that pay follows days actually worked.
- Run `supabase/migrations/2026-10-daily-wage-wording.sql` once so existing compensation clauses use `{{comp_period}}`.
