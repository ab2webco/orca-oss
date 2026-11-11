import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { writeSettings } from './helpers/settings-write'
import { RuntimeClient } from '../../src/cli/runtime-client'

// Why made-up accounts: captures must never show a real login (ORCA-717).
const ACCOUNTS = {
  activeAccountId: 'e2e-claude-1',
  accounts: [
    { id: 'e2e-claude-1', email: 'claude-one@example.test', authMethod: 'subscription-oauth' },
    { id: 'e2e-claude-2', email: 'claude-two@example.test', authMethod: 'subscription-oauth' },
    {
      id: 'e2e-glm',
      email: 'glm@example.test',
      authMethod: 'custom-endpoint',
      endpointLabel: 'Claude GLM'
    }
  ].map((one) => ({ ...one, createdAt: 1, updatedAt: 1, lastAuthenticatedAt: 1 }))
}

const SHOTS = [
  { width: 1440, theme: 'dark' },
  { width: 768, theme: 'dark' },
  { width: 390, theme: 'light' },
  { width: 320, theme: 'light' }
] as const

// Why: the desktop window's minimum is 600 px (createMainWindow MIN_WIDTH), so a narrower width exists only
// in the paired web client, which draws no window controls; below it every OS renders as that client.
const DESKTOP_MIN_WIDTH = 600

// Why: Linux/Windows reserve 138 px for their window controls; macOS reserves none, so 600 forces Linux's.
async function setWindowControlsWidth(page: Page, width: string | null): Promise<void> {
  await page.evaluate((next) => {
    const root = document.querySelector<HTMLElement>('.app-layout')!
    root.dataset.e2eControlsWidth ??= root.style.getPropertyValue('--window-controls-width')
    root.style.setProperty('--window-controls-width', next ?? root.dataset.e2eControlsWidth)
    // Why: the web client draws no window controls, so on Linux/Windows the real ones would cover the +.
    for (const controls of document.querySelectorAll<HTMLElement>('.window-controls')) {
      controls.style.display = next === '0px' ? 'none' : ''
    }
  }, width)
}

// Why (ORCA-717): at 390 and 320 with the sidebar collapsed the + was clipped under the floating header.
async function expectPlusReachable(page: Page): Promise<void> {
  const box = await page.getByRole('button', { name: 'New tab' }).first().boundingBox()
  expect(box, 'the + has no box').not.toBeNull()
  const width = page.viewportSize()?.width ?? 0
  expect(box!.width, 'the + is clipped').toBeGreaterThanOrEqual(20)
  expect(box!.x + box!.width, 'the + runs past the window').toBeLessThanOrEqual(width)
  const onTop = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'),
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  )
  expect(onTop, 'something covers the +').toBe('New tab')
}

// Why (ORCA-717): at 320 the strip shrank to a 22 px sliver that showed only the tab's ×.
async function expectActiveTabReadable(page: Page): Promise<void> {
  const tab = page.locator('[data-testid="sortable-tab"][data-active="true"]').first()
  const strip = await page.locator('.terminal-tab-strip').first().boundingBox()
  const icon = await tab.locator('svg').first().boundingBox()
  const closeButton = tab.locator('[data-tab-close-button="true"]')
  // Why: under a 120 px tab bar a tab is its icon alone and shows its close on hover (ORCA-717).
  if (!(await closeButton.isVisible())) {
    await tab.hover()
  }
  const close = await closeButton.boundingBox()
  expect(strip && icon && close, 'the active tab has no box').toBeTruthy()
  expect(icon!.x, "the tab's icon is cut off").toBeGreaterThanOrEqual(strip!.x)
  expect(close!.x + close!.width, "the tab's close is cut off").toBeLessThanOrEqual(
    strip!.x + strip!.width
  )
}

async function openMenu(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await page.keyboard.press('Escape')
  // Why: Escape only starts the open menu's exit; a check before it leaves reads the closing menu.
  await expect(page.getByRole('menu')).toHaveCount(0)
  const menu = page.getByRole('menu').first()
  const heading = menu.getByText('Agents', { exact: true })
  await expectPlusReachable(page)
  // Why a retry: a theme write re-renders the tab bar, and a click in that frame can miss.
  await expect(async () => {
    if (!(await heading.isVisible())) {
      await page.getByRole('button', { name: 'New tab' }).first().click()
    }
    await expect(heading).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  return menu
}

// Why (ORCA-717): at 390/320 the Add member submenu opened off the window's left, and at 768 a
// pointer leaving toward its left-side submenu closed it; a stepped path is a person's mouse.
async function expectTeamSubmenusStay(page: Page, width: number): Promise<void> {
  const inWindow = async (menu: ReturnType<Page['getByRole']>, name: string): Promise<void> => {
    const box = await menu.boundingBox()
    expect(box, `${width}px: ${name} has no box`).not.toBeNull()
    expect(box!.x, `${width}px: ${name} leaves the window`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${width}px: ${name} leaves the window`).toBeLessThanOrEqual(width)
  }
  const moveTo = async (target: ReturnType<Page['getByRole']>): Promise<void> => {
    const box = (await target.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
  }
  const menu = await openMenu(page)
  await moveTo(menu.getByRole('menuitem', { name: 'Add member…' }))
  const addMember = page.getByRole('menu').filter({ hasText: 'Member account' })
  await expect(addMember).toBeVisible()
  const account = addMember.getByRole('menuitem', { name: "Choose the member's account" })
  await moveTo(account)
  await page.waitForTimeout(400)
  await expect(addMember, `${width}px: Add member closed under the pointer`).toBeVisible()
  await inWindow(addMember, 'Add member')
  await account.click()
  const list = page.getByRole('menu').filter({ hasText: 'Claude accounts' })
  await expect(list).toBeVisible()
  await page.waitForTimeout(400)
  await expect(list, `${width}px: the account list closed under the pointer`).toBeVisible()
  await inWindow(list, 'the account list')
}

async function captureEach(
  page: Page,
  name: string,
  outputPath: (file: string) => string,
  ready: (menu: ReturnType<Page['getByRole']>) => Promise<void>
): Promise<void> {
  for (const shot of SHOTS) {
    await page.setViewportSize({ width: shot.width, height: 900 })
    await setWindowControlsWidth(page, shot.width < DESKTOP_MIN_WIDTH ? '0px' : null)
    // Why: below a tablet width a person collapses both sidebars to reach the tabs.
    await page.evaluate((wide) => {
      const state = window.__store!.getState()
      state.setSidebarOpen(wide)
      state.setRightSidebarOpen(wide)
    }, shot.width >= 768)
    await writeSettings(page, { theme: shot.theme })
    const menu = await openMenu(page)
    await ready(menu)
    await page.screenshot({
      animations: 'disabled',
      path: outputPath(`new-tab-${name}-${shot.width}-${shot.theme}.png`)
    })
  }
  await page.keyboard.press('Escape')
}

// ORCA-717: the + stays clickable at every phone width with the sidebar collapsed.
test('the + reaches a pointer click at every width', async ({ orcaPage }, testInfo) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActivePanePtyId(orcaPage)
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
  await captureEach(
    orcaPage,
    'reach',
    (file) => testInfo.outputPath(file),
    async () => expectActiveTabReadable(orcaPage)
  )

  // ORCA-717: at Linux/Windows' narrowest window its 40 + 138 px right reserve lands in the tab strip
  // once the right sidebar closes. Both sidebars open is #1141's: the right one becomes a drawer there.
  await orcaPage.setViewportSize({ width: DESKTOP_MIN_WIDTH, height: 900 })
  await setWindowControlsWidth(orcaPage, '138px')
  await writeSettings(orcaPage, { theme: 'dark' })
  for (const leftOpen of [true, false]) {
    await orcaPage.evaluate((open) => {
      const state = window.__store!.getState()
      state.setSidebarOpen(open)
      state.setRightSidebarOpen(false)
    }, leftOpen)
    await expect(async () => expectActiveTabReadable(orcaPage)).toPass({ timeout: 10_000 })
    await expectPlusReachable(orcaPage)
    await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(
        `new-tab-reach-${DESKTOP_MIN_WIDTH}-dark-window-controls-${leftOpen ? 'left-open' : 'both-closed'}.png`
      )
    })
  }
  await setWindowControlsWidth(orcaPage, null)
})

// ORCA-717: the + menu offers the project's lead, live or kept, instead of starting a second team.
test("the + menu offers the project's lead instead of a second team", async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  const shotPath = (file: string): string => testInfo.outputPath(file)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActivePanePtyId(orcaPage)
  const pane = await waitForActivePaneHookDescriptor(orcaPage)
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
  await electronApp.evaluate(({ ipcMain }, fixture) => {
    ipcMain.removeHandler('claudeAccounts:list')
    ipcMain.handle('claudeAccounts:list', async () => fixture)
  }, ACCOUNTS)

  // No team: today's entries under Terminal and Agents, no Team group.
  await captureEach(orcaPage, 'no-team', shotPath, async (menu) => {
    await expect(menu.getByText('Terminal', { exact: true })).toBeVisible()
    await expect(menu.getByText('Team', { exact: true })).toHaveCount(0)
  })
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await writeSettings(orcaPage, { theme: 'dark' })
  const plain = await openMenu(orcaPage)
  // Why a waiting check: the accounts load after the menu opens.
  await plain.getByRole('menuitem', { name: 'Choose the Claude account' }).click()
  await expect(orcaPage.getByText('claude-two@example.test')).toBeVisible()
  await orcaPage.screenshot({
    animations: 'disabled',
    path: shotPath('new-tab-account-submenu-1440-dark.png')
  })

  // Lead closed: the project keeps a lead conversation, so Reopen team and a confirmed fresh lead.
  const place = await orcaPage.evaluate((id) => {
    const state = window.__store!.getState()
    const repoId = state.getKnownWorktreeById(id)?.repoId
    const repo = state.repos.find((candidate) => candidate.id === repoId)
    return repo ? { connectionId: repo.connectionId ?? null, path: repo.path } : null
  }, worktreeId)
  expect(place).not.toBeNull()
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const leadsDir = join(userDataDir, 'orchestrator-game-leads')
  mkdirSync(leadsDir, { recursive: true })
  // Why the place name: the no-team reads above already settled the one-time copy from the repo id's name.
  const placeName = createHash('sha256')
    .update(`place:${place!.connectionId ?? 'local'}:${place!.path.replace(/[\\/]+$/, '')}`)
    .digest('hex')
    .slice(0, 32)
  writeFileSync(
    join(leadsDir, `${placeName}.lead.json`),
    JSON.stringify({ sessionId: 'e2e-kept', agentArgs: null, worktreeId, accountId: null })
  )
  await captureEach(orcaPage, 'lead-closed', shotPath, async (menu) => {
    await expect(menu.getByRole('menuitem', { name: /Reopen team/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Claude Agent Teams' })).toHaveCount(0)
  })
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await writeSettings(orcaPage, { theme: 'dark' })
  const closed = await openMenu(orcaPage)
  await closed.getByRole('menuitem', { name: 'Start fresh lead…' }).click()
  await expect(orcaPage.getByText('Start a fresh lead?')).toBeVisible()
  await orcaPage.screenshot({
    animations: 'disabled',
    path: shotPath('new-tab-start-fresh-confirm-1440-dark.png')
  })

  // Lead live: this pane leads the project, so Go to lead and Add member.
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const lead = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey: pane.paneKey
    })
  ).result.terminal.handle
  // Why Ctrl-C first: openMenu's Escape reaches the focused shell, and zsh's ESC prefix ate the next keys.
  await client.call('terminal.send', { terminal: lead, interrupt: true })
  // Why a foreground process: a lead pane back at its shell is not a live lead.
  await client.call('terminal.send', {
    terminal: lead,
    text: 'node -e "setInterval(() => {}, 1e9)"',
    enter: true
  })
  await expect
    .poll(
      async () =>
        (
          await client.call<{ registered: boolean }>('game.leadRegister', {
            terminalHandle: lead,
            project: 'e2e',
            label: 'Alfred'
          })
        ).result.registered
    )
    .toBe(true)
  // Why a waiting check: each open reads the leads afresh, so a count at open reads the pending menu.
  await expect(async () => {
    const menu = await openMenu(orcaPage)
    await expect(menu.getByRole('menuitem', { name: /^Go to lead/ })).toBeVisible({
      timeout: 5_000
    })
  }).toPass({ timeout: 60_000 })
  await captureEach(orcaPage, 'lead-live', shotPath, async (menu) => {
    await expect(menu.getByRole('menuitem', { name: 'Add member…' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Claude Agent Teams' })).toHaveCount(0)
  })
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await writeSettings(orcaPage, { theme: 'dark' })
  const live = await openMenu(orcaPage)
  await live.getByRole('menuitem', { name: 'Add member…' }).click()
  await expect(
    orcaPage.getByRole('menuitem', { name: /To Do is empty|ORCA-/ }).first()
  ).toBeVisible()
  await orcaPage.screenshot({
    animations: 'disabled',
    path: shotPath('new-tab-add-member-1440-dark.png')
  })
  for (const width of [768, 320]) {
    await orcaPage.setViewportSize({ width, height: 900 })
    await setWindowControlsWidth(orcaPage, width < DESKTOP_MIN_WIDTH ? '0px' : null)
    await orcaPage.evaluate((wide) => {
      const state = window.__store!.getState()
      state.setSidebarOpen(wide)
      state.setRightSidebarOpen(wide)
    }, width >= 768)
    await expectTeamSubmenusStay(orcaPage, width)
    await orcaPage.screenshot({
      animations: 'disabled',
      path: shotPath(`new-tab-add-member-accounts-${width}-dark.png`)
    })
  }
  await setWindowControlsWidth(orcaPage, null)
  await orcaPage.keyboard.press('Escape')
})

// ORCA-717: beside both sidebars at 768 the strip fits one tab; a +N count lists and opens the rest.
test('the +N count lists the hidden tabs and opens the one picked', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActivePanePtyId(orcaPage)
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
  await orcaPage.evaluate((id) => {
    const state = window.__store!.getState()
    state.createTab(id)
    state.createTab(id)
  }, worktreeId)
  await expect(orcaPage.locator('[data-testid="sortable-tab"]')).toHaveCount(3)
  await orcaPage.setViewportSize({ width: 768, height: 900 })
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSidebarOpen(true)
    state.setRightSidebarOpen(true)
  })
  const activeTabId = () => orcaPage.evaluate(() => window.__store!.getState().activeTabId)
  for (const theme of ['dark', 'light'] as const) {
    await writeSettings(orcaPage, { theme })
    const count = orcaPage.getByRole('button', { name: '2 more tabs' })
    await expect(count).toHaveText('+2')
    await orcaPage.mouse.move(0, 450)
    await expect(async () => expectActiveTabReadable(orcaPage)).toPass({ timeout: 10_000 })
    await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`hidden-tabs-count-768-${theme}.png`)
    })
    const before = await activeTabId()
    await count.click()
    const rows = orcaPage.getByRole('menuitem')
    await expect(rows).toHaveCount(2)
    await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`hidden-tabs-list-768-${theme}.png`)
    })
    await rows.first().click()
    await expect.poll(activeTabId).not.toBe(before)
    await expect(orcaPage.getByRole('menu')).toHaveCount(0)
  }
})
