import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Why fixed values, not Date.now(): a deterministic instance key keeps the
// spec's first assertion reproducible instead of depending on wall-clock time.
const FIXTURE = {
  pid: 4242,
  startedAtMs: 1_700_000_000_000,
  dismissed: false
} as const

async function installStaleBundleNoticeBackend(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, fixture) => {
    ipcMain.removeHandler('pty:management:staleBundleNotice')
    ipcMain.handle('pty:management:staleBundleNotice', async () => ({
      stale: true,
      pid: fixture.pid,
      startedAtMs: fixture.startedAtMs,
      dismissed: fixture.dismissed
    }))

    ipcMain.removeHandler('pty:management:dismissStaleBundleNotice')
    ipcMain.handle('pty:management:dismissStaleBundleNotice', async () => ({ success: true }))
  }, FIXTURE)
}

/** Drives the real setting so the whole window repaints, not just the root
 *  class — a screenshot of a half-applied theme is not evidence of one. */
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

const SCREENSHOT_DIR =
  '/Volumes/Data/claude-tmp/claude-501/-Users-fabolivar-Projects-orca-oss/25493b05-5b3a-43ba-aebf-ecb1d1b991fb/orca-534-shots'
const WIDTHS = [1440, 768, 390, 320] as const
const THEMES = ['light', 'dark'] as const

test('daemon stale-bundle notice toast shows the restart remedy (ORCA-534)', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)

  await installStaleBundleNoticeBackend(electronApp)
  // Why a focus event: the hook only re-polls on mount + window focus. The
  // real mount already ran against the app's default (non-stale) handler, so
  // a synthetic focus is what makes it observe the just-installed fixture.
  await orcaPage.evaluate(() => window.dispatchEvent(new Event('focus')))

  const toast = orcaPage.locator('[data-sonner-toast]').filter({ hasText: /daemon restart/i })
  await expect(toast).toBeVisible({ timeout: 15_000 })
  await expect(toast).toContainText('A terminal fix needs a daemon restart')
  await expect(toast).toContainText('Restart it from Manage Sessions')
  const openManageSessionsButton = toast.getByRole('button', { name: 'Open Manage Sessions' })
  const dismissButton = toast.getByRole('button', { name: 'Dismiss' })
  await expect(openManageSessionsButton).toBeVisible()
  await expect(dismissButton).toBeVisible()

  for (const width of WIDTHS) {
    await orcaPage.setViewportSize({ width, height: 900 })
    for (const theme of THEMES) {
      await setTheme(orcaPage, theme)
      // The toast must survive every resize/theme swap in this loop — assert
      // it instead of only trusting the screenshot.
      await expect(toast).toBeVisible()
      await orcaPage.screenshot({ path: `${SCREENSHOT_DIR}/${width}-${theme}.png` })
    }
  }
})
