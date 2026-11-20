import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { writeSettings } from './helpers/settings-write'
import { openOfficeTeam, type SeededMember } from './helpers/team-office-seed'

// ORCA-1296: Figures as the 3D diorama, one island per machine, each member at its own plot.
const team: SeededMember[] = [
  { name: 'Ada · ORCA-401 Build', state: 'waiting' },
  { name: 'Bo · ORCA-402 Build', state: 'working' },
  { name: 'Cy · ORCA-403 Build', state: 'working', review: 'open' },
  { name: 'Di · ORCA-404 Build', state: 'done' },
  { name: 'Fi · ORCA-406 Build', state: 'working', host: 'm2' },
  { name: 'Gu · ORCA-407 Build', state: 'idle', host: 'gpu-box' }
]

test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

test('Figures draws the team as the diorama, an island per machine, at every width', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team })
  try {
    const panel = orcaPage.getByTestId('team-panel')
    await writeSettings(orcaPage, {
      orchestratorGame: { scene: 'quest', panel: { look: 'game', style: 'figures', diorama: true } }
    })
    const canvas = panel.locator('[data-team-scene-diorama] canvas')
    await expect(canvas).toBeVisible({ timeout: 30_000 })
    // Home plus the two paired machines the members run on.
    await expect(canvas).toHaveAttribute('data-diorama-islands', '3', { timeout: 30_000 })
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
        await panel.screenshot({ path: testInfo.outputPath(`diorama-${width}-${theme}.png`) })
      }
    }
  } finally {
    dispose()
  }
})
