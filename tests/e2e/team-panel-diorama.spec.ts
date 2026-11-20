import type { Locator } from '@stablyai/playwright-test'
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

/** Whether the diorama got WebGL: 'on' once it drew its islands, 'off' once it fell back to 2D. */
async function dioramaWebgl(panel: Locator): Promise<'on' | 'off'> {
  const state = async () => {
    const scene = panel.locator('[data-team-scene-webgl]')
    if ((await scene.getAttribute('data-team-scene-webgl')) === 'off') {
      return 'off'
    }
    const islands = await panel
      .locator('[data-team-scene-diorama] canvas')
      .getAttribute('data-diorama-islands')
      .catch(() => null)
    return islands ? 'on' : 'pending'
  }
  await expect.poll(state, { timeout: 30_000 }).not.toBe('pending')
  return (await state()) as 'on' | 'off'
}

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
    const webgl = await dioramaWebgl(panel)
    testInfo.annotations.push({ type: 'webgl', description: webgl })
    if (webgl === 'off') {
      // Linux E2E runs with the GPU off, as a user with hardware acceleration off: Figures in 2D.
      await expect(panel.getByRole('img', { name: 'Live team scene' })).toBeVisible()
      await expect(canvas).toHaveCount(0)
    } else {
      // Home plus the two paired machines the members run on.
      await expect(canvas).toHaveAttribute('data-diorama-islands', '3')
      // The lead walks its round: the stage is not the same picture three seconds later.
      const before = await canvas.screenshot({ path: testInfo.outputPath('diorama-motion-a.png') })
      await orcaPage.waitForTimeout(3000)
      const after = await canvas.screenshot({ path: testInfo.outputPath('diorama-motion-b.png') })
      expect(Buffer.compare(before, after), 'the diorama stood still').not.toBe(0)
    }
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
