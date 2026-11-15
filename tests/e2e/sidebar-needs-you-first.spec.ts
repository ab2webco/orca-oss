/**
 * ORCA-1216 §4: active projects sort Needs you first — Needs you, At risk, Working, Rest — and
 * each header says why. Inside a tier the order is frozen; a project moves only when its tier does.
 */

import type { Page } from '@stablyai/playwright-test'
import type { StoreApi } from 'zustand'
import type { SidebarTeamRoster } from '../../src/renderer/src/components/sidebar/sidebar-team-roster'
import type { TeamLeadCard, TeamMemberCard } from '../../src/shared/team-panel-model-types'
import type { AgentStatusEntry } from '../../src/shared/agent-status-types'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { dismissWorkspaceBoardMovedHint } from './helpers/workspace-board-moved-hint'

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __sidebarTeamRosterStore?: StoreApi<SidebarTeamRoster>
  }
}

const WIDTHS = [1440, 768, 390, 320]
const PREFIX = 'e2e-ny-'
const ACTIVE_AT_0800 = [
  'cineco-frontend',
  'orca-oss',
  'koombea-website',
  'certified-received',
  'koombea-ai-workflows'
]

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

/** The §4 08:00 sidebar: one project per tier, plus two idle ones. */
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
      throw new Error('Needs you first E2E needs the seeded repo')
    }
    const now = Date.now()
    const min = 60 * 1000
    const hour = 60 * min
    const day = 24 * hour
    const repos = [...state.repos]
    const worktreesByRepo = { ...state.worktreesByRepo }
    worktreesByRepo[sourceRepo.id] = (worktreesByRepo[sourceRepo.id] ?? []).map((w) => ({
      ...w,
      lastActivityAt: now - 6 * hour
    }))
    const add = (name: string, workspaces: [string, number][]) => {
      const id = `${prefix}${name}`
      // Why no host owner: the PR cache key of a local repo is `<repoId>::<branch>`.
      repos.push({
        ...sourceRepo,
        id,
        path: `${sourceRepo.path}-${id}`,
        displayName: name,
        connectionId: null,
        executionHostId: undefined
      })
      worktreesByRepo[id] = workspaces.map(([branch, age], n) => ({
        ...sourceWorktree,
        id: `${id}-${branch}`,
        repoId: id,
        path: `${sourceWorktree.path}-${id}-${branch}`,
        displayName: branch,
        branch: `refs/heads/${branch}`,
        isMainWorktree: n === 0,
        isArchived: false,
        isPinned: false,
        lastActivityAt: now - age
      }))
    }
    add('cineco-frontend', [
      ['main', day + hour],
      ['aerin', 4.5 * min]
    ])
    add('cineco-prototype', [['main', 2 * day]])
    add('orca-oss', [
      ['main', 25 * min],
      ['orca-1198', 40 * min]
    ])
    add('koombea-website', [
      ['main', 2 * day],
      ['hero', 12 * min]
    ])
    add('certified-received', [
      ['main', 3 * day],
      ['handover', 30 * min]
    ])
    add('koombea-ai-workflows', [
      ['main', 2 * day],
      // Why off the hour: the shared clock ticks every 30 s, so an exact 3 h can still read 2 h.
      ['timesheet', 3 * hour + 5 * min]
    ])
    add('project-hub', [
      ['main', 21 * day],
      ['spike', 14 * day]
    ])
    store.setState({ repos, worktreesByRepo })
    const next = store.getState()
    next.setActiveView('terminal')
    next.setSidebarOpen(true)
    next.setSidebarWidth(470)
    next.setRightSidebarOpen(false)
    next.setGroupBy('repo')
    next.setProjectOrderBy('needs-you')
    next.setFilterRepoIds([])
    if (next.collapsedGroups.has('idle-projects')) {
      next.toggleCollapsedGroup('idle-projects')
    }
  }, PREFIX)
}

/** Live hook rows (a question, running agents) and the failing PR, as the app stores them. */
async function seedSignals(page: Page): Promise<void> {
  await page.evaluate((prefix) => {
    const store = window.__store!
    const now = Date.now()
    const agent = (
      worktreeId: string,
      n: number,
      state: AgentStatusEntry['state']
    ): AgentStatusEntry => ({
      state,
      prompt: '',
      updatedAt: now,
      stateStartedAt: now,
      paneKey: `${prefix}tab-${n}:00000000-0000-4000-8000-00000000000${n}`,
      worktreeId: `${prefix}${worktreeId}`,
      agentType: 'claude',
      stateHistory: []
    })
    const rows = [
      agent('cineco-frontend-aerin', 1, 'waiting'),
      // orca-oss has an agent working, but its failing PR outranks it.
      agent('orca-oss-main', 2, 'working'),
      agent('koombea-website-hero', 3, 'working'),
      agent('certified-received-handover', 4, 'working')
    ]
    store.setState((s) => ({
      agentStatusByPaneKey: {
        ...s.agentStatusByPaneKey,
        ...Object.fromEntries(rows.map((row) => [row.paneKey, row]))
      },
      prCache: {
        ...s.prCache,
        [`${prefix}orca-oss::orca-1198`]: {
          data: {
            number: 1205,
            title: 'Delivered PR',
            state: 'open' as const,
            url: 'https://github.com/acme/orca/pull/1205',
            checksStatus: 'failure' as const,
            updatedAt: new Date(now).toISOString(),
            mergeable: 'UNKNOWN' as const
          },
          fetchedAt: now
        }
      },
      sortEpoch: s.sortEpoch + 1,
      agentStatusEpoch: s.agentStatusEpoch + 1
    }))
  }, PREFIX)
}

/** cineco-prototype's main hits its account limit: the team roster is the app's only source. */
async function hitAccountLimit(page: Page): Promise<void> {
  await page.evaluate((prefix) => {
    const store = window.__store!
    const roster = window.__sidebarTeamRosterStore
    if (!roster) {
      throw new Error('window.__sidebarTeamRosterStore is not available')
    }
    const now = Date.now()
    const id = `${prefix}cineco-prototype`
    store.setState((s) => ({
      worktreesByRepo: {
        ...s.worktreesByRepo,
        // Why 1 min: it must be newer than cineco-frontend's frozen entry (seed − 4.5 min) however fast the run is.
        [id]: (s.worktreesByRepo[id] ?? []).map((w) => ({ ...w, lastActivityAt: now - 60_000 }))
      }
    }))
    const facts = {
      terminalHandle: null,
      host: { kind: 'local' as const },
      agentType: 'claude',
      since: now,
      liveAction: null,
      model: null,
      account: null,
      characterKey: null
    }
    const lead: TeamLeadCard = {
      ...facts,
      paneKey: `${prefix}lead`,
      worktreeId: `${prefix}no-lead-worktree`,
      name: 'Lead',
      status: 'idle',
      condition: 'idle',
      branch: null,
      ownerAsk: null
    }
    const member: TeamMemberCard = {
      ...facts,
      paneKey: `${prefix}member`,
      worktreeId: `${id}-main`,
      name: 'Toad',
      status: 'risk',
      condition: 'limited',
      ticket: null,
      branch: 'main',
      flowPhase: null,
      summary: null,
      pr: null,
      needsYou: false,
      limitResetsAt: now + 3 * 60 * 60_000,
      found: false
    }
    roster.setState({ model: { lead, members: [member] } })
  }, PREFIX)
}

/** Active project headers in render order, by name; the seeded repo's own project as `[source]`. */
async function activeOrder(page: Page): Promise<string[]> {
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
    return (idleAt === -1 ? ordered : ordered.slice(0, idleAt)).map((entry) =>
      entry.id?.startsWith(prefix) ? entry.id.slice(prefix.length) : '[source]'
    )
  }, PREFIX)
}

function header(page: Page, name: string) {
  return page.locator(`[data-worktree-sidebar] [data-repo-header-id="${PREFIX}${name}"]`).first()
}

/** The reason's text colour and glyph colour, beside the token values they must equal. */
async function reasonColors(page: Page, name: string) {
  return page.evaluate((repoId) => {
    const reason = document.querySelector<HTMLElement>(
      `[data-worktree-sidebar] [data-repo-header-id="${repoId}"] [data-project-reason]`
    )
    const probe = (value: string) => {
      const span = document.createElement('span')
      span.style.color = `var(${value})`
      document.body.append(span)
      const color = getComputedStyle(span).color
      span.remove()
      return color
    }
    const text = reason?.querySelector<HTMLElement>('[data-project-reason-text]')
    const dot = reason?.querySelector<HTMLElement>('[data-status-tone] > span')
    return {
      text: text ? getComputedStyle(text).color : null,
      dot: dot ? getComputedStyle(dot).backgroundColor : null,
      spinner: dot?.hasAttribute('data-agent-spinner')
        ? getComputedStyle(dot).borderRightColor
        : null,
      weight: text ? getComputedStyle(text).fontWeight : null,
      size: text ? getComputedStyle(text).fontSize : null,
      attention: probe('--status-attention'),
      warning: probe('--status-warning'),
      info: probe('--status-info'),
      muted: probe('--muted-foreground')
    }
  }, `${PREFIX}${name}`)
}

test('active projects sort Needs you first, frozen inside a tier, with the reason on each header', async ({
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

  // 08:00 — tiers in order; the seeded repo's own project is Rest, last by its activity.
  await expect
    .poll(() => activeOrder(orcaPage), { timeout: 30_000 })
    .toEqual([...ACTIVE_AT_0800, '[source]'])
  await expect(header(orcaPage, 'cineco-frontend').locator('[data-project-reason]')).toHaveText(
    '1 pregunta'
  )
  await expect(header(orcaPage, 'orca-oss').locator('[data-project-reason]')).toHaveText('CI falla')
  await expect(header(orcaPage, 'koombea-website').locator('[data-project-reason]')).toHaveText(
    '1 trabajando'
  )
  await expect(header(orcaPage, 'certified-received').locator('[data-project-reason]')).toHaveText(
    '1 trabajando'
  )
  // Rest shows its age in the same slot.
  await expect(
    header(orcaPage, 'koombea-ai-workflows').locator('[data-project-reason]')
  ).toHaveCount(0)
  await expect(header(orcaPage, 'koombea-ai-workflows').locator('[data-activity-age]')).toHaveText(
    '3 h'
  )

  const question = await reasonColors(orcaPage, 'cineco-frontend')
  expect(question.text).toBe(question.attention)
  expect(question.dot).toBe(question.attention)
  expect(question.weight).toBe('400')
  expect(question.size).toBe('11px')
  const ci = await reasonColors(orcaPage, 'orca-oss')
  expect(ci.text).toBe(ci.warning)
  expect(ci.dot).toBe(ci.warning)
  const working = await reasonColors(orcaPage, 'koombea-website')
  expect(working.text).toBe(working.muted)
  expect(working.spinner).toBe(working.info)

  await orcaPage.mouse.move(1000, 600)
  await orcaPage.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('needs-you-0800-1440-dark.png')
  })
  const before = await activeOrder(orcaPage)

  // New output in certified-received, newer than koombea-website: the tier holds, so it stays.
  await orcaPage.evaluate((id) => {
    const store = window.__store!
    store.setState((s) => ({
      worktreesByRepo: {
        ...s.worktreesByRepo,
        [id]: (s.worktreesByRepo[id] ?? []).map((w) =>
          // Why 2 min 40 s: the shared clock can lag 30 s, and an exact 2 min then reads 1 min.
          w.isMainWorktree ? w : { ...w, lastActivityAt: Date.now() - 2 * 60_000 - 40_000 }
        )
      }
    }))
  }, `${PREFIX}certified-received`)
  await expect(
    orcaPage.locator(
      `[data-worktree-id="${PREFIX}certified-received-handover"] [data-activity-age]`
    )
  ).toHaveText('2 min')
  expect(await activeOrder(orcaPage)).toEqual(before)

  // cineco-prototype hits its account limit: it enters Needs you at the top; nothing else moves.
  await hitAccountLimit(orcaPage)
  await expect
    .poll(() => activeOrder(orcaPage), { timeout: 30_000 })
    .toEqual(['cineco-prototype', ...before])
  await expect(header(orcaPage, 'cineco-prototype').locator('[data-project-reason]')).toHaveText(
    'Cuenta limitada'
  )
  const limited = await reasonColors(orcaPage, 'cineco-prototype')
  expect(limited.text).toBe(limited.attention)
  await expect(header(orcaPage, 'orca-oss').locator('[data-project-reason]')).toHaveText('CI falla')

  // 08:20 at every width, both themes, Spanish; right panel closed at 390 and 320.
  const sidebar = orcaPage.locator('[data-worktree-sidebar]')
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
      await header(orcaPage, 'cineco-prototype').scrollIntoViewIfNeeded()
      await expect(header(orcaPage, 'cineco-prototype'), where).toBeVisible()
      const fit = await sidebar.evaluate((node) => {
        const right = node.getBoundingClientRect().right
        const reasons = [...node.querySelectorAll('[data-project-reason]')].map(
          (reason) => reason.getBoundingClientRect().right
        )
        return {
          overflow: node.scrollWidth - node.clientWidth,
          reasonsOutside: reasons.filter((reasonRight) => reasonRight > right + 0.5).length
        }
      })
      expect(fit.overflow, `sidebar scrolls sideways at ${where}`).toBeLessThanOrEqual(0)
      expect(fit.reasonsOutside, `a reason escapes the sidebar at ${where}`).toBe(0)
      await orcaPage.mouse.move(width - 5, 700)
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`needs-you-0820-${width}-${theme}.png`)
      })
      // The Rest tier (age in the reason slot) and En reposo sit below the fold.
      await header(orcaPage, 'koombea-ai-workflows').scrollIntoViewIfNeeded()
      await expect(
        header(orcaPage, 'koombea-ai-workflows').locator('[data-activity-age]'),
        where
      ).toBeVisible()
      await orcaPage.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(`needs-you-0820-rest-${width}-${theme}.png`)
      })
    }
  }
})
