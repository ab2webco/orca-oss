import { rm } from 'node:fs/promises'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import {
  execInTerminal,
  sendToTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId
} from './helpers/terminal'
import { claudeVersionOk, startGameBand } from './helpers/orchestrator-game-band'
import { screenText } from './helpers/orchestrator-game-panel-capture'
import { demoLeadState, demoMember, sizeWindow } from './helpers/game-showcase-demo-party'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { startMessagesApi } from './helpers/showcase-messages-api'
import { createShowcaseRepo } from './helpers/showcase-repo'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameOwnerQuestion } from '../../src/shared/orchestrator-game-owner-questions'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site Inbox clip: the owner asks the live lead for a decision it cannot make
// alone, the lead's questions reach Orca's Inbox, and the answer lands in the lead's mail.
const OWNER_PROMPT = 'Offline cache needs 40 MB on older phones. Ask me before it ships.'
const LEAD_ANSWER =
  'That is a product call, so it is in your Inbox with both options and PR #42 for context. ' +
  "I also asked about LUM-17's share sheet; Pico and Juno keep working meanwhile."
const LEAD_ON_ANSWER =
  'You chose Ship in 2.3 for LUM-14. Telling Pico to keep the 40 MB cache and finish #42 for ' +
  'the 2.3 build; the share sheet question is still waiting on you.'

const party = demoLeadState([
  demoMember({
    name: 'Pico',
    ticket: 'LUM-14',
    title: 'Offline cache for the feed',
    state: 'waiting',
    pr: { number: 42, ci: 'success', state: 'open' }
  }),
  demoMember({
    name: 'Juno',
    ticket: 'LUM-17',
    title: 'Share sheet on Android',
    state: 'working',
    tool: 'Edit'
  })
])

test("the lead's question reaches the Inbox and the answer reaches the lead", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  // Why a fallback: CI has no Claude Code, and the Inbox round trip must still run there.
  const live = claudeVersionOk()
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  await sizeWindow(electronApp, 1440, 900)
  const repo = createShowcaseRepo()
  const api = await startMessagesApi([
    { match: /ask me before it ships/i, text: LEAD_ANSWER },
    // Why: Orca tells the lead it has mail, and the owner's answer is in it.
    { match: /orchestration message/i, text: LEAD_ON_ANSWER }
  ])
  const band = live
    ? await startGameBand(orcaPage, repo, {
        state: party,
        theme: 'dark',
        locale: 'en',
        showcase: { apiUrl: api.url }
      })
    : null
  try {
    if (band) {
      await expect.poll(async () => screenText(orcaPage), { timeout: 60_000 }).toContain('Juno')
    } else {
      await attachRepoAndOpenTerminal(orcaPage, repo)
      await ensureTerminalVisible(orcaPage)
      // Why a foreground process: a lead pane back at its shell is not a live lead.
      await execInTerminal(
        orcaPage,
        await waitForActivePanePtyId(orcaPage),
        'clear; node -e "setInterval(() => {}, 1e9)"'
      )
    }
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const pane = await waitForActivePaneHookDescriptor(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    const resolved = await client.call<{ terminal: { handle: string; ptyId?: string } }>(
      'terminal.resolvePane',
      { paneKey: pane.paneKey }
    )
    const lead = resolved.result.terminal.handle
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
    // Why: the band closes the sidebars, and the Inbox entry lives in the left one.
    await orcaPage.evaluate(() => window.__store!.getState().setSidebarOpen(true))
    const entry = orcaPage.getByTestId('game-inbox-entry')
    // Why: the one-time sidebar hint fades on its own and would cover the Inbox entry.
    await expect(orcaPage.getByText('Workspace board moved to the bottom bar')).toHaveCount(0, {
      timeout: 15_000
    })
    await orcaPage.waitForTimeout(1_000)

    const clip = await showcaseClip(electronApp, testInfo, 'owner-inbox')
    await orcaPage.waitForTimeout(1_000)
    if (live) {
      const ptyId = await waitForActivePanePtyId(orcaPage)
      for (const word of OWNER_PROMPT.match(/\S+\s*/g) ?? []) {
        await sendToTerminal(orcaPage, ptyId, word)
        await orcaPage.waitForTimeout(70)
      }
      await sendToTerminal(orcaPage, ptyId, '\r')
      await expect.poll(() => api.prompts.length, { timeout: 20_000 }).toBe(1)
      await expect
        .poll(async () => screenText(orcaPage), { timeout: 20_000 })
        .toContain('keep working')
    }

    const ask = (args: { ticket: string; question: string; options: string[]; context: string }) =>
      client.call<{ question: GameOwnerQuestion }>('game.ownerAsk', { worktreeId, ...args })
    const release = await ask({
      ticket: 'lum-14',
      question: 'The offline cache needs 40 MB on older phones. Ship it in 2.3 or wait for 2.4?',
      options: ['Ship in 2.3', 'Wait for 2.4'],
      context: 'https://github.example.com/lumen/app/pull/42'
    })
    await orcaPage.waitForTimeout(600)
    await ask({
      ticket: 'lum-17',
      question: 'Use the system share sheet on Android, or keep our own?',
      options: ['System share sheet', 'Keep ours'],
      context: 'The lead pane has the full thread.'
    })
    await expect(entry).toContainText('2')
    await orcaPage.waitForTimeout(1_500)

    await entry.click()
    const sheet = orcaPage.getByTestId('game-inbox-sheet')
    await expect(sheet.locator('[data-game-owner-question]')).toHaveCount(2)
    await expect(sheet).toHaveAttribute('data-state', 'open')
    await orcaPage.waitForTimeout(1_800)

    const card = sheet.locator(`[data-game-owner-question="${release.result.question.id}"]`)
    await card.getByRole('button', { name: 'Ship in 2.3' }).hover()
    await orcaPage.waitForTimeout(900)
    await card.getByRole('button', { name: 'Ship in 2.3' }).click()
    await expect(card).toHaveCount(0)
    await expect(entry).toContainText('1')

    const leadMail = async () =>
      (
        await client.call<{ inbox: { messages: { subject: string }[] } }>('game.inbox', {
          terminalHandle: lead
        })
      ).result.inbox.messages.map((one) => one.subject)
    await expect.poll(leadMail).toContainEqual(expect.stringContaining('Owner answered LUM-14'))
    await orcaPage.waitForTimeout(1_200)
    await orcaPage.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    if (live) {
      await expect
        .poll(async () => screenText(orcaPage), { timeout: 30_000 })
        .toContain('finish #42 for the 2.3 build')
    }
    await orcaPage.waitForTimeout(2_500)
    await clip.stop()
  } finally {
    await api.close()
    if (band) {
      await rm(band.root, { recursive: true, force: true })
    }
  }
})
