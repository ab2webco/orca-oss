import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const STYLES = ['pixel', 'figures', 'office'] as const
// Why this long: the acceptance is a visible change within 2 s while anyone works (ORCA-1097).
const WINDOW_MS = 2000
// Why: Pixel's tool swing shows for 1/2.3 s ≈ 435 ms of every 1.15 s (SWING_FADE, SWING_SECONDS in
// team-scene-pixel-painter.ts) and rests otherwise; frames closer than that over 2 s must catch
// both. Figures and Office move continuously, so the same bound covers them.
const MAX_FRAME_GAP_MS = 430
// Why fresh windows, not a longer one: a stretched window would judge "within N s", not 2 s.
const MAX_WINDOWS = 5
// Why by role and name: Pixel's thought cloud is a canvas too.
const sceneCanvasIn = (root: Locator): Locator => root.getByRole('img', { name: 'Live team scene' })

// Why mapped: a never-shown window gets a frame only every ~1017 ms on CI (ORCA-760), too sparse
// for any window to be judged (PR #1067 run 42408533741).
test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

type SceneWindow = { hashes: string[]; frames: number; maxGapMs: number }

const describeWindow = (w: SceneWindow): string =>
  `${new Set(w.hashes).size} distinct of ${w.frames} frames, at most ${Math.round(w.maxGapMs)} ms apart`

// Why hashed inside the frame: a hash per animation frame is what the scene painted, not what a
// Playwright poll happened to catch on a starved runner (ORCA-1132).
async function sceneWindow(page: Page): Promise<SceneWindow> {
  return page.evaluate(
    (windowMs) =>
      new Promise<SceneWindow>((resolve) => {
        const hashOf = (): string => {
          const canvas = document.querySelector<HTMLCanvasElement>('[data-team-scene] [role="img"]')
          const g = canvas?.getContext('2d')
          if (!canvas || !g || canvas.width === 0) {
            return 'unpainted'
          }
          const { data } = g.getImageData(0, 0, canvas.width, canvas.height)
          let hash = 0x811c9dc5
          for (let i = 0; i < data.length; i++) {
            hash = Math.imul(hash ^ data[i]!, 0x01000193)
          }
          return (hash >>> 0).toString(16)
        }
        const start = performance.now()
        const stamps = [start]
        const hashes: string[] = []
        let counting = true
        const tick = (): void => {
          if (!counting) {
            return
          }
          stamps.push(performance.now())
          hashes.push(hashOf())
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        // Why a timer resolves: a starved runner may run no frame at all before the window ends.
        setTimeout(() => {
          counting = false
          stamps.push(performance.now())
          let maxGapMs = 0
          for (let i = 1; i < stamps.length; i++) {
            maxGapMs = Math.max(maxGapMs, stamps[i]! - stamps[i - 1]!)
          }
          resolve({ hashes, frames: hashes.length, maxGapMs })
        }, windowMs)
      }),
    WINDOW_MS
  )
}

async function canvasHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-team-scene] [role="img"]')
    const g = canvas?.getContext('2d')
    if (!canvas || !g || canvas.width === 0) {
      return 'unpainted'
    }
    const { data } = g.getImageData(0, 0, canvas.width, canvas.height)
    let hash = 0x811c9dc5
    for (let i = 0; i < data.length; i++) {
      hash = Math.imul(hash ^ data[i]!, 0x01000193)
    }
    return (hash >>> 0).toString(16)
  })
}

// A real lead, one member working and one asking the user; nothing walks once they are seated, so
// only a style's idle motion can change the canvas.
test('every Team scene style moves while its team works, with no one entering or leaving', async ({
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
    const endpoint = await readHookEndpoint(electronApp)
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Scene motion',
      from: lead
    })
    await expect
      .poll(
        async () =>
          (
            await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
          ).result.worktrees.some((one) => one.id === worktreeId),
        { timeout: 60_000, message: 'the runtime never listed the active worktree' }
      )
      .toBe(true)
    const member = async (ticket: string) => {
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Work on ${ticket}`,
        taskTitle: ticket,
        run: run.result.run.id,
        callerTerminalHandle: lead
      })
      const started = await client.call<{
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: ticket,
        agent: 'codex',
        timeoutMs: 20_000
      })
      const handle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      expect(handle, `workerStart opened no agent terminal for ${ticket}`).toBeTruthy()
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      const terminal = listed.result.terminals.find((one) => one.handle === handle)
      expect(terminal, `the ${ticket} terminal is not listed`).toBeTruthy()
      return { paneKey: `${terminal!.tabId}:${terminal!.leafId}`, worktreeId: terminal!.worktreeId }
    }
    const members = [await member('ORCA-12'), await member('ORCA-14')]
    await client.call('game.ownerAsk', {
      worktreeId,
      terminalHandle: lead,
      ticket: 'ORCA-14',
      question: 'Merge #14 now?',
      options: ['Yes', 'No']
    })
    await expect
      .poll(
        async () => {
          for (const one of members) {
            await emitCodexHookStatus(endpoint, { ...one, state: 'working', prompt: 'Work' })
          }
          const state = (
            await client.call<OrchestratorGameState>('game.state', {
              worktreeId,
              terminalHandle: lead,
              paneKey: pane.paneKey
            })
          ).result
          return state.agents.filter((one) => one.isMember && !one.isLeader).length
        },
        { timeout: 90_000, message: 'game.state never listed the two members' }
      )
      .toBe(2)

    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const reduced = await orcaPage.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
    expect(reduced, 'the scene only animates without reduced motion').toBe(false)

    for (const style of STYLES) {
      await orcaPage.evaluate(
        (next) =>
          window.__store!.getState().updateSettings({
            orchestratorGame: { panel: { style: next } }
          }),
        style
      )
      await expect(sceneCanvasIn(panel.locator(`[data-team-scene="${style}"]`))).toBeVisible({
        timeout: 30_000
      })
      await expect.poll(() => canvasHash(orcaPage), { timeout: 30_000 }).not.toBe('unpainted')
      // Why a wait first: the members walked in when they joined; by now every one is seated.
      await orcaPage.waitForTimeout(8000)
      const windows: SceneWindow[] = []
      while (windows.length < MAX_WINDOWS) {
        windows.push(await sceneWindow(orcaPage))
        if (windows.at(-1)!.maxGapMs <= MAX_FRAME_GAP_MS) {
          break
        }
      }
      const judged = windows.at(-1)!
      testInfo.annotations.push({
        type: 'team-scene-motion',
        description: `${style}: ${windows.map(describeWindow).join('; ')} over ${WINDOW_MS} ms each`
      })
      await panel.locator('[data-team-scene]').screenshot({
        path: testInfo.outputPath(`team-scene-motion-${style}.png`)
      })
      if (judged.maxGapMs > MAX_FRAME_GAP_MS) {
        expect
          .soft(
            judged.maxGapMs,
            `${style} not judged: the runner starved the scene in ${windows.length} windows of ${WINDOW_MS} ms (${windows.map(describeWindow).join('; ')})`
          )
          .toBeLessThanOrEqual(MAX_FRAME_GAP_MS)
        continue
      }
      expect
        .soft(
          new Set(judged.hashes).size,
          `${style} drew one still frame for ${WINDOW_MS} ms: ${describeWindow(judged)}`
        )
        .toBeGreaterThan(1)
    }

    // Two moments of Pixel per width and theme, a swing apart, to judge the motion against V28.
    await orcaPage.evaluate(() =>
      window.__store!.getState().updateSettings({ orchestratorGame: { panel: { style: 'pixel' } } })
    )
    const pixel = panel.locator('[data-team-scene="pixel"]')
    await expect(sceneCanvasIn(pixel)).toBeVisible({ timeout: 30_000 })
    // A sequence across one swing, so the motion can be read frame by frame.
    for (let frame = 0; frame < 6; frame++) {
      await pixel.screenshot({
        path: testInfo.outputPath(`team-scene-pixel-sequence-${frame}.png`)
      })
      await orcaPage.waitForTimeout(200)
    }
    for (const width of [1440, 768, 390, 320]) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await writeSettings(orcaPage, { theme })
        for (const moment of ['a', 'b']) {
          await orcaPage.waitForTimeout(moment === 'a' ? 600 : 250)
          await pixel.screenshot({
            path: testInfo.outputPath(`team-scene-pixel-${width}-${theme}-${moment}.png`)
          })
        }
      }
    }
  } finally {
    agent.dispose()
  }
})
