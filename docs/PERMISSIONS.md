# Permissions: who can do what

**Admin → Permissions** (Admin only) is where an Admin decides, for each role, what it may do in every module and in the tabs inside a module. The menu, the pages that open, and the buttons that save or delete all follow it.

Who has which role is still set on **Admin → Users**. This page decides what a role can do.

## Levels

| Level | A person with it can | Cannot |
| --- | --- | --- |
| **None** | nothing: the page is not in their menu and the address redirects them home | |
| **View** | look at everything | add, change or delete anything. The save and delete buttons are hidden and the browser refuses the attempt |
| **Create** | look, and add new entries | change or delete existing ones |
| **Edit** | look, add and change | delete or void |
| **Full** | everything the module offers, including delete, void and reopen | the Admin-only actions below |

**Always Admin only**, whatever the level: Users, Permissions, approving or reopening a payroll run, the bank transfer letter and pay-slip links, and authorizing a bill for the JSL portal.

A **Viewer** can only be set to None or View. Admin is always Full and cannot be edited.

## The page

1. **Pick a role** at the top: Operations, Site Engineer, Supervisor, Viewer.
2. **Set a level** for each module with the buttons on its row. Modules are grouped like the menu (People, Operations, Sales, Templates, Admin).
3. **Set tabs apart** (Payroll, Meals, Expenses have tabs): open "Set tabs" and choose a level for a single tab, or **Same** to follow the module. A tab set to None disappears for that role.
4. The panel on the right shows **the menu that role will see**, live, with the level next to each page.
5. **Save changes** (bottom bar). **Discard** drops what you have not saved. **Reset to defaults** loads the built-in defaults, which you then save.

Switching role with unsaved changes asks first. Every change is recorded (who, role, module, from, to) in the database.

### When a change takes effect

- The person's **menu and buttons** update the next time their page loads.
- The **page guard** (who may open an address) can take up to **a minute**, because the server remembers a role's rules for 60 seconds. Pages they already have open keep working until they navigate.
- Nobody is signed out.

## Out of the box

These are the defaults, and they are also what applies before anything is saved.

| Module | Operations | Site Engineer / Supervisor | Viewer |
| --- | --- | --- | --- |
| Employees | Full | none | View |
| Payroll | **Edit** | none | View |
| Attendance | Full | Edit | View |
| Projects | **View** | none | View |
| Meals | **View on Overview, Daily log, People, Bills only** | none | View |
| Site supplies, Inventory | Full | Inventory: Edit | View |
| Expenses | **View** (Due and Spent) | none | View |
| Quotations | **Edit** (create, read, update; no delete) | none | View |
| Clients | **Edit** | none | View |
| Clause library, Mail templates, Quotation wording, Settings | Full | none | View |
| Sites today, Transport, Accommodation, Invoices, Work orders, Locations | none | none | View |

## Use cases

**Give Operations the ability to record expenses.** Permissions → Operations → Expenses → *Set tabs* → Spent → **Create**. They can add; they cannot change or delete what they added. Use **Edit** to let them correct their own mistakes.

**Let one person see only the Meals bills.** Meals → Set tabs → set every tab to None except Bills = View, and the module row to None. Meals appears in their menu with a single tab.

**Take Payroll away from Operations again.** Operations → Payroll → None → Save. The menu item goes immediately; a payroll tab they already have open stops working within a minute.

**A trusted Operations lead who may also delete quotations.** Quotations → Full.

**Check what a role actually sees** without signing in as them: choose the role and read the panel on the right. It shows the menu and the level of each page.

## What is enforced where

| Layer | What it does |
| --- | --- |
| Menu and page guard | A page with level None is not shown and its address redirects. Data routes (payroll register, payments due, vendor statement, quotation and invoice downloads) follow their module. |
| Controls | Below Create the save and add buttons are hidden; below Full the delete and void buttons are hidden. Tabbed screens follow the tab on show. |
| The browser | Writes the level does not allow are stopped before they leave and a plain message appears. |
| The database | **Payroll tables and bank details** follow the matrix at the row level (read, add, change, delete by level). Everything else in the database still uses its older rules (Operations can write most tables). So for modules other than payroll, a person who bypasses the app and talks to the database directly is limited by the older rules, not by this page. Moving the other modules to the matrix is a separate, larger change. |

## Setting it up

Run `supabase/migrations/2026-11-role-permissions.sql` once in Supabase (SQL editor). It creates the permissions table, seeds the defaults above, adds the save function and the log, and opens the payroll tables to the levels. Until it is run:

- the built-in defaults apply, everywhere, as written above;
- the Permissions page shows them read-only with a notice;
- **Operations will see Payroll in their menu but its data will not load**, because the payroll tables are still Admin-only in the database until the migration is run.

The migration is safe to run twice and removes nothing.

## Adding a new module later

Add it to `MODULES` in `src/lib/permissions.ts` (and its defaults in `DEFAULTS`), give its menu entry the same `module` key in `src/lib/nav.ts`, and it appears on this page. Roles that have saved rows get **None** for it until an Admin sets it.
