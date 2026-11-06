// Raises an MRR on the JSL portal from a job file. DRY RUN ONLY: it fills the form, reads back what the portal shows, takes screenshots and stops.
// There is no Save step in this file on purpose. It refuses to start unless DRY_RUN=true.
// Usage: JSL_USER=... JSL_PASSWORD=... DRY_RUN=true node run.mjs samples/hand.json
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const LOGIN_URL = 'https://jajitapps.jindalstainless.com:8050/Login.aspx';
const OUT = 'out';
const id = (name) => `#ContentPlaceHolder1_${name}`;
const PROOF = { aadhaar: '1', voter: '2' };   // the portal's values for both proof dropdowns

const fail = (msg) => { console.error(msg); process.exit(1); };
const jobFile = process.argv[2];
const { JSL_USER, JSL_PASSWORD } = process.env;
if (!jobFile) fail('Usage: node run.mjs <job.json>');
if (!JSL_USER || !JSL_PASSWORD) fail('JSL_USER and JSL_PASSWORD are not set.');
if (process.env.DRY_RUN !== 'true') fail('Only the dry run is built. Set DRY_RUN=true.');

const job = JSON.parse(readFileSync(jobFile, 'utf8'));
function checkJob(j) {
  const need = (ok, what) => { if (!ok) fail(`Job file: ${what}`); };
  need(['hand', 'vehicle'].includes(j.receivedBy), 'receivedBy must be "hand" or "vehicle"');
  need(/^\d{6,}$/.test(j.wo || ''), 'wo must be the work order number');
  need(Array.isArray(j.items) && j.items.length > 0, 'items is empty');
  for (const it of j.items) need(it.name && it.qty > 0 && it.unit, `item "${it.name}" needs a name, a quantity and a unit`);
  if (j.receivedBy === 'hand') need(j.hand?.name && PROOF[j.hand.idType] && j.hand.idNo, 'hand needs name, idType (aadhaar|voter) and idNo');
  if (j.receivedBy === 'vehicle') {
    const v = j.vehicle || {};
    need(v.vehicleNo && v.driverName && v.driverDl, 'vehicle needs vehicleNo, driverName and driverDl');
    if (v.coDriver) need(v.coDriver.name && PROOF[v.coDriver.idType] && v.coDriver.idNo, 'coDriver needs name, idType and idNo');
  }
}
checkJob(job);

mkdirSync(OUT, { recursive: true });
const result = { ok: false, receivedBy: job.receivedBy, saved: false };

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

const browser = await chromium.launch();
const page = await (await browser.newContext({ locale: 'en-IN', viewport: { width: 1400, height: 1000 } })).newPage();
page.setDefaultTimeout(20000);
page.on('dialog', (d) => d.accept().catch(() => {}));   // the portal's alert always says ERROR even when it worked, so its text is ignored

try {
  await page.goto(LOGIN_URL);
  await page.locator(id('txtUID')).fill(JSL_USER);
  await page.locator(id('txtPWD')).fill(JSL_PASSWORD);
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByText('Logout').first().waitFor().catch(() => { throw new Error('Login did not complete (no Logout link after Submit).'); });

  await page.getByRole('link', { name: 'Material', exact: true }).click();
  await page.getByRole('button', { name: 'Add Material Requisition' }).click();
  await page.locator(id('ddlReceivedby')).waitFor();

  // The form shows its own requisition number before anything is saved.
  result.requisitionNoOnForm = await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).find((v) => /^\d{8}-\d+$/.test(v)) || null);

  await page.locator(id('ddlReceivedby')).selectOption(job.receivedBy === 'hand' ? 'By Hand' : 'By Vehicle');
  // The portal fills contractor name, address and validity once the WO box is left. It may listen for key presses, which fill() never sends, so type key by key and try the ways a person would leave the box.
  // Enter is not one of them: in an ASP.NET form it can press the default button.
  const wo = page.locator(id('txtWorkorder'));
  const filledCount = () => page.evaluate(() => [...document.querySelectorAll('input')].filter((i) => !['hidden', 'password', 'checkbox', 'image', 'submit', 'button'].includes(i.type) && i.value.trim()).length);
  await wo.click();
  await wo.pressSequentially(job.wo, { delay: 80 });
  const before = await filledCount();
  const filled = async (ms) => { for (let t = 0; t < ms; t += 500) { if ((await filledCount()) >= before + 3) return true; await page.waitForTimeout(500); } return false; };
  const ways = [
    ['tab', () => wo.press('Tab')],
    ['click-away', () => page.getByRole('cell', { name: /^Work Order/ }).first().click()],
    ['suggestion', async () => { const s = page.locator('li', { hasText: job.wo }).first(); if (await s.isVisible()) await s.click(); }],
  ];
  for (const [name, leave] of ways) {
    await leave().catch(() => {});
    if (await filled(6000)) { result.woFilledBy = name; break; }
  }
  if (!result.woFilledBy) {
    result.formInputs = await page.evaluate(() => [...document.querySelectorAll('input,select')].filter((e) => !['hidden', 'password'].includes(e.type)).map((e) => ({ id: e.id, type: e.type, value: e.value })));
    throw new Error('The portal did not fill in the contractor details from the WO number.');
  }
  result.contractor = (await inputAfter(page, 'Contractor Name').inputValue().catch(() => '')).trim();
  result.woValidity = (await inputAfter(page, 'WO Validity').inputValue().catch(() => '')).trim();
  await page.locator(id('ddlDept')).selectOption(job.department || 'MECHANICAL');

  if (job.receivedBy === 'hand') {
    await setPersons(page, page.locator(id('txtNoofPersoninH')), 1);
    await page.locator(id('txtPersonName')).fill(job.hand.name);
    await page.locator(id('ddlPersonProofid')).selectOption(PROOF[job.hand.idType]);
    await page.locator(id('txtPersonPfoofid')).fill(job.hand.idNo);
  } else {
    const v = job.vehicle;
    await page.getByRole('checkbox', { name: 'GPS Required' }).check();   // compulsory on the portal
    await page.locator(id('txtVehicleNo')).fill(v.vehicleNo);
    await page.locator(id('txtDriverName')).fill(v.driverName);
    await page.locator(id('txtDriverDLNo')).fill(v.driverDl);
    if (v.coDriver) {
      await setPersons(page, page.locator('input[id*="txtNoofPersonin"]:visible').first(), 1);
      await page.locator(id('ddlIDProofType')).selectOption(PROOF[v.coDriver.idType]);
      await page.locator(id('txtCoDriverName')).fill(v.coDriver.name);
      await page.locator(id('txtCodriverDLNo')).fill(v.coDriver.idNo);
    }
  }

  for (const it of job.items) {
    await page.locator(id('txtMaterialnm')).fill(it.name);
    await page.locator(id('txtQty')).fill(String(it.qty));
    await page.locator(id('ddlUnit')).selectOption(it.unit);
    await page.locator(id('ImgAdd')).click();
    await page.waitForTimeout(800);
  }

  // Read the item list back: each name must appear as many times as the job has it (two lines can share a name).
  const listText = (await page.locator(id('pnlMaterial')).innerText()).toUpperCase();
  const count = (s, sub) => s.split(sub).length - 1;
  result.itemsMissing = [...new Set(job.items.map((i) => i.name))].filter((n) => count(listText, n.toUpperCase()) < job.items.filter((i) => i.name === n).length);
  if (result.itemsMissing.length) throw new Error(`Items not shown in the portal's list: ${result.itemsMissing.join(', ')}`);

  await page.screenshot({ path: `${OUT}/form.png`, fullPage: true });
  result.ok = true;
  console.log('Dry run complete: the form was filled and read back. Nothing was saved.');
} catch (e) {
  result.error = e.message;
  console.error(`Dry run FAILED: ${e.message}`);
  await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
} finally {
  writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(result.ok ? 0 : 1);
}
