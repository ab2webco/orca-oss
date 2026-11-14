import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'

// Why: the panel reads game.state every 20 s (TEAM_REFRESH_MS).
const REFRESH_WAIT_MS = 21_000

// ORCA-1139 criterion 5: with no Lead name, the lead was Elaine, then Cipher, then Vigía nocturno.
test('the lead keeps the name it first had when the scene and the language change', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
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
            // Why empty: as `orca game lead` registers a project with no Lead name.
            label: ''
          })
        ).result.registered
    )
    .toBe(true)
  const endpoint = await readHookEndpoint(electronApp)
  await emitCodexHookStatus(endpoint, {
    paneKey: pane.paneKey,
    worktreeId,
    state: 'working',
    prompt: 'Lead the team'
  })
  const stateOf = async (): Promise<OrchestratorGameState> =>
    (
      await client.call<OrchestratorGameState>('game.state', {
        worktreeId,
        terminalHandle: lead,
        paneKey: pane.paneKey
      })
    ).result

  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  const panel = orcaPage.getByTestId('team-panel')
  const leadCard = panel.locator('[data-team-card="lead"]')
  await expect(leadCard).toContainText('Elaine', { timeout: 90_000 })
  expect((await stateOf()).leadName).toBe('Elaine')

  const steps = [
    { label: 'vigilante-en', scene: 'vigilante', uiLanguage: 'en' },
    { label: 'vigilante-es', scene: 'vigilante', uiLanguage: 'es' }
  ] as const
  for (const step of steps) {
    await writeSettings(orcaPage, {
      uiLanguage: step.uiLanguage,
      orchestratorGame: { scene: step.scene }
    })
    await expect.poll(async () => (await stateOf()).config?.scene).toBe(step.scene)
    expect((await stateOf()).leadName, `${step.label}: game.state renamed the lead`).toBe('Elaine')
    await orcaPage.waitForTimeout(REFRESH_WAIT_MS)
    await expect(leadCard, `${step.label}: the card renamed the lead`).toContainText('Elaine')
    await expect(leadCard).not.toContainText(/Cipher|Vigía/)
  }

  for (const width of [1440, 768, 390, 320]) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of ['dark', 'light'] as const) {
      await writeSettings(orcaPage, { theme })
      await orcaPage.waitForTimeout(400)
      await panel.screenshot({
        path: testInfo.outputPath(`lead-one-name-vigilante-es-${width}-${theme}.png`)
      })
    }
  }
})
