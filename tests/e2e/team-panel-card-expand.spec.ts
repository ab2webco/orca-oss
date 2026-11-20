import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { seedRendererGameState, seededReview } from './helpers/game-state-renderer-seed'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const WIDTHS = [1440, 768, 390, 320]
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

const activeTab = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.__store!.getState().activeTabId)

// ORCA-1300: a click on a Team card unfolds it, the lead's too; only its terminal icon opens the terminal.
test('a Team card click expands it, and its terminal icon opens the session', async ({
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
    const repoId = await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      return state.getKnownWorktreeById(state.activeWorktreeId!)!.repoId
    })
    await writeSettings(orcaPage, {
      uiLanguage: 'en',
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' },
      orchestratorGameProjects: { [repoId]: { orchestrator: { label: 'Alfred' } } }
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
      objective: 'Card expand',
      from: lead
    })
    await expect
      .poll(async () => {
        const listed = await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        return listed.result.worktrees.some((one) => one.id === worktreeId)
      })
      .toBe(true)
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-1142',
      taskTitle: 'Knight · ORCA-1142 Keep the look',
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const started = await client.call<{
      effects: { kind: string; role?: string; id?: string }[]
    }>('orchestration.workerStart', {
      task: task.result.task.id,
      from: lead,
      worktree: `id:${worktreeId}`,
      displayName: 'Knight · ORCA-1142 Keep the look',
      agent: 'codex',
      timeoutMs: 20_000
    })
    const handle = started.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    const terminal = (
      await client.call<RuntimeTerminalListResult>('terminal.list')
    ).result.terminals.find((one) => one.handle === handle)
    expect(terminal, 'the member terminal is not listed').toBeTruthy()
    const member = {
      paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
      worktreeId: terminal!.worktreeId
    }
    await emitCodexHookStatus(endpoint, {
      ...member,
      state: 'working',
      tool: 'Bash',
      toolInput: { command: 'npx vitest run team-panel' }
    })
    await client.call('game.ownerAsk', {
      worktreeId,
      terminalHandle: lead,
      ticket: 'ORCA-1142',
      question: 'Merge #924 now?',
      options: ['Yes', 'No']
    })
    // Why seeded: E2E reaches no PR provider, and a codex stub reports no served model.
    await seedRendererGameState(electronApp, {
      fields: {
        [pane.paneKey]: { launch: { model: 'Opus 5.5', effort: 'high', source: 'session' } },
        [member.paneKey]: { review: seededReview(924, 'open', 'success') }
      }
    })

    // Why the center starts away from the member: opening it must be the icon's doing.
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const leadCard = panel.locator('[data-team-card="lead"]')
    const knight = panel.locator('[data-team-card="member"]').filter({ hasText: 'ORCA-1142' })
    await expect(knight).toHaveCount(1, { timeout: 90_000 })
    await expect(leadCard).toContainText('Alfred')
    const memberTab = member.paneKey.split(':')[0]
    const leadTab = pane.paneKey.split(':')[0]
    await orcaPage.evaluate((tab) => window.__store!.getState().setActiveTab(tab), leadTab)
    await expect.poll(() => activeTab(orcaPage)).toBe(leadTab)

    const capture = async (name: string): Promise<void> => {
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(orcaPage, theme)
          const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
          expect(overflow, `panel overflows at ${width}px ${theme}`).toBeLessThanOrEqual(0)
          expect(await panel.innerText(), 'a capture shows an account email').not.toMatch(EMAIL)
          await panel.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`${name}-${width}-${theme}.png`)
          })
        }
      }
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
    }

    const knightToggle = knight.locator('button[aria-expanded]')
    await knightToggle.click()
    await expect(knightToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(knight.locator('[data-team-card-detail]')).toBeVisible()
    await expect(knight.locator('[data-team-detail="tool"]')).toContainText('team-panel')
    expect(await activeTab(orcaPage), 'expanding a member opened its terminal').toBe(leadTab)
    await capture('member-expanded')

    const leadToggle = leadCard.locator('button[aria-expanded]')
    await leadToggle.click()
    await expect(leadToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(knightToggle).toHaveAttribute('aria-expanded', 'false')
    const leadDetail = leadCard.locator('[data-team-card-detail]')
    await expect(leadDetail.locator('[data-team-detail="question"] dd')).toHaveText(
      'Open, on ORCA-1142'
    )
    await expect(leadDetail.locator('[data-team-detail="model"] dd')).toHaveText('Opus 5.5')
    await expect(leadDetail.locator('[data-team-detail="effort"] dd')).toHaveText('high')
    await expect(leadDetail.locator('[data-team-detail="host"] dd')).not.toBeEmpty()
    await expect(leadDetail.locator('[data-team-detail="branch"] dd')).not.toContainText(
      'refs/heads/'
    )
    await expect(leadDetail.getByRole('button', { name: 'Answer in Inbox' })).toBeVisible()
    await capture('lead-expanded')

    const icon = knight.getByRole('button', { name: 'Open terminal' })
    await icon.hover()
    await expect(orcaPage.getByRole('tooltip')).toHaveText('Open terminal')
    await panel.screenshot({ path: testInfo.outputPath('terminal-icon-tooltip.png') })
    await icon.click()
    await expect.poll(() => activeTab(orcaPage)).toBe(memberTab)
    await expect(knightToggle).toHaveAttribute('aria-expanded', 'false')
  } finally {
    agent.dispose()
  }
})
