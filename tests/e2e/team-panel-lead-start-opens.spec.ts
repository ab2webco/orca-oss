/**
 * ORCA-1414: a lead start opens the right sidebar on Team, from the runtime's lead registration and
 * no Claude hook, so it holds when an org plugin skips orca-game's hooks. Needs E2E: the open runs
 * main → IPC → renderer, and the focus it must not steal is the real terminal's.
 */

import type { Page } from '@stablyai/playwright-test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'

const sidebarOf = (page: Page) =>
  page.evaluate(() => {
    const state = window.__store!.getState()
    return { open: state.rightSidebarOpen, tab: state.rightSidebarTab }
  })

const focusInTerminal = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('.xterm') !== null)

test('a lead start opens Team once, keeps terminal focus, and respects a later tab', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(240_000)
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
  await client.call('terminal.send', {
    terminal: lead,
    text: 'node -e "setInterval(() => {}, 1e9)"',
    enter: true
  })
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(false)
    state.setRightSidebarTab('source-control')
  })
  await orcaPage.locator('.xterm:visible .xterm-helper-textarea').first().focus()
  expect(await focusInTerminal(orcaPage)).toBe(true)

  // As `orca game lead` registers: the runtime call, with no Claude and no hook in the pane.
  const register = (fresh = false) =>
    client.call<{ registered: boolean }>('game.leadRegister', {
      worktreeId,
      terminalHandle: lead,
      project: 'e2e',
      label: 'Alfred',
      claim: true,
      ...(fresh ? { fresh: true } : {})
    })
  await expect.poll(async () => (await register()).result.registered).toBe(true)
  await expect.poll(() => sidebarOf(orcaPage)).toEqual({ open: true, tab: 'team' })
  await expect(orcaPage.getByTestId('team-panel')).toBeVisible()
  expect(await focusInTerminal(orcaPage), 'the open stole the terminal focus').toBe(true)

  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`lead-start-team-${width}-${theme}.png`)
      })
    }
  }
  await setWindowWidth(electronApp, orcaPage, 1440)

  // The person picks another tab: a repeat `game lead`, as a hook and the skill both run, keeps it.
  await orcaPage
    .getByRole('button', { name: /^Source Control/ })
    .first()
    .click()
  await expect.poll(() => sidebarOf(orcaPage)).toEqual({ open: true, tab: 'source-control' })
  expect((await register()).result.registered).toBe(true)
  // Why a pause: no event is the outcome, so give a wrong one the time IPC takes to land.
  await orcaPage.waitForTimeout(1_500)
  expect(await sidebarOf(orcaPage)).toEqual({ open: true, tab: 'source-control' })

  // A fresh lead in the same pane is a new start.
  expect((await register(true)).result.registered).toBe(true)
  await expect.poll(() => sidebarOf(orcaPage)).toEqual({ open: true, tab: 'team' })
})

test('a lead start in a folder workspace opens its Team panel', async ({
  electronApp,
  orcaPage
}) => {
  test.setTimeout(180_000)
  const folder = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-lead-start-folder-')))
  try {
    await waitForSessionReady(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    const made = await client.call<{ group: { id: string } }>('projectGroup.create', {
      name: 'Lead start folder',
      parentPath: folder,
      createdFrom: 'manual'
    })
    const created = await client.call<{ folderWorkspace: { id: string } }>(
      'folderWorkspace.create',
      { projectGroupId: made.result.group.id, folderPath: folder, name: 'Lead start ws' }
    )
    const worktreeId = `folder:${created.result.folderWorkspace.id}`
    await orcaPage.evaluate(async (id) => {
      const store = window.__store!.getState()
      await store.fetchProjectGroups()
      await store.fetchFolderWorkspaces()
      window.__store!.getState().setActiveWorktree(id)
      window.__store!.getState().setRightSidebarOpen(false)
    }, worktreeId)
    const lead = (
      await client.call<{ terminal: { handle: string } }>('terminal.create', {
        worktree: `id:${worktreeId}`,
        command: 'node -e "setInterval(() => {}, 1e9)"'
      })
    ).result.terminal.handle
    const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
    expect(listed.result.terminals.find((one) => one.handle === lead)?.worktreeId).toBe(worktreeId)
    await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))

    // Why no worktreeId: an older CLI omits it, so the host names the pane's own worktree.
    await expect
      .poll(
        async () =>
          (
            await client.call<{ registered: boolean }>('game.leadRegister', {
              terminalHandle: lead,
              project: 'folder-lead-start',
              label: 'Alfred'
            })
          ).result.registered
      )
      .toBe(true)
    await expect.poll(() => sidebarOf(orcaPage)).toEqual({ open: true, tab: 'team' })
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
