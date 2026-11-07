# Performance audit (7 Nov 2026)

How fast the app feels, where the time goes, what repeats, and whether caching or Redis would help. Measured on a production build against a stand-in backend with fake data, so call counts, repeats and file sizes are exact, and timings are relative. **Not measured:** real network delay to your Supabase and Vercel regions, which is the biggest unknown (see 1).

## The short answer

- The pages themselves are lean. The slow feeling will come mostly from **how far the browser and servers are from the database**, a few **whole-table loads**, and **a handful of repeated calls**.
- **Redis would not help today.** Almost every read is a small indexed query, and almost every write goes from the browser straight to Supabase, so a server-side cache can't know when to refresh. Fix the three things in "Do first" and use the cheaper kinds of caching described in section 5.

## 1. Where the time goes (ranked by payoff)

| # | Finding | Evidence | Effort | Payoff |
| --- | --- | --- | --- | --- |
| 1 | **Region.** Browser pages call Supabase directly, so their speed depends on the Supabase region. The app's own `/api` routes run on Vercel and call Supabase from there. Vercel's default region is Washington (`iad1`). If Supabase is in Mumbai, every call from an API route crosses the world, and a route like Payments due makes ~20 of them. | No region set in the repo (it may be set in the Vercel dashboard: check). | 10 minutes, settings only | **High** for every `/api` route |
| 2 | **Payments due loads whole tables.** One call to `/api/payments-due` reads ~20 tables completely (all payroll lines with their snapshots, all bills, payments, attendance...), none filtered by date, every time Expenses is opened by an Admin or Viewer. It grows with the company's history. | `paymentsDueData.ts`: 20 table loads, 0 with a date filter. | Medium | **High** |
| 3 | **Every API route asks Supabase Auth "who is this?"** (`auth.getUser()`) and then asks again for the role (`is_admin`). The login token was already checked by the app's gatekeeper (middleware), so this is a repeated trip. | 28 route files call `getUser()`; 7 also call a role check. | Small per route | **Medium-High**: saves a round trip on every API call |
| 4 | **The project page loads everything for all tabs at once** (16 calls): every column of every person, every expense, every document, plus forecast, even if you only look at Overview. The forecast call sometimes fires twice on open. | Request audit, `/projects/:id`. | Small to medium | Medium |
| 5 | **Site supplies repeats reference data.** Gas and Equipment each load the same vendors, vendor links and names, so 5 queries run twice (18 calls for the page). | Request audit, `/site-supplies`. | Small | Medium |
| 6 | **The Employees page downloads two whole tables** every visit: all employees and every document status row for every employee (about 14 rows per person). | Request audit, `/`. | Medium | Medium now, **High** as headcount grows |
| 7 | **`select("*")` in 108 places.** Pages fetch every column, including wide ones and personal details, when they show a few. | `grep`. | Ongoing | Medium (payload, speed, and less personal data in the browser) |
| 8 | **The logo files I added for dark mode weighed ~220 KB**, and the hidden one still downloaded. | Fixed: now one 22 KB file. | Done | Small but on every page |
| 9 | **Bill photos have no caching headers.** The route correctly redirects to a short-lived storage link, but the browser re-downloads the image each time. | `api/inventory/view`. | Small | Small |
| 10 | **Background refresh:** Attendance sheet every 25 s and Sites every 30 s (paused when the tab is hidden). Fine; just worth knowing it is steady traffic. | `POLL_MS`. | None | Low |

### What is already good

- **Parallel loading:** most pages make 4 to 10 calls in one or two waves, not a long chain.
- **Who-am-I lookups are shared:** the person and role are fetched once per tab and reused. The permission matrix too.
- **Gatekeeper is cheap:** it checks the login token locally and remembers the role and matrix for a minute.
- **List pages remember their last result** (at least projects, clients, quotations, invoices and work orders) and show it while fresh data loads.
- **Page size is modest:** 102 KB shared script plus 5 to 110 KB per page (first load 175 to 213 KB). Map and PDF/Excel libraries only load where they are used.
- **Indexes** exist on the hot filters (attendance by project and date, expenses by project and date, bills, employees by project, and so on).
- **No web fonts**, no large images in pages, files go through short-lived storage links.

## 2. Calls per page (production build, signed in as Admin)

| Page | Calls | Waves | Repeated within the page |
| --- | --- | --- | --- |
| Employees | 5 | 1 | none (but 2 whole-table loads) |
| Payroll | 9 | 1 | none |
| Attendance | 10 | 2 | none |
| Projects | 6 | 1 | none |
| Project page | 17 | 1 | forecast twice (sometimes) |
| Meals | 9 | 2 | none |
| **Site supplies** | **20** | 1 | 5 queries twice |
| Inventory | 8 | 2 | none |
| Expenses | 6 (+1 heavy `/api/payments-due`) | 2 | none |
| Quotations | 6 | 1 | none |
| Invoices / Work orders | 7 | 1 | none |
| Clients | 6 | 1 | none |
| Transport / Accommodation | 8 / 9 | 1 | none |

A "wave" is a group of calls started together. The first load of a session also includes two small lookups (your role and name) that are then shared across pages.

## 3. Page weight (first load, production build)

Shared by every page: **102 KB**. Largest pages: Employee profile 213 KB, Payroll 208 KB, Project page 205 KB, Site supplies 198 KB, Attendance 195 KB, Meals 195 KB, Expenses 192 KB. Smallest: Settings 178 KB, Login 175 KB. This is healthy for an app of this size; the wins are in data, not script.

## 4. What to do, in order

**Do first (cheap, safe, big):**
1. **Put the Vercel functions in the same region as Supabase** (Vercel project, Settings, Functions, Region; for Mumbai that is `bom1`). Check the Supabase project's region first (Settings, General). If they already match, skip.
2. **Replace `auth.getUser()` with the local token check in the API routes** and read the role from the token instead of asking the database. Removes a round trip from every API call.
3. **Make Payments due cheaper:**
   a. Load it only when its figures are needed and remember the answer for a minute while moving around the app (today every visit refetches ~20 tables).
   b. Better: limit what it reads to what is unpaid or recent, or move the arithmetic into one database function so the browser receives only the result.

**Next:**
4. Project page: load People, Expenses, Documents and Forecast **when their tab opens**; stop the doubled forecast call; fetch only the columns shown.
5. Site supplies: load shared vendor data once for both parts.
6. Employees page: fetch a count of document statuses per person from the database (one small query) instead of every row; add paging or "load more" once the list passes a few hundred people.
7. Replace `select("*")` with the columns used, page by page, starting with employees, payroll lines and expenses.
8. Add a short `Cache-Control` on file redirects (bill photos, documents).

**Later, only if measurements show a need:** a shared data layer for the browser (see 5), database views for dashboards, and pagination of long lists.

## 5. Would caching help? Would Redis?

**Redis: not now.** Reasons:
- **The queries are cheap.** They are small, indexed reads. Time is lost in round trips and in loading more than needed, not in the database working hard.
- **Writes bypass the server.** Saves go from the browser directly to Supabase. A server cache cannot see them, so it cannot be told when its copy is out of date, and people would see stale money figures. That is the worst place for stale data.
- **It adds a service, a bill and a failure mode** for little gain at this size. It would start to make sense for: rate limiting, a shared lock or queue, or results many users share that are expensive and fine to be a minute old. None of those is the app's problem today.

**Caching that does help, cheapest first:**
1. **Remember data in the browser and refresh in the background** (stale-while-revalidate). The app already does this for several list pages. Extend it to the shared lists used on many screens (projects, expense categories, vendors, the permission matrix) with a short lifetime, so moving between pages doesn't refetch them. A library such as TanStack Query or SWR also removes duplicate in-flight requests (the Site supplies repeats) and retries for free.
2. **HTTP caching of files:** short `private` caching for photos and documents.
3. **A short server-side cache for Payments due only**, using Next.js's built-in data cache (no extra service), about 30 to 60 seconds, with a "refresh" that skips it. The data is the same for every Admin and Viewer, and the cost is high.
4. **Database-side work:** a view or function for the expensive totals, and turning on the slow-query report in Supabase to see real numbers.

## 6. Loading indicators (done in the same pass)

- A centred ring replaces every "Loading…" text, on 27 screens.
- A thin bar along the top of the screen shows whenever the app is talking to the server (after a short delay, so quick calls don't flash it).
- A ring appears on any button that is switched off while it works ("Saving…", "Uploading…", "Sending…").
- For the iPhone or iPad home-screen app: **pull down from the top of the page to refresh**.

## 7. What I could not check

- **Real timings** (your regions, mobile networks, the size of your real tables). The stand-in backend answers instantly.
- **The Supabase performance advisor and slow-query report**, because the database connection from this workspace is not authorized. Running them in the Supabase dashboard (Advisors, Performance; Reports, Query performance) would give the real list of missing indexes and slow queries.
- **Row-level security cost on large tables**, for the same reason. The rules were tidied earlier to evaluate once per query, which is the main thing to get right.
