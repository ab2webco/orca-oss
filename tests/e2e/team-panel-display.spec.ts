import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import { setTheme, THEMES, WIDTHS } from './helpers/settings-window'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'

const GB = 1024 ** 3
// Why: every page, width, theme and language outruns the CI budget; ORCA_CAPTURE_EVIDENCE=1 runs it.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
const LANGUAGES = ['en', 'es'] as const
const PAGES = {
  en: ['Summary', 'Delivery', 'Quality', 'Machines', 'Usage'],
  es: ['Resumen', 'Entrega', 'Calidad', 'Máquinas', 'Uso']
} as const
const NEXT = { en: 'Next metric', es: 'Métrica siguiente' } as const
const PAUSE = { en: 'Pause the carousel', es: 'Pausar el carrusel' } as const

const day = (offset: number): string =>
  new Date(Date.UTC(2026, 10, 6) - offset * 86_400_000).toISOString().slice(0, 10)
// What game.state's metrics carry on a real host: merges per day, lead time and account use.
const METRICS = {
  computedAt: '2026-11-06T12:00:00.000Z',
  timezone: 'UTC',
  mergedPerDay: Array.from({ length: 14 }, (_, index) => ({
    day: day(13 - index),
    merged: [2, 0, 3, 1, 4, 2, 0, 6, 4, 7, 5, 3, 1, 5][index]
  })),
  leadTime: { medianMs: 6_120_000, measured: 9 },
  claudeAccounts: [
    { email: 'scloud@x.test', active: true, sessionPercent: 6, weeklyPercent: 31 },
    { email: 'fabianal@x.test', active: false, sessionPercent: 40, weeklyPercent: 88 },
    { email: 'fabiana@x.test', active: false, sessionPercent: null, weeklyPercent: 4 }
  ]
}
const machine = (cores: number, total: number, free: number, load: number) => ({
  status: 'ok',
  cpuCoreCount: cores,
  totalMemory: total * GB,
  availableMemory: free * GB,
  loadAverage1m: load
})
const WORK = {
  project: {
    reviews: { provider: 'github', total: 0, url: null, items: [] },
    todo: { provider: 'plane', total: 0, url: null, items: [] },
    queue: {
      provider: 'github',
      entries: [
        {
          id: '#915',
          title: 'Launch E2E',
          url: 'https://github.com/o/r/pull/915',
          position: 1,
          state: 'checks',
          since: null
        },
        {
          id: '#916',
          title: 'Dependabot',
          url: 'https://github.com/o/r/pull/916',
          position: 2,
          state: 'waiting',
          since: null
        }
      ]
    }
  },
  hostCapacity: [
    { host: 'local', running: 1, cap: 4, ...machine(14, 36, 21, 4.9) },
    { host: 'm1', running: 0, cap: 5, ...machine(8, 16, 14, 2.2) },
    { host: 'imac', running: 0, cap: 2, status: 'unreachable' }
  ]
}

type RuntimeCall = (event: unknown, args: { method: string }) => Promise<{ result?: object }>
type Rig = typeof globalThis & { __displayOverlay?: Record<string, unknown> }

async function overlayGameState(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    const { _invokeHandlers: handlers } = ipcMain as unknown as {
      _invokeHandlers: Map<string, RuntimeCall>
    }
    const real = handlers.get('runtime:call')!
    ipcMain.removeHandler('runtime:call')
    ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
      const response = await real(event, args)
      if (args.method !== 'game.state' || !response.result) {
        return response
      }
      return {
        ...response,
        result: { ...response.result, ...(globalThis as Rig).__displayOverlay }
      }
    })
  })
}

const setOverlay = (
  electronApp: ElectronApplication,
  overlay: Record<string, unknown>
): Promise<void> =>
  electronApp.evaluate((_, next) => {
    ;(globalThis as Rig).__displayOverlay = next
  }, overlay)

// Why through another tab: the panel re-reads on mount, far sooner than its 20 s poll.
async function rereadPanel(page: Page): Promise<void> {
  await page.evaluate(() => window.__store!.getState().setRightSidebarTab('explorer'))
  await page.evaluate(() => window.__store!.getState().setRightSidebarTab('team'))
}

const setLook = (page: Page, look: 'game' | 'display' | 'plain'): Promise<void> =>
  page.evaluate(
    (next) =>
      window.__store!.getState().updateSettings({ orchestratorGame: { panel: { look: next } } }),
    look
  )

// A soft check: names every label the narrow panel cuts and every block row squeezed to nothing.
async function expectNothingCut(page: Page, label: string): Promise<void> {
  const cut = await page.getByTestId('team-panel').evaluate((node) => {
    const carousel = node.querySelector('[aria-roledescription="carousel"]')!
    const texts = [...carousel.querySelectorAll<HTMLElement>('[data-team-display-stage] span')]
      .filter((one) => one.children.length === 0 && one.scrollWidth > one.clientWidth + 1)
      .map((one) => one.textContent)
    const squeezed = [...carousel.querySelectorAll<HTMLElement>('[data-team-display-blocks]')]
      .filter((one) => one.getClientRects().length > 0 && one.getBoundingClientRect().width < 24)
      .map(() => 'blocks')
    return [...texts, ...squeezed]
  })
  expect.soft(cut, `cut: ${label}`).toEqual([])
}

async function expectNoSidewaysScroll(page: Page, label: string): Promise<void> {
  const overflow = await page.getByTestId('team-panel').evaluate((node) => {
    const carousel = node.querySelector('[aria-roledescription="carousel"]')
    return Math.max(
      node.scrollWidth - node.clientWidth,
      carousel ? carousel.scrollWidth - carousel.clientWidth : 0
    )
  })
  expect.soft(overflow, `overflows sideways: ${label}`).toBeLessThanOrEqual(0)
}

// A real lead's game.state drives the panel; metrics and host data are laid over its answer.
test('the Display look draws a metrics carousel from real game.state metrics', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(900_000)
  const agent = createStdinLoggingAgent()
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActivePanePtyId(orcaPage)
    const pane = await waitForActivePaneHookDescriptor(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    const lead = (
      await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
        paneKey: pane.paneKey
      })
    ).result.terminal.handle
    await client.call('terminal.send', { terminal: lead, text: agent.command, enter: true })
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
    await expect(orcaPage.getByText('Workspace board moved to the bottom bar').first()).toBeHidden({
      timeout: 15_000
    })

    await overlayGameState(electronApp)
    await setOverlay(electronApp, { ...WORK, metrics: METRICS })
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.updateSettings({ uiLanguage: 'en' })
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
    })
    const panel = orcaPage.getByTestId('team-panel')
    const carousel = panel.locator('[aria-roledescription="carousel"]')
    const title = carousel.locator('[data-team-display-title]')

    // Plain draws no carousel; Display draws it in place of the scene.
    await setLook(orcaPage, 'plain')
    await expect(panel.getByRole('tab', { name: 'Team' })).toBeVisible({ timeout: 30_000 })
    await expect(carousel).toHaveCount(0)
    if (CAPTURE_EVIDENCE) {
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        await panel.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`plain-${width}.png`)
        })
      }
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
    }
    await setLook(orcaPage, 'display')
    if (CAPTURE_EVIDENCE) {
      // Why before the carousel check: the same capture on the old code shows what Display drew there.
      await orcaPage.waitForTimeout(1_000)
      for (const width of WIDTHS) {
        await orcaPage.setViewportSize({ width, height: 900 })
        await panel.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath(`display-first-${width}.png`)
        })
      }
      await orcaPage.setViewportSize({ width: 1440, height: 900 })
    }
    await expect(carousel).toBeVisible({ timeout: 10_000 })

    // It turns by itself when nothing holds it.
    await orcaPage.mouse.move(0, 0)
    await expect(title).toHaveText('Summary')
    await expect(title).toHaveText('Delivery', { timeout: 12_000 })

    // Today's merges and the queue length are the host's, not samples.
    await carousel.getByRole('button', { name: 'Summary' }).click()
    await expect(
      carousel.locator('[data-team-display-kpi]').nth(2).getByRole('img')
    ).toHaveAttribute('aria-label', '2')
    await expect(
      carousel.locator('[data-team-display-kpi]').nth(3).getByRole('img')
    ).toHaveAttribute('aria-label', '5')

    for (const language of LANGUAGES) {
      await orcaPage.evaluate(
        (next) => window.__store!.getState().updateSettings({ uiLanguage: next }),
        language
      )
      await carousel.getByRole('button', { name: PAUSE[language] }).click()
      await carousel.getByRole('button', { name: PAGES[language][0] }).click()
      for (const name of PAGES[language]) {
        await expect(title).toHaveText(name)
        await orcaPage.mouse.move(0, 0)
        for (const width of CAPTURE_EVIDENCE ? WIDTHS : ([1440, 320] as const)) {
          await orcaPage.setViewportSize({ width, height: 900 })
          for (const theme of CAPTURE_EVIDENCE ? THEMES : (['dark'] as const)) {
            await setTheme(orcaPage, theme)
            await expectNoSidewaysScroll(orcaPage, `${name} ${width} ${theme} ${language}`)
            await expectNothingCut(orcaPage, `${name} ${width} ${theme} ${language}`)
            if (CAPTURE_EVIDENCE) {
              await panel.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(
                  `display-${language}-${PAGES.en[PAGES[language].indexOf(name as never)]}-${width}-${theme}.png`
                )
              })
            }
          }
        }
        await orcaPage.setViewportSize({ width: 1440, height: 900 })
        await carousel.getByRole('button', { name: NEXT[language] }).click()
      }
      // Resume, so the next language starts from a running carousel.
      await carousel
        .getByRole('button', {
          name: language === 'en' ? 'Resume the carousel' : 'Reanudar el carrusel'
        })
        .click()
    }

    // A host that publishes no metrics: every page says what it lacks.
    await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ uiLanguage: 'en' }))
    await setOverlay(electronApp, {})
    await rereadPanel(orcaPage)
    await carousel.getByRole('button', { name: PAUSE.en }).click()
    await carousel.getByRole('button', { name: 'Delivery' }).click()
    await expect(carousel).toContainText('No lead time yet', { timeout: 30_000 })
    for (const name of PAGES.en) {
      await carousel.getByRole('button', { name }).click()
      await orcaPage.mouse.move(0, 0)
      if (CAPTURE_EVIDENCE) {
        for (const width of [1440, 320] as const) {
          await orcaPage.setViewportSize({ width, height: 900 })
          await panel.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath(`nodata-${name}-${width}.png`)
          })
        }
        await orcaPage.setViewportSize({ width: 1440, height: 900 })
      }
    }
  } finally {
    agent.dispose()
  }
})
