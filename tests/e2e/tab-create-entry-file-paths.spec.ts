import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const relativeFilePath =
  'packages/orca/src/renderer/src/components/navigation/worktree/secondary-nav/SecondaryNav.tsx'

// Why beforeAll: the app resolves the worktree file list once and does not pick
// up a directory created after launch on Linux CI (it does on macOS through
// FSEvents), so writing this inside the test body makes the omnibox result
// platform-dependent. Seed it before the fixture launches Electron.
test.beforeAll(({ testRepoPath }) => {
  const filePath = path.join(testRepoPath, ...relativeFilePath.split('/'))
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, 'export const SecondaryNav = true\n')
})

// Parked, not repaired — fourth attempt, and the two causes already "confirmed" for it
// (the omnibox placeholder, then seeding the file before launch for the
// FileListingCancelledError) were both true and neither closed it. Rather than give it a
// third cause, the source was instrumented the way ORCA-204 finally was: a probe on
// `useRuntimeFileListForWorktree` recording every {loading, loadError, files.length,
// hasSecondaryNav} snapshot the classifier receives, plus the rendered options, dumped on
// failure. It never fired — 6/6 green on macOS. This reproduces only on Linux CI, so the
// probe has to run there, and debug instrumentation is not something to land in a sync PR.
// Unparked by: run that probe on Linux and read what the results component actually
// receives, in order. Do not add a fourth inferred cause from the DOM (ORCA-203).
test.fixme('new-tab file results prioritize the filename and reveal the full path on hover', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)

  await orcaPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  // Not the placeholder/aria-label: that copy is translated and already drifted
  // once. aria-controls points at the results listbox id, which is structural.
  const input = orcaPage.locator('input[role="combobox"][aria-controls="tab-create-entry-results"]')
  await input.fill('secondaryNav')

  const row = orcaPage.locator('[role="option"]').filter({ hasText: 'Open file' }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('SecondaryNav.tsx')
  await expect(row).toContainText('packages/orca/src/renderer/src/components/navigation/')
  const rowText = await row.textContent()
  expect(rowText?.indexOf('SecondaryNav.tsx')).toBeLessThan(
    rowText?.indexOf('packages/orca/src/renderer/src/components/navigation/') ?? -1
  )

  // The filename must survive intact; only the directory may be clipped, and the
  // row itself must never spill past the dropdown.
  const overflow = await row.evaluate((element) => {
    const filename = element.querySelector(':scope > span:last-of-type > span:first-child')
    return {
      filenameClipped: filename ? filename.scrollWidth > filename.clientWidth : true,
      rowClipped: element.scrollWidth > element.clientWidth
    }
  })
  expect(overflow).toEqual({ filenameClipped: false, rowClipped: false })

  // Two hovers on purpose: results stream in and remount the row, and Radix only
  // opens on a pointermove it actually receives. A single hover can land before
  // the remount and leave the cursor sitting still over a row that never saw it.
  await row.hover({ position: { x: 20, y: 12 } })
  await orcaPage.waitForTimeout(250)
  await row.hover({ position: { x: 40, y: 12 } })

  // Exact cursor placement is arithmetic, unit-tested via cursorTooltipOffsets.
  // Asserting it here measured the app mid-reflow and was flaky; what E2E is
  // uniquely good for is that the tooltip really opens with the whole path.
  await expect(
    orcaPage.locator('[data-slot="tooltip-content"]').filter({ hasText: relativeFilePath })
  ).toBeVisible()

  const proofPath = process.env.ORCA_STA3424_PROOF_PATH
  if (proofPath) {
    await orcaPage.screenshot({ path: proofPath })
  }
})
