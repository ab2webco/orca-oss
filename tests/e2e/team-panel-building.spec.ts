import { writeFile } from 'node:fs/promises'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const GB = 1024 ** 3
const machine = (cores: number, total: number, free: number) => ({
  status: 'ok',
  cpuCoreCount: cores,
  totalMemory: total * GB,
  availableMemory: free * GB,
  loadAverage1m: 2
})
// Why these: two members here, two on the iMac with one other session there, one on an m1 that
// went unreachable, so the sheet shows own, taken and free desks and a dark floor.
const HOSTS = [
  { host: 'local', running: 2, cap: 5, ...machine(14, 36, 21) },
  { host: 'imac', running: 3, cap: 4, ...machine(8, 16, 10) },
  { host: 'm1', running: 1, cap: 3, status: 'unreachable' }
]
const MEMBERS = [
  { name: 'Caballero · ORCA-201 Plan', host: null },
  { name: 'Escudero · ORCA-202 Code', host: null },
  { name: 'Mago · ORCA-203 Tests', host: 'imac' },
  // Why waiting: a member on another floor who needs you is what sends the lead up the elevator.
  { name: 'Herrero · ORCA-204 Review', host: 'imac', state: 'waiting' },
  { name: 'Arquera · ORCA-205 Docs', host: 'm1' }
]

type RuntimeCall = (event: unknown, args: { method: string }) => Promise<{ result?: object }>

// Why cloned from the one real member: E2E has no remote hosts, so members on them are added to
// the real game.state on its way to the renderer, each carrying its own host as a paired one would.
async function spreadAcrossMachines(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { members, hosts }) => {
      const { _invokeHandlers: handlers } = ipcMain as unknown as {
        _invokeHandlers: Map<string, RuntimeCall>
      }
      const real = handlers.get('runtime:call')!
      ipcMain.removeHandler('runtime:call')
      ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
        const response = await real(event, args)
        const result = response.result as { agents?: Record<string, unknown>[] } | undefined
        if (args.method !== 'game.state' || !Array.isArray(result?.agents)) {
          return response
        }
        const leader = result.agents.find((one) => one.isLeader)
        const template = result.agents.find((one) => !one.isLeader)
        if (!leader || !template) {
          return response
        }
        const added = members.map((one, i) => ({
          ...template,
          paneKey: `building:${i}`,
          terminalHandle: null,
          displayName: one.name,
          state: one.state ?? 'working',
          toolName: 'Edit',
          ...(one.host ? { remote: { host: one.host, stateKnown: one.host !== 'm1' } } : {})
        }))
        return {
          ...response,
          result: { ...result, agents: [leader, ...added], hostCapacity: hosts }
        }
      })
    },
    { members: MEMBERS, hosts: HOSTS }
  )
}

// ORCA-1150: an Office team on several machines is a building, one floor per machine.
test('the Team panel draws a team on three machines as a building in Office', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(420_000)
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
    await orcaPage.evaluate(async (command) => {
      const state = window.__store!.getState()
      await state.updateSettings({
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)
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
    const endpoint = await readHookEndpoint(electronApp)
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })
    // One real member, as a launch makes it, so the panel reads a team; the rest are its clones.
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Building',
      from: lead
    })
    await expect
      .poll(async () => {
        const listed = await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        return listed.result.worktrees.some((one) => one.id === worktreeId)
      })
      .toBe(true)
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-200',
      taskTitle: 'Paje · ORCA-200 Build',
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const started = await client.call<{ effects: { kind: string; role?: string; id?: string }[] }>(
      'orchestration.workerStart',
      {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: 'Paje · ORCA-200 Build',
        agent: 'codex',
        timeoutMs: 20_000
      }
    )
    const handle = started.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
    const terminal = listed.result.terminals.find((one) => one.handle === handle)
    expect(terminal, 'the member terminal is not listed').toBeTruthy()
    await emitCodexHookStatus(endpoint, {
      paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
      worktreeId: terminal!.worktreeId,
      state: 'working',
      prompt: 'Work'
    })
    await spreadAcrossMachines(electronApp)
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      const game = state.settings?.orchestratorGame
      void state.updateSettings({
        orchestratorGame: { ...game, panel: { ...game?.panel, look: 'game', style: 'office' } }
      })
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })

    const panel = orcaPage.getByTestId('team-panel')
    const building = panel.locator('[data-team-building]')
    const floors = building.locator('[data-team-floor]')
    await expect(building).toBeVisible({ timeout: 90_000 })
    await expect(floors).toHaveCount(3)
    // The lead's floor at the bottom, then the iMac, the unreachable m1 on top and dark.
    await expect(floors.nth(0)).toHaveAttribute('data-team-floor', 'm1')
    await expect(floors.nth(0)).toHaveAttribute('data-team-floor-dark', '')
    await expect(floors.nth(2)).toHaveAttribute('data-team-floor', '')
    await expect(building).not.toContainText(/offline/i)
    // The lead rides to the iMac, where a member waits on you: the car stands at that floor.
    await expect(building.locator('[data-team-elevator-car]')).toHaveAttribute(
      'data-team-elevator-car',
      'imac'
    )

    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      for (const width of WIDTHS) {
        await setWindowWidth(electronApp, orcaPage, width)
        await orcaPage.waitForTimeout(1500)
        await building.screenshot({ path: testInfo.outputPath(`building-${width}-${theme}.png`) })
      }
    }
    // Why reduced motion: a hidden test window runs no animation frames, so only the ride's
    // settled end (the lead beside Herrero, gone from its own floor) can be photographed.
    await orcaPage.emulateMedia({ reducedMotion: 'reduce' })
    await expect
      .poll(() => orcaPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
      .toBe(true)
    // Why the sidebar, not the window: the Team panel keeps its own width at any window width.
    const sidebarBefore = await orcaPage.evaluate(
      () => window.__store!.getState().rightSidebarWidth
    )
    for (const width of [420, 390, 320]) {
      await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), width)
      await orcaPage.waitForTimeout(1500)
      // Why recorded: a ride only shows on a floor at least 360 px wide.
      const measured = await building.evaluate((root) => ({
        building: root.clientWidth,
        stages: [...root.querySelectorAll('[data-team-floor] canvas')].map((c) => c.clientWidth)
      }))
      await writeFile(testInfo.outputPath(`ride-widths-${width}.json`), JSON.stringify(measured))
      await building.screenshot({ path: testInfo.outputPath(`building-ride-reduced-${width}.png`) })
    }
    await orcaPage.evaluate(
      (w) => window.__store!.getState().setRightSidebarWidth(w),
      sidebarBefore
    )
    await orcaPage.emulateMedia({ reducedMotion: null })
    await setWindowWidth(electronApp, orcaPage, 1440)

    // A floor button zooms into that floor; Escape on the focused scene returns; a number key zooms.
    await building.getByRole('button', { name: 'imac' }).click()
    await expect(floors).toHaveCount(1)
    await expect(floors.first()).toHaveAttribute('data-team-floor', 'imac')
    await building.screenshot({ path: testInfo.outputPath('building-zoom-imac.png') })
    await building.focus()
    await orcaPage.keyboard.press('Escape')
    await expect(floors).toHaveCount(3)
    await orcaPage.keyboard.press('2')
    await expect(floors.first()).toHaveAttribute('data-team-floor', 'imac')
    // Why the terminal: digits typed there belong to it, never to the scene beside it.
    await orcaPage.keyboard.press('0')
    await expect(floors).toHaveCount(3)
    await ensureTerminalVisible(orcaPage)
    await orcaPage.locator('.xterm-helper-textarea').first().focus()
    await orcaPage.keyboard.press('3')
    await expect(floors).toHaveCount(3)
  } finally {
    agent.dispose()
  }
})
