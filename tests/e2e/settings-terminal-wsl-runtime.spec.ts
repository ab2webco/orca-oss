import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { THEMES, WIDTHS, setTheme, setWindowWidth } from './helpers/settings-window'
import { writeSettings } from './helpers/settings-write'

const DISTRO = 'Ubuntu-24.04'

async function stubWindowsHostWithWsl(app: ElectronApplication, page: Page): Promise<void> {
  const status = await page.evaluate(() => window.api.runtime.getStatus())
  await app.evaluate(
    ({ ipcMain }, fixture) => {
      ipcMain.removeHandler('runtime:getStatus')
      ipcMain.handle('runtime:getStatus', () => ({ ...fixture.status, hostPlatform: 'win32' }))
      ipcMain.removeHandler('wsl:isAvailable')
      ipcMain.handle('wsl:isAvailable', () => true)
      ipcMain.removeHandler('wsl:listDistros')
      ipcMain.handle('wsl:listDistros', () => [fixture.distro])
    },
    { status, distro: DISTRO }
  )
  // Why: Settings loads the Windows capabilities only for a Windows renderer.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      configurable: true
    })
  })
}

test.describe('Settings → Terminal: WSL default runtime on Windows', () => {
  test('sets the WSL default project runtime from the Windows shell section', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await stubWindowsHostWithWsl(electronApp, orcaPage)
    await writeSettings(orcaPage, { localWindowsRuntimeDefault: { kind: 'windows-host' } })
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setSettingsSearchQuery('')
      state.openSettingsTarget({ pane: 'terminal', repoId: null })
      state.openSettingsPage()
    })

    const shellHeader = orcaPage.getByRole('heading', { name: 'Windows Shell' })
    await expect(shellHeader).toBeVisible({ timeout: 15_000 })
    const runtimeControl = orcaPage.getByRole('radiogroup', { name: 'Default project runtime' })
    await expect(runtimeControl).toBeVisible()

    await runtimeControl.getByRole('radio', { name: 'WSL' }).click()
    await expect
      .poll(() =>
        orcaPage.evaluate(() => window.__store!.getState().settings?.localWindowsRuntimeDefault)
      )
      .toEqual({ kind: 'wsl', distro: DISTRO })
    await expect(orcaPage.getByRole('combobox').filter({ hasText: DISTRO })).toBeVisible()

    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        await setWindowWidth(electronApp, orcaPage, width)
        await setTheme(orcaPage, theme)
        await shellHeader.evaluate((element) => element.scrollIntoView({ block: 'start' }))
        await orcaPage.screenshot({
          path: testInfo.outputPath(`terminal-wsl-${width}-${theme}.png`)
        })
      }
    }
  })
})
