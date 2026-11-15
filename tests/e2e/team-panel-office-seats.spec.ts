import { writeFile } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { setTheme, setWindowWidth, THEMES } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'
import { writeSettings } from './helpers/settings-write'

// Why opt-in: the frame strips at every width and theme outrun the CI budget.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'

type SeededMember = { name: string; state: string; review?: 'open' }

// Why six: one more than Office's row of five, the QA case where the sixth member had no desk.
// Why a PR waiting on review: a working member's desk then shows its review, not code (ORCA-1204).
const MEMBERS: SeededMember[] = [
  { name: 'Mario · ORCA-301 Code', state: 'working', review: 'open' },
  { name: 'Luigi · ORCA-302 Code', state: 'idle' },
  { name: 'Toad · ORCA-303 Docs', state: 'done' },
  { name: 'Peach · ORCA-304 Code', state: 'working' },
  { name: 'Daisy · ORCA-305 Code', state: 'waiting' },
  { name: 'Yoshi · ORCA-306 Code', state: 'working' }
]

type RuntimeCall = (event: unknown, args: { method: string }) => Promise<{ result?: object }>

// Why cloned from the one real member: the panel reads a team only from a real launch; the rest are
// added to game.state on its way to the renderer, from a list a test step can change.
async function seedMembers(app: ElectronApplication, members: SeededMember[]): Promise<void> {
  await app.evaluate(
    ({ ipcMain, BrowserWindow }, seeded) => {
      const scope = globalThis as unknown as { __officeMembers?: unknown }
      const first = scope.__officeMembers === undefined
      scope.__officeMembers = seeded
      if (!first) {
        // Why this event: the panel re-reads game.state on it now, not at its next 20 s poll.
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send('runtime:gameAdvisorChanged')
        )
        return
      }
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
        const list = scope.__officeMembers as SeededMember[]
        const added = list.map((one, i) => ({
          ...template,
          paneKey: `office:${i}`,
          terminalHandle: null,
          displayName: one.name,
          state: one.state,
          toolName: 'Edit',
          ...(one.review
            ? {
                review: {
                  provider: 'github',
                  number: 900 + i,
                  title: one.name,
                  url: `https://github.com/example/repo/pull/${900 + i}`,
                  state: 'open',
                  ci: 'success',
                  verdict: 'review_required'
                }
              }
            : {})
        }))
        return { ...response, result: { ...result, agents: [leader, ...added] } }
      })
    },
    members as unknown as Parameters<typeof app.evaluate>[1]
  )
}

const readSeats = (page: Page): Promise<string | null> =>
  page
    .locator('[data-team-scene] [data-scene-seats]')
    .first()
    .getAttribute('data-scene-seats', { timeout: 1000 })
    .catch(() => null)

const readLeadX = (page: Page): Promise<number> =>
  page
    .locator('[data-team-scene] [data-scene-lead-x]')
    .first()
    .getAttribute('data-scene-lead-x', { timeout: 1000 })
    .then(Number)
    .catch(() => Number.NaN)

/** The scene's lead x every `everyMs` for `forMs`, so a walk out and back can be read. */
async function leadTrack(page: Page, forMs: number, everyMs = 250): Promise<number[]> {
  const xs: number[] = []
  for (let at = 0; at < forMs; at += everyMs) {
    xs.push(await readLeadX(page))
    await page.waitForTimeout(everyMs)
  }
  return xs
}

/** Screenshots of the scene `everyMs` apart, with the lead's x at each, so a walk can be read. */
async function strip(
  page: Page,
  name: string,
  frames: number,
  everyMs: number,
  out: (n: string) => string
): Promise<number[]> {
  const scene = page.getByTestId('team-panel').locator('[data-team-scene]')
  const xs: number[] = []
  for (let frame = 0; frame < frames; frame++) {
    xs.push(await readLeadX(page))
    await scene.screenshot({ path: out(`${name}-${String(frame).padStart(2, '0')}.png`) })
    await page.waitForTimeout(everyMs)
  }
  return xs
}

// Why test.use: a never-shown window paints about once a second on CI, too sparse for any walk.
test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

test('Office keeps each member at its desk while others change state, and the lead walks out and back', async ({
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
    await writeSettings(orcaPage, {
      uiLanguage: 'en',
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' }
    })
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
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Office seats',
      from: lead
    })
    await expect
      .poll(async () => {
        const listed = await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        return listed.result.worktrees.some((one) => one.id === worktreeId)
      })
      .toBe(true)
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-300',
      taskTitle: 'Bowser · ORCA-300 Build',
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const started = await client.call<{ effects: { kind: string; role?: string; id?: string }[] }>(
      'orchestration.workerStart',
      {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: 'Bowser · ORCA-300 Build',
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
    await seedMembers(electronApp, MEMBERS)
    await setWindowWidth(electronApp, orcaPage, 1440)
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      const game = state.settings?.orchestratorGame
      void state.updateSettings({
        orchestratorGame: { ...game, panel: { ...game?.panel, look: 'game', style: 'office' } }
      })
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
      state.setRightSidebarWidth(640)
    })
    const scene = orcaPage.getByTestId('team-panel').locator('[data-team-scene="office"]')
    await expect(scene.getByRole('img', { name: 'Live team scene' })).toBeVisible({
      timeout: 90_000
    })
    // Why a wait: the members walked in when they joined; by now every one is seated.
    await orcaPage.waitForTimeout(8000)
    const out = (name: string) => testInfo.outputPath(name)

    // Daisy asks: the lead walks to her desk.
    const toAsker = CAPTURE_EVIDENCE
      ? await strip(orcaPage, 'office-attend', 6, 300, out)
      : await leadTrack(orcaPage, 2000)
    testInfo.annotations.push({ type: 'lead-x at asker', description: toAsker.join(' ') })
    expect
      .soft(Math.min(...toAsker), 'the lead never left its spot for the asker')
      .toBeLessThan(0.8)

    // Only Luigi changes, idle to working: no other member may change desk.
    const seatsBefore = await readSeats(orcaPage)
    await scene.screenshot({ path: out('office-seats-before.png') })
    await seedMembers(
      electronApp,
      MEMBERS.map((one) => (one.name.startsWith('Luigi') ? { ...one, state: 'working' } : one))
    )
    await orcaPage.waitForTimeout(5000)
    const seatsAfter = await readSeats(orcaPage)
    await scene.screenshot({ path: out('office-seats-after-luigi-works.png') })
    testInfo.annotations.push({
      type: 'seats',
      description: `before ${seatsBefore} | after ${seatsAfter}`
    })
    expect.soft(seatsBefore, 'the scene does not expose its seats').not.toBeNull()
    expect.soft(seatsAfter, 'a member changed desk when only Luigi changed state').toBe(seatsBefore)

    // Daisy is answered and back at work: the lead walks home, in front of the desks; at ~35 px/s
    // from the row's first desk that takes up to 15 s.
    await seedMembers(
      electronApp,
      MEMBERS.map((one) =>
        one.name.startsWith('Luigi') || one.name.startsWith('Daisy')
          ? { ...one, state: 'working' }
          : one
      )
    )
    await expect(
      orcaPage.locator('[data-team-scene] [data-scene-speaker="office:4"]'),
      'Daisy still asks after going back to work'
    ).toHaveCount(0, { timeout: 30_000 })
    const home = CAPTURE_EVIDENCE
      ? await strip(orcaPage, 'office-return', 40, 400, out)
      : await leadTrack(orcaPage, 24_000)
    testInfo.annotations.push({ type: 'lead-x home and rounds', description: home.join(' ') })
    expect.soft(Math.max(...home), 'the lead never came back to its spot').toBeGreaterThan(0.8)
    expect
      .soft(await readSeats(orcaPage), 'a member changed desk when Daisy went back to work')
      .toBe(seatsBefore)

    await writeFile(out('track.json'), JSON.stringify(testInfo.annotations, null, 1))
    if (!CAPTURE_EVIDENCE) {
      return
    }
    // Working screens frame by frame, close up, for the monitor animation.
    await strip(orcaPage, 'office-screens', 6, 150, out)
    // Wide and narrow panels in both themes.
    for (const [windowWidth, panel] of [
      [1440, 640],
      [1440, 1120],
      [390, 0]
    ] as const) {
      await setWindowWidth(electronApp, orcaPage, windowWidth)
      if (panel) {
        await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), panel)
      }
      for (const theme of THEMES) {
        await setTheme(orcaPage, theme)
        await orcaPage.waitForTimeout(1200)
        await strip(orcaPage, `office-${windowWidth}-${panel || 'min'}-${theme}`, 3, 400, out)
      }
    }
  } finally {
    agent.dispose()
  }
})
