/**
 * ORCA-1216 §2.3–2.4: every row carries its age, and idle projects sit in a collapsible
 * "En reposo · N proyectos" group after the active ones, newest first. The window is a setting.
 */

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { dismissWorkspaceBoardMovedHint } from './helpers/workspace-board-moved-hint'
import { worktreeRow } from './worktree-row-locators'

const WIDTHS = [1440, 768, 390, 320]

type Seeded = Record<'cineco' | 'koombea' | 'notes', string> & { hub: string[] }

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
      throw new Error('Age split E2E needs the seeded repo')
    }
    const now = Date.now()
    const min = 60 * 1000
    const hour = 60 * min
    const day = 24 * hour
    const repos = [...state.repos]
    // Why: the seeded repo's own workspace is current, so its project is active; age it like the rest.
    const worktreesByRepo = { ...state.worktreesByRepo }
    worktreesByRepo[sourceRepo.id] = (worktreesByRepo[sourceRepo.id] ?? []).map((w) => ({
      ...w,
      lastActivityAt: now - 2 * min
    }))
    const addProject = (name: string, ages: number[], extra: { kind?: 'folder' } = {}) => {
      const id = `e2e-age-${name}`
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
        // Why: age -1 seeds a workspace with no activity timestamp.
        lastActivityAt: age < 0 ? 0 : now - age
      }))
      return worktreesByRepo[id].map((worktree) => worktree.id)
    }
    // Why off the boundaries: the shared 30 s clock can read up to 30 s behind the seed.
    const cineco = addProject('cineco-frontend', [4.5 * min])[0]!
    const koombea = addProject('koombea-website', [5 * hour + 15 * min])[0]!
    const notes = addProject('orca-notes', [30 * hour])[0]!
    addProject('certified-received-prototype', [6 * day + hour])
    addProject('fe-ai-prototype-driven', [7 * day + hour])
    const hub = addProject('project-hub', [21 * day + hour, 14 * day + hour])
    addProject('ab2web-landing', [21 * day + hour], { kind: 'folder' })
    addProject('scratch-blank', [-1])
    store.setState({ repos, worktreesByRepo })
    const next = store.getState()
    next.setActiveView('terminal')
    next.setSidebarOpen(true)
    next.setSidebarWidth(470)
    next.setRightSidebarOpen(false)
    next.setGroupBy('repo')
    next.setFilterRepoIds([])
    if (next.collapsedGroups.has('idle-projects')) {
      next.toggleCollapsedGroup('idle-projects')
    }
    return { cineco, koombea, notes, hub }
  })
}

/** Row labels in render order: project headers by name, the idle group as `[idle]`. */
async function headerOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sidebar = document.querySelector('[data-worktree-sidebar]')
    const nodes = sidebar
      ? [
          ...sidebar.querySelectorAll<HTMLElement>(
            '[data-repo-header-id], [data-idle-projects-group]'
          )
        ]
      : []
    return nodes
      .map((node) => ({
        top: node.getBoundingClientRect().top,
        label: node.hasAttribute('data-idle-projects-group')
          ? '[idle]'
          : (node.querySelector('.truncate')?.textContent ?? '')
      }))
      .sort((a, b) => a.top - b.top)
      .map((entry) => entry.label)
  })
}

function projectHeader(page: Page, name: string) {
  return page.locator(`[data-worktree-sidebar] [data-repo-header-id="e2e-age-${name}"]`).first()
}

test('every row shows its age, and idle projects sit in a collapsible En reposo group', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await writeSettings(orcaPage, { uiLanguage: 'es', sidebarActivityWindowHours: 24 })
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await setTheme(orcaPage, 'dark')
  const seeded = await seedProjects(orcaPage)
  await dismissWorkspaceBoardMovedHint(orcaPage)
  const sidebar = orcaPage.locator('[data-worktree-sidebar]')
  const group = sidebar.locator('[data-idle-projects-group]')

  // The group header: chevron, "En reposo", and its project count.
  await expect(group).toHaveCount(1, { timeout: 30_000 })
  await expect(group).toHaveAttribute('data-idle-projects-group', 'open')
  await expect(group).toContainText('En reposo')
  await expect(group.locator('[data-idle-projects-count]')).toHaveText('6 proyectos')

  // Workspace rows and project headers carry their short Spanish age.
  await expect(worktreeRow(orcaPage, seeded.cineco).locator('[data-activity-age]')).toHaveText(
    '4 min'
  )
  await expect(worktreeRow(orcaPage, seeded.koombea).locator('[data-activity-age]')).toHaveText(
    '5 h'
  )
  await expect(
    projectHeader(orcaPage, 'cineco-frontend').locator('[data-activity-age]')
  ).toHaveText('4 min')
  const idleAges: [string, string][] = [
    ['orca-notes', '1 d'],
    ['certified-received-prototype', '6 d'],
    ['fe-ai-prototype-driven', '1 sem'],
    ['project-hub', '2 sem'],
    ['ab2web-landing', '3 sem']
  ]
  for (const [name, age] of idleAges) {
    await expect(projectHeader(orcaPage, name).locator('[data-activity-age]'), name).toHaveText(age)
  }
  // No timestamp, no invented age.
  await expect(projectHeader(orcaPage, 'scratch-blank')).toBeVisible()
  await expect(projectHeader(orcaPage, 'scratch-blank').locator('[data-activity-age]')).toHaveCount(
    0
  )

  // Active projects first, then the idle group by age, newest first.
  const order = await headerOrder(orcaPage)
  const idleStart = order.indexOf('[idle]')
  expect(order.slice(idleStart)).toEqual([
    '[idle]',
    'orca-notes',
    'certified-received-prototype',
    'fe-ai-prototype-driven',
    'project-hub',
    'ab2web-landing',
    'scratch-blank'
  ])
  expect(order.slice(0, idleStart)).toEqual(
    expect.arrayContaining(['cineco-frontend', 'koombea-website'])
  )

  // Screenshots, Spanish: 1440 dark first, then every width in both themes.
  const sidebarWidthFor = (width: number): number => (width >= 1440 ? 470 : width > 320 ? 280 : 220)
  for (const width of WIDTHS) {
    await orcaPage.setViewportSize({ width, height: width >= 1440 ? 900 : 760 })
    await orcaPage.evaluate((w) => {
      const store = window.__store!.getState()
      store.setSidebarWidth(w)
      store.setRightSidebarOpen(false)
    }, sidebarWidthFor(width))
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      const where = `${width}px ${theme}`
      await group.scrollIntoViewIfNeeded()
      await expect(group, where).toBeVisible()
      const fit = await sidebar.evaluate((node) => {
        const right = node.getBoundingClientRect().right
        const ages = [...node.querySelectorAll('[data-activity-age]')].map(
          (age) => age.getBoundingClientRect().right
        )
        return {
          overflow: node.scrollWidth - node.clientWidth,
          agesOutside: ages.filter((ageRight) => ageRight > right + 0.5).length
        }
      })
      expect(fit.overflow, `sidebar scrolls sideways at ${where}`).toBeLessThanOrEqual(0)
      expect(fit.agesOutside, `an age escapes the sidebar at ${where}`).toBe(0)
      await orcaPage.mouse.move(width - 5, 700)
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`age-split-${width}-${theme}.png`)
      })
    }
  }
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  await orcaPage.evaluate(() => window.__store?.getState().setSidebarWidth(470))
  await setTheme(orcaPage, 'dark')

  // Collapse: the header stays with its count; the idle projects leave the list.
  await group.click()
  await expect(group).toHaveAttribute('data-idle-projects-group', 'collapsed')
  await expect(group).toHaveAttribute('aria-expanded', 'false')
  await expect(group.locator('[data-idle-projects-count]')).toHaveText('6 proyectos')
  await expect(projectHeader(orcaPage, 'project-hub')).toHaveCount(0)
  expect(
    await orcaPage.evaluate(() => window.__store?.getState().collapsedGroups.has('idle-projects'))
  ).toBe(true)
  await orcaPage.mouse.move(1000, 600)
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('age-split-collapsed-1440-dark.png')
  })

  // A reveal of a workspace inside the collapsed group opens the group and the project fold.
  await orcaPage.evaluate(
    (id) => window.__store?.getState().revealWorktreeInSidebar(id),
    seeded.hub[0]!
  )
  await expect(group).toHaveAttribute('data-idle-projects-group', 'open')
  await expect(worktreeRow(orcaPage, seeded.hub[0]!)).toBeVisible()
  await projectHeader(orcaPage, 'project-hub').locator('[data-idle-project-fold-chevron]').click()

  // Keyboard: Enter on the focused header toggles it like a click.
  await group.focus()
  await orcaPage.keyboard.press('Enter')
  await expect(group).toHaveAttribute('data-idle-projects-group', 'collapsed')
  await orcaPage.keyboard.press('Enter')
  await expect(group).toHaveAttribute('data-idle-projects-group', 'open')

  // The window is a setting: at 3 d, orca-notes (30 h) is active again.
  await writeSettings(orcaPage, { sidebarActivityWindowHours: 72 })
  await expect(group.locator('[data-idle-projects-count]')).toHaveText('5 proyectos')
  const wider = await headerOrder(orcaPage)
  expect(wider.indexOf('orca-notes')).toBeLessThan(wider.indexOf('[idle]'))
  await expect(worktreeRow(orcaPage, seeded.notes).locator('[data-activity-age]')).toHaveText('1 d')
  await writeSettings(orcaPage, { sidebarActivityWindowHours: 24 })
  await expect(group.locator('[data-idle-projects-count]')).toHaveText('6 proyectos')
})
