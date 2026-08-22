/**
 * Positive/negative control for tests/e2e/helpers/renderer-recovery-evidence.ts
 * (ORCA-280). @ondemand: a diagnostic for re-verifying the evidence-collection
 * mechanism itself still works, not a per-run regression gate — see
 * docs/reference/renderer-recovery-reload.md for what the evidence means.
 *
 * Run with:
 *   pnpm exec playwright test --config tests/playwright.config.ts \
 *     --project electron-ondemand renderer-recovery-evidence-repro
 */
import type { ElectronApplication } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { readRendererRecoveryEvidence } from './helpers/renderer-recovery-evidence'
import { waitForSessionReady } from './helpers/store'

async function getUserDataDir(electronApp: ElectronApplication): Promise<string> {
  return electronApp.evaluate(({ app }) => app.getPath('userData'))
}

test.describe('Renderer recovery evidence collection @ondemand', () => {
  test('reports the reload as LIKELY or CONFIRMED after a real forced renderer crash', async ({
    orcaPage,
    electronApp
  }) => {
    test.setTimeout(60_000)
    await waitForSessionReady(orcaPage)
    const userDataDir = await getUserDataDir(electronApp)

    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.forcefullyCrashRenderer()
      }
    })

    // Why poll: process-gone-recorder.ts writes crash-reports.json via a
    // fire-and-forget `store.record(...).catch(...)`, so the file can land a
    // moment after the crash event itself.
    await expect
      .poll(async () => (await readRendererRecoveryEvidence(userDataDir)).rendererCrashRecorded, {
        timeout: 30_000,
        message: 'crash-reports.json never recorded the forced renderer crash'
      })
      .toBe(true)

    const evidence = await readRendererRecoveryEvidence(userDataDir)
    expect(evidence.rendererCrashRecorded, evidence.detail).toBe(true)
    expect(evidence.recoveryReloadConfirmed || evidence.recoveryReloadLikely, evidence.detail).toBe(
      true
    )
  })

  test('reports explicit absence when nothing crashed', async ({ orcaPage, electronApp }) => {
    await waitForSessionReady(orcaPage)
    const userDataDir = await getUserDataDir(electronApp)

    const evidence = await readRendererRecoveryEvidence(userDataDir)

    expect(evidence.rendererCrashRecorded, evidence.detail).toBe(false)
    expect(evidence.recoveryReloadConfirmed, evidence.detail).toBe(false)
    expect(evidence.detail).toContain('did not fire')
  })
})
