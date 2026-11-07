import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { expectPlaceholdersFit } from './helpers/placeholder-fit'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { GameInboxThreads } from '../../src/shared/orchestrator-game-inbox-threads'

// Why gated: every width, theme and language is evidence for a reviewer, too slow for each CI run.
const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'
const WIDTHS = CAPTURE ? [1440, 768, 390, 320] : [320]
const THEMES = CAPTURE ? (['dark', 'light'] as const) : (['dark'] as const)
const SUBS = {
  en: { forYou: 'For you', waiting: 'Waiting', threads: 'Threads', answered: 'Answered' },
  es: { forYou: 'Para ti', waiting: 'Esperando', threads: 'Hilos', answered: 'Respondidas' }
} as const
const INBOX = { en: 'Inbox', es: 'Bandeja' } as const

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

function createOtherRepo(): string {
  const repoPath = mkdtempSync(path.join(os.tmpdir(), 'orca-inbox-tab-other-'))
  writeFileSync(path.join(repoPath, 'README.md'), 'other project\n')
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath })
  execFileSync('git', ['add', '.'], { cwd: repoPath })
  execFileSync(
    'git',
    ['-c', 'user.name=Orca E2E', '-c', 'user.email=orca-e2e@example.com', 'commit', '-m', 'seed'],
    { cwd: repoPath }
  )
  return repoPath
}

// The Inbox tab reads the real board, threads and every project's questions (ORCA-1072).
test('the Inbox tab holds every question for you, the lead mail and its answers', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const agent = createStdinLoggingAgent()
  const otherRepo = createOtherRepo()
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
        uiLanguage: 'en',
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
    const endpoint = await readHookEndpoint(electronApp)
    await emitCodexHookStatus(endpoint, {
      paneKey: pane.paneKey,
      worktreeId,
      state: 'working',
      prompt: 'Lead the team'
    })

    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const inboxTab = panel.getByRole('tab', { name: /Inbox|Bandeja/ })
    await expect(panel.locator('[data-team-card="lead"]')).toBeVisible({ timeout: 90_000 })
    await inboxTab.click()

    const capture = async (name: string, scroller: Locator | null): Promise<void> => {
      for (const language of ['en', 'es'] as const) {
        await orcaPage.evaluate(
          (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
          language
        )
        await expect(inboxTab).toContainText(INBOX[language])
        for (const width of WIDTHS) {
          await orcaPage.setViewportSize({ width, height: 900 })
          for (const theme of THEMES) {
            await setTheme(orcaPage, theme)
            const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
            expect(overflow, `${name} overflows at ${width}px ${theme} ${language}`).toBe(0)
            if (scroller) {
              const wide = await scroller.evaluate((node) => node.scrollWidth - node.clientWidth)
              expect(wide, `${name} list is cut at ${width}px ${theme} ${language}`).toBe(0)
              await expectPlaceholdersFit(scroller, `in ${name} at ${width}px ${theme} ${language}`)
              // A wrapped sub-tab bar must push the list down, not draw over it.
              const overlap = await scroller.evaluate((node) => {
                // Why the tabs, not the list: a fixed-height list keeps its box while tabs spill out.
                const bottom = Math.max(
                  ...[...node.querySelectorAll('[role="tab"]')].map(
                    (tab) => tab.getBoundingClientRect().bottom
                  )
                )
                const list = node
                  .querySelector('[role="tabpanel"][data-state="active"]')
                  ?.getBoundingClientRect()
                return list ? bottom - list.top : 0
              })
              expect(
                overlap,
                `${name} tabs cover the list at ${width}px ${language}`
              ).toBeLessThanOrEqual(0.5)
            }
            if (CAPTURE) {
              await orcaPage.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(`inbox-${name}-${language}-${width}-${theme}.png`)
              })
            }
          }
        }
      }
      await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
    }

    // Empty: a lead with no question, no member mail and no other project asking.
    await expect(panel.getByText('Nothing waits for you')).toBeVisible({ timeout: 60_000 })
    await capture('empty', null)

    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Inbox tab',
      from: lead
    })
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on ORCA-12',
      taskTitle: 'ORCA-12',
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const started = await client.call<{ effects: { kind: string; role?: string; id?: string }[] }>(
      'orchestration.workerStart',
      {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: 'ORCA-12',
        agent: 'codex',
        timeoutMs: 20_000
      }
    )
    const member = started.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    expect(member, 'workerStart opened no agent terminal').toBeTruthy()
    const send = (from: string, to: string, type: string, subject: string, body: string) =>
      client.call('orchestration.send', { from, to, type, subject, body })
    await send(member!, lead, 'status', 'Reading the ticket', 'Reading ORCA-12.')
    await send(member!, lead, 'decision_gate', 'Port?', 'Which port should the preview use?')
    const waitingId = async (text: string): Promise<string> => {
      let id: string | undefined
      await expect
        .poll(async () => {
          const read = await client.call<GameInboxThreads>('game.inboxThreads', { worktreeId })
          id = read.result.waiting.find((one) => one.body.includes(text))?.id
          return id
        })
        .toBeTruthy()
      return id!
    }
    await client.call('orchestration.reply', {
      id: await waitingId('Which port'),
      body: 'Use 8080',
      from: lead
    })
    // Why after the reply: the lead's reply settles every gate the member had open.
    // A real `orchestration ask`, with the member's own dispatch capability from its preamble.
    let capability: string | null = null
    await expect
      .poll(
        () => {
          capability =
            new RegExp(
              `Your task ID is: ${task.result.task.id}[\\s\\S]*?--dispatch-capability (dcap_[A-Za-z0-9_-]+)`
            ).exec(agent.readStdin())?.[1] ?? null
          return capability
        },
        { timeout: 60_000, message: 'the member never got its dispatch capability' }
      )
      .not.toBeNull()
    // Why not awaited: ask blocks until the lead answers, and this one is left for the lead.
    void client
      .call(
        'orchestration.ask',
        { from: member!, question: 'Rebase #917 now or wait for #913?', timeoutMs: 240_000 },
        { orchestrationCapability: capability! }
      )
      .catch(() => {})
    await waitingId('Rebase #917')

    await client.call('game.ownerAsk', {
      worktreeId,
      terminalHandle: lead,
      ticket: 'ORCA-12',
      question: 'Merge #923 now or wait for #915 first?',
      options: ['Merge now', 'Wait for #915']
    })
    const added = await client.call<{ repo: { id: string; displayName: string } }>('repo.add', {
      path: otherRepo,
      kind: 'git'
    })
    const otherName = added.result.repo.displayName
    await orcaPage.evaluate(async () => {
      await window.__store?.getState().fetchRepos()
    })
    await client.call('game.ownerAsk', {
      worktreeId: `${added.result.repo.id}::${otherRepo}`,
      ticket: 'WEB-212',
      question: 'Ship the price change today or tomorrow?',
      options: ['Today', 'Tomorrow']
    })
    await orcaPage.evaluate(() => window.dispatchEvent(new Event('focus')))

    // Full: this project's question and the other project's, counted once on the tab.
    const inbox = panel.getByTestId('team-panel-inbox')
    await expect(inboxTab).toContainText('2', { timeout: 60_000 })
    await expect(inbox.getByText('Merge #923 now or wait for #915 first?')).toBeVisible({
      timeout: 60_000
    })
    await expect(inbox.getByText('Ship the price change today or tomorrow?')).toBeVisible()
    await expect(inbox.getByText(`${otherName}`, { exact: false }).first()).toBeVisible()
    // ORCA-780: the member's ask is the lead's to answer; it reaches you only through the lead.
    const needsYou = inbox.locator('[data-needs-you="true"]')
    await expect(needsYou).toHaveCount(1)
    await expect(needsYou).toContainText('Needs you')
    await expect(needsYou).toContainText('ORCA-12')
    await expect(needsYou).toContainText('Merge #923 now or wait for #915 first?')
    await expect(inbox.getByText(/Rebase #917 now or wait for #913\?/)).toHaveCount(0)
    await capture('for-you', inbox)

    for (const [key, name] of [
      ['waiting', 'waiting'],
      ['threads', 'threads'],
      ['answered', 'answered']
    ] as const) {
      await inbox.getByRole('tab', { name: new RegExp(SUBS.en[key]) }).click()
      await expect(inbox.getByRole('tab', { name: new RegExp(SUBS.en[key]) })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      if (key === 'waiting') {
        await expect(inbox.getByText(/Rebase #917 now or wait for #913\?/)).toBeVisible()
        // Opened so the reply box behind Answer is measured too.
        await inbox.getByRole('button', { name: 'Answer' }).click()
      } else if (key === 'threads') {
        await expect(inbox.getByTestId('game-inbox-thread-ORCA-12')).toBeVisible()
      } else {
        await expect(inbox.getByText('Use 8080')).toBeVisible()
        // Opened so the override box is measured too.
        await inbox.getByRole('button', { name: 'Override' }).click()
      }
      await capture(name, inbox)
    }

    // Answering another project's question from here removes it and lowers the one count.
    await inbox.getByRole('tab', { name: /For you/ }).click()
    await inbox.getByRole('button', { name: 'Today' }).click()
    await expect(inbox.getByText('Ship the price change today or tomorrow?')).toHaveCount(0, {
      timeout: 60_000
    })
    await expect(inboxTab).toContainText('1', { timeout: 60_000 })

    // Answering this project's question moves it to Answered, under what you answered.
    await inbox.getByRole('button', { name: 'Merge now' }).click()
    await expect(inbox.getByText('Merge #923 now or wait for #915 first?')).toHaveCount(0, {
      timeout: 60_000
    })
    // Why 5 s: the badge follows the answer's change push, not the 20 s model poll.
    await expect(inboxTab).not.toContainText('1', { timeout: 5_000 })
    await inbox.getByRole('tab', { name: /Answered/ }).click()
    await expect(inbox.getByText('You answered: Merge now')).toBeVisible({ timeout: 60_000 })
    await expect(inbox.getByText('The lead answered: Use 8080')).toBeVisible()
    await capture('answered-yours', inbox)
  } finally {
    agent.dispose()
    rmSync(otherRepo, { recursive: true, force: true })
  }
})
