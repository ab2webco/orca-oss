import { writeFile } from 'node:fs/promises'
import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES } from './helpers/settings-window'
import { writeSettings } from './helpers/settings-write'
import { openOfficeTeam, type SeededMember } from './helpers/team-office-seed'

// ORCA-1302: Illustrated draws the Office as a 3D building, one floor per machine; Low resources
// keeps today's 2D Office.
const team: SeededMember[] = [
  { name: 'Ada · ORCA-401 Build', state: 'waiting' },
  { name: 'Bo · ORCA-402 Build', state: 'working' },
  { name: 'Cy · ORCA-403 Build', state: 'working', review: 'open' },
  { name: 'Di · ORCA-404 Build', state: 'done' },
  { name: 'Fi · ORCA-406 Build', state: 'waiting', host: 'm2' },
  { name: 'Gu · ORCA-407 Build', state: 'idle', host: 'gpu-box' }
]

test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

const office = (quality: 'high' | 'low') => ({
  pluginSystemEnabled: true,
  orchestratorGame: {
    scene: 'quest',
    panel: { look: 'game' as const, style: 'office' as const, quality }
  }
})

test('Illustrated draws the Office in 3D at every container width; Low resources keeps the 2D Office', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(300_000)
  const { dispose } = await openOfficeTeam(electronApp, orcaPage, {
    members: team,
    jev: 'Jev · approves Ada’s Edit'
  })
  try {
    const panel = orcaPage.getByTestId('team-panel')
    const scene = panel.locator('[data-team-scene-webgl]')
    const canvas = panel.locator('[data-team-scene-office3d] canvas')
    await writeSettings(orcaPage, office('high'))
    await expect(scene).toHaveAttribute('data-team-scene-webgl', /on|off/, { timeout: 30_000 })
    const webgl = await scene.getAttribute('data-team-scene-webgl')
    testInfo.annotations.push({ type: 'webgl', description: String(webgl) })
    if (webgl === 'off') {
      // Linux E2E runs with the GPU off, as a user with hardware acceleration off: the 2D Office.
      await expect(canvas).toHaveCount(0)
      await expect(panel.locator('[data-team-floor]').first()).toBeVisible()
    } else {
      // This machine plus the two paired machines the members run on.
      await expect(canvas).toHaveAttribute('data-office3d-floors', '3', { timeout: 30_000 })
      const before = await canvas.screenshot()
      await orcaPage.waitForTimeout(3000)
      expect(Buffer.compare(before, await canvas.screenshot()), 'the Office stood still').not.toBe(
        0
      )
    }
    // Why a wide window first: the sidebar is clamped to the room the window leaves it.
    await setWindowWidth(electronApp, orcaPage, 1440)
    await orcaPage.evaluate(() => {
      const s = window.__store!.getState()
      s.setRightSidebarOpen(true)
      s.setRightSidebarTab('team')
    })
    // The panel's container widths: its minimum, the two common ones, and the large view.
    for (const [name, width] of [
      ['panel-219', 220],
      ['panel-320', 320],
      ['panel-350', 350],
      ['large', 1120]
    ] as const) {
      await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), width)
      for (const quality of ['high', 'low'] as const) {
        await writeSettings(orcaPage, office(quality))
        for (const theme of THEMES) {
          await setTheme(orcaPage, theme)
          await orcaPage.waitForTimeout(1500)
          const overflow = await panel.evaluate((n) => n.scrollWidth - n.clientWidth)
          expect(overflow, `panel overflows at ${name} ${theme}`).toBeLessThanOrEqual(0)
          const stage = quality === 'high' && webgl === 'on' ? canvas : scene
          const measured = await stage.evaluate((n) => n.clientWidth)
          await writeFile(testInfo.outputPath(`office-${name}-${quality}.json`), String(measured))
          await scene.screenshot({
            path: testInfo.outputPath(`office-${name}-${quality}-${theme}.png`)
          })
        }
      }
      // Low resources is today's Office: its floors, never the 3D canvas.
      await expect(canvas).toHaveCount(0)
      await expect(panel.locator('[data-team-floor]').first()).toBeVisible()
    }
  } finally {
    dispose()
  }
})
