// Raises a Material Requisition (MRR) on the JSL portal. Two modes, one set of form-filling code:
//
//   MODE=dry  (the default)  fills the form from a sample file, reads it back, reads the portal's Report, and STOPS. There is no Save in this mode.
//             Usage: JSL_USER=... JSL_PASSWORD=... DRY_RUN=true node run.mjs samples/hand.json
//   MODE=send                the real thing, for one bill the app has queued. It needs CONFIRM_SEND=yes, BILL_ID, APP_URL and JSL_WORKER_KEY, and refuses DRY_RUN=true.
//
// How a real send protects against raising the same MRR twice, or raising a broken one:
//   1. The job comes from the app, once per send. The app refuses it unless the bill is queued.
//   2. BEFORE anything is filled in, the portal's Report is read, so the numbers that already exist are known and the Report is proven to work. If it cannot be read, nothing is saved.
//   3. The form shows the requisition number it is about to use. It must look like a requisition number and not exist yet.
//   4. Nothing is cut off: every value must fit its box on the portal.
//   5. The app is told "about to press Save" and must agree BEFORE Save is pressed. If the app cannot be reached, Save is not pressed.
//   6. After Save the Report is read again (several times, the portal can be slow). Our number there = submitted. Anything else = "needs check", which nothing ever retries by itself.
//   Any failure before step 5 is reported as "failed" (nothing was saved, safe to try again). Any failure after it is "needs_check".
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const BASE = (process.env.JSL_BASE_URL || 'https://jajitapps.jindalstainless.com:8050').replace(/\/$/, '');
const LOGIN_URL = `${BASE}/Login.aspx`;
const OUT = 'out';
const MODE = process.env.MODE === 'send' ? 'send' : 'dry';
const id = (name) => `#ContentPlaceHolder1_${name}`;
const UNITS = ['FT', 'Inch', 'Kg', 'Meter', 'mm', 'MT', 'No', 'Pcs'];   // the portal's unit dropdown, spelled as it spells them
const PROOF = { aadhaar: 1, voter: 1 };   // only the allowed ID kinds: the portal's option values are looked up by label
const REQ_NO = /\b\d{8}-\d+\b/g;          // a requisition number, e.g. 05112026-003

// Pick an ID type by the label the portal shows, so a changed option number can never send the wrong ID type.
async function pickProof(page, selector, kind) {
  const src = kind === 'aadhaar' ? 'a{1,2}dh?a{1,2}r' : 'voter';
  const val = await page.locator(selector).evaluate((el, rx) => { const o = [...el.options].find((x) => new RegExp(rx, 'i').test(x.text)); return o ? o.value : null; }, src);
  if (val === null) throw new Error(`No "${kind}" choice in ${selector}.`);
  await page.locator(selector).selectOption(val);
}

// Every field on the form with its value and choices. Dry run only (it holds the sample data): a real send never prints form contents.
const dumpFields = (page) => page.evaluate(() => [...document.querySelectorAll('input,select')].filter((e) => !['hidden', 'password'].includes(e.type)).map((e) => ({ id: e.id, type: e.type, value: e.value, options: e.tagName === 'SELECT' && e.options.length < 15 ? [...e.options].map((o) => `${o.value}=${o.text}`) : undefined })));

// ASP.NET reloads parts of this page after many changes (the Received by dropdown, the WO, Add). Anything typed meanwhile is wiped, so wait for the page to go quiet first.
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(Number(process.env.SETTLE_MS || 1500));
}

// The count box is the input the ▲ button belongs to (the button's id is the box's id plus "_bUp"), so it is found the same way on every form.
async function countBox(page, result) {
  const upId = await page.getByRole('button', { name: '▲' }).first().getAttribute('id');
  result.countBoxId = upId;
  if (upId && upId.endsWith('_bUp')) return page.locator(`#${upId.slice(0, -4)}`);
  return page.locator('input[id*="txtNoofPerson" i]:visible').first();   // by hand it is ...PersoninH, by vehicle ...PersonIn
}

const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(msg); process.exit(1); };
const { JSL_USER, JSL_PASSWORD } = process.env;
if (!JSL_USER || !JSL_PASSWORD) fail('JSL_USER and JSL_PASSWORD are not set.');
const SKIP_WO = process.env.SKIP_WO === 'true';   // SAP down: do not wait for the contractor details (dry run only)

// ---------- the job ----------
function checkJob(j) {
  const need = (ok, what) => { if (!ok) throw new Error(`Job: ${what}`); };
  need(['hand', 'vehicle'].includes(j.receivedBy), 'receivedBy must be "hand" or "vehicle"');
  need(/^\d{6,}$/.test(j.wo || ''), 'wo must be the work order number');
  need(Array.isArray(j.items) && j.items.length > 0, 'items is empty');
  for (const it of j.items) {
    need(it.name && it.qty > 0 && it.unit, `item "${it.name}" needs a name, a quantity and a unit`);
    need(UNITS.includes(it.unit), `item "${it.name}": "${it.unit}" is not a portal unit (${UNITS.join(', ')})`);
  }
  if (j.receivedBy === 'hand') need(j.hand?.name && PROOF[j.hand.idType] && j.hand.idNo, 'hand needs name, idType (aadhaar|voter) and idNo');
  if (j.receivedBy === 'hand' && j.hand?.idType === 'aadhaar') need(/^\d{12}$/.test(j.hand.idNo), 'an Aadhaar number is 12 digits');
  if (j.vehicle?.coDriver?.idType === 'aadhaar') need(/^\d{12}$/.test(j.vehicle.coDriver.idNo), 'a co-driver Aadhaar number is 12 digits');
  if (j.receivedBy === 'vehicle') {
    const v = j.vehicle || {};
    need(v.vehicleNo && v.driverName && v.driverDl, 'vehicle needs vehicleNo, driverName and driverDl');
    if (v.coDriver) need(v.coDriver.name && PROOF[v.coDriver.idType] && v.coDriver.idNo, 'coDriver needs name, idType and idNo');
  }
}

// ---------- talking to the app (real sends only) ----------
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
async function appCall(path, body, { tries = 1 } = {}) {
  let last = '';
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(`${APP_URL}/api/jsl-worker/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-worker-key': process.env.JSL_WORKER_KEY }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      last = `${r.status} ${j.error || ''}`.trim();
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;   // the app said no: asking again will not change the answer
    } catch (e) { last = e.message; }
    if (i < tries) await new Promise((res) => setTimeout(res, Number(process.env.RETRY_MS || 3000) * i));
  }
  throw new Error(`The app did not accept "${path}": ${last}`);
}

// ---------- the portal's Report ----------
// Returns every requisition number the Report shows. Throws if the page does not look like the Report (no "Requisition No" column), so a broken Report is never mistaken for an empty one.
async function readReport(page, job, result, label) {
  await page.getByRole('link', { name: 'Report', exact: true }).click();
  await page.locator(id('ddlReportType')).waitFor();
  await page.locator(id('ddlReportType')).selectOption('2');   // as recorded: the Material Requisition report
  await settle(page);
  await page.locator(id('ddltype')).selectOption('4').catch(() => {});
  await settle(page);
  const dept = await page.locator(id('ddDept')).evaluate((el, d) => { const o = [...el.options].find((x) => x.text.trim().toUpperCase() === d); return o ? o.value : null; }, (job.department || 'MECHANICAL').toUpperCase()).catch(() => null);
  await page.locator(id('ddDept')).selectOption(dept ?? '7').catch(() => {});   // by label when it can be found, else the value recorded for MECHANICAL
  await settle(page);
  // The Report lists nothing until both dates are set, and the boxes start empty. Clicking a box opens a calendar; its "Today" line fills the box. Today to today is enough:
  // a requisition number starts with the date, so a new one always falls in today's list.
  for (const box of ['txtFrom', 'txtTo']) {
    await page.locator(id(box)).click();
    await page.getByText(/Today:\s/).filter({ visible: true }).first().click({ timeout: 6000 });   // there is one calendar per box: use the one that is open
    await page.waitForTimeout(400);
    if (!(await page.locator(id(box)).inputValue()).trim()) throw new Error(`Could not set the Report's ${box === 'txtFrom' ? 'From' : 'To'} date.`);
  }
  result.reportRange = { from: await page.locator(id('txtFrom')).inputValue(), to: await page.locator(id('txtTo')).inputValue() };
  await page.getByRole('button', { name: 'Retrieve' }).click();
  await settle(page);
  const text = await page.locator('body').innerText();
  if (!/Requisition\s*No/i.test(text)) throw new Error('The Report did not show a "Requisition No" column.');
  const nums = [...new Set(text.match(REQ_NO) || [])];
  result[label] = { count: nums.length, last: nums.slice(-3) };
  return new Set(nums);
}

// The input that sits to the right of a label in the form's tables.
const inputAfter = (page, label) => page.locator(`xpath=//td[starts-with(normalize-space(.), "${label}") and not(.//td)]/following-sibling::td[1]//input`).first();

// The count box has ▲ / ▼ buttons, and the first click does not always register: click until the box shows what we want.
async function setPersons(page, box, want) {
  for (let i = 0; i < 5; i++) {
    if (Number(await box.inputValue()) === want) return;
    await page.getByRole('button', { name: '▲' }).first().click();
    await page.waitForTimeout(500);
  }
  if (Number(await box.inputValue()) !== want) throw new Error(`Could not set "No of Persons" to ${want}.`);
}

// Refuse text a box would cut off: fill() silently drops what does not fit, and a shortened name or ID must never be sent.
async function fitCheck(page, selector, value, what) {
  const max = await page.locator(selector).evaluate((e) => e.maxLength).catch(() => -1);
  if (max > 0 && String(value).length > max) throw new Error(`${what} is too long for the portal (${String(value).length} characters, it takes ${max}).`);
}
async function put(page, selector, value, what) { await fitCheck(page, selector, value, what); await page.locator(selector).fill(String(value)); }

// ---------- open the form and fill it in (shared by both modes) ----------
async function fillForm(page, job, result) {
  await page.getByRole('link', { name: 'Material', exact: true }).click();
  await page.getByRole('button', { name: 'Add Material Requisition' }).click();
  await page.locator(id('ddlReceivedby')).waitFor();

  // The form shows its own requisition number before anything is saved.
  // It can arrive a moment after the form opens, so look for a few seconds before deciding it is missing.
  for (let t = 0; t < 8000; t += 500) {
    result.requisitionNoOnForm = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).find((v) => /^\d{8}-\d+$/.test(v)) || null);
    if (result.requisitionNoOnForm) break;
    await page.waitForTimeout(500);
  }

  await page.locator(id('ddlReceivedby')).selectOption(job.receivedBy === 'hand' ? 'By Hand' : 'By Vehicle');
  await settle(page);
  // The portal fills contractor name, address and validity once the WO box is left. It may listen for key presses, which fill() never sends, so type key by key and try the ways a person would leave the box.
  // Enter is not one of them: in an ASP.NET form it can press the default button.
  const wo = page.locator(id('txtWorkorder'));
  const filledCount = () => page.evaluate(() => [...document.querySelectorAll('input')].filter((i) => !['hidden', 'password', 'checkbox', 'image', 'submit', 'button'].includes(i.type) && i.value.trim()).length);
  for (let attempt = 1; attempt <= 3; attempt++) {   // typed text can still be wiped by a late reload: check it stayed, and type again if not
    await wo.click();
    await wo.selectText().catch(() => {});
    await wo.pressSequentially(job.wo, { delay: Number(process.env.TYPE_DELAY || 80) });
    if ((await wo.inputValue()).trim() === job.wo) break;
    result.woTypedTimes = attempt;
    await settle(page);
  }
  result.woValueAfterTyping = await wo.inputValue();
  if (MODE === 'dry') {
    result.suggestions = (await page.locator('li:visible, [role="option"]:visible').allInnerTexts().catch(() => [])).slice(0, 10);
    await page.screenshot({ path: `${OUT}/wo-typed.png` });
  }
  if (SKIP_WO) {
    // The portal gets the contractor from SAP when the WO is left. While SAP is down nothing will fill in, so do not wait for it: leave the box and check everything else.
    await wo.press('Tab').catch(() => {});
    await settle(page);
    result.woSkipped = true;
  } else {
    const before = await filledCount();
    const filled = async (ms) => { for (let t = 0; t < ms; t += 500) { if ((await filledCount()) >= before + 3) return true; await page.waitForTimeout(500); } return false; };
    const ways = [
      ['tab', () => wo.press('Tab')],
      ['click-away', () => page.getByRole('cell', { name: /^Work Order/ }).first().click()],
      ['suggestion', async () => { const s = page.locator('li', { hasText: job.wo }).first(); if (await s.isVisible()) await s.click(); }],
    ];
    for (const [name, leave] of ways) {
      await leave().catch(() => {});
      if (await filled(Number(process.env.WO_WAIT_MS || 6000))) { result.woFilledBy = name; break; }
    }
    if (!result.woFilledBy) {
      if (MODE === 'dry') result.formInputs = await dumpFields(page);
      throw new Error('The portal did not fill in the contractor details from the WO number.');
    }
    if (MODE === 'dry') {
      result.contractor = (await inputAfter(page, 'Contractor Name').inputValue().catch(() => '')).trim();
      result.woValidity = (await inputAfter(page, 'WO Validity').inputValue().catch(() => '')).trim();
    } else if (!(await inputAfter(page, 'Contractor Name').inputValue().catch(() => '')).trim()) throw new Error('The portal did not show a contractor for this WO.');
  }
  await page.locator(id('ddlDept')).selectOption(job.department || 'MECHANICAL');
  await settle(page);

  if (job.receivedBy === 'hand') {
    await setPersons(page, await countBox(page, result), 1);
    await put(page, id('txtPersonName'), job.hand.name, 'The person\'s name');
    await pickProof(page, id('ddlPersonProofid'), job.hand.idType);
    await put(page, id('txtPersonPfoofid'), job.hand.idNo, 'The ID number');
  } else {
    const v = job.vehicle;
    await page.getByRole('checkbox', { name: 'GPS Required' }).check();   // compulsory on the portal
    await put(page, id('txtVehicleNo'), v.vehicleNo, 'The vehicle number');
    await put(page, id('txtDriverName'), v.driverName, 'The driver\'s name');
    await put(page, id('txtDriverDLNo'), v.driverDl, 'The driver\'s licence number');
    if (v.coDriver) {
      await setPersons(page, await countBox(page, result), 1);
      await pickProof(page, id('ddlIDProofType'), v.coDriver.idType);
      await put(page, id('txtCoDriverName'), v.coDriver.name, 'The co-driver\'s name');
      await put(page, id('txtCodriverDLNo'), v.coDriver.idNo, 'The co-driver\'s ID number');
    }
  }

  for (const it of job.items) {
    await put(page, id('txtMaterialnm'), it.name, `Item "${it.name.slice(0, 20)}"`);
    await page.locator(id('txtQty')).fill(String(it.qty));
    await page.locator(id('ddlUnit')).selectOption(it.unit);
    await page.locator(id('ImgAdd')).click();
    await settle(page);
  }

  // Read the item list back: each name must appear as many times as the job has it (two lines can share a name).
  const listText = (await page.locator(id('pnlMaterial')).innerText()).toUpperCase();
  const count = (s, sub) => s.split(sub).length - 1;
  result.itemsMissing = [...new Set(job.items.map((i) => i.name))].filter((n) => count(listText, n.toUpperCase()) < job.items.filter((i) => i.name === n).length);
  if (result.itemsMissing.length) throw new Error(`Items not shown in the portal's list: ${result.itemsMissing.length} of ${new Set(job.items.map((i) => i.name)).size} missing.`);
  // The longest text each box accepts, so the app can refuse what the portal would cut off.
  result.fieldLimits = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('input')].filter((e) => ['text', ''].includes(e.type) && e.maxLength > 0 && e.maxLength < 1000).map((e) => [e.id.replace('ContentPlaceHolder1_', ''), e.maxLength])));
}

async function login(page) {
  await page.goto(LOGIN_URL);
  await page.locator(id('txtUID')).fill(JSL_USER);
  await page.locator(id('txtPWD')).fill(JSL_PASSWORD);
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByText('Logout').first().waitFor().catch(() => { throw new Error('Login did not complete (no Logout link after Submit).'); });
}

async function newBrowser(result) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'en-IN', timezoneId: 'Asia/Kolkata', viewport: { width: 1400, height: 1000 } })).newPage();   // India time: the portal's calendar says "Today" by the browser's clock
  page.setDefaultTimeout(Number(process.env.STEP_TIMEOUT_MS || 20000));
  page.on('dialog', (d) => d.accept().catch(() => {}));   // the portal's alert always says ERROR even when it worked, so its text is ignored
  // Background calls the portal makes that fail (paths only, never the query or body): this is how we would see the portal refusing a GitHub server.
  result.badRequests = [];
  page.on('response', (r) => { if (r.status() >= 400 && result.badRequests.length < 15) result.badRequests.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  page.on('requestfailed', (r) => { if (result.badRequests.length < 15) result.badRequests.push(`FAILED ${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText}`); });
  return { browser, page };
}

mkdirSync(OUT, { recursive: true });

// =====================================================================================================================
// MODE=dry: fill, read back, read the Report, stop.
// =====================================================================================================================
async function dryRun() {
  if (process.env.DRY_RUN !== 'true') fail('The dry run needs DRY_RUN=true.');
  const jobFile = process.argv[2]; if (!jobFile) fail('Usage: node run.mjs <job.json>');
  const job = JSON.parse(readFileSync(jobFile, 'utf8')); try { checkJob(job); } catch (e) { fail(e.message); }
  const result = { ok: false, mode: 'dry', receivedBy: job.receivedBy, saved: false };
  const { browser, page } = await newBrowser(result);
  try {
    await login(page);
    // Safe discovery of the Report: read it before and after filling the form. Nothing is saved, so the numbers must not change.
    let before = null; try { before = await readReport(page, job, result, 'reportBefore'); } catch (e) { result.reportError = e.message; await page.screenshot({ path: `${OUT}/report-problem.png`, fullPage: true }).catch(() => {}); }
    await fillForm(page, job, result);
    await page.screenshot({ path: `${OUT}/form.png`, fullPage: true });
    if (before) {
      result.requisitionOnFormIsNew = !!result.requisitionNoOnForm && !before.has(result.requisitionNoOnForm);
      try { const after = await readReport(page, job, result, 'reportAfter'); result.reportUnchanged = after.size === before.size && [...after].every((n) => before.has(n)); } catch (e) { result.reportAfterError = e.message; }
    }
    result.ok = true;
    log('Dry run complete: the form was filled and read back. Nothing was saved.');
  } catch (e) {
    result.error = e.message;
    result.formInputs ??= await dumpFields(page).catch(() => undefined);
    console.error(`Dry run FAILED: ${e.message}`);
    await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
  } finally {
    writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
    log(JSON.stringify(result, null, 2));
    await browser.close();
    process.exit(result.ok ? 0 : 1);
  }
}

// =====================================================================================================================
// MODE=send: one bill, for real.
// =====================================================================================================================
async function send() {
  if (process.env.DRY_RUN === 'true') fail('MODE=send cannot run with DRY_RUN=true.');
  if (SKIP_WO) fail('MODE=send cannot skip the work order check.');
  if (process.env.CONFIRM_SEND !== 'yes') fail('MODE=send needs CONFIRM_SEND=yes.');
  const bill = process.env.BILL_ID || '';
  if (!/^[0-9a-f-]{36}$/i.test(bill)) fail('BILL_ID is missing or not a bill id.');
  if (!APP_URL || !process.env.JSL_WORKER_KEY) fail('APP_URL and JSL_WORKER_KEY are needed to send.');

  const result = { ok: false, mode: 'send', saved: false, stage: 'start' };   // nothing from the job (names, ID numbers) is ever put in here or printed
  let browser, page;
  const report = (stage, ref, detail) => appCall('report', { bill, stage, ref, detail }, { tries: 5 });
  const giveUp = async (stage, detail) => {   // report where it ended; if even that cannot be said, say so loudly (the app's own timeout then settles it)
    result.error = detail; console.error(`${stage.toUpperCase()}: ${detail}`);
    try { await report(stage, result.requisitionNoOnForm ?? null, detail); } catch (e) { console.error(`Could not tell the app: ${e.message}`); result.reportedToApp = false; }
  };
  try {
    log('Taking the job from the app…');
    let job;
    try { job = (await appCall('job', { bill })).job; checkJob(job); }
    catch (e) { await giveUp('failed', `Could not get a valid job: ${e.message}`); return finish(result, browser); }

    ({ browser, page } = await newBrowser(result));
    // ---- before Save: any failure here saves nothing ----
    let before;
    try {
      result.stage = 'login'; await login(page);
      result.stage = 'report-before'; before = await readReport(page, job, result, 'reportBefore'); log(`Report read: ${before.size} requisition number(s) so far.`);
      result.stage = 'form'; await fillForm(page, job, result); log('The form is filled and the items are listed.');
      const ref = result.requisitionNoOnForm;
      if (!ref || !/^\d{8}-\d+$/.test(ref)) throw new Error('The form did not show a requisition number.');
      if (before.has(ref)) throw new Error('The requisition number on the form already exists in the Report.');
      result.stage = 'tell-app'; await report('submitting', ref, 'About to press Save');   // the app must agree before Save is pressed
    } catch (e) { await giveUp('failed', e.message); return finish(result, browser); }

    // ---- Save, then confirm. From here on nobody can say for sure what the portal holds, so anything unexpected is needs_check ----
    const ref = result.requisitionNoOnForm;
    try {
      result.stage = 'save'; log(`Pressing Save (requisition ${ref}).`);
      await page.locator(id('ImgSave')).click();
      result.saved = 'clicked';
      await settle(page);
      try { await page.locator(id('ibtn_Close')).click({ timeout: 8000 }); await settle(page); } catch { /* the form may already be closed */ }
      result.stage = 'confirm'; let found = false;
      for (let attempt = 1; attempt <= Number(process.env.CONFIRM_TRIES || 4) && !found; attempt++) {
        const after = await readReport(page, job, result, 'reportAfter');
        result.newNumbers = [...after].filter((n) => !before.has(n));
        found = after.has(ref); log(`Confirm ${attempt}: ${found ? 'our requisition is in the Report' : `not in the Report yet (${result.newNumbers.length} new number(s))`}.`);
        if (!found && attempt < Number(process.env.CONFIRM_TRIES || 4)) await page.waitForTimeout(Number(process.env.CONFIRM_WAIT_MS || 20000));
      }
      if (!found) { await giveUp('needs_check', `Save was pressed but ${ref} is not in the Report. It may or may not exist: check the portal. New numbers seen: ${result.newNumbers.join(', ') || 'none'}.`); return finish(result, browser); }
      await report('submitted', ref, 'Confirmed in the Report');
      result.ok = true; result.saved = true; log(`Done: requisition ${ref} is on the portal.`);
    } catch (e) { await giveUp('needs_check', `After pressing Save: ${e.message}`); }
  } catch (e) { result.error = e.message; console.error(e.message); }
  return finish(result, browser);
}
async function finish(result, browser) {
  writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
  log(JSON.stringify(result, null, 2));
  await browser?.close().catch(() => {});
  process.exit(result.ok ? 0 : 1);
}

if (MODE === 'send') await send(); else await dryRun();
