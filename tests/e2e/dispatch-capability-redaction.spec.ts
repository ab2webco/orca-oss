/**
 * Invariant: a dispatch capability in an agent's prompt, tool input or reply is visible on no
 * surface — dashboard rows, the Agents page, sidebar rows — at desktop or phone width (ORCA-1125).
 * Needs E2E: the token rides the real /hook/claude server, main's normalizer and the renderer row.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForTerminalOutput,
  waitForActiveTerminalManager,
  waitForPaneCount,
  type ActivePaneHookDescriptor
} from './helpers/terminal'
import { readHookEndpoint } from './helpers/agent-hook-endpoint'
import type { AgentHookEndpoint } from '../../src/shared/agent-hook-endpoint-file'

const CAPABILITY = `dcap_${'Q'.repeat(20)}e2e${'Z'.repeat(20)}`
// The three ways a capability reaches text: a spaced flag, an `=` flag and a bare token.
const COMMAND = `orca orchestration send --dispatch-capability ${CAPABILITY} --type heartbeat`
const ASK = `orca orchestration ask --dispatch-capability=${CAPABILITY} --question "Merge?"`
const REPLY = `Heartbeat sent; my capability is ${CAPABILITY}.`
const WIDTHS = [1440, 390]
// Why the body too: a token wrapped across terminal rows leaves its tail without the prefix.
const LEAK = /dcap_|QQQQ|ZZZZ/

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

/** The main window floors at 600px, so phone widths need the floor lifted first. */
async function setWindowWidth(app: ElectronApplication, page: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window_ = BrowserWindow.getAllWindows()[0]
    window_?.setMinimumSize(320, 400)
    window_?.setSize(size, 900)
  }, width)
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

/** Markup, not innerText: a token in a title or aria-label is just as copyable. */
async function expectNoCapability(page: Page, surface: string): Promise<void> {
  const markup = await page.evaluate(() => document.documentElement.outerHTML)
  expect(markup, `${surface} shows the capability`).not.toMatch(LEAK)
}

test('a seeded dispatch capability is visible on no agent surface', async ({
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

  await orcaPage.evaluate(async () => {
    const settings = await window.api.settings.set({
      experimentalActivity: true,
      experimentalAgentDashboardPopout: true,
      experimentalAgentDashboardShowIdle: true
    })
    window.__store!.setState({ settings })
    // Why: the right sidebar overlays the dashboard sheet and would hide its cards in the captures.
    window.__store!.getState().setRightSidebarOpen(false)
  })

  await postClaudeHook(endpoint, pane, { hook_event_name: 'UserPromptSubmit', prompt: COMMAND })
  await postClaudeHook(endpoint, pane, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: ASK }
  })
  await expect
    .poll(() =>
      orcaPage.evaluate(
        (key) => window.__store?.getState().agentStatusByPaneKey[key]?.toolInput ?? '',
        pane.paneKey
      )
    )
    .toContain('[redacted]')
  const working = await orcaPage.evaluate(
    (key) => window.__store!.getState().agentStatusByPaneKey[key],
    pane.paneKey
  )
  expect(working.prompt).toContain('--dispatch-capability [redacted] --type heartbeat')

  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    await expectNoCapability(orcaPage, `sidebar working at ${width}`)
    await orcaPage.screenshot({ path: testInfo.outputPath(`sidebar-working-${width}.png`) })
  }

  await postClaudeHook(endpoint, pane, {
    hook_event_name: 'Stop',
    last_assistant_message: REPLY
  })
  await expect
    .poll(() =>
      orcaPage.evaluate(
        (key) => window.__store?.getState().agentStatusByPaneKey[key]?.state,
        pane.paneKey
      )
    )
    .toBe('done')

  const sheet = orcaPage.locator('[data-agent-dashboard-sheet]')
  await setWindowWidth(electronApp, orcaPage, 1440)
  await orcaPage.getByRole('button', { name: /Agent Dashboard/ }).click()
  await sheet.waitFor({ state: 'visible' })
  await sheet.getByRole('button', { name: 'Dashboard', exact: true }).click()
  await expect(sheet).toContainText('[redacted]')
  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    await expectNoCapability(orcaPage, `dashboard rows at ${width}`)
    await orcaPage.screenshot({ path: testInfo.outputPath(`dashboard-rows-${width}.png`) })
  }
  await orcaPage.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })

  await orcaPage.evaluate(() => window.__store!.getState().openActivityPage())
  await expect(orcaPage.getByText('[redacted]').first()).toBeVisible()
  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    await expectNoCapability(orcaPage, `Agents page at ${width}`)
    await orcaPage.screenshot({ path: testInfo.outputPath(`agents-page-${width}.png`) })
  }
  await orcaPage.evaluate(() => window.__store!.getState().closeActivityPage())

  // Why last and scoped to the grid cell: the terminal itself must show what was typed into it.
  await setWindowWidth(electronApp, orcaPage, 1440)
  await execInTerminal(orcaPage, await waitForActivePanePtyId(orcaPage), `echo '${COMMAND}'`)
  await waitForTerminalOutput(orcaPage, CAPABILITY)
  // Why: a shell command ends the agent's row; a new turn brings its grid cell back over this screen.
  await postClaudeHook(endpoint, pane, { hook_event_name: 'UserPromptSubmit', prompt: 'check' })
  await orcaPage.getByRole('button', { name: /Agent Dashboard/ }).click()
  await sheet.waitFor({ state: 'visible' })
  await sheet.getByRole('button', { name: 'Grid', exact: true }).click()
  const tail = sheet.locator('[data-terminal-tail]').first()
  await expect(tail).toContainText('--dispatch-capability [redacted] --type heartbeat')
  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    expect(await sheet.innerHTML(), `grid tail at ${width}`).not.toMatch(LEAK)
    await orcaPage.screenshot({ path: testInfo.outputPath(`dashboard-grid-tail-${width}.png`) })
  }
})
