import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { settleGameInboxSheet } from './helpers/game-inbox-sheet'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameOwnerQuestion } from '../../src/shared/orchestrator-game-owner-questions'

const WIDTHS = [1440, 768, 390, 320]
// The types a lead's report watcher passes.
const LEAD_WATCH_TYPES = 'worker_done,escalation,question,decision_gate'

type Mail = { messages: { from_handle: string; type: string; subject: string; run_id: string }[] }

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

// A lead rotated with `game lead --fresh` has no Run until it dispatches; the person's Inbox answer
// was held unheard while its watch slept, and the Inbox still read it as answered (ORCA-1100).
test('an Inbox answer wakes a lead that has no Run, and a held one shows until it reaches the next lead', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActivePanePtyId(orcaPage)
  const pane = await waitForActivePaneHookDescriptor(orcaPage)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 90_000, null, null)
  const lead = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey: pane.paneKey
    })
  ).result.terminal.handle
  const startLead = async (): Promise<void> => {
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
  }
  const ask = async (question: string) =>
    (
      await client.call<{ question: GameOwnerQuestion }>('game.ownerAsk', {
        terminalHandle: lead,
        ticket: 'orca-1100',
        question,
        options: ['Yes', 'No']
      })
    ).result.question
  await startLead()
  expect(
    (await client.call<{ run: unknown }>('orchestration.runCurrent', { from: lead })).result.run
  ).toBeNull()

  // The lead parks on its watch exactly as `orchestration check --wait --watch` does.
  const first = await ask('Does the warning still show?')
  const watching = client.call<Mail>('orchestration.check', {
    terminal: lead,
    types: LEAD_WATCH_TYPES,
    wait: true,
    timeoutMs: 60_000
  })
  // Why a settle: the waiter must be parked before the answer, or this proves a plain read.
  await orcaPage.waitForTimeout(1_000)

  const entry = orcaPage.getByTestId('game-inbox-entry')
  await expect(entry).toBeVisible()
  await entry.click()
  const sheet = orcaPage.getByTestId('game-inbox-sheet')
  const card = sheet.locator(`[data-game-owner-question="${first.id}"]`)
  await card.getByRole('button', { name: 'No' }).click()
  await expect(card).toHaveCount(0)

  const woke = (await watching).result.messages
  expect(woke).toMatchObject([
    { from_handle: 'owner', type: 'escalation', subject: expect.stringContaining('ORCA-1100') }
  ])
  await expect(sheet.getByTestId('game-inbox-undelivered')).toHaveCount(0)

  // With the lead pane back at its shell, no lead can take an answer: the Inbox says so.
  await client.call('terminal.send', { terminal: lead, text: '\u0003' })
  const second = await ask('Merge #951 now?')
  await expect(sheet.locator(`[data-game-owner-question="${second.id}"]`)).toBeVisible()
  await sheet
    .locator(`[data-game-owner-question="${second.id}"]`)
    .getByRole('button', { name: 'Yes' })
    .click()
  const notice = sheet.getByTestId('game-inbox-undelivered')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Merge #951 now?')
  for (const width of WIDTHS) {
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      await settleGameInboxSheet(orcaPage, width)
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`game-inbox-undelivered-${width}-${theme}.png`)
      })
    }
  }
  await settleGameInboxSheet(orcaPage, 1440)

  // The next lead takes it on registering, with no read of its own, and the notice goes.
  await startLead()
  await expect(notice).toHaveCount(0, { timeout: 30_000 })
  const kept = await client.call<{ questions: GameOwnerQuestion[] }>('game.ownerQuestions', {
    terminalHandle: lead,
    all: true
  })
  expect(kept.result.questions.find((one) => one.id === second.id)?.answer).toEqual({
    text: 'Yes',
    at: expect.any(String)
  })
  const mail = await client.call<Mail>('orchestration.check', {
    terminal: lead,
    types: LEAD_WATCH_TYPES
  })
  expect(mail.result.messages).toMatchObject([
    { from_handle: 'owner', type: 'escalation', subject: expect.stringContaining('Merge #951') }
  ])
})
