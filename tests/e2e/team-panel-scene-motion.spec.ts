import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const STYLES = ['pixel', 'figures', 'office'] as const
// Why this long: the acceptance is a visible change within 2 s while anyone works (ORCA-1097).
const WINDOW_MS = 2000
const SAMPLES = 11

async function canvasHash(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-team-scene] canvas')
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

async function hashesOver(page: Page): Promise<string[]> {
  const seen: string[] = []
  for (let i = 0; i < SAMPLES; i++) {
    seen.push(await canvasHash(page))
    await page.waitForTimeout(WINDOW_MS / (SAMPLES - 1))
  }
  return seen
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
      await expect(panel.locator(`[data-team-scene="${style}"] canvas`)).toBeVisible({
        timeout: 30_000
      })
      await expect.poll(() => canvasHash(orcaPage), { timeout: 30_000 }).not.toBe('unpainted')
      // Why a wait first: the members walked in when they joined; by now every one is seated.
      await orcaPage.waitForTimeout(8000)
      const hashes = await hashesOver(orcaPage)
      testInfo.annotations.push({
        type: 'team-scene-motion',
        description: `${style}: ${new Set(hashes).size} distinct frames in ${SAMPLES} samples over ${WINDOW_MS} ms`
      })
      await panel.locator('[data-team-scene]').screenshot({
        path: testInfo.outputPath(`team-scene-motion-${style}.png`)
      })
      expect
        .soft(new Set(hashes).size, `${style} drew one still frame for ${WINDOW_MS} ms`)
        .toBeGreaterThan(1)
    }

    // Two moments of Pixel per width and theme, a swing apart, to judge the motion against V28.
    await orcaPage.evaluate(() =>
      window.__store!.getState().updateSettings({ orchestratorGame: { panel: { style: 'pixel' } } })
    )
    const pixel = panel.locator('[data-team-scene="pixel"]')
    await expect(pixel.locator('canvas')).toBeVisible({ timeout: 30_000 })
    for (const width of [1440, 768, 390, 320]) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await orcaPage.evaluate(async (next) => {
          const settings = await window.api.settings.set({ theme: next })
          window.__store?.setState({ settings })
        }, theme)
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
