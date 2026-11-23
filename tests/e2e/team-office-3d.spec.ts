import { writeFile } from 'node:fs/promises'
import type { Locator, Page } from '@stablyai/playwright-test'
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
      // ORCA-1317: the idle and the finished members are in the games room, the rest at desks.
      await expect(canvas).toHaveAttribute('data-office3d-places', /:games/, { timeout: 30_000 })
      await expect(canvas).toHaveAttribute('data-office3d-places', /:desk/)
      await orcaPage.waitForTimeout(20_000)
      await canvas.screenshot({ path: testInfo.outputPath('lobby-members.png') })
      // The owner: the Office pans, zooms and follows the lead like Figures, following by default.
      await expect(canvas).toHaveAttribute('data-office3d-camera', 'lead')
      await canvas.screenshot({ path: testInfo.outputPath('camera-lead.png') })
      await panel.getByRole('button', { name: 'Show all' }).click()
      await expect(canvas).toHaveAttribute('data-office3d-camera', 'all')
      await orcaPage.waitForTimeout(2500)
      await canvas.screenshot({ path: testInfo.outputPath('camera-all.png') })
      const box = (await canvas.boundingBox())!
      const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2]
      await orcaPage.mouse.move(cx, cy)
      await orcaPage.mouse.down()
      await orcaPage.mouse.move(cx - 80, cy + 40, { steps: 6 })
      await orcaPage.mouse.up()
      await expect(canvas).toHaveAttribute('data-office3d-camera', 'free')
      const panned = await canvas.screenshot({ path: testInfo.outputPath('camera-pan.png') })
      // The owner: a plain wheel or trackpad scroll over the scene zooms it.
      await orcaPage.mouse.wheel(0, -400)
      await orcaPage.waitForTimeout(1500)
      const zoomed = await canvas.screenshot({ path: testInfo.outputPath('camera-zoom.png') })
      expect(Buffer.compare(panned, zoomed), 'the wheel did not zoom').not.toBe(0)
      // A pinch arrives as Ctrl with the wheel, and still zooms.
      await orcaPage.keyboard.down('Control')
      await orcaPage.mouse.wheel(0, 300)
      await orcaPage.keyboard.up('Control')
      await orcaPage.waitForTimeout(1500)
      const pinched = await canvas.screenshot({ path: testInfo.outputPath('camera-pinch.png') })
      expect(Buffer.compare(zoomed, pinched), 'the pinch did not zoom').not.toBe(0)
      await panel.getByRole('button', { name: 'Follow the lead' }).click()
      await expect(canvas).toHaveAttribute('data-office3d-camera', 'lead')
      await orcaPage.waitForTimeout(2500)
      await canvas.screenshot({ path: testInfo.outputPath('camera-follow.png') })
      // The owner: it opens at the 2D Office's height, three floors' strips, and grows by dragging.
      const tall = async () => Math.round((await canvas.boundingBox())!.height)
      expect(await tall()).toBe(336)
      const edge = panel.locator('[data-team-scene-office3d] [data-team-building-resize]')
      const grip = (await edge.boundingBox())!
      await orcaPage.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
      await orcaPage.mouse.down()
      await orcaPage.mouse.move(grip.x + grip.width / 2, grip.y + 120, { steps: 6 })
      await orcaPage.mouse.up()
      await expect.poll(tall).toBeGreaterThan(400)
      const kept = await orcaPage.evaluate(() => localStorage.getItem('orca.teamOffice3d.height'))
      expect(Number(kept)).toBe(await tall())
      await orcaPage.waitForTimeout(1500)
      await canvas.screenshot({ path: testInfo.outputPath('dragged.png') })
      await edge.dblclick()
      await expect.poll(tall).toBe(336)
    }
    // Why a wide window first: the sidebar is clamped to the room the window leaves it.
    await setWindowWidth(electronApp, orcaPage, 1440)
    await orcaPage.evaluate(() => {
      const s = window.__store!.getState()
      s.setRightSidebarOpen(true)
      s.setRightSidebarTab('team')
    })
    // The panel's container widths: its minimum, the common ones, a tall 410, 600 and the large view.
    for (const [name, width] of [
      ['panel-219', 220],
      ['panel-320', 320],
      ['panel-350', 350],
      ['panel-410', 410],
      ['panel-600', 600],
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
          // Why data-team-scene: Low resources draws no WebGL, so it carries no webgl attribute.
          const stage = panel.locator('[data-team-scene]')
          const measured = await stage.evaluate((n) => n.clientWidth)
          await writeFile(testInfo.outputPath(`office-${name}-${quality}.json`), String(measured))
          await stage.screenshot({
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

/** Sweeps the canvas until a pointer position lights `key`, so a figure is hovered by what it shows. */
async function hoverFigureOnCanvas(page: Page, canvas: Locator, key: string): Promise<void> {
  const box = (await canvas.boundingBox())!
  for (let fy = 0.1; fy <= 0.95; fy += 0.04) {
    for (let fx = 0.04; fx <= 0.96; fx += 0.04) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy)
      if ((await canvas.getAttribute('data-office3d-lit')) === key) {
        return
      }
    }
  }
  throw new Error(`no point on the Office lights ${key}`)
}

// ORCA-1336: a Team row and its Office figure light each other, the lead and advisor too.
test('hovering a Team row or a figure lights the other in the Office, and leaving clears it', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const { dispose } = await openOfficeTeam(electronApp, orcaPage, {
    members: team,
    jev: 'Jev · approves Ada’s Edit'
  })
  try {
    const panel = orcaPage.getByTestId('team-panel')
    const scene = panel.locator('[data-team-scene-webgl]')
    const canvas = panel.locator('[data-team-scene-office3d] canvas')
    const bo = panel.locator('[data-team-card="member"]').filter({ hasText: 'ORCA-402' })
    const lead = panel.locator('[data-team-card="lead"]')
    const advisor = panel.locator('[data-team-card="advisor"]')
    for (const theme of THEMES) {
      await writeSettings(orcaPage, office('high'))
      await setTheme(orcaPage, theme)
      await expect(scene).toHaveAttribute('data-team-scene-webgl', /on|off/, { timeout: 30_000 })
      const webgl = await scene.getAttribute('data-team-scene-webgl')
      testInfo.annotations.push({ type: 'webgl', description: String(webgl) })
      const boKey = (await bo.getAttribute('data-pane-key'))!

      if (webgl !== 'off') {
        await expect(canvas).toHaveAttribute('data-office3d-floors', '3', { timeout: 30_000 })
        // Jev sits in 3D only on a floor whose advisor has spoken.
        const advisors = await canvas.getAttribute('data-office3d-advisors')
        const rows = [
          [bo, boKey],
          [lead, 'lead'],
          ...(advisors !== '0' ? [[advisor, 'advisor'] as const] : [])
        ] as const
        for (const [row, key] of rows) {
          await row.hover()
          await expect(canvas).toHaveAttribute('data-office3d-lit', key)
          await expect(row).toHaveAttribute('data-team-card-lit', '')
          if (row === bo) {
            // The whole panel, so the hovered row and its ringed figure share one image.
            await orcaPage.waitForTimeout(500)
            await panel.screenshot({
              path: testInfo.outputPath(`office-hover-row-to-figure-${theme}.png`)
            })
          }
          await orcaPage.mouse.move(1, 1)
          await expect(canvas).toHaveAttribute('data-office3d-lit', '')
          await expect(row).not.toHaveAttribute('data-team-card-lit')
        }
        // Figure to row: a pointer over Bo's figure lights Bo's row.
        await hoverFigureOnCanvas(orcaPage, canvas, boKey)
        await expect(bo).toHaveAttribute('data-team-card-lit', '')
        await orcaPage.waitForTimeout(500)
        await panel.screenshot({
          path: testInfo.outputPath(`office-hover-figure-to-row-${theme}.png`)
        })
        await orcaPage.mouse.move(1, 1)
        await expect(canvas).toHaveAttribute('data-office3d-lit', '')
        await expect(bo).not.toHaveAttribute('data-team-card-lit')
        await orcaPage.waitForTimeout(500)
        await panel.screenshot({ path: testInfo.outputPath(`office-hover-clear-${theme}.png`) })
      } else {
        // WebGL is off on Linux E2E, so the Office is the 2D building: its lit label names the row.
        await expect(canvas).toHaveCount(0)
        await bo.hover()
        await expect(panel.locator(`[data-scene-who="${boKey}"]`)).toHaveCount(1)
        await expect(bo).toHaveAttribute('data-team-card-lit', '')
        await orcaPage.mouse.move(1, 1)
        await expect(panel.locator('[data-scene-who]')).toHaveCount(0)
        await expect(bo).not.toHaveAttribute('data-team-card-lit')
        for (const row of [lead, advisor]) {
          await row.hover()
          await expect(row).toHaveAttribute('data-team-card-lit', '')
          await orcaPage.mouse.move(1, 1)
          await expect(row).not.toHaveAttribute('data-team-card-lit')
        }
      }
    }
  } finally {
    dispose()
  }
})
