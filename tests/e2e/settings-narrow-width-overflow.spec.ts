import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const
const GENERAL_PANES = ['general', 'agents', 'appearance', 'terminal', 'git'] as const

type PaneTarget = { pane: string; repoId: string | null }

// Why: a developer's ANDROID_HOME shows the SDK as found, hiding the wider not-found row CI renders.
test.use({ orcaAppExtraEnv: { ANDROID_HOME: '', ANDROID_SDK_ROOT: '' } })

type OverflowReport = {
  scrollWidth: number
  clientWidth: number
  shellScrollWidth: number
  shellClientWidth: number
  offenders: string[]
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate(async (next) => {
    const settings = await window.api.settings.set({ theme: next })
    window.__store?.setState({ settings })
  }, theme)
  await expect
    .poll(async () =>
      page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'))
    )
    .toBe(theme)
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

async function openPane(page: Page, target: PaneTarget): Promise<void> {
  await page.evaluate((next) => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget(next as Parameters<typeof state.openSettingsTarget>[0])
    state.openSettingsPage()
  }, target)
  const sectionId = target.pane === 'repo' ? `repo-${target.repoId}` : target.pane
  await expect(page.locator(`[data-settings-section="${sectionId}"]`)).toBeVisible({
    timeout: 15_000
  })
}

/** Measures the settings content scroller and names the elements that stick out of it. */
async function measureOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const section = document.querySelector<HTMLElement>('[data-settings-section]')
    const shell = document.querySelector<HTMLElement>('.settings-view-shell')
    let scroller = section?.parentElement ?? null
    while (scroller && getComputedStyle(scroller).overflowY === 'visible') {
      scroller = scroller.parentElement
    }
    if (!section || !shell || !scroller) {
      throw new Error('settings content scroller not found')
    }
    // Why the column's content box: a child reaching into the gutter still widens the scroller.
    const column = section.parentElement ?? scroller
    const columnRect = column.getBoundingClientRect()
    const columnStyle = getComputedStyle(column)
    const bounds = {
      left: columnRect.left + Number.parseFloat(columnStyle.paddingLeft),
      right: columnRect.right - Number.parseFloat(columnStyle.paddingRight)
    }
    // Why: content inside its own scroller or truncation box is contained by design.
    const clippedByInnerBox = (element: HTMLElement): boolean => {
      for (let node = element.parentElement; node && node !== scroller; node = node.parentElement) {
        if (getComputedStyle(node).overflowX !== 'visible') {
          return true
        }
      }
      return false
    }
    const sticksOut = (element: HTMLElement): boolean => {
      const rect = element.getBoundingClientRect()
      // Why scrollWidth: an unbreakable text run overflows its own box without moving its rect.
      const ownsOverflow =
        getComputedStyle(element).overflowX !== 'visible' || element instanceof HTMLInputElement
      const right = ownsOverflow
        ? rect.right
        : Math.max(rect.right, rect.left + element.scrollWidth)
      return rect.width > 0 && (right > bounds.right + 1 || rect.left < bounds.left - 1)
    }
    const candidates = Array.from(section.querySelectorAll<HTMLElement>('*')).filter(sticksOut)
    const uncontained = candidates.filter((element) => !clippedByInnerBox(element))
    // Why: when the scroller still overflows, name the contained elements too so the cause is visible.
    const overflowing = scroller.scrollWidth > scroller.clientWidth + 1
    const pool = uncontained.length === 0 && overflowing ? candidates : uncontained
    // Why innermost: ancestors of an overflowing control only repeat it.
    const offenders = pool
      .filter((element) => !pool.some((other) => other !== element && element.contains(other)))
      .slice(0, 6)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const text = (element.textContent ?? '').trim().slice(0, 40)
        return `${element.tagName.toLowerCase()} w=${Math.round(rect.width)} sw=${element.scrollWidth} right=${Math.round(rect.right)} class="${String(element.className).slice(0, 80)}" parent="${String(element.parentElement?.className ?? '').slice(0, 90)}" text="${text}"`
      })
    return {
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      shellScrollWidth: shell.scrollWidth,
      shellClientWidth: shell.clientWidth,
      offenders
    }
  })
}

async function scrollTo(page: Page, selector: string | null): Promise<void> {
  await page.evaluate((target) => {
    const section = document.querySelector<HTMLElement>('[data-settings-section]')
    const anchor = target ? document.querySelector<HTMLElement>(target) : null
    if (anchor) {
      anchor.scrollIntoView({ block: 'center' })
    } else {
      section?.scrollIntoView({ block: 'start' })
    }
  }, selector)
}

async function checkPane(
  app: ElectronApplication,
  page: Page,
  testInfo: TestInfo,
  name: string,
  anchor: string | null,
  failures: string[]
): Promise<void> {
  for (const theme of THEMES) {
    await setTheme(page, theme)
    for (const width of WIDTHS) {
      await setWindowWidth(app, page, width)
      await scrollTo(page, anchor)
      const report = await measureOverflow(page)
      const overflows =
        report.scrollWidth > report.clientWidth + 1 ||
        report.shellScrollWidth > report.shellClientWidth + 1 ||
        report.offenders.length > 0
      if (overflows) {
        failures.push(
          `${name} ${theme} ${width}: scroller ${report.scrollWidth}/${report.clientWidth}, shell ${report.shellScrollWidth}/${report.shellClientWidth}\n    ${report.offenders.join('\n    ')}`
        )
      }
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${theme}-${width}.png`)
      })
    }
  }
}

test('settings panes fit the window without horizontal overflow at every width', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  const failures: string[] = []

  for (const pane of GENERAL_PANES) {
    await setWindowWidth(electronApp, orcaPage, 1440)
    await openPane(orcaPage, { pane, repoId: null })
    await checkPane(electronApp, orcaPage, testInfo, pane, null, failures)
  }

  await setWindowWidth(electronApp, orcaPage, 1440)
  await openPane(orcaPage, { pane: 'general', repoId: null })
  await checkPane(
    electronApp,
    orcaPage,
    testInfo,
    'general-cli',
    'button[role="switch"][aria-label="Shell command"]',
    failures
  )

  await setWindowWidth(electronApp, orcaPage, 1440)
  await openPane(orcaPage, { pane: 'mobile-emulator', repoId: null })
  // Why: the toolchain rows render after an async availability probe; measuring earlier misses them.
  await expect(orcaPage.getByText('Android SDK', { exact: true })).toBeVisible({ timeout: 15_000 })
  await checkPane(
    electronApp,
    orcaPage,
    testInfo,
    'mobile-emulator',
    '[aria-label="Refresh emulator availability"]',
    failures
  )

  await setWindowWidth(electronApp, orcaPage, 1440)
  await openPane(orcaPage, { pane: 'agents', repoId: null })
  await checkPane(
    electronApp,
    orcaPage,
    testInfo,
    'agents-game',
    '[role="combobox"][aria-label="Default view"]',
    failures
  )

  const repoId = await orcaPage.evaluate(() => window.__store!.getState().repos[0]?.id ?? null)
  expect(repoId, 'the harness seeds one repo').not.toBeNull()
  await setWindowWidth(electronApp, orcaPage, 1440)
  await openPane(orcaPage, { pane: 'repo', repoId })
  await checkPane(electronApp, orcaPage, testInfo, 'repo', null, failures)
  await checkPane(
    electronApp,
    orcaPage,
    testInfo,
    'repo-game',
    '[role="combobox"][aria-label="Default view"]',
    failures
  )

  expect(failures, 'settings content overflows horizontally').toEqual([])
})

test('every settings pane in the sidebar fits the window at narrow widths', async ({
  electronApp,
  orcaPage
}) => {
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  await openPane(orcaPage, { pane: 'general', repoId: null })
  const navItems = orcaPage.locator('.settings-view-shell aside div.overflow-y-auto button')
  const count = await navItems.count()
  expect(count, 'the sidebar lists the settings panes').toBeGreaterThan(10)

  const failures: string[] = []
  const measured: string[] = []
  for (let index = 0; index < count; index += 1) {
    await setWindowWidth(electronApp, orcaPage, 1440)
    await navItems.nth(index).click()
    await expect(navItems.nth(index)).toHaveAttribute('aria-current', 'page')
    const section = orcaPage.locator('[data-settings-section]').first()
    await expect(section).toBeVisible({ timeout: 15_000 })
    const sectionId = (await section.getAttribute('data-settings-section')) ?? `#${index}`
    measured.push(sectionId)
    for (const width of [768, 390, 320]) {
      await setWindowWidth(electronApp, orcaPage, width)
      const report = await measureOverflow(orcaPage)
      if (
        report.scrollWidth > report.clientWidth + 1 ||
        report.shellScrollWidth > report.shellClientWidth + 1 ||
        report.offenders.length > 0
      ) {
        failures.push(
          `${sectionId} ${width}: scroller ${report.scrollWidth}/${report.clientWidth}, shell ${report.shellScrollWidth}/${report.shellClientWidth}\n    ${report.offenders.join('\n    ')}`
        )
      }
    }
  }

  expect(new Set(measured).size, 'each nav item opened its own pane').toBe(count)
  expect(failures, 'settings content overflows horizontally').toEqual([])
})
