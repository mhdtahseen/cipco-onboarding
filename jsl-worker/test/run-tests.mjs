// Tests the robot end to end against a fake portal and a fake app, with no real portal, no real login and no real data.
//   cd jsl-worker && npm install && npx playwright install chromium && node test/run-tests.mjs
// The fake app follows the same rules as the database functions (inventory_jsl_job / inventory_jsl_report), which are tested separately.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { startPortal } from './fake-portal.mjs';

const BILL = 'a0000000-0000-0000-0000-000000000001', KEY = 'test-key-test-key-test-key-1234';
let fails = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + x)); if (!c) fails++; };

function startApp(job, flags = {}) {
  const st = { status: 'sending', claimed: false, ref: null, expected: null, calls: [], flags, detail: '' };
  const server = http.createServer(async (req, res) => {
    const body = JSON.parse(await new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => ok(d || '{}')); }));
    const send = (code, o) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.headers['x-worker-key'] !== KEY) return send(401, { error: 'Not allowed.' });
    if (req.url.endsWith('/job')) { st.calls.push('job'); if (st.flags.refuseJob || st.claimed || st.status !== 'sending') return send(409, { error: 'This send was already picked up.' }); st.claimed = true; return send(200, { job }); }
    if (req.url.endsWith('/report')) {
      st.calls.push(body.stage); const s = body.stage;
      if (s === 'submitting' && st.flags.failSubmitting) return send(500, { error: 'boom' });
      const bad = (m) => send(409, { error: m });
      if (s === 'submitting') { if (st.status !== 'sending' || !st.claimed) return bad('Not in a state to save'); if (!/^\d{8}-\d+$/.test(body.ref || '')) return bad('number'); st.status = 'submitting'; st.expected = body.ref; }
      else if (s === 'submitted') { if (st.status !== 'submitting') return bad('Not saving'); st.status = 'submitted'; st.ref = body.ref; }
      else if (s === 'failed') { if (st.status !== 'sending') return bad('Cannot call this failed'); st.status = 'failed'; st.detail = body.detail; }
      else if (s === 'needs_check') { if (st.status !== 'submitting') return bad('Not saving'); st.status = 'needs_check'; st.detail = body.detail; }
      return send(200, { ok: true });
    }
    send(404, {});
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, st, stop: () => new Promise((x) => server.close(x)) })));
}
function runWorker(env, args = []) {
  rmSync('out', { recursive: true, force: true });
  return new Promise((resolve) => {
    const p = spawn('node', ['run.mjs', ...args], { env: { ...process.env, JSL_USER: 'u', JSL_PASSWORD: 'p', SETTLE_MS: '150', TYPE_DELAY: '5', WO_WAIT_MS: '2500', STEP_TIMEOUT_MS: '8000', RETRY_MS: '50', CONFIRM_WAIT_MS: '200', ...env } });
    let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    const t = setTimeout(() => p.kill('SIGKILL'), 120000);
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}
const HAND = { receivedBy: 'hand', wo: '1909000093', department: 'MECHANICAL', hand: { name: 'RAMESH PATEL', idType: 'aadhaar', idNo: '111122223333' }, items: [{ name: 'GRINDING DISC 4 INCH', qty: 10, unit: 'Pcs' }, { name: 'EAR PLUG', qty: 2.5, unit: 'No' }] };
const VEH = { receivedBy: 'vehicle', wo: '1909000093', department: 'MECHANICAL', vehicle: { vehicleNo: 'MH12AB1234', driverName: 'RAVI K', driverDl: 'MH1220200000000', coDriver: { name: 'SUNIL', idType: 'voter', idNo: 'ABC1234567' } }, items: [{ name: 'LPG CYLINDER 19KG', qty: 1, unit: 'No' }] };

async function scenario(name, { job = HAND, portal: pf = {}, app: af = {}, env = {} }, check) {
  const portal = await startPortal(pf), app = await startApp(job, af);
  const r = await runWorker({ MODE: 'send', CONFIRM_SEND: 'yes', BILL_ID: BILL, APP_URL: app.url, JSL_WORKER_KEY: KEY, JSL_BASE_URL: portal.url, ...env });
  const result = existsSync('out/result.json') ? JSON.parse(readFileSync('out/result.json', 'utf8')) : {};
  console.log(`\n--- ${name}`); try { check({ r, portal, app, result }); } catch (e) { ok(`${name}: the check itself ran`, false, e.message); }
  const leaked = /111122223333|ABC1234567|RAMESH|MH12AB1234|MH1220200000000|SUNIL/.test(r.out + JSON.stringify(result)); ok(`${name}: nothing personal in the output`, !leaked);
  await portal.stop(); await app.stop();
}
const newCount = (p) => p.state.requisitions.length - (p.state.flags.startEmpty ? 0 : 3);

// ---------- the dry run (no Save) ----------
{
  const portal = await startPortal(); const r = await runWorker({ DRY_RUN: 'true', JSL_BASE_URL: portal.url }, ['samples/hand.json']); const res = JSON.parse(readFileSync('out/result.json', 'utf8'));
  console.log('\n--- dry run, by hand');
  ok('dry run: completes', r.code === 0 && res.ok, r.out.slice(-300)); ok('dry run: nothing saved', portal.state.saves === 0 && newCount(portal) === 0);
  ok('dry run: the Report was read before and after, and did not change', res.reportBefore?.count === 3 && res.reportUnchanged === true, JSON.stringify(res.reportBefore));
  ok('dry run: the form\'s requisition number is new', res.requisitionOnFormIsNew === true, res.requisitionNoOnForm);
  await portal.stop();
  const p2 = await startPortal(); const r2 = await runWorker({ DRY_RUN: 'true', JSL_BASE_URL: p2.url }, ['samples/vehicle.json']); const res2 = JSON.parse(readFileSync('out/result.json', 'utf8'));
  console.log('\n--- dry run, by vehicle with a co-driver'); ok('dry run (vehicle): completes with nothing saved', r2.code === 0 && res2.ok && p2.state.saves === 0, r2.out.slice(-300)); await p2.stop();
}

// ---------- refusals ----------
{
  const r = await runWorker({ MODE: 'send', BILL_ID: BILL, APP_URL: 'http://x', JSL_WORKER_KEY: KEY }); console.log('\n--- refusals');
  ok('send refuses without CONFIRM_SEND=yes', r.code === 1 && /CONFIRM_SEND/.test(r.out));
  const r2 = await runWorker({ MODE: 'send', CONFIRM_SEND: 'yes', DRY_RUN: 'true', BILL_ID: BILL, APP_URL: 'http://x', JSL_WORKER_KEY: KEY }); ok('send refuses together with DRY_RUN=true', r2.code === 1 && /DRY_RUN/.test(r2.out));
  const r3 = await runWorker({ MODE: 'send', CONFIRM_SEND: 'yes', SKIP_WO: 'true', BILL_ID: BILL, APP_URL: 'http://x', JSL_WORKER_KEY: KEY }); ok('send refuses to skip the work order', r3.code === 1 && /skip the work order/.test(r3.out));
  const r4 = await runWorker({ MODE: 'send', CONFIRM_SEND: 'yes', BILL_ID: 'not-a-bill', APP_URL: 'http://x', JSL_WORKER_KEY: KEY }); ok('send refuses a bad bill id', r4.code === 1);
}

// ---------- real sends ----------
await scenario('happy path, by hand', {}, ({ r, portal, app, result }) => {
  ok('exit 0', r.code === 0, r.out.slice(-400)); ok('exactly one new requisition on the portal', newCount(portal) === 1, String(newCount(portal)));
  ok('the app was told in order: job, submitting, submitted', app.st.calls.join(',') === 'job,submitting,submitted', app.st.calls.join(','));
  ok('the app holds the number the form showed', app.st.status === 'submitted' && app.st.ref === app.st.expected && /^07112026-\d+$/.test(app.st.ref), JSON.stringify(app.st));
  ok('the saved MRR has both items', /GRINDING DISC 4 INCH x 10 Pcs; EAR PLUG x 2.5 No/.test(portal.state.lastSave.items), portal.state.lastSave?.items);
  ok('Save was pressed once', portal.state.saves === 1);
  ok('the Report was read before filling and after Save', portal.state.reportReads >= 2);
});
await scenario('happy path, by vehicle with a co-driver', { job: VEH }, ({ r, portal, app }) => {
  ok('exit 0 and submitted', r.code === 0 && app.st.status === 'submitted', r.out.slice(-400)); ok('one new requisition', newCount(portal) === 1);
});
await scenario('nothing exists on the portal yet today (the Report says No Record Found)', { portal: { startEmpty: true } }, ({ r, portal, app }) => {
  ok('an empty Report is fine: sent and confirmed', r.code === 0 && app.st.status === 'submitted' && newCount(portal) === 1, r.out.slice(-300));
});
await scenario('a slow Report whose numbers wrap over two lines', { portal: { slowReport: 3000, wrapNumbers: true } }, ({ r, portal, app }) => {
  ok('waits for the list and joins wrapped numbers: sent and confirmed', r.code === 0 && app.st.status === 'submitted' && newCount(portal) === 1, r.out.slice(-300));
});
await scenario('the portal is slow to show the new requisition (3 reads)', { portal: { lagReports: 2 }, env: { CONFIRM_TRIES: '5' } }, ({ r, portal, app }) => {
  ok('found on a later read: submitted', r.code === 0 && app.st.status === 'submitted', r.out.slice(-300)); ok('it did not save twice', portal.state.saves === 1);
});
await scenario('Save does nothing on the portal', { portal: { swallowSave: true }, env: { CONFIRM_TRIES: '2' } }, ({ r, portal, app }) => {
  ok('needs_check, never failed or submitted', app.st.status === 'needs_check', app.st.status); ok('exit 1', r.code === 1);
  ok('Save was pressed exactly once (never retried)', portal.state.saves === 1);
});
await scenario('the portal shows our requisition but also a second one it made', { portal: { doubleSave: true } }, ({ r, app, result }) => {
  ok('ours is found: submitted', app.st.status === 'submitted', app.st.status); ok('the extra number is recorded for a human', (result.newNumbers || []).length === 2, JSON.stringify(result.newNumbers));
});
await scenario('the Report is broken before anything is filled in', { portal: { brokenReport: true } }, ({ r, portal, app }) => {
  ok('failed, and Save was never pressed', app.st.status === 'failed' && portal.state.saves === 0, app.st.status + ' saves=' + portal.state.saves);
  ok('"submitting" was never reported', !app.st.calls.includes('submitting'), app.st.calls.join(','));
});
await scenario('the Report breaks after Save', { portal: { brokenAfterSave: true } }, ({ r, portal, app }) => {
  ok('needs_check (Save was pressed)', app.st.status === 'needs_check' && portal.state.saves === 1, app.st.status);
});
await scenario('the app cannot be told "about to save"', { app: { failSubmitting: true } }, ({ r, portal, app }) => {
  ok('Save was NOT pressed', portal.state.saves === 0 && newCount(portal) === 0, 'saves=' + portal.state.saves);
  ok('the bill is called failed (nothing saved)', app.st.status === 'failed', app.st.status);
});
await scenario('a name too long for the portal', { job: { ...HAND, items: [{ name: 'X'.repeat(150), qty: 1, unit: 'No' }] } }, ({ r, portal, app }) => {
  ok('failed before Save, nothing cut off and sent', app.st.status === 'failed' && portal.state.saves === 0 && /too long/.test(app.st.detail), app.st.detail);
});
await scenario('the portal does not fill in the contractor', { portal: { noContractor: true } }, ({ r, portal, app }) => {
  ok('failed before Save', app.st.status === 'failed' && portal.state.saves === 0, app.st.status + ' / ' + app.st.detail);
});
await scenario('the app refuses the job (already picked up)', { app: { refuseJob: true } }, ({ r, portal, app }) => {
  ok('the robot never even logs in', portal.state.logins === 0 && portal.state.saves === 0); ok('exit 1', r.code === 1);
});
await scenario('a bad job (unit the portal does not have)', { job: { ...HAND, items: [{ name: 'DISC', qty: 1, unit: 'Box' }] } }, ({ r, portal, app }) => {
  ok('failed, no login, no Save', app.st.status === 'failed' && portal.state.logins === 0 && portal.state.saves === 0, app.st.status);
});

console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
