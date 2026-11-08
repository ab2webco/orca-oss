/**
 * Needs E2E: the question rides the real /hook/claude server into agent status, the Inbox reads it
 * there, and the answer is typed into the pane's real PTY (ORCA-1129 D4-D6).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  type ActivePaneHookDescriptor
} from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'

// Why gated: every width, theme and language is evidence for a reviewer, too slow for each CI run.
const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'
const WIDTHS = CAPTURE ? [1440, 768, 390, 320] : [320]
const THEMES = CAPTURE ? (['dark', 'light'] as const) : (['dark'] as const)
const INBOX = { en: 'Inbox', es: 'Bandeja' } as const
const QUESTION = 'Merge #923 now or wait for #915 first?'
const OPTIONS = ['Merge now', 'Wait for #915']

type Dispatched = {
  source: string
  agentQuestion?: string
  gameInbox?: { environmentId: string | null; worktreeId: string | null }
}

/** An agent that reads keys as they are typed, the way Claude's selector does, and logs them. */
function createKeyLoggingAgent(): { script: string; keys: () => string; dispose: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-key-agent-'))
  const ledger = path.join(dir, 'keys.log')
  const script = path.join(dir, 'agent.js')
  writeFileSync(
    script,
    `const { appendFileSync } = require('node:fs')
process.stdin.setRawMode?.(true)
process.stdin.on('data', (chunk) => appendFileSync(${JSON.stringify(ledger)}, chunk.toString()))
process.stdin.resume()
process.stdout.write('waiting for an answer\\n')
setInterval(() => {}, 60_000)
`
  )
  return {
    script,
    keys: () => (existsSync(ledger) ? readFileSync(ledger, 'utf8') : ''),
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}

function createOtherRepo(): string {
  const repoPath = mkdtempSync(path.join(os.tmpdir(), 'orca-agent-questions-other-'))
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

async function postClaudeHook(
  app: ElectronApplication,
  pane: ActivePaneHookDescriptor,
  payload: Record<string, unknown>
): Promise<void> {
  const endpoint = await readHookEndpoint(app)
  const [tabId] = pane.paneKey.split(':')
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': endpoint.token },
    body: JSON.stringify({
      paneKey: pane.paneKey,
      tabId,
      worktreeId: pane.worktreeId,
      env: endpoint.env,
      version: endpoint.version,
      payload
    })
  })
  expect(response.status).toBe(204)
}

/** Claude 2.1.x reports a pending AskUserQuestion as a PermissionRequest. */
async function askThroughHook(app: ElectronApplication, pane: ActivePaneHookDescriptor) {
  await postClaudeHook(app, pane, { hook_event_name: 'UserPromptSubmit', prompt: 'Ship it' })
  await postClaudeHook(app, pane, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [
        {
          question: QUESTION,
          header: 'Merge',
          multiSelect: false,
          options: OPTIONS.map((label) => ({ label }))
        }
      ]
    }
  })
}

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

async function setPlugins(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(
    (next) =>
      window.__store!.getState().updateSettings({ pluginSystemEnabled: next, uiLanguage: 'en' }),
    enabled
  )
}

async function startAgent(page: Page, client: RuntimeClient, script: string): Promise<string> {
  const pane = await waitForActivePaneHookDescriptor(page)
  const handle = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey: pane.paneKey
    })
  ).result.terminal.handle
  await client.call('terminal.send', {
    terminal: handle,
    text: `node ${JSON.stringify(script)}`,
    enter: true
  })
  return handle
}

async function openInbox(page: Page): Promise<{ panel: Locator; inboxTab: Locator }> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  const panel = page.getByTestId('team-panel')
  return { panel, inboxTab: panel.getByRole('tab', { name: /Inbox|Bandeja/ }) }
}

async function captureCard(
  page: Page,
  panel: Locator,
  name: string,
  testInfo: { outputPath: (n: string) => string }
) {
  const inboxTab = panel.getByRole('tab', { name: /Inbox|Bandeja/ })
  for (const language of ['en', 'es'] as const) {
    await page.evaluate(
      (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
      language
    )
    await expect(inboxTab).toContainText(INBOX[language])
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of THEMES) {
        await setTheme(page, theme)
        const card = panel.locator('[data-team-inbox-agent]')
        await expect(card).toBeVisible()
        const overflow = await panel.evaluate((node) => node.scrollWidth - node.clientWidth)
        expect(overflow, `${name} overflows at ${width}px ${theme} ${language}`).toBe(0)
        const cut = await card.evaluate((node) =>
          [...node.querySelectorAll('button')].some((b) => b.scrollWidth > b.clientWidth + 1)
        )
        expect(cut, `${name} cuts a button at ${width}px ${theme} ${language}`).toBe(false)
        if (CAPTURE) {
          await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`${name}-${language}-${width}-${theme}.png`)
          })
        }
      }
    }
  }
  await page.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
  await page.setViewportSize({ width: 1440, height: 900 })
}

// Why 20 s: the Team model's poll; the lead's question must not wait for a second one.
const TEAM_POLL_MS = 20_000

/** No bubble's text may run past its box: a cut path loses characters (ORCA-1129). */
async function expectBubblesFit(page: Page, where: string): Promise<void> {
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll('[data-scene-bubble] > span:first-child')].flatMap((node) =>
      node.scrollWidth > node.clientWidth ? [`${node.scrollWidth}>${node.clientWidth}`] : []
    )
  )
  expect(cut, `a bubble's text overflows ${where}`).toEqual([])
}

async function captureScene(
  page: Page,
  panel: Locator,
  testInfo: { outputPath: (n: string) => string }
): Promise<void> {
  for (const language of ['en', 'es'] as const) {
    await page.evaluate(
      (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
      language
    )
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of THEMES) {
        await setTheme(page, theme)
        await expect(panel.locator('[data-scene-bubble="lead"]')).toContainText(QUESTION)
        await expectBubblesFit(page, `at ${width}px ${theme} ${language}`)
        if (CAPTURE) {
          await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`scene-lead-question-${language}-${width}-${theme}.png`)
          })
        }
      }
    }
  }
  await page.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
  await page.setViewportSize({ width: 1440, height: 900 })
}

for (const plugins of [false, true]) {
  const label = plugins ? 'plugins on' : 'plugins off'

  test(`a lead's own question counts and answers in its team Inbox, never another project's (${label})`, async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    test.setTimeout(300_000)
    const agent = createKeyLoggingAgent()
    const otherRepo = createOtherRepo()
    try {
      await waitForSessionReady(orcaPage)
      const worktreeId = await waitForActiveWorktree(orcaPage)
      await ensureTerminalVisible(orcaPage)
      await waitForActivePanePtyId(orcaPage)
      await setPlugins(orcaPage, plugins)
      const pane = await waitForActivePaneHookDescriptor(orcaPage)
      const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      const client = new RuntimeClient(userDataDir, 30_000, null, null)
      const lead = await startAgent(orcaPage, client, agent.script)
      // Why a live foreground process: a lead pane back at its shell is not a live lead.
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
      const { panel, inboxTab } = await openInbox(orcaPage)
      await expect(panel.locator('[data-team-card="lead"]')).toBeVisible({ timeout: 90_000 })
      await askThroughHook(electronApp, pane)
      const asked = Date.now()

      // The scene's bubble says the question, never the tool's name, and fits its box.
      const bubble = panel.locator('[data-scene-bubble="lead"]')
      await expect(bubble).toHaveText(`Waiting for you · ${QUESTION}`, { timeout: TEAM_POLL_MS })
      await expectBubblesFit(orcaPage, label)
      if (!plugins) {
        await captureScene(orcaPage, panel, testInfo)
      }

      // D4: game.state carries no AskUserQuestion; For you shows it within one model poll.
      await inboxTab.click()
      const inbox = panel.getByTestId('team-panel-inbox')
      const card = inbox.locator(`[data-team-inbox-agent="${pane.paneKey}"]`)
      await expect(card).toContainText(QUESTION, { timeout: TEAM_POLL_MS - (Date.now() - asked) })
      testInfo.annotations.push({
        type: 'for-you-after-ms',
        description: String(Date.now() - asked)
      })
      await expect(inbox.getByRole('tab', { name: /For you/ })).toContainText('1')
      await expect(inboxTab).toContainText('1')
      if (!plugins) {
        await captureCard(orcaPage, panel, 'team-inbox-lead-question', testInfo)
      }

      // D4: another project with no team never shows this lead's question.
      const added = await client.call<{ repo: { id: string } }>('repo.add', {
        path: otherRepo,
        kind: 'git'
      })
      const otherWorktreeId = `${added.result.repo.id}::${otherRepo}`
      await orcaPage.evaluate(async (repoId) => {
        await window.__store!.getState().fetchRepos()
        await window.__store!.getState().fetchWorktrees(repoId)
      }, added.result.repo.id)
      await orcaPage.evaluate(
        (id) => window.__store!.getState().setActiveWorktree(id),
        otherWorktreeId
      )
      await expect(panel.locator('[data-team-card="lead"]')).toHaveCount(0, { timeout: 60_000 })
      await inboxTab.click()
      await expect(panel.getByText('Nothing waits for you')).toBeVisible({ timeout: 30_000 })
      await expect(panel.getByText(QUESTION)).toHaveCount(0)
      await expect(inboxTab).not.toContainText('1')

      // D5: back in its own project, an option button types the answer into the lead's pane.
      await orcaPage.evaluate((id) => window.__store!.getState().setActiveWorktree(id), worktreeId)
      // Why the card, not the lead's: Inbox stays the tab on screen across the switch.
      await expect(card).toBeVisible({ timeout: 90_000 })
      await expect(inboxTab).toContainText('1')
      await card.getByRole('button', { name: 'Wait for #915' }).click()
      // Why '2': Claude's selector commits on the option's 1-based number.
      await expect.poll(agent.keys, { timeout: 15_000 }).toBe('2')
    } finally {
      agent.dispose()
      rmSync(otherRepo, { recursive: true, force: true })
    }
  })
}

test('a no-team question is answered from the Inbox, and its notification opens there', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  const agent = createKeyLoggingAgent()
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActivePanePtyId(orcaPage)
    await setPlugins(orcaPage, false)
    // Why stub in main: the test cannot see an OS banner, only what Orca asked for.
    await electronApp.evaluate(({ ipcMain }) => {
      const seen = globalThis as unknown as { __asked?: unknown[] }
      seen.__asked = []
      ipcMain.removeHandler('notifications:dispatch')
      ipcMain.handle('notifications:dispatch', (_event, args) => {
        seen.__asked?.push(args)
        return { delivered: true }
      })
    })
    const pane = await waitForActivePaneHookDescriptor(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    await startAgent(orcaPage, client, agent.script)
    // Why another worktree: a notification for the pane on screen is not needed.
    await orcaPage.evaluate(() => window.__store!.getState().setActiveView('settings'))
    await askThroughHook(electronApp, pane)

    // D6: the alert carries the question, and its click target is the Inbox.
    let sent: Dispatched | undefined
    await expect
      .poll(
        async () => {
          const asked = await electronApp.evaluate(
            () => (globalThis as unknown as { __asked: Dispatched[] }).__asked
          )
          sent = asked.find((one) => one.agentQuestion !== undefined)
          return sent?.agentQuestion
        },
        { timeout: 30_000 }
      )
      .toBe(QUESTION)
    expect(sent?.gameInbox).toEqual({ environmentId: null, worktreeId })
    // What a click on that notification sends the window.
    await electronApp.evaluate(({ BrowserWindow }, target) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('ui:openGameInbox', target)
    }, sent!.gameInbox)
    const panel = orcaPage.getByTestId('team-panel')
    const inboxTab = panel.getByRole('tab', { name: /Inbox|Bandeja/ })
    await expect(inboxTab).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
    await expect(inboxTab).toContainText('1')
    const card = panel.locator(`[data-team-inbox-agent="${pane.paneKey}"]`)
    await expect(card).toContainText(QUESTION)
    await captureCard(orcaPage, panel, 'solo-inbox-question', testInfo)

    // D5: the first option types '1' into the agent's real PTY, once.
    await card.getByRole('button', { name: 'Merge now' }).click()
    await expect.poll(agent.keys, { timeout: 15_000 }).toBe('1')
    await expect(card.getByRole('button', { name: 'Wait for #915' })).toBeDisabled()
  } finally {
    agent.dispose()
  }
})
