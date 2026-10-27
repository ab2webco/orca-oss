import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import type { TuiAgent } from '../../src/shared/tui-agent'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { THEMES, WIDTHS, setTheme, setWindowWidth } from './helpers/settings-window'

// Why: Claude Agent Teams runs in-process on Windows and WSL, so its row must not offer an install.
const TEAMS_LABEL = 'Claude Agent Teams'

async function openAgentsPane(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.setSettingsSearchQuery('')
    state.openSettingsTarget({ pane: 'agents', repoId: null })
    state.openSettingsPage()
  })
  await expect(page.getByText('Default Agent', { exact: true })).toBeVisible({ timeout: 15_000 })
}

async function stubWindowsHostRuntime(app: ElectronApplication, page: Page): Promise<void> {
  const status = await page.evaluate(() => window.api.runtime.getStatus())
  await app.evaluate(({ ipcMain }, fixture) => {
    ipcMain.removeHandler('runtime:getStatus')
    ipcMain.handle('runtime:getStatus', () => ({ ...fixture, hostPlatform: 'win32' }))
    ipcMain.removeHandler('wsl:isAvailable')
    ipcMain.handle('wsl:isAvailable', () => true)
    ipcMain.removeHandler('wsl:listDistros')
    ipcMain.handle('wsl:listDistros', () => ['Ubuntu'])
  }, status)
}

async function setDetectedAgents(page: Page, ids: TuiAgent[]): Promise<void> {
  await page.evaluate((next) => {
    window.__store!.setState({ detectedAgentIds: next })
  }, ids)
}

test.describe('Settings → Agents: Claude Agent Teams row', () => {
  test('offers an install for Claude Agent Teams on macOS', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await openAgentsPane(orcaPage)
    await setDetectedAgents(orcaPage, ['claude'])

    const teamsRow = orcaPage.locator('div.py-3').filter({ hasText: TEAMS_LABEL })
    await expect(teamsRow.locator('a[title="Install"]')).toHaveCount(1)
    await expect(orcaPage.getByRole('heading', { name: /^Runs in-process/ })).toHaveCount(0)

    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        await setWindowWidth(electronApp, orcaPage, width)
        await setTheme(orcaPage, theme)
        await teamsRow.evaluate((element) => element.scrollIntoView({ block: 'center' }))
        await orcaPage.screenshot({
          path: testInfo.outputPath(`macos-${width}-${theme}.png`)
        })
      }
    }
  })

  test('lists Claude Agent Teams as runs in-process on Windows', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await stubWindowsHostRuntime(electronApp, orcaPage)
    // Why: Settings loads the Windows capabilities only for a Windows renderer, so the user agent must say so before it opens.
    await orcaPage.evaluate(() => {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        configurable: true
      })
    })
    await openAgentsPane(orcaPage)
    await setDetectedAgents(orcaPage, ['claude'])

    const inProcessHeader = orcaPage.getByRole('heading', { name: /^Runs in-process/ })
    await expect(inProcessHeader).toBeVisible({ timeout: 15_000 })
    await expect(orcaPage.getByText('Runs in-process on Windows: teammates stay')).toBeVisible()

    const teamsRow = orcaPage.locator('div.py-3').filter({ hasText: TEAMS_LABEL })
    await expect(teamsRow).toHaveCount(1)
    await expect(teamsRow.locator('a[title="Install"]')).toHaveCount(0)

    for (const width of WIDTHS) {
      for (const theme of THEMES) {
        await setWindowWidth(electronApp, orcaPage, width)
        await setTheme(orcaPage, theme)
        await inProcessHeader.evaluate((element) => element.scrollIntoView({ block: 'center' }))
        await orcaPage.screenshot({
          path: testInfo.outputPath(`windows-${width}-${theme}.png`)
        })
      }
    }
  })
})
