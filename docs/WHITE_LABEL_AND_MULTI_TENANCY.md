# White-labelling and multi-tenancy (7 Nov 2026)

How to turn this app (today: CIPCO Operations for one company) into a product other companies can use under their own name, and the two ways to do it. Written from the code as it stands, so the numbers and file names are real. No code has been changed for this; it is a plan.

## 1. The short answer

| | A. White-label, one deployment per customer | B. True multi-tenant, one shared deployment |
| --- | --- | --- |
| What it is | Same code, a **separate copy** per customer: own Vercel project, own Supabase project, own domain, own branding settings | **One** app and **one** database serving many companies; every row belongs to a company |
| Isolation | Strongest (separate databases) | Only as strong as your row-level security |
| Effort to first second customer | **About 1 to 2 weeks** (mostly de-hard-coding) | **About 2 to 4 months** (every table, every policy, every route) |
| Running cost per customer | Higher (a Supabase project each, about a plan each) | Low (shared) |
| Updates | Roll out N times (scripted) | Once |
| Customer-specific changes | Easy (a branch or a config flag) | Hard; everything must be a setting |
| Best for | The first 1 to 15 customers; customers who want their own data and domain | 20+ customers, self-service sign-up, low price per customer |

**Recommendation:** do **A first**, in a way that keeps **B** possible. It gets a second customer live in weeks, forces the right clean-up (branding and company details out of code), and the work is not wasted if you later move to B. Do not start with B: this app's security is not yet enforced at the database level for most modules (section 4), and that must be fixed before many companies can share one database.

## 2. What is tied to CIPCO today (audit)

Counted in this repo: **36 source files** mention CIPCO or Chandrika, **39 SQL migrations** and **74 tables** (none has a company column), **12 environment variables**, and a handful of company-specific business rules.

### 2.1 Branding and identity (easy, all in code)

| Thing | Where | What to do |
| --- | --- | --- |
| Company name, address, GSTIN, UDYAM, phone, signatory, city | `src/lib/company.ts` (`COMPANY`) | Move to a settings record per customer |
| Company bank account for invoices and the bank letter | `src/lib/company.ts` (`BANK`), `src/lib/pdf/bankLetter.ts` (`EMAIL`) | Same |
| Logo (screen) | `public/branding/logo-sm.png`, `src/components/Logo.tsx` | Per-customer file, URL from settings |
| Logo (PDFs), seal, signature | `assets/logo.png`, `public/branding/seal.png`, `signature.png` | Per-customer files in storage |
| App icon, favicon, home-screen icon | `src/app/icon.svg`, `favicon.ico`, `public/icons/*` | Generate per customer (see 5.3) |
| Page titles and tab names | `src/app/layout.tsx`, `src/components/AppShell.tsx` ("... · CIPCO Operations") | Read the product name from settings |
| PWA name, colours | `public/manifest.webmanifest` | Make it a route that builds the manifest per host |
| Colours | `:root` variables in `src/app/globals.css` (`--brand`, `--brand-soft`, ...), plus `html.dark` swaps in `src/app/dark.css` | Already variables; inject per customer (5.2) |
| Text such as "you@cipcogroup.com", the PDF footer "ops.cipcogroup.com", `info@cipcogroup.com` as the push-notification contact | `login/page.tsx`, `pdf/vendorStatement.ts`, `lib/push.ts` | Read from settings |
| Employee number format `CIP-EMP-###`, start number 51 | `supabase/migrations/2026-11-employee-numbers.sql`, `docs/EMPLOYEE_NUMBERS.md` | Make prefix and start a setting |
| Local-storage keys `cipco_nav_*`, cookie and session names | `AppShell.tsx`, `lib/lastProject.ts`, `lib/supabase/session.ts` | Prefix by a customer key (matters in B, harmless in A) |

### 2.2 Documents and forms (medium)

- `assets/templates/*.pdf` (joining form, Form 11, gratuity Form F) and `import_employee.xlsx` are CIPCO's own or statutory templates. Statutory forms are the same for every Indian company; **the joining form is not**.
- The PDF drawing code (`src/lib/pdf/*`, quotation and invoice builders) takes the header and footer from `COMPANY`. Once `COMPANY` is data, these follow.
- Mail templates, clause library and quotation wording are already database content, so each customer edits their own.

### 2.3 Business rules that are India-specific (decide on scope)

PF and ESI, professional tax, TDS, GST in invoices and quotations, UAN/ESIC numbers, the statutory "challan" payment mode, rupee formatting (`inr`), IST timezone, and the monthly payroll calendar. These are right for any Indian contractor. **For a customer outside India this is a product decision, not a branding change**: either do not sell abroad, or make payroll rules pluggable per country (large piece of work, not covered here).

### 2.4 CIPCO's own integrations (must become optional)

- **JSL portal robot** (`jsl-worker/`, `.github/workflows/jsl-send.yml`, the Inventory "Send to JSL" section). This talks to one vendor's portal with CIPCO's login. It is a **feature for CIPCO only**. In a white-label product it must be switched off by default and shown only to customers who have it (feature flag, 4.4).
- **WhatsApp or push reminders** use CIPCO's VAPID keys and sender details.
- **Cron jobs** (`/api/cron/*`, the daily attendance check) are scheduled in Vercel for one project.

### 2.5 Secrets and infrastructure (12 variables)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`, `JSL_WORKER_KEY`, `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, `GITHUB_REF_NAME`, `NEXT_PUBLIC_ATT_POLL_MS`. Each customer in model A gets their own set. Never share the service-role key or VAPID keys between customers.

## 3. Option A: white-label, one deployment per customer

### 3.1 The idea

One code repository, **one "customer profile" file or table** that holds everything in section 2.1. A new customer is: a new Supabase project, a new Vercel project pointing at the same repo, a new set of environment variables, and a filled-in profile.

### 3.2 The work

1. **Create a `brand` and `company` config that is data, not code.**
   - A table `app_settings` (one row, or key and value) holding: product name, short name, logo URLs, colours, company details, bank, signatory text, employee-number prefix and start, currency and locale, enabled modules (4.4).
   - `src/lib/company.ts` becomes a loader with the current values as defaults, so nothing breaks while migrating. Every importer of `COMPANY` and `BANK` (PDFs, invoices, letters) then reads through the loader. PDF routes already run on the server, so they can read the table once per request.
2. **Brand variables injected at runtime.** The layout reads the profile on the server and writes a `<style>` with `--brand`, `--brand-soft`, `--brand-text`, `--brand-ink`, `--focus` and the logo URL. The dark-mode swap in `dark.css` already works from variables, so a customer colour mostly "just works"; only the few hard-coded hex values need cleaning (the `#f6f7fb` background was one of them, fixed in this release).
3. **Logo files in storage.** Upload through Settings (Admin), store the path in the profile. The screen logo, PDF logo and seal come from there. Keep one logo that works on dark (the app already uses a CSS filter for the white version).
4. **Dynamic metadata.** Replace the static `metadata` in `layout.tsx` with `generateMetadata()` reading the profile (title, application name, Open Graph). Replace `public/manifest.webmanifest` with `src/app/manifest.ts` so name, short name and colours follow the customer.
5. **Icons per customer.** Generate once at onboarding from the customer's logo: `favicon.ico`, `icon.svg` or png, `apple-touch-icon` 180, `icon-192/512`, `maskable-192/512`. A small script already exists in spirit (this release produced them with `sharp`); turn it into `scripts/make-icons.mjs <logo> <hex>` and store the output in storage, served from route handlers (`/icons/[name]`).
6. **Feature flags** (4.4): hide the JSL module and any CIPCO-only item unless enabled.
7. **A provisioning script** (`scripts/new-customer`): create the Supabase project (CLI), run all migrations in order, seed the first Admin and the settings row, create the Vercel project and set env vars, add the domain, and print a checklist. Without this, every customer costs a day of manual work.
8. **A release process**: one `main`, a deploy per customer project (Vercel can connect many projects to one repo), migrations applied to every customer database by a script, with a dry-run and a per-customer failure report. Keep a table of customers and their version.

### 3.3 Domains and sign-in

Each customer gets `ops.theirdomain.com` (CNAME to Vercel) or `theirname.yourproduct.com`. Auth emails (magic links, password resets) are sent by their Supabase project; set the sender name and templates per customer, and configure the Supabase "Site URL" and redirect URLs to their domain.

### 3.4 Pros and cons

- Pros: strongest data isolation, a customer can be on a different version or have a custom tweak, a problem in one customer cannot touch another, easy to hand a customer their own copy or leave.
- Cons: cost (a Supabase project each), N deployments to keep in step, no cross-customer analytics, and the temptation to fork the code per customer (do not; use flags).

## 4. Option B: true multi-tenant (one app, one database)

### 4.1 The idea

Add a **company** (tenant) to everything. A signed-in person belongs to one or more companies; the database only ever returns rows of the company they are acting in. Branding and settings come from the company, chosen by host name (`acme.yourproduct.com`) or after login.

### 4.2 Database changes (the big part)

1. **New tables**
   - `organizations` (id, name, slug, status, plan, created_at)
   - `org_members` (org_id, user_id, role, status), replacing the single role on the user profile; one person can belong to several companies with a different role in each
   - `org_settings` (org_id, brand, company details, bank, feature flags, numbering rules). This is section 2.1 as data
   - `org_domains` (host, org_id) for host-to-company lookup
2. **A company column on every business table.** All 74 tables get `org_id uuid not null references organizations(id)`, with an index on `(org_id, ...)` leading every existing index. Do it in steps: add nullable, backfill CIPCO's id into every row, set not null, then add the policies.
3. **Row-level security on every table, no exceptions.** The standard policy shape:

   ```sql
   -- who am I acting for? set once per request by the app (or read from the JWT)
   create function app.current_org() returns uuid language sql stable as
     $$ select nullif(current_setting('app.org', true), '')::uuid $$;

   create policy tenant_isolation on projects
     using (org_id = app.current_org()
            and exists (select 1 from org_members m
                        where m.org_id = projects.org_id and m.user_id = auth.uid() and m.status = 'active'))
     with check (org_id = app.current_org());
   ```

   Setting the company: put `org_id` into the user's JWT as a claim (custom access-token hook, refreshed when they switch company) rather than relying on a client-sent header. Writes must also **force** `org_id` (a trigger that fills it from the claim) so the browser can never choose another company.
4. **Unique constraints become per company**: project names, invoice numbers, quotation numbers, `emp_no`, vendor names, `(org_id, number)` everywhere. Number sequences (invoice, quotation, requisition, employee numbers) must be **per company**, so replace global sequences with a counters table locked per company.
5. **Storage** (bills, documents, photos, signatures): path prefix `org_id/...` and storage policies that check the prefix against the person's company. Today paths are not company-scoped.
6. **Functions** (SECURITY DEFINER ones such as the inventory approval, payroll approval, employee numbering): every one must take or derive the company and filter by it. A SECURITY DEFINER function that forgets `org_id` leaks across companies; review each by hand (there are many, since the app puts workflows in the database).
7. **Realtime and views**: any view or Realtime channel must be per company, and views should use `security_invoker`.

### 4.3 App changes

- **Company resolution**: middleware reads the host, looks up `org_domains`, rejects unknown hosts, sets the company for the request. A person who belongs to several companies gets a switcher (like the role menu).
- **The permission matrix** (`role_permissions`, section "Permissions" of this app) gets an `org_id`, so each company edits its own roles. Defaults in `lib/permissions.ts` stay as the template for a new company.
- **Server routes** use the service-role key in places (payroll register, payslips, JSL worker, cron). Service-role **bypasses RLS**, so every such route must filter by `org_id` explicitly. Write a helper (`scoped(orgId)`), forbid raw service-role queries in review, and add a test that fails on a query without a company filter.
- **Cron and background jobs** loop over companies; each job and each web-push subscription carries `org_id`.
- **Caches**: the 60-second permission cache in middleware and every client cache key (local storage keys like `cipco_nav_*`, list-page caches) must include the company, or one company can briefly see another's data on a shared computer.
- **Emails and PDFs** use the company's name, logo, bank, signatory.
- **Super-admin area** (yours, not the customers'): create a company, suspend it, see usage, impersonate to support (with an audit log).
- **Billing** (if you charge): plans, seat limits, trial, a hook to Stripe or Razorpay, and a "suspended" state that turns the company read-only.

### 4.4 Feature flags (needed in both models)

A `features` map in the settings: `jsl_portal`, `payroll`, `meals`, `accommodation`, `site_supplies`, `inventory`, `quotations`, `invoices`, `transport`. The menu (`NAV` in `src/lib/nav.ts`), the page guard, the permission matrix and the API route table (`API_MODULES`) all already know modules by key, so **a module switched off for a company is simply "no access" for everyone, Admin included**. This is a small change on top of the existing permission code.

### 4.5 The security rule that decides everything

**Today most of the app's rules are enforced in the app (middleware and the browser), not in the database.** The Permissions page documents this: only the payroll tables and bank details are enforced by the database. For one company that is a conscious trade-off (staff are trusted). For many companies it is **not acceptable**: anyone with a valid login could, with the public Supabase key and a few lines of code, ask the database for another company's rows if the rows are not protected by RLS.

So before B goes live: row-level security on **every** table is the minimum, and the per-role rules should follow for sensitive modules. This is the single biggest piece of B and the reason it is a months-long project.

### 4.6 Migration path for the existing CIPCO data

1. Create the `organizations` row for CIPCO; backfill `org_id` on all tables.
2. Switch the app to read settings from `org_settings` (this is the same work as section 3.2 step 1, so doing A first covers it).
3. Turn on the new RLS policies in a staging copy and run the full test rigs (the PGlite and Playwright rigs already used for permissions and inventory can be extended with a second company and "company A must never see company B" tests).
4. Cut over in a maintenance window; keep the old policies in a rollback script.

## 5. Branding details that are easy to get wrong

### 5.1 Logos
Provide two assets per customer: a normal logo and a version that works on dark backgrounds, or keep one and use the CSS filter. Check PDFs on white, screen on dark, and a very wide or very tall logo (set a max height and `object-fit: contain`).

### 5.2 Colours
Ask for one brand colour. Derive the rest in code (`--brand-hover` darker, `--brand-soft` tint, `--brand-ink`, and dark-mode variants) so a customer cannot pick an unreadable combination. Check contrast (aim for at least 4.5:1 for text on the brand colour). Test every page in light and dark; most dark-mode issues come from hard-coded hex values, so search for `#` colours in components and replace them with variables.

### 5.3 Icons and the home-screen app
- `favicon.ico` (32 and 48) for browsers, `icon.svg` for modern browsers, `apple-touch-icon` 180 for iOS, `192` and `512` for Android, and **maskable** versions (logo inside the central 80%) so Android does not crop it.
- The theme colour and the manifest name appear when the app is installed. Changing them after install does not update existing home-screen copies on iOS; customers must re-add the app, so set them correctly before roll-out.
- The service worker (`public/sw.js`) has "CIPCO Operations" and icon paths for push notifications; make it read them from the manifest or pass them in the push payload.

### 5.4 SEO and sharing
This app is private, so every page is set to **noindex** (done in this release: `robots.txt`, meta robots and `X-Robots-Tag`). Keep that for customers. If you also sell the product itself, put the marketing site on a separate domain and keep the app domains noindex.

### 5.5 Remove the "powered by" decision upfront
Decide whether customers may remove your name from the footer and the PDFs, and price it accordingly; build a setting (`show_powered_by`).

## 6. Things that are not branding but will bite

1. **Statutory data is per company**: GSTIN, PAN, PF and ESI codes, bank, signatory. Validate formats at entry (the GSTIN contains the PAN; the app derives it today).
2. **Numbers and series**: invoice and quotation series (`CIPCO/26-27/...`), employee numbers, requisitions. Let each company set a prefix and financial-year rule; never reuse another company's prefix.
3. **Time zone and calendar**: IST is assumed (the attendance day, the JSL robot, cron times). Store a time zone per company if you ever go outside India.
4. **Data export and delete**: customers will ask to take their data out (a full export per company) and to be deleted. Plan an export job and a hard-delete path including storage.
5. **Backups and restore per company**: in A, the Supabase backups are per customer already. In B, restoring one company means selective restore, which is hard; decide up front.
6. **Support access**: in A you need a way into their project (limited, logged). In B an impersonation feature with a visible banner and audit log.
7. **Legal**: a data-processing agreement, terms, and where the data is stored (region of the Supabase project; choose Mumbai for Indian customers to keep speed and satisfy data-location questions). See `docs/PERFORMANCE.md` section 1: the app region should match the database region.
8. **The repository is public** today (`mhdtahseen/cipco-onboarding`). A product with other customers' configuration must live in a **private** repo. Move before any customer data or secrets are added, and rotate any key that ever sat in the public history.

## 7. Phased plan

### Phase 0: prepare (3 to 5 days, helps both options)
- Move `COMPANY`, `BANK`, employee-number prefix and start, brand colours and logos into a settings table; keep CIPCO's values as the seed.
- Dynamic `generateMetadata`, `manifest.ts`, icons from storage.
- Remove hard-coded CIPCO text in the 36 files listed in 2.1 and 2.4.
- Feature flags; JSL module off by default.
- Make the repo private.

### Phase 1: second customer on Option A (1 to 2 weeks after phase 0)
- Provisioning script (Supabase, migrations, seed, Vercel, domain, env vars).
- Branding checklist and a "customer onboarding" doc (logo, colour, company details, bank, signatory, domain, first Admin, modules on).
- Per-customer release script and a customer register.
- Test on a throwaway customer end to end: sign-up of the first Admin, onboarding an employee, payroll run, quotation PDF, invoice PDF, bank letter, push notification, install on a phone.

### Phase 2: decide on B (when you have about 10 customers or want self-service sign-up)
- Add `organizations`, `org_members`, `org_settings`, `org_domains`; add `org_id` and RLS to all 74 tables; per-company counters; storage prefixes; JWT claim; scoped service-role helper; per-company permission matrix; cron by company; super-admin area; billing.
- Build the "company A must never see company B" test suite first, then the policies to satisfy it.
- Migrate customers from separate deployments into the shared one only if the economics justify it; the two models can run side by side (large or sensitive customers stay on A).

## 8. Effort and cost (rough)

| Item | Estimate |
| --- | --- |
| Phase 0 (settings, metadata, flags, clean-up) | 3 to 5 working days |
| Phase 1 (provisioning and release tooling, first extra customer) | 1 to 2 weeks |
| Phase 2 (full multi-tenant: RLS on all tables, claims, scoping, tests, super-admin, billing) | 2 to 4 months |
| Infrastructure per customer in A | one Supabase project (a paid plan each for production use) plus one Vercel project (can share a team plan) |
| Infrastructure for B | one larger Supabase project, one Vercel project; cost grows with usage, not with customers |

Estimates assume one developer who knows the codebase. The risky part of B is not the amount of typing but proving that nothing leaks, which is why the test suite comes first.

## 9. Checklist for a new white-label customer (Option A)

1. Collect: legal name, trade name, address, phone, email, GSTIN, UDYAM, PAN, bank details, signatory and designation, logo (PNG with transparent background, at least 1000 px wide), brand colour, domain, first Admin's email, modules wanted, employee-number prefix and start, invoice and quotation prefixes, financial-year start.
2. Create the Supabase project (region near the customer, Mumbai for India), run migrations, seed settings and first Admin.
3. Create the Vercel project from the same repo, set the 12 variables (new keys for this customer), set the region to match Supabase, add the domain.
4. Generate icons, upload the logo and seal, check the login page, a PDF and the home-screen icon on a real phone.
5. Switch on only the modules they bought; keep the JSL module off.
6. Set the Supabase auth emails (sender name, templates, redirect URLs).
7. Run the smoke test list from Phase 1, then hand over with `docs/OPERATIONS_GUIDE.md` adapted to their name.
8. Add them to the customer register with the version deployed.

## 10. What I would do next

1. Make the GitHub repository private.
2. Approve Phase 0 so the company details, brand and flags become settings; this is useful even if you never sell the app.
3. Build the provisioning script and onboard one friendly customer on Option A; the lessons will tell you whether B is worth its cost.
