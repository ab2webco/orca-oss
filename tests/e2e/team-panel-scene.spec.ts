import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const WIDTHS = [1440, 768, 390, 320]
const COPY = {
  en: { label: 'Live team scene', open: 'Open terminal' },
  es: { label: 'Escena en vivo del equipo', open: 'Abrir terminal' }
} as const

// Why sampled: a mounted canvas that never painted is still visible; varied pixels prove a frame.
async function paintedColors(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-team-scene] canvas')
    const g = canvas?.getContext('2d')
    if (!canvas || !g || canvas.width === 0) {
      return 0
    }
    const { data } = g.getImageData(0, 0, canvas.width, canvas.height)
    const seen = new Set<number>()
    for (let i = 0; i < data.length; i += 4 * 97) {
      seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!)
    }
    return seen.size
  })
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

// The live scene in the Team panel, drawn from the lead's own game state (ORCA-1051). Nothing is
// seeded into the panel: a real lead pane, real orchestration members and a real owner question.
test('the Team panel draws the live scene beside a member opened under its header', async ({
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
    // The lead's agent row is posted the way Orca's hooks do; main attaches its terminal handle.
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Team tab',
      from: lead
    })
    // Why: workerStart resolves `id:` through the runtime's fleet, which can lag the renderer's
    // active worktree; starting a member before it lists the worktree fails with selector_not_found.
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
      return {
        paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
        worktreeId: terminal!.worktreeId
      }
    }
    const members = [await member('ORCA-12'), await member('ORCA-14')]
    const postMemberHooks = async (): Promise<void> => {
      for (const one of members) {
        await emitCodexHookStatus(endpoint, { ...one, state: 'working', prompt: 'Work' })
      }
    }
    await client.call('game.ownerAsk', {
      worktreeId,
      terminalHandle: lead,
      ticket: 'ORCA-14',
      question: 'Merge #14 now?',
      options: ['Yes', 'No']
    })

    // The runtime itself must report both members before the panel is judged.
    await expect
      .poll(
        async () => {
          await postMemberHooks()
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

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const scene = panel.locator('[data-team-scene]')
    await expect(scene.locator('canvas')).toBeVisible({ timeout: 90_000 })
    await expect.poll(() => paintedColors(orcaPage), { timeout: 30_000 }).toBeGreaterThan(8)

    for (const language of ['en', 'es'] as const) {
      await orcaPage.evaluate(
        (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
        language
      )
      await expect(scene.locator('canvas')).toHaveAttribute('aria-label', COPY[language].label)
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(orcaPage, theme)
          const box = await scene.boundingBox()
          const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
          expect(
            overflow,
            `panel overflows at ${width}px ${theme} ${language}`
          ).toBeLessThanOrEqual(0)
          testInfo.annotations.push({
            type: 'team-scene',
            description: `${language} ${width} ${theme}: ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`
          })
          await expect.poll(() => paintedColors(orcaPage)).toBeGreaterThan(8)
          await scene.screenshot({
            path: testInfo.outputPath(`team-scene-${language}-${width}-${theme}.png`)
          })
          await orcaPage.screenshot({
            path: testInfo.outputPath(`team-panel-scene-${language}-${width}-${theme}.png`)
          })
        }
      }
    }

    // A member opened from the Team tab gets its native header while the scene keeps drawing.
    await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
    await orcaPage.setViewportSize({ width: 1440, height: 900 })
    const asker = panel.locator('[data-team-card="member"]').filter({ hasText: 'ORCA-14' })
    await asker.locator('button[aria-expanded]').click()
    await asker.getByRole('button', { name: COPY.en.open }).click()
    const askerTab = members[1].paneKey.split(':')[0]
    const header = orcaPage.locator(
      `[data-terminal-overlay-tab-id="${askerTab}"] [data-team-member-header]`
    )
    await expect(header).toBeVisible({ timeout: 30_000 })
    await expect(scene.locator('canvas')).toBeVisible()
    await expect.poll(() => paintedColors(orcaPage)).toBeGreaterThan(8)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      await orcaPage.screenshot({
        path: testInfo.outputPath(`team-scene-with-member-header-en-1440-${theme}.png`)
      })
    }
  } finally {
    agent.dispose()
  }
})
