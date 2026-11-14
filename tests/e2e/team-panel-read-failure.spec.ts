/**
 * ORCA-1199: a brief failed team read keeps the rows with a quiet "Updating the team…" line; only
 * reads failing for the sustained window show the error and its retry.
 *
 * Why wrap `runtime:call` in main: a failing game.state needs a silent paired host, which the E2E
 * host has none of. The wrap rejects only game.state, only while the flag is set, and is restored.
 */

import type { IpcMainInvokeEvent } from 'electron'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'

const WIDTHS = [1440, 768, 390, 320]
const UPDATING = 'Updating the team…'
const ERROR_TITLE = 'Could not read the team'

type RuntimeCallArgs = { method: string; params?: unknown }
type RuntimeCallHandler = (event: IpcMainInvokeEvent, args: RuntimeCallArgs) => Promise<unknown>
type ReadFailureRig = { original?: RuntimeCallHandler; failGameState?: boolean }

async function holdGameState(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, RuntimeCallHandler> })
      ._invokeHandlers
    const original = handlers?.get('runtime:call')
    if (!original) {
      throw new Error('runtime:call has no handler to wrap')
    }
    const rig = globalThis as typeof globalThis & { __teamReadFailure?: ReadFailureRig }
    rig.__teamReadFailure = { original, failGameState: true }
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: RuntimeCallArgs) => {
      if (rig.__teamReadFailure?.failGameState && args.method === 'game.state') {
        throw new Error('E2E: game.state held')
      }
      return original(event, args)
    })
  })
}

async function releaseGameState(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const rig = globalThis as typeof globalThis & { __teamReadFailure?: ReadFailureRig }
    if (rig.__teamReadFailure) {
      rig.__teamReadFailure.failGameState = false
    }
  })
}

async function restoreRuntimeCall(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const rig = globalThis as typeof globalThis & { __teamReadFailure?: ReadFailureRig }
    const original = rig.__teamReadFailure?.original
    if (original) {
      ipcMain.removeHandler('runtime:call')
      ipcMain.handle('runtime:call', original)
    }
    delete rig.__teamReadFailure
  })
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

test('a brief failed team read stays quiet; only a sustained one shows the error and retry', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(420_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActivePanePtyId(orcaPage)
  const pane = await waitForActivePaneHookDescriptor(orcaPage)
  await writeSettings(orcaPage, { uiLanguage: 'en' })
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const lead = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey: pane.paneKey
    })
  ).result.terminal.handle
  // Why a foreground process: a lead pane back at its shell is not a live lead.
  await client.call('terminal.send', {
    terminal: lead,
    text: 'node -e "setInterval(() => {}, 1e9)"',
    enter: true
  })
  await expect
    .poll(
      async () =>
        (
          await client.call<{ registered: boolean }>('game.leadRegister', {
            terminalHandle: lead,
            project: 'e2e',
            label: 'Alfred'
          })
        ).result.registered
    )
    .toBe(true)
  await emitCodexHookStatus(await readHookEndpoint(electronApp), {
    paneKey: pane.paneKey,
    worktreeId,
    state: 'working',
    prompt: 'Lead the team'
  })

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  const panel = orcaPage.getByTestId('team-panel')
  const leadCard = panel.locator('[data-team-card="lead"]')
  await expect(panel).toHaveAttribute('data-team-panel-state', 'team', { timeout: 90_000 })
  await expect(leadCard).toBeVisible()

  const updating = panel.getByRole('status').filter({ hasText: UPDATING })
  const errorTitle = panel.getByText(ERROR_TITLE)
  const retry = panel.getByRole('button', { name: 'Try again' })
  try {
    await holdGameState(electronApp)

    // The next 20 s poll fails: the rows stay, a quiet line says so, no alarm.
    await expect(updating).toBeVisible({ timeout: 40_000 })
    await expect(errorTitle).toHaveCount(0)
    await expect(retry).toHaveCount(0)
    await expect(leadCard).toBeVisible()
    // Why themes outside: two theme writes keep all eight shots inside the sustained window.
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        await expect(updating).toBeVisible()
        await expect(errorTitle).toHaveCount(0)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`read-updating-${width}-${theme}.png`)
        })
      }
    }

    // Reads keep failing for the sustained window: the error and its retry, still over the rows.
    await expect(errorTitle).toBeVisible({ timeout: 120_000 })
    await expect(retry).toBeVisible()
    await expect(updating).toHaveCount(0)
    await expect(leadCard).toBeVisible()
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        await expect(errorTitle).toBeVisible()
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`read-error-${width}-${theme}.png`)
        })
      }
    }

    // The host answers again: Retry reads now and clears both states.
    await releaseGameState(electronApp)
    await retry.click()
    await expect(errorTitle).toHaveCount(0, { timeout: 30_000 })
    await expect(updating).toHaveCount(0)
    await expect(leadCard).toBeVisible()
  } finally {
    await restoreRuntimeCall(electronApp)
  }
})
