/**
 * ORCA-1076: the owner read a closed remote session as 'needs me', since it wore the needs-you '?'.
 * A closed session reads muted with its own mark; a failed start or a logout stays red, as an alert.
 */
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameAgent } from '../../src/shared/orchestrator-game-state'

type RuntimeCall = (event: unknown, args: { method: string }) => Promise<unknown>

const remoteMember = (ticket: string, remote: Partial<NonNullable<GameAgent['remote']>>) => ({
  paneKey: `remote:${ticket}`,
  displayName: ticket,
  agentType: 'codex',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true, ...remote }
})

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

async function capture(page: Page, outputPath: (name: string) => string, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: outputPath(`${name}-${width}.png`) })
  }
}

test('a closed remote session is no needs-you question; a failed start stays red as an alert', async ({
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
  await withRemoteMembers(electronApp, [
    remoteMember('E2E-901', { gone: true }),
    remoteMember('E2E-902', { startFailed: true })
  ])

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  const panel = orcaPage.getByTestId('team-panel')
  const cardOf = (ticket: string) =>
    panel.locator('[data-team-card="member"]').filter({ hasText: ticket })
  await expect(cardOf('E2E-901')).toBeVisible({ timeout: 60_000 })
  await expect(cardOf('E2E-902')).toBeVisible()

  await expect(cardOf('E2E-901')).toContainText('Session closed')
  await expect(cardOf('E2E-901').locator('[data-status-glyph]').first()).toHaveAttribute(
    'data-status-glyph',
    'closed'
  )
  await expect(cardOf('E2E-902').locator('[data-status-glyph]').first()).toHaveAttribute(
    'data-status-glyph',
    'alert'
  )
  await expect(
    panel.locator('[data-team-card="member"] [data-status-glyph="question"]')
  ).toHaveCount(0)
  await capture(orcaPage, testInfo.outputPath.bind(testInfo), 'closed-session-card')
})
