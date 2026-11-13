/**
 * Invariant: in its default place the floating terminal button covers no content: a Team card's
 * meta line, a Settings switch or account action, or a terminal's rows (ORCA-1148 F1).
 * Needs E2E: the overlap only exists with real layout at real widths, which happy-dom does not do.
 */

import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { WIDTHS, setTheme, setWindowWidth } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId
} from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import { writeSettings } from './helpers/settings-write'

// Why: one capture per width and theme outruns the CI budget; ORCA_CAPTURE_EVIDENCE=1 saves them.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
const DESKTOP_WIDTHS = [1440, 768] as const
const SCROLL_BLOCKS = ['start', 'center', 'end', 'level with the button'] as const

type Box = { left: number; top: number; right: number; bottom: number }

const ORCA_YAML = [
  'orchestratorGame:',
  '  actions:',
  '    - label: Release',
  '      command: release',
  '      icon: tag',
  '      pin: true',
  '      prompt: Prepare the release and tell me what is missing.',
  '    - label: Board',
  '      command: board',
  '      icon: list',
  '      mcp: { server: plane, tool: list_work_items }',
  ''
].join('\n')

const NOW = Date.now()
const account = (id: string, email: string) => ({
  id,
  email,
  authMethod: 'subscription-oauth' as const,
  longLivedTokenSetAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  lastAuthenticatedAt: NOW
})
const ACCOUNTS = {
  accounts: [account('first', 'first@example.com'), account('second', 'second@example.com')],
  activeAccountId: 'first',
  activeAccountIdsByRuntime: { host: 'first', wsl: {} }
}

async function toggleBoxes(page: Page): Promise<Box[]> {
  return page.locator('[data-floating-terminal-toggle]').evaluateAll((nodes) =>
    nodes
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map(({ left, top, right, bottom }) => ({ left, top, right, bottom }))
  )
}

const intersects = (a: Box, b: Box): boolean =>
  a.left < a.right &&
  a.top < a.bottom &&
  b.left < b.right &&
  b.top < b.bottom &&
  a.left < b.right &&
  a.right > b.left &&
  a.top < b.bottom &&
  a.bottom > b.top

async function boxOf(target: Locator): Promise<Box> {
  return target.evaluate((node) => {
    const { left, top, right, bottom } = node.getBoundingClientRect()
    return { left, top, right, bottom }
  })
}

/** Names the toggle box that covers the target, or null. */
async function coveringToggle(page: Page, target: Locator): Promise<Box | null> {
  const [toggles, box] = await Promise.all([toggleBoxes(page), boxOf(target)])
  return toggles.find((toggle) => intersects(toggle, box)) ?? null
}

type Block = (typeof SCROLL_BLOCKS)[number]

/** Scrolls the target to each block and reads its box and the button's at once. */
async function sweepTarget(
  target: Locator,
  blocks: readonly Block[]
): Promise<{ block: Block; target: Box; buttons: Box[] }[]> {
  // Why one synchronous call and no frame waits: an instant scroll lays out at once, and a hidden CI window paints about once a second.
  return target.evaluate((node, list) => {
    const boxOfNode = (element: Element) => {
      const { left, top, right, bottom } = element.getBoundingClientRect()
      return { left, top, right, bottom }
    }
    // Why: a row scrolled past its list's edge is clipped, not painted, so no button can cover it.
    const paintedBoxOf = (element: Element) => {
      const box = boxOfNode(element)
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (style.overflowX === 'visible' && style.overflowY === 'visible') {
          continue
        }
        const clip = parent.getBoundingClientRect()
        box.left = Math.max(box.left, clip.left)
        box.top = Math.max(box.top, clip.top)
        box.right = Math.min(box.right, clip.right)
        box.bottom = Math.min(box.bottom, clip.bottom)
      }
      return box
    }
    const buttons = () =>
      [...document.querySelectorAll('[data-floating-terminal-toggle]')]
        .map(boxOfNode)
        .filter((box) => box.right > box.left && box.bottom > box.top)
    return list.map((block) => {
      if (block === 'level with the button') {
        // Why: a fixed button covers whatever a scroll brings under it, not only start or end.
        const [button] = buttons()
        let scroller = node.parentElement
        while (
          scroller &&
          (scroller.scrollHeight <= scroller.clientHeight ||
            !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
        ) {
          scroller = scroller.parentElement
        }
        const rect = node.getBoundingClientRect()
        const middle = button ? (button.top + button.bottom) / 2 : 0
        scroller?.scrollBy({ top: rect.top + rect.height / 2 - middle, behavior: 'instant' })
      } else {
        node.scrollIntoView({ block, behavior: 'instant' })
      }
      return { block, target: paintedBoxOf(node), buttons: buttons() }
    })
  }, blocks)
}

/** Why every block: a fixed button covers whatever scrolls under it, not only the first paint. */
async function expectClearWhileScrolled(
  page: Page,
  targets: Locator,
  where: string,
  capture?: { testInfo: TestInfo; name: string }
): Promise<void> {
  const count = await targets.count()
  expect(count, `nothing to check at ${where}`).toBeGreaterThan(0)
  await expect(page.locator('[data-floating-terminal-toggle]').first()).toBeVisible()
  let captured = false
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index)
    const label = `${(await target.getAttribute('aria-label')) ?? (await target.innerText())} at ${where}`
    const sweep = await sweepTarget(target, SCROLL_BLOCKS)
    for (const { block, target: box, buttons } of sweep) {
      const covering = buttons.find((button) => intersects(button, box)) ?? null
      expect.soft(covering, `the button covers ${label.trim()}, scrolled to ${block}`).toBeNull()
      if (capture && CAPTURE_EVIDENCE && covering && !captured) {
        captured = true
        await sweepTarget(target, [block])
        await page.screenshot({ path: capture.testInfo.outputPath(`${capture.name}.png`) })
      }
    }
  }
  if (capture && CAPTURE_EVIDENCE && !captured) {
    await page.screenshot({ path: capture.testInfo.outputPath(`${capture.name}.png`) })
  }
}

async function forEachTheme(page: Page, run: (theme: 'dark' | 'light') => Promise<void>) {
  for (const theme of CAPTURE_EVIDENCE ? (['dark', 'light'] as const) : (['dark'] as const)) {
    await setTheme(page, theme)
    await run(theme)
  }
}

type RuntimeCall = (
  event: unknown,
  args: { method: string }
) => Promise<{ result?: { agents?: Record<string, unknown>[] } }>

/** Why: six members make the card list scroll, as a real team does; one lead alone never reaches the button. */
async function addMembers(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const { _invokeHandlers: handlers } = ipcMain as unknown as {
      _invokeHandlers: Map<string, RuntimeCall>
    }
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      const response = await real(event, args)
      const agents = response.result?.agents
      const leader = agents?.find((one) => one.isLeader)
      if (args.method !== 'game.state' || !agents || !leader) {
        return response
      }
      const members = [1, 2, 3, 4, 5, 6].map((at) => ({
        ...leader,
        isLeader: false,
        isMember: true,
        paneKey: `member-tab-${at}:member-leaf-${at}`,
        terminalHandle: `member-${at}`,
        displayName: `Member · ORCA-90${at} Card ${at}`
      }))
      return { ...response, result: { ...response.result, agents: [...agents, ...members] } }
    })
  })
}

async function stubAccounts(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, state) => {
    ipcMain.removeHandler('claudeAccounts:list')
    ipcMain.handle('claudeAccounts:list', () => state)
  }, ACCOUNTS)
}

// Why: the seeded repo is shared by the worker; this test's orca.yaml must not reach the next test.
test.afterEach(({ testRepoPath }) => {
  rmSync(path.join(testRepoPath, 'orca.yaml'), { force: true })
})

test('the default button covers no Settings switch or account action at every width', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 300_000 : 150_000)
  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(async () => {
    await window.api.ui.set({ starNagCompleted: true })
  })
  await writeSettings(orcaPage, { uiLanguage: 'en' })
  await stubAccounts(electronApp)
  // A fresh profile carries the button in the status bar, the 24 px row at the window's foot.
  const inStatusBar = await orcaPage.evaluate(() => {
    const toggle = document
      .querySelector('[data-floating-terminal-toggle]')
      ?.getBoundingClientRect()
    return toggle
      ? toggle.top >= window.innerHeight - 24 && toggle.bottom <= window.innerHeight
      : null
  })
  expect(inStatusBar, 'the fresh-profile button is not in the status bar').toBe(true)
  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? null)
  expect(repoId, 'the fixture seeds a repo').not.toBeNull()
  writeFileSync(path.join(testRepoPath, 'orca.yaml'), ORCA_YAML)

  const open = async (target: Record<string, unknown>): Promise<void> => {
    await orcaPage.evaluate((next) => {
      const store = window.__store!.getState()
      store.openSettingsTarget(next as Parameters<typeof store.openSettingsTarget>[0])
      store.openSettingsPage()
    }, target)
  }

  const actionsId = `repo-${repoId}-game-actions`
  await open({ pane: 'repo', repoId, sectionId: actionsId })
  const actions = orcaPage.locator(`[id="${actionsId}"]`)
  await expect(actions.locator('[data-slot="game-action-row"]')).not.toHaveCount(0, {
    timeout: 15_000
  })
  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    await forEachTheme(orcaPage, (theme) =>
      expectClearWhileScrolled(orcaPage, actions.getByRole('switch'), `Actions ${width}px`, {
        testInfo,
        name: `actions-${width}-${theme}`
      })
    )
  }

  await open({ pane: 'agents', repoId: null, sectionId: 'agents-game-panel' })
  const panelSection = orcaPage.locator('[id="agents-game-panel"]')
  await expect(panelSection).toBeVisible({ timeout: 15_000 })
  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    await forEachTheme(orcaPage, (theme) =>
      expectClearWhileScrolled(orcaPage, panelSection.getByRole('switch'), `Panel ${width}px`, {
        testInfo,
        name: `panel-switches-${width}-${theme}`
      })
    )
  }

  await open({ pane: 'accounts', repoId: null })
  const second = orcaPage
    .locator('div.rounded-md.border')
    .filter({ hasText: 'second@example.com' })
    .filter({ hasNotText: 'first@example.com' })
    .first()
  const rowActions = second.getByRole('button', { name: /^(Re-authenticate|Token)$/ })
  await expect(rowActions).toHaveCount(2, { timeout: 15_000 })
  for (const width of WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    await forEachTheme(orcaPage, (theme) =>
      expectClearWhileScrolled(orcaPage, rowActions, `Accounts ${width}px`, {
        testInfo,
        name: `accounts-${width}-${theme}`
      })
    )
  }
})

test("the default button covers no terminal row nor a Team card's meta at any width", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(CAPTURE_EVIDENCE ? 300_000 : 180_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const ptyId = await waitForActivePanePtyId(orcaPage)
  await orcaPage.evaluate(async () => {
    await window.api.ui.set({ starNagCompleted: true })
  })
  await writeSettings(orcaPage, { uiLanguage: 'en' })

  // Why a drawn line: Claude Code's status line sits in the pane's last rows, where the button was.
  // Why the sidebar shut: open, it is what sits under the button, not the pane.
  await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))
  const screen = orcaPage.locator('.xterm:visible .xterm-screen').first()
  for (const width of DESKTOP_WIDTHS) {
    await setWindowWidth(electronApp, orcaPage, width)
    await execInTerminal(
      orcaPage,
      ptyId,
      `clear; tput cup $(($(tput lines)-2)) 0; printf "%$(($(tput cols)-2))s" "◐ medium · /effort"; read -r _`
    )
    await expect(screen).toBeVisible()
    await forEachTheme(orcaPage, async (theme) => {
      const covering = await coveringToggle(orcaPage, screen)
      expect.soft(covering, `the button covers the terminal at ${width}`).toBeNull()
      if (CAPTURE_EVIDENCE) {
        await orcaPage.screenshot({ path: testInfo.outputPath(`terminal-${width}-${theme}.png`) })
      }
    })
    await execInTerminal(orcaPage, ptyId, '')
  }

  const pane = await waitForActivePaneHookDescriptor(orcaPage)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const lead = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey: pane.paneKey
    })
  ).result.terminal.handle
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
  await emitCodexHookStatus(await readHookEndpoint(electronApp), {
    paneKey: pane.paneKey,
    worktreeId,
    state: 'working',
    prompt: 'Lead the team'
  })
  await addMembers(electronApp)
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
  })
  const panel = orcaPage.getByTestId('team-panel')
  const members = panel.locator('[data-team-card="member"]')
  await expect(members).toHaveCount(6, { timeout: 60_000 })
  const meta = panel.locator('[data-team-card] [data-team-meta]')
  // Why both states: collapsed, the last meta ends the list; opened, the last card's actions do.
  const states = [
    { name: 'collapsed', targets: meta },
    { name: 'open', targets: members.last().locator('[data-team-meta], button') },
    { name: 'asked', targets: meta }
  ]
  for (const state of states) {
    if (state.name === 'open') {
      await members.last().locator('button[aria-expanded]').click()
      await expect(members.last().locator('button[aria-expanded="true"]')).toBeVisible()
    }
    if (state.name === 'asked') {
      await members.last().locator('button[aria-expanded]').click()
      // Why: a question adds its answer row, so the list's last meta reaches the button.
      await client.call('game.ownerAsk', {
        worktreeId,
        terminalHandle: lead,
        ticket: 'ORCA-901',
        question: 'Merge #14 now?',
        options: ['Yes', 'No']
      })
      await expect(members.first().locator('[data-status-glyph="question"]')).toBeVisible({
        timeout: 30_000
      })
    }
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await forEachTheme(orcaPage, (theme) =>
        expectClearWhileScrolled(orcaPage, state.targets, `Team ${state.name} ${width}px`, {
          testInfo,
          name: `team-${state.name}-${width}-${theme}`
        })
      )
    }
  }

  // Why: the clip must not hide a real overlap; a button over a painted row inside the list still counts.
  const probe = meta.first()
  const [placed] = await sweepTarget(probe, ['center'])
  await orcaPage.evaluate((box) => {
    const stand = document.createElement('div')
    stand.id = 'covering-probe'
    stand.dataset.floatingTerminalToggle = ''
    Object.assign(stand.style, {
      position: 'fixed',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: '20px',
      height: `${box.bottom - box.top}px`
    })
    document.body.append(stand)
  }, placed.target)
  const [over] = await sweepTarget(probe, ['center'])
  expect(
    over.buttons.some((button) => intersects(button, over.target)),
    'a button over a painted row reads as covering it'
  ).toBe(true)
  await orcaPage.evaluate(() => document.getElementById('covering-probe')?.remove())
})

test('the menu still moves the button both ways, a drag still places it, and the choice sticks', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  const setting = (
    key: 'floatingTerminalTriggerLocation' | 'floatingTerminalTriggerLocationDefaulted'
  ) => orcaPage.evaluate((name) => window.__store!.getState().settings?.[name], key)
  await expect.poll(() => setting('floatingTerminalTriggerLocationDefaulted')).toBe(true)
  await expect.poll(() => setting('floatingTerminalTriggerLocation')).toBe('status-bar')

  await orcaPage.locator('[data-floating-terminal-toggle]').first().click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Move to Floating Button' }).click()
  const floating = orcaPage.locator('button[data-floating-terminal-toggle]')
  await expect(floating).toBeVisible()
  await expect.poll(() => setting('floatingTerminalTriggerLocation')).toBe('floating-button')

  const start = (await floating.boundingBox())!
  await orcaPage.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await orcaPage.mouse.down()
  await orcaPage.mouse.move(start.x - 200, start.y - 200, { steps: 8 })
  await orcaPage.mouse.up()
  await expect.poll(async () => (await floating.boundingBox())!.x).toBeLessThan(start.x - 150)
  // Why a reload: the one-shot runs on every mount, and it must not undo the move back.
  await orcaPage.reload()
  await waitForSessionReady(orcaPage)
  await expect(floating).toBeVisible()
  expect(await setting('floatingTerminalTriggerLocation')).toBe('floating-button')
  expect((await floating.boundingBox())!.x).toBeLessThan(start.x - 150)

  await floating.click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Move to Status Bar' }).click()
  await expect(floating).toHaveCount(0)
  await expect.poll(() => setting('floatingTerminalTriggerLocation')).toBe('status-bar')
})
