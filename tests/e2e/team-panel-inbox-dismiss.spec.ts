import type { Locator } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { expectPlaceholdersFit } from './helpers/placeholder-fit'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameInboxThreads } from '../../src/shared/orchestrator-game-inbox-threads'

// Why the panel's own widths: Dismiss lives in a sidebar the person drags from 220 px up (ORCA-1482).
const MIN_WIDTH = 220
const MAX_REQUEST = 4000

// A wait no reply can settle shows Dismiss; a second Dismiss with a note settles it for the watch too.
test('the Inbox dismisses a wait no reply can settle, with a note, at every panel width', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
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
  await writeSettings(orcaPage, { uiLanguage: 'en', theme: 'dark' })
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

  // A sender outside the team, whose mail lands in the legacy Run: no reply settles it.
  await client.call('orchestration.send', {
    from: 'term_gone_e2e',
    to: lead,
    type: 'escalation',
    subject: 'Blocked: CI',
    body: 'CI is red on main and I cannot rerun it.'
  })
  let stuckId = ''
  await expect
    .poll(async () => {
      const read = await client.call<GameInboxThreads>('game.inboxThreads', { worktreeId })
      const row = read.result.waiting.find((one) => one.subject === 'Blocked: CI')
      stuckId = row?.stuck ? row.id : ''
      return row?.stuck
    })
    .toBeTruthy()

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  const panel = orcaPage.getByTestId('team-panel')
  await panel.getByRole('tab', { name: /Inbox/ }).click()
  const inbox = panel.getByTestId('team-panel-inbox')
  await inbox.getByRole('tab', { name: /Waiting/ }).click()
  const row = inbox.getByTestId(`team-inbox-waiting-${stuckId}`)
  await expect(row).toBeVisible({ timeout: 60_000 })
  await expect(row.getByRole('button', { name: 'Answer' })).toHaveCount(0)
  await expect(row).toContainText('No reply can reach it')

  const defaultWidth = await orcaPage.evaluate(() => window.__store!.getState().rightSidebarWidth)
  const capture = async (step: string, scroller: Locator, shown: Locator): Promise<void> => {
    for (const [name, width] of [
      ['min', MIN_WIDTH],
      ['default', defaultWidth],
      ['max', MAX_REQUEST]
    ] as const) {
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
      await orcaPage.evaluate(
        (next) => window.__store!.setState({ rightSidebarWidth: next }),
        width
      )
      await expect(shown).toBeVisible()
      const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(overflow, `${step} overflows the panel at its ${name} width`).toBe(0)
      await expectPlaceholdersFit(scroller, `in ${step} at the ${name} width`)
      await panel.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`inbox-dismiss-${step}-${name}.png`)
      })
    }
    await orcaPage.evaluate(
      (next) => window.__store!.setState({ rightSidebarWidth: next }),
      defaultWidth
    )
  }

  await capture('closed', inbox, row)
  // Confirm first: the first Dismiss only asks why.
  await row.getByRole('button', { name: 'Dismiss' }).click()
  const confirm = row.getByRole('button', { name: 'Dismiss' })
  await expect(confirm).toBeDisabled()
  await row
    .getByRole('textbox', { name: 'Why you dismiss it' })
    .fill('Sender is gone; noted on ORCA-1482')
  await capture('confirm', inbox, row)
  await confirm.click()

  await expect(row).toHaveCount(0, { timeout: 30_000 })
  // The watch reads game state's waiting list; the audit note stays in the lead's inbox.
  const leadInbox = async () =>
    (
      await client.call<{ inbox: { waiting: { id: string }[]; messages: { body: string }[] } }>(
        'game.inbox',
        { terminalHandle: lead }
      )
    ).result.inbox
  await expect.poll(async () => (await leadInbox()).waiting).toEqual([])
  expect((await leadInbox()).messages.map((one) => one.body)).toContainEqual(
    `Settled ${stuckId} without a reply (inbox): Sender is gone; noted on ORCA-1482`
  )
  await capture('settled', inbox, inbox.getByText('No member is waiting for an answer.'))
})
