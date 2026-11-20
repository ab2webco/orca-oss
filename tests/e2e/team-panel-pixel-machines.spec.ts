import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { writeSettings } from './helpers/settings-write'
import { openOfficeTeam, type SeededMember } from './helpers/team-office-seed'

// ORCA-1296: Pixel lays a team on several machines out a floor per machine, never stacked seats.
const team: SeededMember[] = [
  { name: 'Ada · ORCA-401 Build', state: 'waiting' },
  { name: 'Bo · ORCA-402 Build', state: 'working' },
  { name: 'Cy · ORCA-403 Build', state: 'working', host: 'm2' },
  { name: 'Di · ORCA-404 Build', state: 'idle', host: 'm2' },
  { name: 'Fi · ORCA-406 Build', state: 'working', host: 'gpu-box' }
]

test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

test('Pixel draws a team on three machines as a floor per machine', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team })
  try {
    const panel = orcaPage.getByTestId('team-panel')
    await writeSettings(orcaPage, {
      orchestratorGame: { scene: 'quest', panel: { look: 'game', style: 'pixel' } }
    })
    const building = panel.locator('[data-team-building]')
    await expect(building).toBeVisible({ timeout: 30_000 })
    await expect(panel.locator('[data-team-scene]')).toHaveAttribute('data-team-scene', 'pixel')
    // All, plus one button per machine: this one, m2 and gpu-box.
    await expect(building.locator('nav button')).toHaveCount(4)
    for (const width of WIDTHS) {
      await setWindowWidth(electronApp, orcaPage, width)
      await orcaPage.evaluate((wide) => {
        const s = window.__store!.getState()
        s.setRightSidebarOpen(true)
        s.setRightSidebarTab('team')
        if (wide) {
          s.setRightSidebarWidth(350)
        }
      }, width === 1440)
      for (const theme of THEMES) {
        await setTheme(orcaPage, theme)
        await orcaPage.waitForTimeout(700)
        const overflow = await panel.evaluate((n) => n.scrollWidth - n.clientWidth)
        expect(overflow, `panel overflows at ${width} ${theme}`).toBeLessThanOrEqual(0)
        await panel.screenshot({
          path: testInfo.outputPath(`pixel-machines-${width}-${theme}.png`)
        })
      }
    }
  } finally {
    dispose()
  }
})
