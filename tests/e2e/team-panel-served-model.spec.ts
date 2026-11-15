import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  emitClaudeHookPayload,
  emitCodexHookStatus,
  readHookEndpoint
} from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const WIDTHS = [1440, 768, 390, 320]
const JEV_LINE = 'jev · model: Opus 5.5 · high effort · code floor (Jev: code)'

const assistantLine = (model: string, effort: string): string =>
  `${JSON.stringify({ type: 'assistant', effort, message: { role: 'assistant', model, content: [] } })}\n`

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

// ORCA-851: a member's card names the model its session actually served mid-turn, and credits
// Jev's router with the switch only when that member's Jev reported one.
test('Team cards show the served model and who chose it', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(420_000)
  const agent = createStdinLoggingAgent()
  const transcripts = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-served-model-'))
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
          label: 'Lead'
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
      objective: 'Served model',
      from: lead
    })
    await expect
      .poll(async () => {
        const listed = await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        return listed.result.worktrees.some((one) => one.id === worktreeId)
      })
      .toBe(true)
    const member = async (ticket: string) => {
      const displayName = `${ticket} Served model`
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Work on ${ticket}`,
        taskTitle: displayName,
        run: run.result.run.id,
        callerTerminalHandle: lead
      })
      const started = await client.call<{
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName,
        agent: 'codex',
        timeoutMs: 20_000
      })
      const handle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
      const terminal = listed.result.terminals.find((one) => one.handle === handle)
      expect(terminal, `the ${ticket} terminal is not listed`).toBeTruthy()
      return {
        handle: handle!,
        paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
        worktreeId: terminal!.worktreeId,
        transcript: path.join(transcripts, `${ticket}.jsonl`)
      }
    }
    const solo = await member('ORCA-9001')
    const routed = await member('ORCA-9002')

    // Both start on Sonnet; a router moves each to Opus mid-turn, before any Stop.
    for (const one of [solo, routed]) {
      writeFileSync(one.transcript, '')
      const at = { paneKey: one.paneKey, worktreeId: one.worktreeId }
      await emitClaudeHookPayload(endpoint, {
        ...at,
        payload: {
          hook_event_name: 'SessionStart',
          source: 'startup',
          model: 'claude-sonnet-5-5',
          transcript_path: one.transcript
        }
      })
      await emitClaudeHookPayload(endpoint, {
        ...at,
        payload: {
          hook_event_name: 'UserPromptSubmit',
          prompt: 'Work',
          transcript_path: one.transcript
        }
      })
      writeFileSync(one.transcript, assistantLine('claude-opus-5-5', 'high'))
      await emitClaudeHookPayload(endpoint, {
        ...at,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'Edit',
          tool_input: { file_path: 'src/a.ts' },
          transcript_path: one.transcript,
          effort: { level: 'medium' }
        }
      })
    }
    // Only the routed member's Jev reports, the way its plugin posts from that member's pane.
    const reportJev = async (): Promise<OrchestratorGameState> =>
      (
        await client.call<OrchestratorGameState>('game.state', {
          worktreeId: routed.worktreeId,
          terminalHandle: routed.handle,
          paneKey: routed.paneKey,
          advisor: {
            version: 1,
            model: 'Opus 5.5',
            effort: 'high',
            line: JEV_LINE,
            routedModel: 'claude-opus-5-5',
            sessionModel: 'claude-sonnet-5-5',
            pinned: { model: false, effort: false }
          }
        })
      ).result
    await expect
      .poll(async () => {
        await reportJev()
        const state = (
          await client.call<OrchestratorGameState>('game.state', {
            worktreeId,
            terminalHandle: lead,
            paneKey: pane.paneKey
          })
        ).result
        return state.agents
          .filter((one) => one.isMember)
          .map((one) => [one.displayName, one.launch?.model ?? null, Boolean(one.advisor)])
          .sort()
      })
      .toEqual([
        ['ORCA-9001 Served model', 'Opus 5.5', false],
        ['ORCA-9002 Served model', 'Opus 5.5', true]
      ])

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const cards = panel.locator('[data-team-card="member"]')
    await expect(cards).toHaveCount(2, { timeout: 90_000 })
    const soloCard = cards.filter({ hasText: 'ORCA-9001' })
    const routedCard = cards.filter({ hasText: 'ORCA-9002' })
    await expect(soloCard.locator('[data-team-model]')).toHaveText('Opus 5.5 · high')
    await expect(routedCard.locator('[data-team-model]')).toHaveText('Sonnet 5.5 → Opus 5.5 · high')

    await orcaPage.addStyleTag({
      content: '[role="tabpanel"] { scrollbar-width: auto; scrollbar-color: auto }'
    })
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 720 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        const where = `${width}px ${theme}`
        const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
        expect(overflow, `panel overflows: ${where}`).toBeLessThanOrEqual(0)
        // Why the list too: a long model line once scrolled the list sideways inside a fitting panel.
        const listOverflow = await panel
          .getByRole('tabpanel')
          .evaluate((node: HTMLElement) => node.scrollWidth - node.clientWidth)
        expect(listOverflow, `list scrolls sideways: ${where}`).toBeLessThanOrEqual(0)
        await panel.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`list-${width}-${theme}.png`)
        })
      }
    }

    // The detail says who chose the model: Jev for the routed member, nobody for the solo one.
    // Why this order: the list opens one card at a time, and the captures show the routed one.
    await soloCard.locator('button[aria-expanded]').first().click()
    await expect(soloCard).toContainText('src/a.ts')
    await expect(soloCard).not.toContainText('Jev')
    await routedCard.locator('button[aria-expanded]').first().click()
    await expect(routedCard).toContainText('code floor (Jev: code)')
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width, height: 900 })
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
        expect(overflow, `panel overflows: ${width}px ${theme}`).toBeLessThanOrEqual(0)
        await routedCard.evaluate((node) => node.scrollIntoView({ block: 'start' }))
        await panel.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`card-${width}-${theme}.png`)
        })
      }
    }
  } finally {
    agent.dispose()
    rmSync(transcripts, { recursive: true, force: true })
  }
})
