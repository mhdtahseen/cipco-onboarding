# JSL robot

Raises Material Requisitions (MRRs) on the JSL portal. Runs on GitHub Actions, not in the app. How it fits and how to set it up: see **Sending to the JSL portal** in `docs/INVENTORY.md`.

| File | What it is |
| --- | --- |
| `run.mjs` | The robot. `MODE=dry` (default) fills a sample and stops; `MODE=send` is a real send for one bill. The comment at the top lists the safety steps. |
| `samples/` | Sample jobs for the dry run (fake people, fake numbers). |
| `test/run-tests.mjs` | Runs the robot against a fake portal and a fake app. Raises nothing, needs no login. |
| `test/fake-portal.mjs` | The fake portal (same field ids and habits as the real one; faults can be switched on). |

```sh
cd jsl-worker
npm install && npx playwright install chromium
node test/run-tests.mjs                       # all scenarios, no real portal
DRY_RUN=true JSL_USER=… JSL_PASSWORD=… node run.mjs samples/hand.json   # real portal, no Save
```

A real send is only ever started by the app (Actions → *JSL send*, with a bill id). The app refuses the job unless the bill is queued, so starting that workflow by hand does nothing.
