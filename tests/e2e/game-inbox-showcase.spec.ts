import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { settleGameInboxSheet } from './helpers/game-inbox-sheet'
import { setTheme } from './helpers/settings-window'
import { showcaseFrame } from './helpers/game-showcase-demo-party'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameOwnerQuestion } from '../../src/shared/orchestrator-game-owner-questions'

// Source frames for the README Inbox GIF: the lead asks the person, the person answers in
// Orca's Inbox, and the answer lands in the lead's mail. Tickets and questions are invented.
test("the lead's question reaches the Inbox and the answer reaches the lead", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(180_000)
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

  // Why a foreground process: a lead pane back at its shell is not a live lead.
  await client.call('terminal.send', {
    terminal: lead,
    text: 'clear; node -e "setInterval(() => {}, 1e9)"',
    enter: true
  })
  await expect
    .poll(async () => {
      const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
        terminalHandle: lead,
        project: 'lumen',
        label: 'Atlas'
      })
      return registered.result.registered
    })
    .toBe(true)

  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await setTheme(orcaPage, 'dark')
  // Why: the one-time sidebar hint fades on its own and would cover the Inbox entry.
  await expect(orcaPage.getByText('Workspace board moved to the bottom bar')).toHaveCount(0, {
    timeout: 15_000
  })
  const ask = (args: { ticket: string; question: string; options: string[]; context: string }) =>
    client.call<{ question: GameOwnerQuestion }>('game.ownerAsk', { worktreeId, ...args })
  const release = await ask({
    ticket: 'lum-14',
    question: 'The offline cache needs 40 MB on older phones. Ship it in 2.3 or wait for 2.4?',
    options: ['Ship in 2.3', 'Wait for 2.4'],
    context: 'https://github.example.com/lumen/app/pull/42'
  })
  await ask({
    ticket: 'lum-17',
    question: 'Use the system share sheet on Android, or keep our own?',
    options: ['System share sheet', 'Keep ours'],
    context: 'The lead pane has the full thread.'
  })

  const entry = orcaPage.getByTestId('game-inbox-entry')
  await expect(entry).toContainText('2')
  await showcaseFrame(orcaPage, testInfo, '01-badge.png')

  await entry.click()
  const sheet = orcaPage.getByTestId('game-inbox-sheet')
  await expect(sheet.locator('[data-game-owner-question]')).toHaveCount(2)
  await settleGameInboxSheet(orcaPage, 1440)
  await showcaseFrame(orcaPage, testInfo, '02-questions.png')

  const card = sheet.locator(`[data-game-owner-question="${release.result.question.id}"]`)
  await card.getByRole('button', { name: 'Ship in 2.3' }).hover()
  await showcaseFrame(orcaPage, testInfo, '03-choose.png')
  await card.getByRole('button', { name: 'Ship in 2.3' }).click()
  await expect(card).toHaveCount(0)
  await expect(entry).toContainText('1')
  await showcaseFrame(orcaPage, testInfo, '04-answered.png')

  const leadMail = async () =>
    (
      await client.call<{ inbox: { messages: { subject: string }[] } }>('game.inbox', {
        terminalHandle: lead
      })
    ).result.inbox.messages.map((one) => one.subject)
  await expect.poll(leadMail).toContainEqual(expect.stringContaining('Owner answered LUM-14'))
})
