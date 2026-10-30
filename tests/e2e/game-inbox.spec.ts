import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { settleGameInboxSheet } from './helpers/game-inbox-sheet'
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

// The person answers the lead's questions in Orca's own Inbox, not in the lead's chat (ORCA-782).
test('the Inbox lists every open question for the person and sends the answer they pick or type', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
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

  const entry = orcaPage.getByTestId('game-inbox-entry')
  await expect(entry).toHaveCount(0)

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

  // Pushed by the runtime: no reload, focus or poll brings the entry in.
  await expect(entry).toBeVisible()
  await expect(entry).toContainText('6')
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(orcaPage, theme)
    await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`game-inbox-entry-1440-${theme}.png`)
    })
  }
  await entry.click()
  const sheet = orcaPage.getByTestId('game-inbox-sheet')
  await expect(sheet.getByText('For you')).toBeVisible()
  await expect(sheet.locator('[data-game-owner-question]')).toHaveCount(6)
  const list = sheet.getByRole('tabpanel', { name: /For you/ })
  // A screenshot of a list that does not scroll proves nothing about the rows below the fold.
  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)

  for (const width of [1440, 768, 390, 320]) {
    await settleGameInboxSheet(orcaPage, width)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      await settleGameInboxSheet(orcaPage, width)
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`game-inbox-${width}-${theme}.png`)
      })
    }
  }
  await settleGameInboxSheet(orcaPage, 1440)

  const optionCard = sheet.locator(`[data-game-owner-question="${byOption.result.question.id}"]`)
  await optionCard.getByRole('button', { name: 'Wait for lab.112' }).click()
  await expect(optionCard).toHaveCount(0)
  expect(await answerOf(byOption.result.question.id)).toBe('Wait for lab.112')

  const textCard = sheet.locator(`[data-game-owner-question="${byText.result.question.id}"]`)
  await textCard.getByRole('textbox', { name: 'Your answer' }).fill('The iMac, it has room')
  await textCard.getByRole('textbox', { name: 'Your answer' }).press('Enter')
  await expect(textCard).toHaveCount(0)
  expect(await answerOf(byText.result.question.id)).toBe('The iMac, it has room')
  await expect(entry).toContainText('4')

  // A question asked while the Inbox is open shows up in it.
  await ask({ question: 'Merge #747 now?', options: ['Yes', 'No'] })
  await expect(sheet.locator('[data-game-owner-question]')).toHaveCount(5)
  await expect(entry).toContainText('5')
})
