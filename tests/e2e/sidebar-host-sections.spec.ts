/**
 * ORCA-1216 §9 / ORCA-1181: with no host filter, every host that has rows gets its own card, its
 * own active and En reposo split, and project headers that read the repo name. An offline host
 * names the age of its last data and dims its rows instead of counting agents. Needs E2E: the
 * cards, headers and dimming are the real virtualized sidebar.
 */

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { writeSettings } from './helpers/settings-write'
import { dismissWorkspaceBoardMovedHint } from './helpers/workspace-board-moved-hint'
import {
  seedPairedHostSidebar,
  setSeededHostConnection,
  type SeededHostRepo
} from './helpers/paired-host-sidebar-fixture'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const M1 = 'e2e-m1'
const CONTABO = 'e2e-orca-contabo'
const PAIRED_ORCA_OSS = 'e2e-hosts-m1-orca-oss'
const LOCAL_ORCA_OSS = 'e2e-hosts-orca-oss'
// Owner's width at 1440; the shell's default and minimum below it (proposal §3).
const WIDTHS = [
  { viewport: 1440, sidebar: 470 },
  { viewport: 768, sidebar: 280 },
  { viewport: 390, sidebar: 280 },
  { viewport: 320, sidebar: 220 }
]

const repo = (
  id: string,
  displayName: string,
  activityAgeMs: number,
  extra: Partial<SeededHostRepo> = {}
): SeededHostRepo => ({ id, displayName, workspaces: 2, activityAgeMs, ...extra })

// orca-oss: the same repo at the same path on this computer and m1, active on both.
// koombea-website: one project on both hosts, active here and idle on m1.
const SEED = {
  local: [
    repo(LOCAL_ORCA_OSS, 'orca-oss', 3 * MINUTE, { path: 'orca-oss', remote: 'orca-oss' }),
    repo('e2e-hosts-koombea', 'koombea-website', 20 * MINUTE, { remote: 'koombea-website' }),
    repo('e2e-hosts-cineco', 'cineco-frontend', 10 * MINUTE),
    repo('e2e-hosts-ab2web', 'ab2web-landing', 3 * DAY, { workspaces: 1 }),
    repo('e2e-hosts-hub', 'project-hub', 9 * DAY)
  ],
  hosts: [
    {
      connectionId: M1,
      label: 'm1',
      repos: [
        repo(PAIRED_ORCA_OSS, 'orca-oss', 3 * MINUTE, { path: 'orca-oss', remote: 'orca-oss' }),
        repo('e2e-hosts-m1-koombea', 'koombea-website', 4 * DAY, { remote: 'koombea-website' }),
        repo('e2e-hosts-m1-scripts', 'm1-scripts', 5 * DAY, { workspaces: 1 })
      ]
    },
    {
      connectionId: CONTABO,
      label: 'orca-contabo',
      repos: [repo('e2e-hosts-contabo-orca-oss', 'orca-oss', 2 * DAY, { path: 'srv-orca-oss' })]
    }
  ],
  visibleHostIds: null,
  sidebarWidth: 470
}

type HostSection = {
  label: string
  offline: string | null
  active: string | null
  projects: string[]
  folded: string[]
  idleGroups: string[]
  rows: number
  dimmedRows: number
  undimmedRows: number
}

/** Reads the drawn sidebar top to bottom, grouping each row under the host card above it. */
async function readHostSections(page: Page): Promise<HostSection[]> {
  return page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('[data-worktree-sidebar] [data-worktree-virtual-row]')
    ).sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
    const sections: HostSection[] = []
    for (const row of rows) {
      const card = row.querySelector<HTMLElement>('[data-host-header-drag-id]')
      if (card) {
        sections.push({
          label: card.querySelector('.truncate')?.textContent ?? '',
          offline: card.querySelector('[data-host-header-offline]')?.textContent ?? null,
          active: card.querySelector('[data-host-header-active]')?.textContent ?? null,
          projects: [],
          folded: [],
          idleGroups: [],
          rows: 0,
          dimmedRows: 0,
          undimmedRows: 0
        })
        continue
      }
      const section = sections.at(-1)
      if (!section) {
        continue
      }
      section.rows += 1
      const content = row.firstElementChild
      const opacity = content ? Number(getComputedStyle(content).opacity) : 1
      if (row.hasAttribute('data-host-offline-row') && opacity < 0.7) {
        section.dimmedRows += 1
      } else {
        section.undimmedRows += 1
      }
      const project = row.querySelector('[data-repo-header-id] .text-\\[12\\.5px\\]')
      if (project) {
        section.projects.push(project.textContent ?? '')
        if (row.querySelector('[data-idle-project-fold]')) {
          section.folded.push(project.textContent ?? '')
        }
      }
      const idle = row.querySelector('[data-idle-projects-count]')
      if (idle) {
        section.idleGroups.push(idle.textContent ?? '')
      }
    }
    return sections
  })
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await writeSettings(page, { theme })
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
}

test.describe('host sections without a host filter (ORCA-1181)', () => {
  test('draws a card per host with its own split, repo names and an offline age', async ({
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    // Tall enough that the virtualizer draws every seeded row, so the read covers all three hosts.
    await orcaPage.setViewportSize({ width: 1440, height: 1500 })
    await writeSettings(orcaPage, { uiLanguage: 'es', theme: 'dark' })
    await seedPairedHostSidebar(orcaPage, SEED)
    await setSeededHostConnection(orcaPage, M1, 'connected')
    await setSeededHostConnection(orcaPage, CONTABO, 'connected')

    const cards = orcaPage.locator('[data-worktree-sidebar] [data-host-header-drag-id]')
    await expect(cards).toHaveCount(3, { timeout: 30_000 })
    // The session sees orca-contabo live before it drops, so its card can say how long ago.
    await expect(
      orcaPage.locator(`[data-host-header-drag-id="ssh:${CONTABO}"] [data-host-header-active]`)
    ).toHaveCount(1)
    await setSeededHostConnection(orcaPage, CONTABO, 'disconnected')
    await expect(
      orcaPage.locator(`[data-host-header-drag-id="ssh:${CONTABO}"] [data-host-header-offline]`)
    ).toHaveText('Sin conexión · ahora')

    const sections = await readHostSections(orcaPage)
    testInfo.annotations.push({ type: 'host sections', description: JSON.stringify(sections) })
    expect(sections.map((section) => section.label)).toEqual(['Este equipo', 'm1', 'orca-contabo'])
    const [local, m1, contabo] = sections

    // Every host names the repo, never a path, even with the same path on two hosts.
    for (const section of sections) {
      expect(section.projects, `${section.label} project headers`).toContain('orca-oss')
      expect(section.projects.filter((label) => label.includes('/'))).toEqual([])
    }
    expect(local.projects).toEqual(expect.arrayContaining(['cineco-frontend', 'ab2web-landing']))
    expect(m1.projects).toEqual(['orca-oss', 'koombea-website', 'm1-scripts'])
    // One project, two hosts: active here, En reposo on m1 with m1's own workspaces.
    expect(local.folded).not.toContain('koombea-website')
    expect(m1.folded).toEqual(['koombea-website', 'm1-scripts'])

    // Each host splits its own idle projects off and counts only its own.
    expect(local.idleGroups).toEqual(['2 proyectos'])
    expect(m1.idleGroups).toEqual(['2 proyectos'])
    expect(contabo.idleGroups).toEqual(['1 proyecto'])

    // A live host counts agents; the offline one names its age instead and dims every row.
    expect(local.active).not.toBeNull()
    expect(m1.active).not.toBeNull()
    expect(contabo.active).toBeNull()
    expect(contabo.rows).toBeGreaterThan(0)
    expect(contabo.dimmedRows).toBe(contabo.rows)
    expect(local.dimmedRows + m1.dimmedRows).toBe(0)

    // Rows inside a section show no host name: the card above already names the host.
    // Why visible text only: the SSH control's icon keeps an sr-only name for screen readers.
    const m1RowsNamingHost = await orcaPage
      .locator(`[data-worktree-sidebar] [role="option"][data-worktree-id^="${PAIRED_ORCA_OSS}"]`)
      .evaluateAll((rows) =>
        rows.map((row) =>
          Array.from(row.querySelectorAll<HTMLElement>('*')).some((element) => {
            const rect = element.getBoundingClientRect()
            const ownText = Array.from(element.childNodes)
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent ?? '')
              .join('')
            return !element.closest('.sr-only') && rect.width > 1 && ownText.includes('m1')
          })
        )
      )
    expect(m1RowsNamingHost.length).toBeGreaterThan(0)
    expect(m1RowsNamingHost.filter(Boolean)).toEqual([])

    // Collapsing orca-oss under this computer leaves it open under m1.
    const toggleOrcaOssUnderLocal = (): Promise<void> =>
      orcaPage.evaluate(() => {
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-worktree-sidebar] [data-worktree-virtual-row]'
          )
        ).sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
        const secondHost = rows.findIndex(
          (row, index) => index > 0 && row.querySelector('[data-host-header-drag-id]')
        )
        const header = rows
          .slice(0, secondHost)
          .find(
            (row) =>
              row.querySelector('[data-repo-header-id] .text-\\[12\\.5px\\]')?.textContent ===
              'orca-oss'
          )
        header?.querySelector<HTMLElement>('[data-repo-header-collapse-affordance]')?.click()
      })
    const rowsOf = (repoId: string) =>
      orcaPage.locator(`[data-worktree-sidebar] [role="option"][data-worktree-id^="${repoId}-wt"]`)
    await expect(rowsOf(LOCAL_ORCA_OSS)).toHaveCount(2)
    await toggleOrcaOssUnderLocal()
    await expect(rowsOf(LOCAL_ORCA_OSS)).toHaveCount(0)
    await expect(rowsOf(PAIRED_ORCA_OSS)).toHaveCount(2)
    await toggleOrcaOssUnderLocal()
    await expect(rowsOf(LOCAL_ORCA_OSS)).toHaveCount(2)

    await dismissWorkspaceBoardMovedHint(orcaPage)
    await orcaPage.mouse.move(0, 0)
    for (const width of WIDTHS) {
      await orcaPage.setViewportSize({ width: width.viewport, height: 1500 })
      await orcaPage.evaluate((sidebar) => {
        const state = window.__store!.getState()
        state.setSidebarWidth(sidebar)
        state.setRightSidebarOpen(false)
      }, width.sidebar)
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await expect(cards).toHaveCount(3)
        await orcaPage.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`host-sections-${width.viewport}-${theme}.png`)
        })
      }
    }

    // The Projects filter mixes hosts, so a repeated name carries its host.
    await orcaPage.setViewportSize({ width: 1440, height: 1500 })
    await orcaPage.evaluate(() => window.__store!.getState().setSidebarWidth(470))
    await setTheme(orcaPage, 'dark')
    await orcaPage.evaluate(
      (id) => window.__store!.getState().setFilterRepoIds([id]),
      PAIRED_ORCA_OSS
    )
    // One host left with rows: no host card at all.
    await expect(cards).toHaveCount(0)
    await expect(
      orcaPage.locator(`[data-worktree-sidebar] [data-worktree-id^="${PAIRED_ORCA_OSS}"]`).first()
    ).toBeVisible()

    await orcaPage
      .locator('button[aria-label^="Opciones de espacio de trabajo"]:visible')
      .first()
      .click()
    const projectsTrigger = orcaPage.locator('[data-slot="dropdown-menu-sub-trigger"]', {
      hasText: /^Proyectos/
    })
    await expect(projectsTrigger).toContainText('orca-oss · m1')
    await projectsTrigger.click()
    const panel = orcaPage.locator('[data-slot="dropdown-menu-sub-content"]')
    await expect(panel.locator('[data-slot="badge"]')).toHaveText(['orca-oss · m1'])
    const options = panel.locator('[data-slot="command-item"]')
    // Why the optional SSH: an SSH project keeps its transport chip beside the name.
    await expect(options.filter({ hasText: 'orca-oss' })).toHaveText([
      /^orca-oss · Este equipo$/,
      /^orca-oss · orca-contabo(SSH)?$/
    ])
    await orcaPage.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('projects-filter-1440-dark.png')
    })
  })
})
