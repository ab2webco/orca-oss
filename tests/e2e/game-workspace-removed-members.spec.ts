/**
 * ORCA-1478: deleting a folder workspace left its members on the Team panel, because the gone
 * worktree sweep cannot read a `folder:` id. The desktop delete now forgets them, and only them.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { setTheme } from './helpers/settings-window'
import { RuntimeClient } from '../../src/cli/runtime-client'

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

// Why the panel's own widths: the desktop window keeps its size; the right sidebar is what changes.
const WINDOW = { width: 1440, height: 900 }
const SIDEBAR_WIDTHS = { min: 220, default: 350, max: WINDOW.width - 320 }

async function capture(page: Page, outputPath: (name: string) => string, name: string) {
  const panel = page.getByTestId('team-panel')
  await page.setViewportSize(WINDOW)
  for (const [label, width] of Object.entries(SIDEBAR_WIDTHS)) {
    await page.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), width)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme)
      await panel.screenshot({
        animations: 'disabled',
        path: outputPath(`${name}-${label}-${width}-${theme}.png`)
      })
    }
  }
  await page.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), 350)
  await setTheme(page, 'dark')
}

test('deleting a folder workspace takes its member off the Team panel and keeps the others', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  const folder = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-removed-ws-')))
  try {
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
      objective: 'Members of a deleted folder workspace',
      from: lead
    })

    const group = await client.call<{ group: { id: string } }>('projectGroup.create', {
      name: 'Removed folder team',
      createdFrom: 'manual'
    })
    const created = await client.call<{ folderWorkspace: { id: string } }>(
      'folderWorkspace.create',
      { projectGroupId: group.result.group.id, folderPath: folder, name: 'Notes folder' }
    )
    const folderWorkspaceId = created.result.folderWorkspace.id
    const worktreeOf: Record<string, string> = {
      'E2E-811': `folder:${folderWorkspaceId}`,
      'E2E-812': await orcaPage.evaluate(async () => {
        const state = window.__store!.getState()
        await state.fetchProjectGroups()
        await state.fetchFolderWorkspaces()
        const repoId = Object.values(state.worktreesByRepo)
          .flat()
          .find((one) => one.id === state.activeWorktreeId)!.repoId
        return (await state.createWorktree(repoId, 'e2e-812')).worktree.id
      })
    }
    // Each member has no live terminal, so the lead lists it as paused.
    for (const [ticket, worktreeId] of Object.entries(worktreeOf)) {
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: 'Wait',
        taskTitle: ticket,
        run: run.result.run.id,
        callerTerminalHandle: lead
      })
      await client.call('game.memberRecord', {
        worktreeId: leadWorktreeId,
        terminalHandle: lead,
        member: {
          ticket,
          name: `Merlin · ${ticket}`,
          runId: run.result.run.id,
          taskId: task.result.task.id,
          worktreeId,
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
    await expect(cards).toHaveCount(2, { timeout: 60_000 })
    await expect(panel).toContainText('E2E-811')
    await expect(panel).toContainText('E2E-812')
    await capture(orcaPage, testInfo.outputPath.bind(testInfo), 'folder-before')

    // The person's own delete, from the desktop; the folder itself stays on disk.
    expect(
      await orcaPage.evaluate(
        async (id) => window.__store!.getState().deleteFolderWorkspace(id),
        folderWorkspaceId
      )
    ).toBe(true)

    // Why count the cards: a panel between reads holds no text, so 'not.toContainText' passes on it.
    await expect(cards).toHaveCount(1, { timeout: 60_000 })
    await expect(cards).toContainText('E2E-812')
    await expect.poll(() => savedTickets(userDataDir)).toEqual(['E2E-812'])
    await capture(orcaPage, testInfo.outputPath.bind(testInfo), 'folder-after')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
