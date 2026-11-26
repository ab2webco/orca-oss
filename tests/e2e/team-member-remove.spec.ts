/**
 * ORCA-1476: a member card offers Remove, which asks first and names only that member. The capture
 * covers the panel's min, default and max widths, where the confirmation must wrap, never cut.
 */
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'

type RuntimeCall = (event: unknown, args: { method: string }) => Promise<unknown>

// Why gone on koombea: the user's stale row, a member whose host no longer has it (ORCA-1177).
const STALE = {
  paneKey: 'remote:ctx_e2e1177',
  displayName: 'E2E-1177',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  remote: { host: 'koombea', environmentId: 'env_k', stateKnown: true, gone: true }
}

/** Adds remote members to the panel's game.state, as a paired host would report them. */
async function withRemoteMembers(app: ElectronApplication, members: unknown[]): Promise<void> {
  await app.evaluate(({ ipcMain }, extra) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, RuntimeCall> })
      ._invokeHandlers
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      const response = (await real(event, args)) as { result?: { agents?: unknown[] } }
      if (args.method === 'game.state' && response?.result?.agents) {
        response.result.agents = [...response.result.agents, ...extra]
      }
      return response
    })
  }, members)
}

test('a member card removes only that member, after asking, at every panel width', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActivePanePtyId(orcaPage)
  const pane = await waitForActivePaneHookDescriptor(orcaPage)
  await writeSettings(orcaPage, { uiLanguage: 'en', theme: 'dark' })
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const lead = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey: pane.paneKey
    })
  ).result.terminal.handle
  // Why a foreground process and a hook: a lead pane back at its shell is not a live lead.
  await client.call('terminal.send', {
    terminal: lead,
    text: 'node -e "setInterval(() => {}, 1e9)"',
    enter: true
  })
  await expect
    .poll(async () => {
      const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
        terminalHandle: lead,
        project: 'e2e',
        label: 'Alfred'
      })
      return registered.result.registered
    })
    .toBe(true)
  await emitCodexHookStatus(await readHookEndpoint(electronApp), {
    paneKey: pane.paneKey,
    worktreeId,
    state: 'working',
    prompt: 'Lead the team'
  })
  await withRemoteMembers(electronApp, [STALE])

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  const panel = orcaPage.getByTestId('team-panel')
  const card = panel.locator('[data-team-card="member"]').filter({ hasText: 'E2E-1177' })
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.locator('button[aria-expanded]').click()
  const remove = card.locator('[data-team-remove]')
  await expect(remove).toHaveText('Remove')
  await remove.click()
  const confirm = card.locator('[data-team-remove-confirm]')
  // Why the card's own name: a member shows its roster name, which the question repeats.
  const name = (await card.locator('[data-team-name]').textContent())?.trim()
  expect(name).toBeTruthy()
  await expect(confirm).toContainText(
    `Remove ${name}? Orca stops its session if it runs, otherwise forgets it. No other member is touched.`
  )

  // Why read once: the window caps the panel, and the max is what that cap leaves.
  const defaultWidth = await orcaPage.evaluate(() => window.__store!.getState().rightSidebarWidth)
  for (const [label, width] of [
    ['min', 220],
    ['default', defaultWidth],
    ['max', 4000]
  ] as const) {
    await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), width)
    await expect(confirm.getByRole('button', { name: 'Remove' })).toBeVisible()
    const fit = await confirm.evaluate((node) => {
      const box = node.getBoundingClientRect()
      const cardBox = node.closest('[data-team-card]')!.getBoundingClientRect()
      const buttons = [...node.querySelectorAll('button')].map((one) => one.getBoundingClientRect())
      return {
        overflow: node.scrollWidth - node.clientWidth,
        inside: buttons.every(
          (one) => one.left >= cardBox.left && one.right <= cardBox.right + 0.5
        ),
        width: Math.round(box.width)
      }
    })
    expect(fit.overflow, `${label}: the confirmation scrolls sideways`).toBeLessThanOrEqual(0)
    expect(fit.inside, `${label}: a button sits outside the card`).toBe(true)
    await panel.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`member-remove-confirm-${label}.png`)
    })
  }

  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(remove).toBeVisible()
})
