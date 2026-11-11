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
  { host: 'm1', running: 1, cap: 3, status: 'unreachable' },
  // Why five: every machine gets its floor, none folded (owner, five machines, 2026-11-11).
  { host: 'contabo', running: 1, cap: 2, ...machine(4, 8, 3) },
  { host: 'mbp', running: 1, cap: 2, ...machine(6, 16, 5) }
]
const MEMBERS = [
  { name: 'Caballero · ORCA-201 Plan', host: null },
  { name: 'Escudero · ORCA-202 Code', host: null },
  { name: 'Mago · ORCA-203 Tests', host: 'imac' },
  // Why waiting: a member on another floor who needs you is what sends the lead up the elevator.
  // Why on the top floor: a bubble there meets the scroller's top edge once the building scrolls.
  { name: 'Herrero · ORCA-204 Review', host: 'mbp', state: 'waiting' },
  { name: 'Arquera · ORCA-205 Docs', host: 'm1' },
  { name: 'Ginebra · ORCA-206 Infra', host: 'contabo' },
  { name: 'Merlín · ORCA-207 Build', host: 'mbp' }
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
// Why test.use: a never-shown window paints no animation frames, so no ride and no bubble would
// ever be drawn (ORCA-760; the frozen ride stills of ORCA-1150).
test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

test('the Team panel draws a team on five machines as a building in Office', async ({
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
    await expect(floors).toHaveCount(5)
    // One floor per machine, none folded: the lead's at the bottom, then the iMac, the unreachable
    // m1 dark, then the two others on top.
    await expect(floors.nth(0)).toHaveAttribute('data-team-floor', 'mbp')
    await expect(floors.nth(1)).toHaveAttribute('data-team-floor', 'contabo')
    await expect(floors.nth(2)).toHaveAttribute('data-team-floor', 'm1')
    await expect(floors.nth(2)).toHaveAttribute('data-team-floor-dark', '')
    await expect(floors.nth(4)).toHaveAttribute('data-team-floor', '')
    await expect(building).not.toContainText(/\+\d/)
    await expect(building).not.toContainText(/offline/i)
    // The lead rides to the top floor, where a member waits on you: the car stands at that floor.
    await expect(building.locator('[data-team-elevator-car]')).toHaveAttribute(
      'data-team-elevator-car',
      'mbp'
    )

    // The lead's step as the owner saw it: a bare tool, its bubble on the lead's floor rising over the
    // slab above in words, never cut behind it ('Los mensajes quedan detrás del muro').
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      tool: 'PushNotification'
    })
    const leadBubble = building.locator('[data-scene-bubble="lead"]')
    // The lead visits the top floor, where Herrero waits: its trip arrives and its line goes with it.
    await expect
      .poll(() => building.getAttribute('data-team-ride'), { timeout: 60_000 })
      .toMatch(/^there\|/)
    await expect(leadBubble).toHaveText('Push notification', { timeout: 30_000 })
    await expect(leadBubble).toBeVisible()
    const [bubbleBox, buildingBox] = await Promise.all([
      leadBubble.boundingBox(),
      building.boundingBox()
    ])
    expect(bubbleBox!.y, 'the lead bubble leaves the building').toBeGreaterThanOrEqual(
      buildingBox!.y
    )
    // Scrolled so the visited floor's top sits above the scroller's top: its bubble stays inside the
    // visible area, never cut by the edge ('detrás del muro' at the scroller's edge).
    const scroller = building.locator('[data-team-floors-scroll]')
    await scroller.evaluate((node) => {
      node.scrollTop = 20
    })
    await orcaPage.waitForTimeout(500)
    const [edgeBubble, scrollerBox] = await Promise.all([
      leadBubble.boundingBox(),
      scroller.boundingBox()
    ])
    // Inside the visible area, or yielded where no spot fits; never cut by the edge.
    const shown = await leadBubble.isVisible()
    testInfo.annotations.push({
      type: 'scrolled-edge-bubble',
      description: shown ? 'shown' : 'yielded'
    })
    if (shown) {
      expect(edgeBubble!.y, 'the bubble rises past the scroller top').toBeGreaterThanOrEqual(
        scrollerBox!.y
      )
    }
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      await building.screenshot({
        path: testInfo.outputPath(`building-scrolled-edge-${theme}.png`)
      })
    }
    await scroller.evaluate((node) => {
      node.scrollTop = 0
    })

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
    // Why a wide window first: the sidebar is clamped to the room the window leaves it, so at a
    // 320 window every sidebar width collapses to its 220 px minimum.
    await setWindowWidth(electronApp, orcaPage, 1440)
    const sidebarBefore = await orcaPage.evaluate(
      () => window.__store!.getState().rightSidebarWidth
    )
    // The panel's real widths: its 220 px minimum, the ride stills' widths, and the widest a
    // 1440 window allows (it leaves the editor 320 px).
    for (const width of [220, 320, 390, 420, 1120]) {
      await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), width)
      await orcaPage.waitForTimeout(1500)
      const measured = await building.evaluate((root) => ({
        building: root.clientWidth,
        stages: [...root.querySelectorAll('[data-team-floor] canvas')].map((c) => c.clientWidth)
      }))
      await writeFile(testInfo.outputPath(`ride-widths-${width}.json`), JSON.stringify(measured))
      for (const theme of THEMES) {
        await setTheme(orcaPage, theme)
        await building.screenshot({
          path: testInfo.outputPath(`building-sidebar-${width}-${theme}.png`)
        })
      }
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
    await expect(floors).toHaveCount(5)
    await orcaPage.keyboard.press('2')
    await expect(floors.first()).toHaveAttribute('data-team-floor', 'imac')
    // Why the terminal: digits typed there belong to it, never to the scene beside it.
    await orcaPage.keyboard.press('0')
    await expect(floors).toHaveCount(5)
    await ensureTerminalVisible(orcaPage)
    await orcaPage.locator('.xterm-helper-textarea').first().focus()
    await orcaPage.keyboard.press('3')
    await expect(floors).toHaveCount(5)
  } finally {
    agent.dispose()
  }
})
