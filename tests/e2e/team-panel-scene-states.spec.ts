import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const STYLES = ['figures', 'office', 'pixel'] as const
type Style = (typeof STYLES)[number]
const WINDOW_MS = 1500
// Why: Pixel's swing rests for most of its 1.15 s; sparser frames could miss it (see scene-motion).
const MAX_FRAME_GAP_MS = 430
// [left, right, top, bottom] as fractions. One member sits at x 0.1 (seatPlanOf); the lead stands
// at 0.84. Their crops start below Pixel's low cloud band (0.38) and keep the head and its emote.
const CROPS = {
  member: [0, 0.26, 0.4, 1],
  lead: [0.74, 0.96, 0.4, 1],
  sky: [0, 1, 0, 0.4]
} as const
// Why longer: Pixel's clouds step one scene pixel every 1.44 s (12 game ticks).
const SKY_WINDOW_MS = 3000
type Who = keyof typeof CROPS
type Sample = { hashes: string[]; maxGapMs: number }

// Why test.use: a never-shown window paints about once a second on CI (ORCA-760).
test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

// Hashes one actor's crop on every animation frame for a window, so the set is what was painted.
async function sampleCrop(page: Page, who: Who, windowMs = WINDOW_MS): Promise<Sample> {
  return page.evaluate(
    ({ crop, windowMs }) =>
      new Promise<Sample>((resolve) => {
        const hashOf = (): string => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-team-scene] [role="img"]')
          const g = canvas?.getContext('2d')
          if (!canvas || !g || canvas.width === 0) {
            return 'unpainted'
          }
          const x = Math.floor(canvas.width * crop[0])
          const top = Math.floor(canvas.height * crop[2])
          const { data } = g.getImageData(
            x,
            top,
            Math.floor(canvas.width * crop[1]) - x,
            Math.floor(canvas.height * crop[3]) - top
          )
          let hash = 0x811c9dc5
          for (let i = 0; i < data.length; i++) {
            hash = Math.imul(hash ^ data[i]!, 0x01000193)
          }
          return (hash >>> 0).toString(16)
        }
        const stamps = [performance.now()]
        const hashes: string[] = []
        let counting = true
        const tick = (): void => {
          if (counting) {
            stamps.push(performance.now())
            hashes.push(hashOf())
            requestAnimationFrame(tick)
          }
        }
        requestAnimationFrame(tick)
        setTimeout(() => {
          counting = false
          stamps.push(performance.now())
          const gaps = stamps.slice(1).map((s, i) => s - stamps[i]!)
          resolve({ hashes, maxGapMs: Math.max(...gaps) })
        }, windowMs)
      }),
    { crop: CROPS[who], windowMs }
  )
}

// Why retried: a starved runner may skip frames; a sparse window cannot judge motion.
async function poseFrames(page: Page, who: Who): Promise<Set<string>> {
  let sample = await sampleCrop(page, who)
  for (let i = 0; i < 4 && sample.maxGapMs > MAX_FRAME_GAP_MS; i++) {
    sample = await sampleCrop(page, who)
  }
  expect
    .soft(sample.maxGapMs, `${who}: frames too sparse to judge`)
    .toBeLessThanOrEqual(MAX_FRAME_GAP_MS)
  return new Set(sample.hashes)
}

const disjoint = (a: Set<string>, b: Set<string>): boolean => [...a].every((one) => !b.has(one))

// A real lead and member driven through idle, working, waiting and done by their own hooks.
test('every Team scene style draws idle, working, waiting and done apart, as V28 does', async ({
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
    await orcaPage.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        uiLanguage: 'en',
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
    const endpoint = await readHookEndpoint(electronApp)
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Scene states',
      from: lead
    })
    await expect
      .poll(
        async () =>
          (
            await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
          ).result.worktrees.some((one) => one.id === worktreeId),
        { timeout: 60_000 }
      )
      .toBe(true)
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-12',
      taskTitle: 'ORCA-12',
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const started = await client.call<{ effects: { kind: string; role?: string; id?: string }[] }>(
      'orchestration.workerStart',
      {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: 'ORCA-12',
        agent: 'codex',
        timeoutMs: 20_000
      }
    )
    const handle = started.result.effects.find(
      (e) => e.kind === 'terminal' && e.role === 'agent'
    )?.id
    const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
    const terminal = listed.result.terminals.find((one) => one.handle === handle)
    expect(terminal, 'workerStart opened no listed agent terminal').toBeTruthy()
    const member = { paneKey: `${terminal!.tabId}:${terminal!.leafId}`, worktreeId }
    const stateOf = async (): Promise<OrchestratorGameState> =>
      (
        await client.call<OrchestratorGameState>('game.state', {
          worktreeId,
          terminalHandle: lead,
          paneKey: pane.paneKey
        })
      ).result
    const agentState = async (isLeader: boolean): Promise<string | undefined> =>
      (await stateOf()).agents.find(
        (one) => one.isLeader === isLeader && (isLeader || one.isMember)
      )?.state
    await expect
      .poll(
        async () => {
          await emitCodexHookStatus(endpoint, { ...member, state: 'working', prompt: 'Work' })
          return agentState(false)
        },
        { timeout: 90_000, message: 'game.state never listed the working member' }
      )
      .toBe('working')
    expect(await agentState(true), 'a lead that never reported is idle').toBe('idle')

    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const seen = new Map<string, Set<string>>()
    // Why: the panel reads game.state every 20 s (TEAM_REFRESH_MS), and on the first round the
    // member also walks in and greets the lead before it sits.
    const REFRESH_WAIT_MS = 21_000
    let settleMs = REFRESH_WAIT_MS
    const capture = async (round: Record<'lead' | 'member', string>): Promise<void> => {
      for (const style of STYLES) {
        await orcaPage.evaluate(
          (next) =>
            window
              .__store!.getState()
              .updateSettings({ orchestratorGame: { panel: { style: next } } }),
          style
        )
        const scene = panel.locator(`[data-team-scene="${style}"]`)
        await expect(scene.getByRole('img', { name: 'Live team scene' })).toBeVisible({
          timeout: 30_000
        })
        await orcaPage.waitForTimeout(settleMs)
        settleMs = 2000
        for (const who of ['lead', 'member'] as const) {
          seen.set(`${style}:${who}:${round[who]}`, await poseFrames(orcaPage, who))
        }
        if (round.member === 'working') {
          const sky = await sampleCrop(orcaPage, 'sky', SKY_WINDOW_MS)
          seen.set(`${style}:sky`, new Set(sky.hashes))
        }
        await scene.screenshot({
          path: testInfo.outputPath(`scene-${style}-lead-${round.lead}-member-${round.member}.png`)
        })
        // Evidence for the seat at every width and theme (criterion 7), read beside V28 office.
        if (round.member === 'working') {
          for (const width of [1440, 768, 390, 320]) {
            await orcaPage.setViewportSize({ width, height: 900 })
            for (const theme of ['dark', 'light'] as const) {
              await writeSettings(orcaPage, { theme })
              await orcaPage.waitForTimeout(400)
              await scene.screenshot({
                path: testInfo.outputPath(`scene-${style}-working-${width}-${theme}.png`)
              })
            }
          }
          await orcaPage.setViewportSize({ width: 1440, height: 900 })
        }
      }
    }

    await capture({ lead: 'idle', member: 'working' })
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      tool: 'Bash',
      toolInput: { command: 'gh pr view 923' }
    })
    await emitCodexHookStatus(endpoint, { ...member, state: 'done', lastAssistantMessage: 'Done' })
    await expect.poll(() => agentState(false)).toBe('done')
    await expect.poll(() => agentState(true)).toBe('working')
    settleMs = REFRESH_WAIT_MS
    await capture({ lead: 'working', member: 'done' })
    // AC3: the bubble names the step as V28 does, never the raw `Bash · …` line.
    const sceneText = panel.locator('[data-team-scene]')
    await expect(sceneText).toContainText('gh pr view 923')
    await expect(sceneText).not.toContainText('Bash ·')
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'done',
      lastAssistantMessage: 'Done'
    })
    await client.call('game.ownerAsk', {
      worktreeId,
      terminalHandle: lead,
      ticket: 'ORCA-12',
      question: 'Merge #12 now?',
      options: ['Yes', 'No']
    })
    await expect.poll(() => agentState(true)).toBe('done')
    settleMs = REFRESH_WAIT_MS
    await capture({ lead: 'done', member: 'waiting' })
    await expect(sceneText, 'a stopped lead keeps no old step').not.toContainText('gh pr view')

    const at = (style: Style, key: string): Set<string> => seen.get(`${style}:${key}`)!
    // AC2: the clouds drift in the styles that have a sky.
    for (const style of ['figures', 'pixel'] as const) {
      expect.soft(at(style, 'sky').size, `${style}: the sky stood still`).toBeGreaterThan(1)
    }
    for (const style of STYLES) {
      const pairs = [
        ['lead:idle', 'lead:working'],
        ['lead:idle', 'lead:done'],
        ['lead:working', 'lead:done'],
        ['member:working', 'member:done'],
        ['member:working', 'member:waiting'],
        ['member:done', 'member:waiting']
      ] as const
      for (const [a, b] of pairs) {
        expect.soft(disjoint(at(style, a), at(style, b)), `${style}: ${a} drew as ${b}`).toBe(true)
      }
      for (const key of ['lead:working', 'member:working'] as const) {
        expect.soft(at(style, key).size, `${style}: ${key} stood still`).toBeGreaterThan(1)
      }
      for (const key of ['lead:done', 'member:done'] as const) {
        expect.soft(at(style, key).size, `${style}: ${key} is not a held pose`).toBe(1)
      }
    }
  } finally {
    agent.dispose()
  }
})
