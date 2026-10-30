import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { settleGameInboxSheet } from './helpers/game-inbox-sheet'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameInboxThreads } from '../../src/shared/orchestrator-game-inbox-threads'

const WIDTHS = [1440, 768, 390, 320]

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

// The person reads how the lead and each member talk, and what waits on the lead (ORCA-878).
test("the Inbox shows each ticket's thread, what waits on the lead and what it answered", async ({
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
    await orcaPage.evaluate(async (command) => {
      await window.__store?.getState().updateSettings({
        defaultTuiAgent: 'codex',
        agentCmdOverrides: { codex: command },
        agentDefaultArgs: { codex: '' }
      })
    }, agent.command)

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

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Inbox threads',
      from: lead
    })
    const member = async (ticket: string) => {
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: `Work on ${ticket}`,
        taskTitle: ticket,
        run: run.result.run.id,
        callerTerminalHandle: lead
      })
      const started = await client.call<{
        dispatchId: string
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: ticket,
        agent: 'codex',
        timeoutMs: 20_000
      })
      const handle = started.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      expect(handle, `workerStart opened no agent terminal for ${ticket}`).toBeTruthy()
      return { handle: handle!, dispatchId: started.result.dispatchId, taskId: task.result.task.id }
    }
    const busy = await member('ORCA-12')
    const asking = await member('ORCA-14')

    const send = (from: string, to: string, type: string, subject: string, body: string) =>
      client.call('orchestration.send', { from, to, type, subject, body })
    for (let step = 1; step <= 14; step += 1) {
      await send(
        busy.handle,
        lead,
        'status',
        `Step ${step} of the arcade`,
        `Progress note ${step}.`
      )
    }
    await send(lead, busy.handle, 'status', 'Keep going', 'Rebase before the PR.')
    await send(
      busy.handle,
      lead,
      'decision_gate',
      'Ship now?',
      'Ship the arcade in lab.111, or wait for lab.112?'
    )

    // Why its preamble: only the member's own dispatch capability may ask its lead.
    let capability: string | null = null
    await expect
      .poll(
        () => {
          capability =
            new RegExp(
              `Your task ID is: ${asking.taskId}[\\s\\S]*?--dispatch-capability (dcap_[A-Za-z0-9_-]+)`
            ).exec(agent.readStdin())?.[1] ?? null
          return capability
        },
        { timeout: 60_000, message: 'the asking member never got its dispatch capability' }
      )
      .not.toBeNull()
    // Why not awaited: ask blocks until the lead answers.
    let askError: unknown = null
    const ask = (question: string) =>
      client
        .call(
          'orchestration.ask',
          { from: asking.handle, question, timeoutMs: 240_000 },
          { orchestrationCapability: capability! }
        )
        .catch((error: unknown) => {
          askError = error
        })
    void ask('Which port should the preview server use?')
    const pendingQuestion = async (text: string) => {
      let id: string | undefined
      let seen: unknown = null
      try {
        await expect
          .poll(async () => {
            const read = await client.call<GameInboxThreads>('game.inboxThreads', { worktreeId })
            seen = read.result
            id = read.result.waiting.find((one) => one.body.includes(text))?.id
            return id
          })
          .toBeTruthy()
      } catch {
        throw new Error(
          `no waiting question; ask: ${String(askError)}; read: ${JSON.stringify(seen)}`
        )
      }
      return id!
    }
    const portQuestion = await pendingQuestion('Which port')
    await client.call('orchestration.reply', { id: portQuestion, body: '8080', from: lead })
    void ask('May I rename the Inbox tab to Mail?')
    await pendingQuestion('rename the Inbox')

    const entry = orcaPage.getByTestId('game-inbox-entry')
    // Pushed by the runtime as the team's mail lands; nothing is for the person, so no count.
    await expect(entry).toBeVisible()
    await expect(entry).toHaveText('Inbox')
    await entry.click()
    const sheet = orcaPage.getByTestId('game-inbox-sheet')
    await expect(sheet.getByRole('tab', { name: /Waiting/ })).toContainText('2')

    await sheet.getByRole('tab', { name: /Waiting/ }).click()
    await expect(sheet.locator('[data-testid^="game-inbox-waiting-"]')).toHaveCount(2)
    for (const width of WIDTHS) {
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await settleGameInboxSheet(orcaPage, width)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`waiting-${width}-${theme}.png`)
        })
      }
    }
    await settleGameInboxSheet(orcaPage, 1440)

    await sheet.getByRole('tab', { name: /Answered/ }).click()
    const answered = sheet.locator('[data-testid^="game-inbox-answered-"]')
    await expect(answered).toHaveCount(1)
    await expect(answered).toContainText('8080')

    await sheet.getByRole('tab', { name: /Threads/ }).click()
    await expect(sheet.getByTestId('game-inbox-thread-ORCA-12')).toContainText('1 waiting')
    await sheet.getByTestId('game-inbox-thread-ORCA-12').click()
    const messages = sheet.getByTestId('game-inbox-thread-messages')
    await expect(
      messages.getByText('Ship the arcade in lab.111, or wait for lab.112?')
    ).toBeVisible()
    // A screenshot of a list that does not scroll proves nothing about the rows above the fold.
    expect(await messages.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)

    // Mail sent while the thread is open shows up in it, pushed.
    await send(busy.handle, lead, 'escalation', 'Blocked on CI', 'The e2e shard 3 is red.')
    await expect(messages.getByText('Blocked on CI')).toBeVisible()

    for (const width of WIDTHS) {
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await settleGameInboxSheet(orcaPage, width)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`thread-${width}-${theme}.png`)
        })
      }
    }
    await settleGameInboxSheet(orcaPage, 1440)
    await sheet.getByRole('button', { name: /All threads/ }).click()
    await settleGameInboxSheet(orcaPage, 1440)
    await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('threads-1440-light.png')
    })
    await sheet.getByRole('tab', { name: /Answered/ }).click()
    await expect(sheet.getByRole('tab', { name: /Answered/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await settleGameInboxSheet(orcaPage, 1440)
    await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('answered-1440-light.png')
    })
  } finally {
    agent.dispose()
  }
})
