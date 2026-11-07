import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'

const GB = 1024 ** 3
// Why: one capture per toggle value and width outruns the CI budget; ORCA_CAPTURE_EVIDENCE=1 runs it.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
const SETTLE_MS = 3_000

/** What the lead's `game.state` gets on top of the real answer: work on every tab and a Jev row. */
const OVERLAY = {
  project: {
    reviews: {
      provider: 'github',
      total: 1,
      url: 'https://github.com/o/r/pulls',
      items: [
        {
          id: '#924',
          title: 'Keep the reflow column',
          url: 'https://github.com/o/r/pull/924',
          status: 'success'
        }
      ]
    },
    todo: { provider: 'plane', total: 0, url: null, items: [] },
    queue: {
      provider: 'github',
      entries: [
        {
          id: '#951',
          title: 'Launch E2E waits',
          url: 'https://github.com/o/r/pull/951',
          position: 1,
          state: 'checks',
          since: null
        }
      ]
    }
  },
  hostCapacity: [
    {
      host: 'local',
      running: 1,
      cap: 4,
      status: 'ok',
      cpuCoreCount: 14,
      totalMemory: 36 * GB,
      availableMemory: 21 * GB,
      loadAverage1m: 3
    },
    {
      host: 'm1',
      running: 0,
      cap: 2,
      status: 'ok',
      cpuCoreCount: 8,
      totalMemory: 16 * GB,
      availableMemory: 9 * GB,
      loadAverage1m: 1
    }
  ]
}
const ADVISOR = {
  model: 'Opus 5.5',
  effort: 'high',
  pinned: { model: false, effort: false },
  line: 'Approved Opus 5.5 for ORCA-1044'
}

type RuntimeCall = (
  event: unknown,
  args: { method: string }
) => Promise<{ result?: { agents?: { isLeader?: boolean }[] } }>

async function overlayGameState(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(
    ({ ipcMain }, { overlay, advisor }) => {
      const { _invokeHandlers: handlers } = ipcMain as unknown as {
        _invokeHandlers: Map<string, RuntimeCall>
      }
      const real = handlers.get('runtime:call')!
      ipcMain.removeHandler('runtime:call')
      ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
        const response = await real(event, args)
        if (args.method !== 'game.state' || !response.result) {
          return response
        }
        const agents = (response.result.agents ?? []).map((agent) =>
          agent.isLeader ? { ...agent, advisor } : agent
        )
        return { ...response, result: { ...response.result, ...overlay, agents } }
      })
    },
    { overlay: OVERLAY, advisor: ADVISOR }
  )
}

async function setPanel(page: Page, panel: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (next) => window.__store!.getState().updateSettings({ orchestratorGame: { panel: next } }),
    panel
  )
}

const CASES = [
  { name: 'all-on', panel: {}, hidden: [] as string[], advisor: true },
  { name: 'prs-off', panel: { tabs: { prs: false } }, hidden: ['PRs'], advisor: true },
  { name: 'queue-off', panel: { tabs: { queue: false } }, hidden: ['Queue'], advisor: true },
  {
    name: 'machines-off',
    panel: { tabs: { machines: false } },
    hidden: ['Machines'],
    advisor: true
  },
  { name: 'advisor-off', panel: { advisor: false }, hidden: [] as string[], advisor: false }
] as const

// A real lead's game.state drives the panel; only the global Settings layer changes between captures.
test('each panel setting changes the Team panel: PRs, Queue and Machines tabs and the Advisor row', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const agent = createStdinLoggingAgent()
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActivePanePtyId(orcaPage)
    const pane = await waitForActivePaneHookDescriptor(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    const lead = (
      await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
        paneKey: pane.paneKey
      })
    ).result.terminal.handle
    await client.call('terminal.send', { terminal: lead, text: agent.command, enter: true })
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
    await expect(orcaPage.getByText('Workspace board moved to the bottom bar').first()).toBeHidden({
      timeout: 15_000
    })

    await overlayGameState(electronApp)
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.updateSettings({ uiLanguage: 'en' })
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    await expect(panel.getByRole('tab', { name: 'Machines' })).toBeVisible({ timeout: 30_000 })

    // Soft, so one run names every setting that changes nothing and still captures each value.
    // SETTLE_MS: game.state's own panel.tabs hides a tab only on the next 20 s poll; a toggle must show now.
    for (const one of CASES) {
      await setPanel(orcaPage, { look: 'plain', ...one.panel })
      await panel.getByRole('tab', { name: 'Team' }).click()
      for (const name of ['PRs', 'Queue', 'Machines']) {
        await expect
          .soft(panel.getByRole('tab', { name }), `${one.name}: ${name}`)
          .toHaveCount((one.hidden as readonly string[]).includes(name) ? 0 : 1, {
            timeout: SETTLE_MS
          })
      }
      await expect
        .soft(panel.locator('[data-team-card="advisor"]'), `${one.name}: advisor`)
        .toHaveCount(one.advisor ? 1 : 0, { timeout: SETTLE_MS })
      if (!CAPTURE_EVIDENCE) {
        continue
      }
      await orcaPage.mouse.move(0, 0)
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        await panel.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`${one.name}-${width}.png`)
        })
      }
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
    }

    // The selected tab falls back to Team when its toggle hides it, as V28 does.
    await setPanel(orcaPage, { look: 'plain' })
    await panel.getByRole('tab', { name: 'Queue' }).click()
    await setPanel(orcaPage, { look: 'plain', tabs: { queue: false } })
    await expect(panel.getByRole('tab', { name: 'Team' })).toHaveAttribute(
      'aria-selected',
      'true',
      {
        timeout: SETTLE_MS
      }
    )
  } finally {
    agent.dispose()
  }
})
