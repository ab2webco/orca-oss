# Rendered UI checks

`AGENTS.md` used to say *"use the `$electron` skill and Playwright CDP for rendered Orca UI checks"*.
No such skill exists in this fork — the line was inherited from an upstream commit describing
upstream's harness (ORCA-321). This is what the fork actually has.

Do not use computer-use for Orca UI validation. That part of the old instruction was right.

## Use the E2E harness, not a bespoke launcher

The repo already launches, isolates and drives the real app for every E2E spec. Reuse it: write a
spec under `tests/e2e/`, run it against one file, and read the screenshots from `test-results/`.

A bespoke `_electron.launch` script has to re-derive the profile seeding, the home isolation and the
`ELECTRON_RUN_AS_NODE` strip that `tests/e2e/helpers/orca-app.ts` already handles. Skip that.

```sh
npx playwright test tests/e2e/<your-spec>.spec.ts \
  --config tests/playwright.config.ts --project=electron-headless --workers=1
```

Flag order matters: the path comes **before** `--config`, or Playwright reads it as a project name
and fails with `Project(s) "tests/e2e/…" not found`.

Add `--project=electron-headful` to watch it, and `ORCA_E2E_SLOWMO_MS=250` to slow every action down.

## Screenshots

`testInfo.outputPath()` puts them in `test-results/<spec>-<hash>-<title>-<project>/`:

```ts
await orcaPage.screenshot({ path: testInfo.outputPath('before.png') })
```

For a before/after judged by eye, take both in one run — two runs give you two different window
sizes, scroll offsets and data orders, and the difference you are looking at may be none of the
things you changed.

## Getting a real screen to look at

`window.__store` is exposed under `NODE_ENV=development`, which the fixture sets. Provider-backed
screens need their IPC stubbed in **main**, then the view opened from the store:

```ts
await electronApp.evaluate(({ ipcMain }, fixture) => {
  ipcMain.removeHandler('linear:listIssues')
  ipcMain.handle('linear:listIssues', async () => ({ items: fixture.issues, hasMore: false }))
}, FIXTURE)

await orcaPage.evaluate(async () => {
  await window.__store!.getState().checkLinearConnection(true)
  window.__store!.getState().openTaskPage({ taskSource: 'linear' })
})
```

`tests/e2e/linear-filter-chip-labels.spec.ts` is the shortest complete example.

## Seed enough data to make the question real

A layout question about scrolling cannot be answered by a screen that does not scroll. Seed enough
rows to overflow, then **assert something actually overflowed** before trusting the screenshot:

```ts
const scrolled = await orcaPage.evaluate(() => {
  const overflowing = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(
    (element) => element.scrollHeight > element.clientHeight + 200 && element.clientHeight > 200
  )
  const target = overflowing.at(-1)
  if (!target) return null
  target.scrollTop = target.scrollHeight
  return { className: target.className, scrollTop: target.scrollTop }
})
expect(scrolled, 'nothing overflowed — the screenshot proves nothing').not.toBeNull()
```

Without that guard a short list scrolls nowhere and every assertion passes against the bug. Log the
container you actually scrolled; a screen usually has several nested scrollers and the one you meant
is rarely the first one `querySelectorAll` returns.

## Delete the rig when it is not a test

A spec kept only to take a screenshot is a spec that asserts nothing and will rot. Either give it a
real assertion and keep it as a regression test, or delete it once the screenshots are captured.
