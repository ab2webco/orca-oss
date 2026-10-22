/**
 * Invariant: a Claude turn that ends with only a Monitor armed reads done, not working, and the
 * Monitor's event waking the agent reads working again (ORCA-719).
 * Needs E2E: the hook sequence crosses the real /hook/claude server, listener and renderer row.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  waitForActivePaneHookDescriptor,
  waitForActiveTerminalManager,
  waitForPaneCount,
  type ActivePaneHookDescriptor
} from './helpers/terminal'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import type { AgentHookEndpoint } from '../../src/shared/agent-hook-endpoint-file'

const WIDTHS = [1440, 768, 390, 320]
// Payload shapes captured from Claude Code 2.1.306.
const MONITOR_INPUT = { description: 'Watch CI', timeout_ms: 300000, command: 'gh run watch' }
const MONITOR_TASK = {
  id: 'bdpbe2bri',
  type: 'shell',
  status: 'running',
  description: 'Watch CI',
  command: 'gh run watch'
}

async function postClaudeHook(
  endpoint: AgentHookEndpoint,
  pane: ActivePaneHookDescriptor,
  payload: Record<string, unknown>
): Promise<void> {
  const [tabId] = pane.paneKey.split(':')
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/hook/claude`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Orca-Agent-Hook-Token': endpoint.token
    },
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

async function paneState(page: Page, paneKey: string): Promise<string | undefined> {
  return page.evaluate(
    (key) => window.__store?.getState().agentStatusByPaneKey[key]?.state,
    paneKey
  )
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

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

test('an idle Claude with only a Monitor armed reads done until the Monitor wakes it', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  await waitForPaneCount(orcaPage, 1, 30_000)
  const pane = await waitForActivePaneHookDescriptor(orcaPage)
  const endpoint = await readHookEndpoint(electronApp)

  await postClaudeHook(endpoint, pane, { hook_event_name: 'UserPromptSubmit', prompt: 'watch CI' })
  await postClaudeHook(endpoint, pane, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Monitor',
    tool_input: MONITOR_INPUT
  })
  await postClaudeHook(endpoint, pane, {
    hook_event_name: 'PostToolUse',
    tool_name: 'Monitor',
    tool_input: MONITOR_INPUT,
    tool_response: { taskId: MONITOR_TASK.id, timeoutMs: 300000, persistent: false }
  })
  await expect.poll(() => paneState(orcaPage, pane.paneKey)).toBe('working')
  await expect(orcaPage.getByLabel('Working', { exact: true }).first()).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('working-before-stop-1440-light.png') })

  await postClaudeHook(endpoint, pane, {
    hook_event_name: 'Stop',
    background_tasks: [MONITOR_TASK],
    session_crons: []
  })
  await expect.poll(() => paneState(orcaPage, pane.paneKey)).toBe('done')
  await expect(orcaPage.getByLabel('Working', { exact: true })).toHaveCount(0)

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(orcaPage, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await orcaPage.screenshot({ path: testInfo.outputPath(`idle-monitor-${width}-${theme}.png`) })
    }
  }

  await setWindowWidth(electronApp, orcaPage, 1440)
  await postClaudeHook(endpoint, pane, {
    hook_event_name: 'UserPromptSubmit',
    prompt: `<task-notification> <task-id>${MONITOR_TASK.id}</task-id> </task-notification>`
  })
  await expect.poll(() => paneState(orcaPage, pane.paneKey)).toBe('working')
  await orcaPage.screenshot({ path: testInfo.outputPath('woken-by-monitor-1440-dark.png') })
})
