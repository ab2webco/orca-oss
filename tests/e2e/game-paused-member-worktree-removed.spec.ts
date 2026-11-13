/**
 * ORCA-1148: a lead removed its members' merged worktrees and the Team panel kept every one of them
 * 'paused' for hours. Removing a member's worktree, from the CLI or the desktop, frees it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'

const TICKETS = ['E2E-801', 'E2E-802', 'E2E-803'] as const

function savedTickets(userDataDir: string): string[] {
  const dir = path.join(userDataDir, 'orchestrator-game-members')
  const file = existsSync(dir)
    ? readdirSync(dir).find((name) => name.endsWith('.members.json'))
    : undefined
  const saved = file
    ? (JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as { members: { ticket: string }[] })
    : { members: [] }
  return saved.members.map((one) => one.ticket).sort()
}

async function capture(page: Page, outputPath: (name: string) => string, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.screenshot({ path: outputPath(`${name}-${width}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test('removing a paused member’s worktree takes it off the Team panel, from the CLI or the desktop', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActivePanePtyId(orcaPage)
  const pane = await waitForActivePaneHookDescriptor(orcaPage)
  await writeSettings(orcaPage, { uiLanguage: 'en', theme: 'dark' })
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const lead = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey: pane.paneKey
    })
  ).result.terminal.handle
  const leadWorktreeId = (
    await client.call<{ terminal: { worktreeId: string } }>('terminal.show', { terminal: lead })
  ).result.terminal.worktreeId
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
  await emitCodexHookStatus(await readHookEndpoint(electronApp), {
    paneKey: pane.paneKey,
    worktreeId: leadWorktreeId,
    state: 'working',
    prompt: 'Lead the team'
  })
  const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
    objective: 'Paused members whose worktree is removed',
    from: lead
  })

  // Each member has its own worktree and no live terminal, so the lead lists it as paused.
  const worktreeOf: Record<string, string> = {}
  for (const ticket of TICKETS) {
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Wait',
      taskTitle: ticket,
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    worktreeOf[ticket] = await orcaPage.evaluate(async (name) => {
      const state = window.__store!.getState()
      const repoId = Object.values(state.worktreesByRepo)
        .flat()
        .find((one) => one.id === state.activeWorktreeId)!.repoId
      return (await state.createWorktree(repoId, name)).worktree.id
    }, ticket.toLowerCase())
    await client.call('game.memberRecord', {
      worktreeId: leadWorktreeId,
      terminalHandle: lead,
      member: {
        ticket,
        name: `Merlin · ${ticket}`,
        runId: run.result.run.id,
        taskId: task.result.task.id,
        worktreeId: worktreeOf[ticket],
        agent: 'codex',
        lastState: 'idle'
      }
    })
  }

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  const panel = orcaPage.getByTestId('team-panel')
  const cards = panel.locator('[data-team-card="member"]')
  await expect(cards).toHaveCount(TICKETS.length, { timeout: 60_000 })
  for (const ticket of TICKETS) {
    await expect(panel).toContainText(ticket)
  }
  await capture(orcaPage, testInfo.outputPath.bind(testInfo), 'paused-before')

  // From the CLI, as a lead's cleanup does, and from the desktop's own delete.
  await client.call('worktree.rm', {
    worktree: `id:${worktreeOf['E2E-801']}`,
    force: true,
    allowGameMember: true
  })
  await orcaPage.evaluate(async (id) => {
    await window.__store!.getState().removeWorktree(id, true)
  }, worktreeOf['E2E-802'])

  // Why count the cards: a panel between reads holds no text, so 'not.toContainText' passes on it.
  await expect(cards).toHaveCount(1, { timeout: 60_000 })
  await expect(cards).toContainText('E2E-803')
  expect(savedTickets(userDataDir)).toEqual(['E2E-803'])
  await capture(orcaPage, testInfo.outputPath.bind(testInfo), 'paused-after')
})
