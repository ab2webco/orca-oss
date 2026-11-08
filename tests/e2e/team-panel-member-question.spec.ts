/**
 * Needs E2E: a launched member's AskUserQuestion rides the real /hook/claude server into agent
 * status, its card sends the person to the Inbox, and the answer reaches its real PTY (ORCA-1141 N1).
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import { RuntimeClient } from '../../src/cli/runtime-client'

const QUESTION = 'Rebase on #1077 before the PR?'
const OPTIONS = ['Rebase now', 'Leave it']
// Why 20 s: the Team model's poll; acceptance is "within one poll".
const TEAM_POLL_MS = 20_000
// Why gated: every width and theme is evidence for a reviewer, too slow for each CI run.
const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'
const WIDTHS = [1440, 768, 390, 320]

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(() =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

/** The Team panel in Spanish at each width and theme, to sit beside V28's inbox-foryou. */
async function capturePanel(page: Page, panel: Locator, name: string, testInfo: TestInfo) {
  if (!CAPTURE) {
    return
  }
  await page.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'es' }))
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(page, theme)
      const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(overflow, `${name} overflows at ${width}px ${theme}`).toBe(0)
      await panel.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`${name}-${width}-${theme}.png`)
      })
    }
  }
  await page.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
  await page.setViewportSize({ width: 1440, height: 900 })
}

/** A Codex-looking agent that reads keys raw, as Claude's selector does, and logs every byte. */
function createRawKeyAgent(): { command: string; keys: () => string; dispose: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-member-ask-'))
  const ledger = path.join(dir, 'keys.log')
  const source = `const { appendFileSync } = require('node:fs')
process.stdout.write('\\u001b]0;Codex Ready\\u0007OpenAI Codex\\nmodel: e2e\\ndirectory: e2e\\n')
process.stdin.setRawMode?.(true)
process.stdin.on('data', (chunk) => appendFileSync(${JSON.stringify(ledger)}, chunk.toString()))
process.stdin.resume()
setInterval(() => {}, 60_000)
`
  let command = path.join(dir, 'agent')
  if (process.platform === 'win32') {
    writeFileSync(path.join(dir, 'agent.js'), source)
    command = path.join(dir, 'agent.cmd')
    writeFileSync(command, '@echo off\r\nnode "%~dp0\\agent.js" %*\r\n')
  } else {
    writeFileSync(command, `#!/usr/bin/env node\n${source}`)
    chmodSync(command, 0o755)
  }
  return {
    command,
    keys: () => (existsSync(ledger) ? readFileSync(ledger, 'utf8') : ''),
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}

async function setPlugins(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(
    (next) =>
      window.__store!.getState().updateSettings({ pluginSystemEnabled: next, uiLanguage: 'en' }),
    enabled
  )
}

for (const plugins of [false, true]) {
  const label = plugins ? 'plugins on' : 'plugins off'

  test(`a member's own question shows in its team Inbox and its answer reaches the member (${label})`, async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    test.setTimeout(300_000)
    const agent = createRawKeyAgent()
    try {
      await waitForSessionReady(orcaPage)
      const worktreeId = await waitForActiveWorktree(orcaPage)
      await ensureTerminalVisible(orcaPage)
      await waitForActivePanePtyId(orcaPage)
      await setPlugins(orcaPage, plugins)
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
      // Why wait: workerStart resolves the worktree from the runtime's scan, which can lag launch.
      await expect
        .poll(
          async () =>
            (
              await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
            ).result.worktrees.some((one) => one.id === worktreeId),
          { timeout: 60_000, message: "the runtime never listed the lead's worktree" }
        )
        .toBe(true)
      const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
        objective: 'Member question',
        from: lead
      })
      const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
        spec: 'Work on ORCA-12',
        taskTitle: 'ORCA-12',
        run: run.result.run.id,
        callerTerminalHandle: lead
      })
      const launched = await client.call<{
        effects: { kind: string; role?: string; id?: string }[]
      }>('orchestration.workerStart', {
        task: task.result.task.id,
        from: lead,
        worktree: `id:${worktreeId}`,
        displayName: 'ORCA-12',
        agent: 'codex',
        timeoutMs: 20_000
      })
      const member = launched.result.effects.find(
        (effect) => effect.kind === 'terminal' && effect.role === 'agent'
      )?.id
      expect(member, 'workerStart opened no agent terminal for ORCA-12').toBeTruthy()

      const shown = await client.call<{ terminal: { tabId: string; leafId: string } }>(
        'terminal.show',
        { terminal: member }
      )
      const memberPaneKey = `${shown.result.terminal.tabId}:${shown.result.terminal.leafId}`

      // Claude 2.1.x reports a pending AskUserQuestion as a PermissionRequest.
      const endpoint = await readHookEndpoint(electronApp)
      const postHook = async (payload: Record<string, unknown>): Promise<void> => {
        const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/claude`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Orca-Agent-Hook-Token': endpoint.token
          },
          body: JSON.stringify({
            paneKey: memberPaneKey,
            tabId: shown.result.terminal.tabId,
            worktreeId,
            env: endpoint.env,
            version: endpoint.version,
            payload
          })
        })
        expect(response.status).toBe(204)
      }
      // Why a prompt first: game.state lists an agent only once its hooks report one.
      await postHook({ hook_event_name: 'UserPromptSubmit', prompt: 'Work on ORCA-12' })
      await orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        state.setRightSidebarOpen(true)
        state.setRightSidebarTab('team')
      })
      const panel = orcaPage.getByTestId('team-panel')
      const card = panel.locator(`[data-team-card="member"][data-pane-key="${memberPaneKey}"]`)
      await expect(card).toBeVisible({ timeout: 90_000 })

      await postHook({
        hook_event_name: 'PermissionRequest',
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: [
            {
              question: QUESTION,
              header: 'Rebase',
              multiSelect: false,
              options: OPTIONS.map((one) => ({ label: one }))
            }
          ]
        }
      })
      const asked = Date.now()

      // For you reads agent status, so the question must show within one Team poll.
      const inboxTab = panel.getByRole('tab', { name: /Inbox/ })
      await inboxTab.click()
      const inbox = panel.getByTestId('team-panel-inbox')
      const question = inbox.locator(`[data-team-inbox-agent="${memberPaneKey}"]`)
      await expect(question).toContainText(QUESTION, { timeout: TEAM_POLL_MS })
      testInfo.annotations.push({
        type: 'for-you-after-ms',
        description: String(Date.now() - asked)
      })
      await expect(question).toContainText('ORCA-12')
      await expect(inbox.getByRole('tab', { name: /For you/ })).toContainText('1')
      await expect(inboxTab).toContainText('1')

      // Why two polls: the card's cue comes from game.state on the Team poll, not agent status.
      await panel.getByRole('tab', { name: /^Team/ }).click()
      const answerInInbox = card.getByRole('button', { name: 'Answer in Inbox' })
      await expect(answerInInbox).toBeVisible({ timeout: 2 * TEAM_POLL_MS + 5_000 })
      if (!plugins) {
        await capturePanel(orcaPage, panel, 'member-card-cue', testInfo)
      }
      await answerInInbox.click()
      await expect(inboxTab).toHaveAttribute('aria-selected', 'true')
      await expect(question).toContainText(QUESTION)
      if (!plugins) {
        await capturePanel(orcaPage, panel, 'member-inbox-foryou', testInfo)
      }

      // Why (ORCA-1141): a member in the lead's worktree had its Open terminal button disabled.
      await orcaPage.evaluate(
        (tabId) => window.__store!.getState().setActiveTab(tabId),
        pane.paneKey.split(':')[0]
      )
      const openTerminal = question.getByRole('button', { name: 'Open terminal' })
      await expect(openTerminal).toBeEnabled()
      await openTerminal.click()
      await expect
        .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeTabId))
        .toBe(shown.result.terminal.tabId)

      // Why the tail: the member's brief was typed into the same ledger before the answer.
      const before = agent.keys().length
      await question.getByRole('button', { name: OPTIONS[1] }).click()
      // Why '2': Claude's selector commits on the option's 1-based number.
      await expect.poll(() => agent.keys().slice(before), { timeout: 15_000 }).toBe('2')

      // Claude reports the answered tool and moves on; For you then empties.
      await postHook({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' })
      await expect(question).toHaveCount(0, { timeout: TEAM_POLL_MS })
      await expect(panel.getByText('Nothing waits for you')).toBeVisible()
      await expect(inboxTab).not.toContainText('1')
      if (!plugins) {
        await capturePanel(orcaPage, panel, 'member-after-answer', testInfo)
      }
    } finally {
      agent.dispose()
    }
  })
}
