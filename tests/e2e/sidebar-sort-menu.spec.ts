/**
 * ORCA-1216 §5: a sort button in the Projects header owns the project order. Every option
 * reorders the active group only; En reposo stays by age under all four.
 */

import type { Page } from '@stablyai/playwright-test'
import type { AgentStatusEntry } from '../../src/shared/agent-status-types'
import type { ProjectOrderBy } from '../../src/shared/ui-chrome-types'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { dismissWorkspaceBoardMovedHint } from './helpers/workspace-board-moved-hint'

const PREFIX = 'e2e-sort-'
const WIDTHS = [1440, 768, 390, 320]
// Each order differs from the other three, so a fallback to any of them would fail.
const EXPECTED_ACTIVE: Record<ProjectOrderBy, string[]> = {
  'needs-you': ['Bravo', 'charlie', 'delta', 'alpha'],
  recent: ['charlie', 'Bravo', 'delta', 'alpha'],
  name: ['alpha', 'Bravo', 'charlie', 'delta'],
  manual: ['delta', 'alpha', 'charlie', 'Bravo']
}
// Age order, which is neither A–Z (echo, Foxtrot, golf) nor manual (golf, echo, Foxtrot).
const EXPECTED_IDLE = ['Foxtrot', 'echo', 'golf']

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

/** Four active projects and three idle ones; the push order is the manual order. */
async function seedSidebar(page: Page): Promise<void> {
  await page.evaluate((prefix) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const sourceRepo = state.repos[0]
    const sourceWorktree = sourceRepo ? (state.worktreesByRepo[sourceRepo.id] ?? [])[0] : undefined
    if (!sourceRepo || !sourceWorktree) {
      throw new Error('Sort menu E2E needs the seeded repo')
    }
    const now = Date.now()
    const min = 60 * 1000
    const day = 24 * 60 * min
    const repos = [...state.repos]
    const worktreesByRepo = { ...state.worktreesByRepo }
    worktreesByRepo[sourceRepo.id] = (worktreesByRepo[sourceRepo.id] ?? []).map((w) => ({
      ...w,
      lastActivityAt: now - 6 * 60 * min
    }))
    const add = (name: string, age: number) => {
      const id = `${prefix}${name}`
      repos.push({
        ...sourceRepo,
        id,
        path: `${sourceRepo.path}-${id}`,
        displayName: name,
        connectionId: null,
        executionHostId: undefined
      })
      worktreesByRepo[id] = [
        {
          ...sourceWorktree,
          id: `${id}-main`,
          repoId: id,
          path: `${sourceWorktree.path}-${id}`,
          displayName: 'main',
          branch: 'refs/heads/main',
          isMainWorktree: true,
          isArchived: false,
          isPinned: false,
          lastActivityAt: now - age
        }
      ]
    }
    add('delta', 20 * min)
    add('alpha', 30 * min)
    add('charlie', 5 * min)
    add('Bravo', 10 * min)
    add('golf', 10 * day)
    add('echo', 3 * day)
    add('Foxtrot', 2 * day)
    store.setState({ repos, worktreesByRepo })
    const next = store.getState()
    next.setActiveView('terminal')
    next.setSidebarOpen(true)
    next.setSidebarWidth(470)
    next.setGroupBy('repo')
    next.setProjectOrderBy('needs-you')
    next.setFilterRepoIds([])
    if (next.collapsedGroups.has('idle-projects')) {
      next.toggleCollapsedGroup('idle-projects')
    }
  }, PREFIX)
}

/** Bravo has a question waiting and charlie an agent working, as the hooks store them. */
async function seedSignals(page: Page): Promise<void> {
  await page.evaluate((prefix) => {
    const store = window.__store!
    const now = Date.now()
    const agent = (
      repo: string,
      n: number,
      state: AgentStatusEntry['state']
    ): AgentStatusEntry => ({
      state,
      prompt: '',
      updatedAt: now,
      stateStartedAt: now,
      paneKey: `${prefix}tab-${n}:00000000-0000-4000-8000-00000000000${n}`,
      worktreeId: `${prefix}${repo}-main`,
      agentType: 'claude',
      stateHistory: []
    })
    const rows = [agent('Bravo', 1, 'waiting'), agent('charlie', 2, 'working')]
    store.setState((s) => ({
      agentStatusByPaneKey: {
        ...s.agentStatusByPaneKey,
        ...Object.fromEntries(rows.map((row) => [row.paneKey, row]))
      },
      sortEpoch: s.sortEpoch + 1,
      agentStatusEpoch: s.agentStatusEpoch + 1
    }))
  }, PREFIX)
}

/** Seeded project headers in render order, split at the En reposo header. */
async function projectOrder(page: Page): Promise<{ active: string[]; idle: string[] }> {
  return page.evaluate((prefix) => {
    const sidebar = document.querySelector('[data-worktree-sidebar]')
    const nodes = sidebar
      ? [
          ...sidebar.querySelectorAll<HTMLElement>(
            '[data-repo-header-id], [data-idle-projects-group]'
          )
        ]
      : []
    const ordered = nodes
      .map((node) => ({
        top: node.getBoundingClientRect().top,
        id: node.getAttribute('data-repo-header-id'),
        idle: node.hasAttribute('data-idle-projects-group')
      }))
      .sort((a, b) => a.top - b.top)
    const idleAt = ordered.findIndex((entry) => entry.idle)
    // Why only seeded ids: the source project's name and age are the fixture's, not this test's.
    const names = (entries: typeof ordered): string[] =>
      entries.flatMap((entry) =>
        entry.id?.startsWith(prefix) ? [entry.id.slice(prefix.length)] : []
      )
    return idleAt === -1
      ? { active: names(ordered), idle: [] }
      : { active: names(ordered.slice(0, idleAt)), idle: names(ordered.slice(idleAt + 1)) }
  }, PREFIX)
}

async function openMenu(page: Page): Promise<void> {
  // Why wait for zero: a menu still animating out reads as visible and swallows the click.
  await expect(page.locator('[data-project-order-menu]')).toHaveCount(0)
  await page.locator('[data-project-order-trigger]:visible').click()
  await expect(page.locator('[data-project-order-menu]')).toBeVisible()
}

async function persistedOrder(page: Page): Promise<string> {
  return page.evaluate(async () => (await window.api.ui.get()).projectOrderBy)
}

/** What of the open menu sits outside the window or is clipped inside its own box. */
async function menuOverflow(page: Page) {
  return page.locator('[data-project-order-menu]').evaluate((menu) => {
    const box = menu.getBoundingClientRect()
    const clipped = [
      ...menu.querySelectorAll<HTMLElement>('[data-project-order-option] span, p, [role="group"]')
    ].filter((node) => node.scrollWidth > node.clientWidth + 0.5)
    const outside = [...menu.querySelectorAll<HTMLElement>('*')].filter((node) => {
      const rect = node.getBoundingClientRect()
      return rect.width > 0 && (rect.left < box.left - 0.5 || rect.right > box.right + 0.5)
    })
    return {
      left: box.left,
      right: box.right,
      windowWidth: window.innerWidth,
      menuScrolls: menu.scrollWidth - menu.clientWidth,
      clipped: clipped.map((node) => node.textContent ?? ''),
      outside: outside.map((node) => node.textContent ?? node.tagName)
    }
  })
}

test('the sort menu orders the active projects, marks a non-default order, and leaves En reposo by age', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await writeSettings(orcaPage, { uiLanguage: 'es', sidebarActivityWindowHours: 24 })
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await setTheme(orcaPage, 'dark')
  await seedSidebar(orcaPage)
  await seedSignals(orcaPage)
  await dismissWorkspaceBoardMovedHint(orcaPage)

  const trigger = orcaPage.locator('[data-project-order-trigger]')
  const dot = trigger.locator('[data-project-order-dot]')
  await expect
    .poll(() => projectOrder(orcaPage), { timeout: 30_000 })
    .toEqual({ active: EXPECTED_ACTIVE['needs-you'], idle: EXPECTED_IDLE })
  await expect(dot).toHaveCount(0)

  // The options menu no longer carries a second control for the same setting.
  await orcaPage
    .locator('button[aria-label^="Opciones de espacio de trabajo"]:visible')
    .first()
    .click()
  await expect(orcaPage.getByRole('menuitem', { name: /Ordenar por/ })).toBeVisible()
  await expect(orcaPage.getByRole('menuitem', { name: /Orden del proyecto/ })).toHaveCount(0)
  await orcaPage.keyboard.press('Escape')

  await openMenu(orcaPage)
  const menu = orcaPage.locator('[data-project-order-menu]')
  await expect(menu.getByRole('menuitemradio')).toHaveText([
    /Te necesita primero\s*predeterminado/,
    'Actividad reciente',
    'Nombre',
    'Manual (arrastrar)'
  ])
  await expect(menu.locator('[data-project-order-option="needs-you"]')).toHaveAttribute(
    'data-state',
    'checked'
  )
  await expect(menu.locator('[data-project-order-footer]')).toHaveText(
    'Se guarda para tu usuario. En reposo sigue por antigüedad.'
  )
  await orcaPage.keyboard.press('Escape')

  for (const order of ['recent', 'name', 'manual', 'needs-you'] as const) {
    await openMenu(orcaPage)
    await orcaPage.locator(`[data-project-order-option="${order}"]`).click()
    await expect
      .poll(() => projectOrder(orcaPage), { timeout: 15_000, message: order })
      .toEqual({ active: EXPECTED_ACTIVE[order], idle: EXPECTED_IDLE })
    await expect(trigger).toHaveAttribute('data-project-order-trigger', order)
    await expect(dot, `dot under ${order}`).toHaveCount(order === 'needs-you' ? 0 : 1)
    if (order === 'name') {
      await orcaPage.mouse.move(1000, 600)
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('sort-menu-name-dot-1440-dark.png')
      })
    }
    // The choice is saved for the user: the main process returns it from ui.get.
    await expect.poll(() => persistedOrder(orcaPage), { message: order }).toBe(order)
  }

  // Escape closes the menu, not the workspace board it opened over.
  await orcaPage.locator('[data-workspace-board-trigger]').click()
  const board = orcaPage.locator('[data-workspace-board-sheet]')
  await expect(board).toBeVisible()
  await openMenu(orcaPage)
  await orcaPage.keyboard.press('Escape')
  await expect(orcaPage.locator('[data-project-order-menu]')).toHaveCount(0)
  await expect(board).toBeVisible()
  await orcaPage.locator('[data-workspace-board-trigger]').click()
  await expect(board).toHaveCount(0)

  const sidebarWidthFor = (width: number): number => (width >= 1440 ? 470 : width > 320 ? 280 : 220)
  for (const width of WIDTHS) {
    await orcaPage.setViewportSize({ width, height: width >= 1440 ? 900 : 760 })
    await orcaPage.evaluate(
      ({ sidebarWidth, rightOpen }) => {
        const store = window.__store!.getState()
        store.setSidebarWidth(sidebarWidth)
        store.setRightSidebarOpen(rightOpen)
      },
      { sidebarWidth: sidebarWidthFor(width), rightOpen: width > 390 }
    )
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      const where = `${width}px ${theme}`
      await openMenu(orcaPage)
      await menu.evaluate((node) =>
        Promise.all(node.getAnimations({ subtree: true }).map((one) => one.finished))
      )
      const fit = await menuOverflow(orcaPage)
      expect(fit.left, `${where}: the menu leaves the window on the left`).toBeGreaterThanOrEqual(0)
      expect(fit.right, `${where}: the menu leaves the window on the right`).toBeLessThanOrEqual(
        fit.windowWidth
      )
      expect(fit.menuScrolls, `${where}: the menu scrolls sideways`).toBeLessThanOrEqual(0)
      expect(fit.clipped, `${where}: text clipped inside the menu`).toEqual([])
      expect(fit.outside, `${where}: content outside the menu`).toEqual([])
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`sort-menu-${width}-${theme}.png`)
      })
      await orcaPage.keyboard.press('Escape')
    }
  }
})
