/**
 * Invariant: a cluster's summary line ("3 AGENTS · 1 WORKSPACES") on the Agent Map never cuts its
 * own ring's outline or reaches another cluster, at 1440, 768, 390 and 320, in both themes and both
 * languages; and the Grid's sticky filter strip paints the sheet's surface (ORCA-1127).
 * Needs E2E: the label's extent is the real font's, and the ring's is the pop-out's fitted zoom.
 * ORCA_E2E_CAPTURE=1 also saves the map and the Grid at every width, theme and language.
 */

import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForSessionReady } from './helpers/store'
import {
  splitActiveTerminalPane,
  waitForPaneCount,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'

const CAPTURE = process.env.ORCA_E2E_CAPTURE === '1'
const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const
const SEEDED: { state: 'blocked' | 'working' | 'done'; title: string }[] = [
  { state: 'blocked', title: 'Needs a merge answer' },
  { state: 'working', title: 'Running the map label spec' },
  { state: 'done', title: 'Opened the PR' }
]
const COPY = {
  en: { grid: 'Grid', map: 'Agent Map' },
  es: { grid: 'Grid', map: 'Mapa de agentes' }
} as const

/** Why: the sheet slides in and the map eases to its fitted zoom; a measure inside either is stale. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function applySettings(page: Page, updates: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set(next)
    window.__store?.setState({ settings })
  }, updates)
}

async function setTheme(pages: Page[], theme: 'light' | 'dark'): Promise<void> {
  await applySettings(pages[0], { theme })
  for (const page of pages) {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(theme === 'dark')
  }
}

async function resize(
  app: ElectronApplication,
  page: Page,
  urlPart: string,
  width: number
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { size, part }) => {
      const target = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes(part)
      )
      target?.setMinimumSize(320, 400)
      target?.setSize(size, 900)
    },
    { size: width, part: urlPart }
  )
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
  await settle(page)
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (CAPTURE) {
    await settle(page)
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`) })
  }
}

/** Shown summary lines whose glyphs, with their 2 px halo, cut their ring's outline or reach another. */
async function crossingSummaries(popout: Page): Promise<{ shown: number; crossing: string[] }> {
  return popout.evaluate(() => {
    const HALO = 2
    const clusters = [...document.querySelectorAll('[data-agent-map-project-id]')].map((group) => {
      const ring = group.querySelector('.agent-map-project-ring')!.getBoundingClientRect()
      const r = ring.width / 2
      return {
        cx: ring.left + r,
        cy: ring.top + r,
        r,
        label: group.querySelector('.agent-map-project-count')
      }
    })
    const crossing: string[] = []
    let shown = 0
    for (const cluster of clusters) {
      if (!cluster.label) {
        continue
      }
      shown += 1
      const rect = cluster.label.getBoundingClientRect()
      const box = {
        left: rect.left - HALO,
        right: rect.right + HALO,
        top: rect.top - HALO,
        bottom: rect.bottom + HALO
      }
      const cuts = clusters.filter((ring) => {
        const inside = [box.left, box.right].every((x) =>
          [box.top, box.bottom].every((y) => Math.hypot(x - ring.cx, y - ring.cy) < ring.r)
        )
        const nearestX = Math.max(box.left, Math.min(ring.cx, box.right))
        const nearestY = Math.max(box.top, Math.min(ring.cy, box.bottom))
        const outside = Math.hypot(nearestX - ring.cx, nearestY - ring.cy) > ring.r
        return ring === cluster ? !inside && !outside : !outside
      })
      if (cuts.length > 0) {
        crossing.push(
          `${cluster.label.textContent} (${Math.round(rect.width)} px) on a ${Math.round(cluster.r * 2)} px ring`
        )
      }
    }
    return { shown, crossing }
  })
}

test('a cluster summary label never crosses a ring and the Grid strip paints the sheet', async ({
  orcaPage,
  electronApp
}, testInfo) => {
  test.setTimeout(CAPTURE ? 360_000 : 240_000)
  await waitForSessionReady(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await splitActiveTerminalPane(orcaPage, 'vertical')
  await splitActiveTerminalPane(orcaPage, 'horizontal')
  await waitForPaneCount(orcaPage, SEEDED.length)
  const snapshot = await waitForPaneIdentitySnapshot(orcaPage, SEEDED.length)
  const paneKeys = snapshot.panes.map((pane) => `${snapshot.tabId}:${pane.leafId}`)
  await orcaPage.evaluate(
    async ({ paneKeys, seeded }) => {
      const store = window.__store!
      const settings = await window.api.settings.set({ experimentalAgentDashboardPopout: true })
      store.setState({ settings })
      const now = Date.now()
      seeded.forEach(({ state, title }, index) => {
        store
          .getState()
          .setAgentStatus(
            paneKeys[index],
            { state, prompt: title, agentType: 'claude', lastAssistantMessage: title },
            title,
            { updatedAt: now, stateStartedAt: now - 60_000 }
          )
      })
      store.getState().setSidebarOpen(true)
      store.getState().setRightSidebarOpen(false)
    },
    { paneKeys, seeded: SEEDED }
  )

  const sheet = orcaPage.locator('[data-agent-dashboard-sheet]')
  const openSheet = async (): Promise<void> => {
    await orcaPage.evaluate(() => window.__store!.getState().setAgentDashboardDrawerOpen(true))
    await sheet.waitFor({ state: 'visible' })
    await settle(orcaPage)
  }

  // The Grid's sticky strip sits on the sheet, so it must paint the sheet's own surface.
  await applySettings(orcaPage, { uiLanguage: 'en' })
  await openSheet()
  await sheet.getByRole('button', { name: COPY.en.grid, exact: true }).dispatchEvent('click')
  const strip = sheet.locator('[data-agent-grid-controls]')
  await expect(strip).toBeVisible()
  for (const theme of THEMES) {
    await setTheme([orcaPage], theme)
    const [stripColor, sheetColor] = await Promise.all([
      strip.evaluate((element) => getComputedStyle(element).backgroundColor),
      sheet.evaluate((element) => getComputedStyle(element).backgroundColor)
    ])
    expect.soft(stripColor, `Grid strip surface in ${theme}`).toBe(sheetColor)
    for (const width of WIDTHS) {
      await resize(electronApp, orcaPage, 'index.html', width)
      await capture(orcaPage, testInfo, `grid-${width}-${theme}`)
    }
  }
  await resize(electronApp, orcaPage, 'index.html', 1440)

  let shownAtWidest = 0
  for (const language of ['en', 'es'] as const) {
    await applySettings(orcaPage, { uiLanguage: language })
    const popoutPromise = electronApp.waitForEvent('window')
    await orcaPage.evaluate(() => window.api.dashboard.openPopout?.('map'))
    const popout = await popoutPromise
    await popout.waitForLoadState('domcontentloaded')
    await expect(
      popout.getByRole('button', { name: COPY[language].map, exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(popout.locator('.agent-map-project-ring').first()).toBeVisible()
    for (const theme of THEMES) {
      await setTheme([orcaPage, popout], theme)
      for (const width of WIDTHS) {
        await resize(electronApp, popout, 'popout.html', width)
        const { shown, crossing } = await crossingSummaries(popout)
        if (width === 1440) {
          shownAtWidest += shown
        }
        expect.soft(crossing, `summary crosses a ring at ${width} ${theme} ${language}`).toEqual([])
        await capture(popout, testInfo, `map-${width}-${theme}-${language}`)
      }
    }
    // Why main-side close: the next language must mount a fresh pop-out, not reuse this one.
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((candidate) => candidate.webContents.getURL().includes('popout.html'))
        ?.destroy()
    })
    await expect.poll(() => popout.isClosed()).toBe(true)
  }
  // Why: a fix that never draws the line would pass the hit-test above vacuously.
  expect(shownAtWidest, 'no summary line drawn at 1440').toBeGreaterThan(0)
})
