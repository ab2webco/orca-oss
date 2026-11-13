/**
 * ORCA-1148: a member named 'Merlin · E2E-801' showed its ticket again beneath the name once the row
 * wrapped. The ticket shows once on the Team card, the sidebar row and the member's pane header.
 */
import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const countOf = async (where: Locator, ticket: string): Promise<number> =>
  ((await where.innerText()).match(new RegExp(ticket, 'g')) ?? []).length

async function capture(page: Page, outputPath: (name: string) => string, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: outputPath(`${name}-${width}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test('a member whose name carries its ticket shows the ticket once on the card, the sidebar and its header', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
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
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' }
    })
    await writeSettings(orcaPage, { uiLanguage: 'en', theme: 'dark' })
    // Why a foreground process and a hook: a lead pane back at its shell is not a live lead.
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
      objective: 'Ticket once',
      from: lead
    })
    const task = async (ticket: string) =>
      (
        await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
          spec: `Work on ${ticket}`,
          taskTitle: ticket,
          run: run.result.run.id,
          callerTerminalHandle: lead
        })
      ).result.task.id

    // A live member named with its ticket in its own worktree (its sidebar row), and a paused one.
    const memberWorktreeId = await orcaPage.evaluate(async () => {
      const state = window.__store!.getState()
      const repoId = Object.values(state.worktreesByRepo)
        .flat()
        .find((one) => one.id === state.activeWorktreeId)!.repoId
      return (await state.createWorktree(repoId, 'e2e-801')).worktree.id
    })
    await expect
      .poll(async () =>
        client.call('worktree.show', { worktree: `id:${memberWorktreeId}` }).then(
          () => true,
          () => false
        )
      )
      .toBe(true)
    const started = await client.call<{ effects: { kind: string; role?: string; id?: string }[] }>(
      'orchestration.workerStart',
      {
        task: await task('E2E-801'),
        from: lead,
        worktree: `id:${memberWorktreeId}`,
        displayName: 'Merlin · E2E-801',
        agent: 'codex',
        timeoutMs: 20_000
      }
    )
    const handle = started.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
    const terminal = listed.result.terminals.find((one) => one.handle === handle)!
    const member = {
      paneKey: `${terminal.tabId}:${terminal.leafId}`,
      worktreeId: terminal.worktreeId
    }
    await client.call('game.memberRecord', {
      worktreeId,
      terminalHandle: lead,
      member: {
        ticket: 'E2E-802',
        name: 'Merlin · E2E-802',
        runId: run.result.run.id,
        taskId: await task('E2E-802'),
        agent: 'codex',
        lastState: 'idle'
      }
    })

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setSidebarOpen(true)
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const cards = panel.locator('[data-team-card="member"]')
    await expect
      .poll(
        async () => {
          await emitCodexHookStatus(endpoint, { ...member, state: 'working', prompt: 'Work' })
          return cards.count()
        },
        { timeout: 90_000, message: 'the panel never drew both members' }
      )
      .toBe(2)
    for (const ticket of ['E2E-801', 'E2E-802']) {
      const card = cards.filter({ hasText: ticket })
      expect(await countOf(card, ticket), `${ticket} card`).toBe(1)
    }
    const row = orcaPage.locator('[data-sidebar-team-row]').filter({ hasText: 'E2E-801' }).first()
    await expect(row).toBeVisible()
    expect(await countOf(row, 'E2E-801'), 'sidebar row').toBe(1)
    await capture(orcaPage, testInfo.outputPath.bind(testInfo), 'ticket-once-panel')

    await cards.filter({ hasText: 'E2E-801' }).locator('button[aria-expanded]').click()
    const header = orcaPage.locator(
      `[data-terminal-overlay-tab-id="${terminal.tabId}"] [data-team-member-header]`
    )
    await expect(header).toBeVisible({ timeout: 30_000 })
    expect(await countOf(header, 'E2E-801'), 'member pane header').toBe(1)
    await capture(orcaPage, testInfo.outputPath.bind(testInfo), 'ticket-once-header')
  } finally {
    agent.dispose()
  }
})
