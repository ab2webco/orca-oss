import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { expectPlaceholdersFit } from './helpers/placeholder-fit'
import { openTeamInbox, postLeadAgentRow } from './helpers/team-panel-inbox'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameOwnerQuestion } from '../../src/shared/orchestrator-game-owner-questions'

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

// The person answers the lead's questions in Orca's own Inbox, not in the lead's chat (ORCA-782);
// since ORCA-1072 that Inbox is the Team panel's tab.
test('the Inbox lists every open question for the person and sends the answer they pick or type', async ({
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
  await postLeadAgentRow(electronApp, { paneKey: pane.paneKey, worktreeId })
  const ask = (args: { ticket?: string; question: string; options?: string[]; context?: string }) =>
    client.call<{ question: GameOwnerQuestion }>('game.ownerAsk', {
      worktreeId,
      ...args
    })
  const answerOf = async (id: string) =>
    (
      await client.call<{ questions: GameOwnerQuestion[] }>('game.ownerQuestions', {
        worktreeId,
        all: true
      })
    ).result.questions.find((one) => one.id === id)?.answer?.text ?? null

  const { inboxTab, inbox } = await openTeamInbox(orcaPage)
  await expect(inboxTab).toHaveText('Inbox')

  const byOption = await ask({
    ticket: 'orca-782',
    question: 'Ship the arcade in lab.111?',
    options: ['Yes', 'Wait for lab.112'],
    context: 'https://example.test/pr/41'
  })
  const byText = await ask({
    ticket: 'orca-790',
    question: 'Which host takes the next member?'
  })
  for (let index = 3; index <= 6; index += 1) {
    await ask({
      ticket: `orca-80${index}`,
      question: `Question ${index}: keep the release scope as planned, or move this ticket out?`,
      options: ['Keep it', 'Move it out', 'Ask me again tomorrow'],
      context: 'The lead pane has the full thread.'
    })
  }

  // Pushed by the runtime: no reload, focus or poll brings the count in.
  await expect(inboxTab).toContainText('6', { timeout: 15_000 })
  await expect(inbox.getByRole('tab', { name: /For you/ })).toHaveAttribute('aria-selected', 'true')
  await expect(inbox.locator('[data-game-owner-question]')).toHaveCount(6)
  // A screenshot of a list that does not scroll proves nothing about the rows below the fold.
  expect(
    await inbox.evaluate((node) => {
      const scroller = node.parentElement
      return scroller ? scroller.scrollHeight > scroller.clientHeight : false
    })
  ).toBe(true)

  for (const width of [1440, 768, 390, 320]) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      await expectPlaceholdersFit(inbox, `at ${width}px ${theme}`)
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`game-inbox-${width}-${theme}.png`)
      })
    }
  }
  await orcaPage.setViewportSize({ width: 1440, height: 900 })

  const optionCard = inbox.locator(`[data-game-owner-question="${byOption.result.question.id}"]`)
  await optionCard.getByRole('button', { name: 'Wait for lab.112' }).click()
  await expect(optionCard).toHaveCount(0)
  expect(await answerOf(byOption.result.question.id)).toBe('Wait for lab.112')

  const textCard = inbox.locator(`[data-game-owner-question="${byText.result.question.id}"]`)
  await textCard.getByRole('textbox', { name: 'Your answer' }).fill('The iMac, it has room')
  await textCard.getByRole('textbox', { name: 'Your answer' }).press('Enter')
  await expect(textCard).toHaveCount(0)
  expect(await answerOf(byText.result.question.id)).toBe('The iMac, it has room')
  await expect(inboxTab).toContainText('4')

  // A question asked while the Inbox is open shows up in it.
  await ask({ question: 'Merge #747 now?', options: ['Yes', 'No'] })
  await expect(inbox.locator('[data-game-owner-question]')).toHaveCount(5)
  await expect(inboxTab).toContainText('5')
})
