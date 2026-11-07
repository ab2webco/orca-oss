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
  await settle(page)
}

/**
 * Why: the dashboard sheet slides in over 300 ms, and a capture inside that window shows the terminal
 * beside a half-open sheet. Wait for every finite animation, then two frames.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

/** The terminal shows what was typed into it, so a page over it must leave none of it on top. */
async function expectTerminalCovered(page: Page, surface: string): Promise<void> {
  const exposed = await page.evaluate(() => {
    const points: string[] = []
    let sampled = 0
    for (const screen of document.querySelectorAll<HTMLElement>('.xterm-screen')) {
      const rect = screen.getBoundingClientRect()
      const left = Math.max(rect.left, 0)
      const right = Math.min(rect.right, window.innerWidth)
      const top = Math.max(rect.top, 0)
      const bottom = Math.min(rect.bottom, window.innerHeight)
      if (right - left < 4 || bottom - top < 4) {
        continue
      }
      for (let ix = 0; ix < 8; ix++) {
        for (let iy = 0; iy < 6; iy++) {
          const x = left + ((right - left) * (ix + 0.5)) / 8
          const y = top + ((bottom - top) * (iy + 0.5)) / 6
          sampled++
          if (document.elementFromPoint(x, y)?.closest('.xterm')) {
            points.push(`${Math.round(x)},${Math.round(y)}`)
          }
        }
      }
    }
    return { sampled, points }
  })
  expect(exposed.points, `${surface} leaves the terminal on top at`).toEqual([])
}

/** Every text node holding any piece of the token must be under something else, never on top. */
async function expectNoVisibleCapability(page: Page, surface: string): Promise<void> {
  const visible = await page.evaluate((pattern) => {
    const leak = new RegExp(pattern)
    const found: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent || !leak.test(node.textContent ?? '')) {
        continue
      }
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        if (rect.width < 1 || x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
          continue
        }
        const top = document.elementFromPoint(x, y)
        if (top && (top === parent || parent.contains(top) || top.contains(parent))) {
          found.push((node.textContent ?? '').slice(0, 120))
        }
      }
    }
    return found
  }, LEAK.source)
  expect(visible, `${surface} shows the capability`).toEqual([])
}

async function expectSheetFillsViewport(page: Page): Promise<void> {
  const edge = await page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>('[data-agent-dashboard-sheet]')!
    const rect = sheet.getBoundingClientRect()
    const hit = document.elementFromPoint(window.innerWidth - 4, rect.top + rect.height / 2)
    return {
      right: Math.round(rect.right),
      width: window.innerWidth,
      edgeInSheet: !!hit?.closest('[data-agent-dashboard-sheet]')
    }
  })
  expect(edge).toEqual({ right: edge.width, width: edge.width, edgeInSheet: true })
}

/** Markup, not innerText: a token in a title or aria-label is just as copyable. */
async function expectNoCapability(page: Page, surface: string): Promise<void> {
  const markup = await page.evaluate(() => document.documentElement.outerHTML)
  expect(markup, `${surface} shows the capability`).not.toMatch(LEAK)
  await expectNoVisibleCapability(page, surface)
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

  // Why: proves the visible-text check can fail, so its passes below mean something.
  await orcaPage.evaluate((token) => {
    const probe = document.createElement('div')
    probe.id = 'capability-check-probe'
    probe.textContent = token
    probe.style.cssText = 'position:fixed;top:200px;left:200px;z-index:2147483647;background:white'
    document.body.append(probe)
  }, CAPABILITY)
  await expect(expectNoVisibleCapability(orcaPage, 'self-check')).rejects.toThrow()
  await orcaPage.evaluate(() => document.getElementById('capability-check-probe')?.remove())

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
  await settle(orcaPage)
  await expect(sheet).toContainText('[redacted]')
  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    await expectSheetFillsViewport(orcaPage)
    await expectTerminalCovered(orcaPage, `dashboard rows at ${width}`)
    await expectNoCapability(orcaPage, `dashboard rows at ${width}`)
    await orcaPage.screenshot({ path: testInfo.outputPath(`dashboard-rows-${width}.png`) })
  }
  await orcaPage.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })

  await orcaPage.evaluate(() => window.__store!.getState().openActivityPage())
  await expect(orcaPage.getByText('[redacted]').first()).toBeVisible()
  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    await expectTerminalCovered(orcaPage, `Agents page at ${width}`)
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
  await settle(orcaPage)
  const tail = sheet.locator('[data-terminal-tail]').first()
  await expect(tail).toContainText('--dispatch-capability [redacted] --type heartbeat')
  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    await expectSheetFillsViewport(orcaPage)
    await expectTerminalCovered(orcaPage, `grid tail at ${width}`)
    expect(await sheet.innerHTML(), `grid tail at ${width}`).not.toMatch(LEAK)
    await expectNoVisibleCapability(orcaPage, `grid tail at ${width}`)
    await orcaPage.screenshot({ path: testInfo.outputPath(`dashboard-grid-tail-${width}.png`) })
  }
})
