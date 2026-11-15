/**
 * ORCA-1216 §7: an idle project (no activity in 24 h, no live agent, not current) is one row.
 * The row opens its workspace; the chevron unfolds it in place; a count pill marks 2+ workspaces.
 */

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { getActiveWorktreeId, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { worktreeRow } from './worktree-row-locators'

const WIDTHS = [1440, 768, 390, 320]

type Seeded = {
  hub: string[]
  lonely: string
  enterTarget: string
  folder: string
  active: string
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

async function seedProjects(page: Page): Promise<Seeded> {
  return page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const sourceRepo = state.repos[0]
    const sourceWorktree = sourceRepo ? (state.worktreesByRepo[sourceRepo.id] ?? [])[0] : undefined
    if (!sourceRepo || !sourceWorktree) {
      throw new Error('Idle fold E2E needs the seeded repo')
    }
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const repos = [...state.repos]
    const worktreesByRepo = { ...state.worktreesByRepo }
    const addProject = (
      name: string,
      ages: number[],
      extra: { kind?: 'folder' } = {}
    ): string[] => {
      const id = `e2e-fold-${name}`
      repos.push({
        ...sourceRepo,
        id,
        path: `${sourceRepo.path}-${id}`,
        displayName: name,
        ...extra
      })
      worktreesByRepo[id] = ages.map((age, n) => ({
        ...sourceWorktree,
        id: `${id}-wt-${n}`,
        repoId: id,
        path: `${sourceWorktree.path}-${id}-${n}`,
        displayName: n === 0 ? 'main' : `spike-${n}`,
        branch: n === 0 ? 'refs/heads/main' : `refs/heads/spike-${n}`,
        isMainWorktree: n === 0,
        isArchived: false,
        isPinned: false,
        lastActivityAt: now - age
      }))
      return worktreesByRepo[id].map((worktree) => worktree.id)
    }
    const active = addProject('koombea-website', [5 * 60 * 1000])[0]
    const crp = addProject('certified-received-prototype', [6 * day])[0]
    const fe = addProject('fe-ai-prototype-driven', [7 * day])[0]
    // spike-1 is the more recent one, so the row opens it.
    const hub = addProject('project-hub', [21 * day, 14 * day])
    const folder = addProject('ab2web-landing', [21 * day], { kind: 'folder' })[0]
    store.setState({ repos, worktreesByRepo })
    const next = store.getState()
    next.setActiveView('terminal')
    next.setSidebarOpen(true)
    next.setSidebarWidth(470)
    next.setRightSidebarOpen(false)
    next.setGroupBy('repo')
    next.setFilterRepoIds([])
    return { hub, lonely: crp, enterTarget: fe, folder, active }
  })
}

function projectRow(page: Page, label: string) {
  return page
    .locator('[data-worktree-sidebar] [data-idle-project-fold]')
    .filter({ hasText: label })
    .first()
}

test('an idle project is one row that opens its workspace, and its chevron unfolds it', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await setTheme(orcaPage, 'dark')
  const seeded = await seedProjects(orcaPage)
  const sidebar = orcaPage.locator('[data-worktree-sidebar]')

  // Folded: four idle projects, one row each; only the 2-workspace one carries a pill.
  await expect(sidebar.locator('[data-idle-project-fold="folded"]')).toHaveCount(4, {
    timeout: 30_000
  })
  await expect(worktreeRow(orcaPage, seeded.active)).toBeVisible()
  for (const id of [...seeded.hub, seeded.lonely, seeded.enterTarget, seeded.folder]) {
    await expect(worktreeRow(orcaPage, id), `${id} has a row while folded`).toHaveCount(0)
  }
  const pills = sidebar.locator('[data-idle-project-count]')
  await expect(pills).toHaveCount(1)
  await expect(projectRow(orcaPage, 'project-hub').locator('[data-idle-project-count]')).toHaveText(
    '2'
  )
  await expect(
    projectRow(orcaPage, 'ab2web-landing').locator('[data-idle-project-fold-chevron]')
  ).toHaveCount(0)
  await expect(
    projectRow(orcaPage, 'ab2web-landing').locator('[data-sidebar-tree-glyph="folder"]')
  ).toHaveCount(1)
  await expect(
    projectRow(orcaPage, 'project-hub').locator('[data-idle-project-fold-chevron]')
  ).toHaveCount(1)

  // Consecutive folded rows stack with no overlap: the size estimate matches the DOM.
  const boxes = await sidebar.locator('[data-idle-project-fold="folded"]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom }
    })
  )
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index]!.top, `folded row ${index} overlaps the one above`).toBeGreaterThanOrEqual(
      boxes[index - 1]!.bottom - 0.5
    )
  }
  await orcaPage.mouse.move(1000, 600)
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('idle-fold-folded-1440-dark.png')
  })

  // The chevron unfolds project-hub in place: header stays, its two rows appear under it.
  await projectRow(orcaPage, 'project-hub').locator('[data-idle-project-fold-chevron]').click()
  await expect(projectRow(orcaPage, 'project-hub')).toHaveAttribute(
    'data-idle-project-fold',
    'open'
  )
  for (const id of seeded.hub) {
    await expect(worktreeRow(orcaPage, id)).toBeVisible()
  }
  await expect(
    projectRow(orcaPage, 'project-hub').locator('[data-idle-project-count]')
  ).toHaveCount(0)
  await orcaPage.mouse.move(1000, 600)
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('idle-fold-opened-1440-dark.png')
  })

  // ...and folds back.
  await projectRow(orcaPage, 'project-hub').locator('[data-idle-project-fold-chevron]').click()
  await expect(projectRow(orcaPage, 'project-hub')).toHaveAttribute(
    'data-idle-project-fold',
    'folded'
  )
  for (const id of seeded.hub) {
    await expect(worktreeRow(orcaPage, id)).toHaveCount(0)
  }

  // Keyboard: ArrowRight unfolds the focused row, ArrowLeft folds it back.
  const hubRow = projectRow(orcaPage, 'project-hub')
  await hubRow.focus()
  await orcaPage.keyboard.press('ArrowRight')
  await expect(hubRow).toHaveAttribute('data-idle-project-fold', 'open')
  await expect(worktreeRow(orcaPage, seeded.hub[0]!)).toBeVisible()
  await orcaPage.keyboard.press('ArrowLeft')
  await expect(hubRow).toHaveAttribute('data-idle-project-fold', 'folded')
  await expect(worktreeRow(orcaPage, seeded.hub[0]!)).toHaveCount(0)

  // A reveal of a workspace behind the fold unfolds it, without activating it.
  const activeBeforeReveal = await getActiveWorktreeId(orcaPage)
  await orcaPage.evaluate(
    (id) => window.__store?.getState().revealWorktreeInSidebar(id),
    seeded.hub[0]!
  )
  await expect(hubRow).toHaveAttribute('data-idle-project-fold', 'open')
  await expect(worktreeRow(orcaPage, seeded.hub[0]!)).toBeVisible()
  expect(await getActiveWorktreeId(orcaPage)).toBe(activeBeforeReveal)
  await hubRow.locator('[data-idle-project-fold-chevron]').click()
  await expect(hubRow).toHaveAttribute('data-idle-project-fold', 'folded')
  await orcaPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  // The shell's sidebar range: the 280 px default at 768 and 390, the 220 px minimum at 320.
  const sidebarWidthFor = (width: number): number => (width >= 1440 ? 470 : width > 320 ? 280 : 220)
  for (const width of WIDTHS) {
    await orcaPage.setViewportSize({ width, height: 720 })
    await orcaPage.evaluate(
      (w) => window.__store?.getState().setSidebarWidth(w),
      sidebarWidthFor(width)
    )
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      const where = `${width}px ${theme}`
      await expect(hubRow, where).toBeVisible()
      const fit = await hubRow.evaluate((row) => {
        const pill = row.querySelector('[data-idle-project-count]')?.getBoundingClientRect()
        const rect = row.getBoundingClientRect()
        return pill ? { pillRight: pill.right, rowRight: rect.right, pillWidth: pill.width } : null
      })
      expect(fit, `pill missing at ${where}`).not.toBeNull()
      expect(fit!.pillWidth, `pill collapsed at ${where}`).toBeGreaterThan(6)
      expect(fit!.pillRight, `pill escapes its row at ${where}`).toBeLessThanOrEqual(fit!.rowRight)
      await orcaPage.mouse.move(width - 5, 700)
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`idle-fold-${width}-${theme}.png`)
      })
    }
  }
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await orcaPage.evaluate(() => window.__store?.getState().setSidebarWidth(470))

  // Clicking a folded row opens its workspace instead of toggling.
  await projectRow(orcaPage, 'certified-received-prototype').click()
  await expect.poll(() => getActiveWorktreeId(orcaPage)).toBe(seeded.lonely)

  // Enter on a focused folded row opens its workspace too.
  const enterRow = projectRow(orcaPage, 'fe-ai-prototype-driven')
  await expect(enterRow).toHaveAttribute('data-idle-project-fold', 'folded')
  await enterRow.focus()
  await orcaPage.keyboard.press('Enter')
  await expect.poll(() => getActiveWorktreeId(orcaPage)).toBe(seeded.enterTarget)
})
