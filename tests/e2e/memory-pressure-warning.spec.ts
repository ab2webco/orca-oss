/**
 * Invariant: under memory pressure the low-memory card names the heaviest terminals, Open
 * brings a terminal back from another view, Close asks before killing anything, Dismiss
 * reaches main for the current episode, and the Settings toggle persists (ORCA-600).
 * Needs E2E: the card is fixed-positioned over the real shell and must fit every width.
 */

import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const GIB = 1024 ** 3
const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const

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

async function setWidth(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  // Why: a BrowserWindow minWidth can clamp silently, and the screenshot would prove nothing.
  await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBe(width)
}

async function readActiveTerminal(
  page: Page
): Promise<{ tabId: string; ptyId: string; title: string }> {
  let found: { tabId: string; ptyId: string; title: string } | null = null
  await expect
    .poll(
      async () => {
        found = await page.evaluate(() => {
          const state = window.__store?.getState()
          const worktreeId = state?.activeWorktreeId
          if (!state || !worktreeId) {
            return null
          }
          const tab = (state.tabsByWorktree[worktreeId] ?? []).find(
            (candidate) => (state.ptyIdsByTabId[candidate.id] ?? []).length > 0
          )
          const ptyId = tab ? state.ptyIdsByTabId[tab.id]?.[0] : undefined
          return tab && ptyId
            ? {
                tabId: tab.id,
                ptyId,
                title: tab.customTitle || tab.title || tab.defaultTitle || ''
              }
            : null
        })
        return found !== null
      },
      { timeout: 30_000, message: 'no terminal tab ever bound a PTY' }
    )
    .toBe(true)
  return found!
}

test('low-memory card lists heavy terminals, opens, confirms close, dismisses; Settings toggle persists', async ({
  electronApp,
  orcaPage
}, testInfo: TestInfo) => {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const terminal = await readActiveTerminal(orcaPage)

  const state = {
    warning: {
      episodeId: 7,
      sweeping: false,
      reading: {
        totalMemory: 16 * GIB,
        availableMemory: 0.9 * GIB,
        swapTotal: 9.2 * GIB,
        swapUsed: 8.3 * GIB,
        kernelLevel: 'critical',
        readAt: Date.now()
      },
      panes: [
        {
          sessionId: `registry-${terminal.ptyId}`,
          ptyId: terminal.ptyId,
          paneKey: null,
          worktreeId,
          worktreeName: 'feature-memory-warning-with-a-long-name',
          repoName: 'cineco',
          memory: 5.3 * GIB,
          metric: 'phys-footprint',
          lastOutputAt: Date.now() - 2 * 24 * 3_600_000
        },
        {
          sessionId: 'memory-e2e-background-1',
          ptyId: 'memory-e2e-background-1',
          paneKey: null,
          worktreeId: null,
          worktreeName: 'Unattributed terminals',
          repoName: 'Other',
          memory: 1.8 * GIB,
          metric: 'phys-footprint',
          lastOutputAt: null
        },
        {
          sessionId: 'memory-e2e-background-2',
          ptyId: 'memory-e2e-background-2',
          paneKey: null,
          worktreeId: 'helpdesk::/srv/helpdesk',
          worktreeName: 'helpdesk',
          repoName: 'helpdesk_netsat',
          memory: 0.7 * GIB,
          metric: 'phys-footprint',
          lastOutputAt: Date.now() - 40 * 60_000
        }
      ]
    }
  }

  await electronApp.evaluate(({ BrowserWindow, ipcMain }, seeded) => {
    const record = globalThis as typeof globalThis & { __memoryDismissed?: number[] }
    record.__memoryDismissed = []
    ipcMain.removeHandler('memory:pressure:get')
    ipcMain.handle('memory:pressure:get', () => seeded)
    ipcMain.removeHandler('memory:pressure:dismiss')
    ipcMain.handle('memory:pressure:dismiss', (_event, episodeId: number) => {
      record.__memoryDismissed?.push(episodeId)
    })
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('memory:pressure:changed', seeded)
    }
  }, state)

  const card = orcaPage.getByTestId('memory-pressure-warning')
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Memory is running low')
  await expect(card).toContainText(terminal.title)
  await expect(card).toContainText('Background terminal')
  await expect(card).toContainText('5.30 GB')

  // Open brings the terminal back from Settings.
  await orcaPage.evaluate(() => window.__store?.getState().openSettingsPage())
  await expect
    .poll(async () => orcaPage.evaluate(() => window.__store?.getState().activeView))
    .toBe('settings')
  await card.getByRole('button', { name: 'Open' }).first().click()
  await expect
    .poll(async () => orcaPage.evaluate(() => window.__store?.getState().activeView))
    .toBe('terminal')
  await expect
    .poll(async () => orcaPage.evaluate(() => window.__store?.getState().activeTabId))
    .toBe(terminal.tabId)

  for (const width of WIDTHS) {
    await setWidth(orcaPage, width)
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      const fit = await card.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return { left: rect.left, right: rect.right, windowWidth: window.innerWidth }
      })
      expect(fit.left, `${width}px ${theme}`).toBeGreaterThanOrEqual(0)
      expect(fit.right, `${width}px ${theme}`).toBeLessThanOrEqual(fit.windowWidth)
      // Why: the floating-terminal trigger once sat over the last row's Close button.
      const coveredActions = await card.evaluate((node) =>
        Array.from(node.querySelectorAll('button'))
          // Disabled buttons have pointer-events: none, so hit-testing sees through them.
          .filter((button) => !button.disabled)
          .filter((button) => {
            const rect = button.getBoundingClientRect()
            const midY = rect.top + rect.height / 2
            // Mid-edges, not corners: hit-testing honours border-radius.
            const points = [
              [rect.left + rect.width / 2, midY],
              [rect.left + 2, midY],
              [rect.right - 2, midY]
            ]
            return points.some(([x, y]) => {
              const top = document.elementFromPoint(x, y)
              return !top || !button.contains(top)
            })
          })
          .map((button) => button.textContent?.trim() || button.getAttribute('aria-label'))
      )
      expect(coveredActions, `${width}px ${theme}: covered card actions`).toEqual([])
      await orcaPage.screenshot({ path: testInfo.outputPath(`card-${width}-${theme}.png`) })
    }
  }

  // Close asks first; Cancel kills nothing.
  await setWidth(orcaPage, 1440)
  await card.getByRole('button', { name: 'Close' }).nth(1).click()
  const dialog = orcaPage.getByRole('dialog', { name: 'Close Background terminal?' })
  await expect(dialog).toBeVisible()
  // The open animation fades and scales in; a mid-animation screenshot shows a layout nobody sees.
  await expect
    .poll(async () =>
      dialog.evaluate((node) => {
        const style = getComputedStyle(node)
        return style.opacity === '1' && new DOMMatrixReadOnly(style.transform).a === 1
      })
    )
    .toBe(true)
  await orcaPage.screenshot({ path: testInfo.outputPath('close-confirm-1440-dark.png') })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(card).toContainText('Background terminal')

  await card.getByRole('button', { name: 'Dismiss' }).click()
  await expect(card).toBeHidden()
  await expect
    .poll(async () =>
      electronApp.evaluate(
        () => (globalThis as typeof globalThis & { __memoryDismissed?: number[] }).__memoryDismissed
      )
    )
    .toEqual([7])

  await orcaPage.evaluate(() => {
    const store = window.__store?.getState()
    store?.setSettingsSearchQuery('')
    store?.openSettingsTarget({
      pane: 'terminal',
      repoId: null,
      sectionId: 'memory-pressure-warning'
    })
    store?.openSettingsPage()
  })
  const section = orcaPage.locator('#memory-pressure-warning')
  await expect(section).toBeVisible({ timeout: 15_000 })
  const toggle = section.getByRole('switch', { name: 'Low memory warning' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await section.getByRole('radio', { name: '15%' }).click()
  await expect
    .poll(async () =>
      orcaPage.evaluate(
        async () => (await window.api.settings.get()).memoryPressureWarningThresholdPercent
      )
    )
    .toBe(15)

  for (const width of WIDTHS) {
    await setWidth(orcaPage, width)
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      await section.scrollIntoViewIfNeeded()
      await orcaPage.screenshot({ path: testInfo.outputPath(`settings-${width}-${theme}.png`) })
    }
  }

  await setWidth(orcaPage, 1440)
  await toggle.click()
  await expect
    .poll(async () =>
      orcaPage.evaluate(async () => (await window.api.settings.get()).memoryPressureWarningEnabled)
    )
    .toBe(false)
  await expect(section.getByRole('radio')).toHaveCount(0)
  await orcaPage.screenshot({ path: testInfo.outputPath('settings-off-1440-dark.png') })
})
