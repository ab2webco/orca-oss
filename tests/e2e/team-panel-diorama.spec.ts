import type { Locator } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES, WIDTHS } from './helpers/settings-window'
import { writeSettings } from './helpers/settings-write'
import { openOfficeTeam, seedOfficeTeam, type SeededMember } from './helpers/team-office-seed'

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
  const jev = 'Jev · approves Ada’s Edit'
  const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team, jev })
  try {
    const panel = orcaPage.getByTestId('team-panel')
    // Why the plugin system: the panel shows Jev only while it is on.
    await writeSettings(orcaPage, {
      pluginSystemEnabled: true,
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
      await expect(canvas).toHaveAttribute('data-diorama-advisor', 'tower', { timeout: 30_000 })
      // The lead walks its round: the stage is not the same picture three seconds later.
      const before = await canvas.screenshot({ path: testInfo.outputPath('diorama-motion-a.png') })
      await orcaPage.waitForTimeout(3000)
      const after = await canvas.screenshot({ path: testInfo.outputPath('diorama-motion-b.png') })
      expect(Buffer.compare(before, after), 'the diorama stood still').not.toBe(0)
      // The camera follows the lead; Show all frames the world, a drag frees it, Follow returns.
      await expect(canvas).toHaveAttribute('data-diorama-camera', 'lead')
      await panel.getByRole('button', { name: 'Show all' }).click()
      await expect(canvas).toHaveAttribute('data-diorama-camera', 'all')
      await orcaPage.waitForTimeout(2500)
      await canvas.screenshot({ path: testInfo.outputPath('diorama-camera-all.png') })
      const box = (await canvas.boundingBox())!
      await orcaPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await orcaPage.mouse.down()
      await orcaPage.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 + 30, {
        steps: 6
      })
      await orcaPage.mouse.up()
      await expect(canvas).toHaveAttribute('data-diorama-camera', 'free')
      await panel.getByRole('button', { name: 'Follow the lead' }).click()
      await expect(canvas).toHaveAttribute('data-diorama-camera', 'lead')
      await orcaPage.waitForTimeout(2500)
      await canvas.screenshot({ path: testInfo.outputPath('diorama-camera-lead.png') })
      // Direct pace brings the court mage; Low resources draws flat figures without shadows.
      for (const [name, look] of [
        ['mage', { pace: 'direct' }],
        ['low', { quality: 'low', pace: 'normal' }]
      ] as const) {
        await writeSettings(orcaPage, {
          pluginSystemEnabled: true,
          orchestratorGame: {
            scene: 'quest',
            panel: { look: 'game', style: 'figures', diorama: true, ...look }
          }
        })
        await panel.getByRole('button', { name: 'Show all' }).click()
        await orcaPage.waitForTimeout(2500)
        await expect(canvas).toHaveAttribute('data-diorama-islands', /\d/)
        await canvas.screenshot({ path: testInfo.outputPath(`diorama-${name}.png`) })
      }
      await writeSettings(orcaPage, {
        pluginSystemEnabled: true,
        orchestratorGame: {
          scene: 'quest',
          panel: { look: 'game', style: 'figures', diorama: true }
        }
      })
      await panel.getByRole('button', { name: 'Follow the lead' }).click()
      // Jev decides in Ada's pane, a member joins here and a machine connects with one more.
      await seedOfficeTeam(electronApp, {
        jev,
        members: [
          { ...team[0]!, decisions: [{ id: 'd1', verdict: 'allow', gesture: 'approved' }] },
          ...team.slice(1),
          { name: 'Ho · ORCA-408 Build', state: 'working' },
          { name: 'Io · ORCA-409 Build', state: 'working', host: 'm3' }
        ]
      })
      await expect(canvas).toHaveAttribute('data-diorama-cues', /bird:office:0/, {
        timeout: 30_000
      })
      await expect(canvas).toHaveAttribute('data-diorama-cues', /arrive:office:6/)
      await expect(canvas).toHaveAttribute('data-diorama-cues', /rise:m3/)
      await expect(canvas).toHaveAttribute('data-diorama-islands', '4')
      for (const [n, wait] of [
        [1, 400],
        [2, 1200],
        [3, 1500]
      ] as const) {
        await orcaPage.waitForTimeout(wait)
        await canvas.screenshot({ path: testInfo.outputPath(`diorama-moment-${n}.png`) })
      }
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

// ORCA-1336: a Team row rings its Figures figure; leaving the row clears the ring.
test('hovering a Team row rings its Figures figure and leaving clears it, at both looks', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const jev = 'Jev · approves Ada’s Edit'
  const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team, jev })
  try {
    const panel = orcaPage.getByTestId('team-panel')
    const canvas = panel.locator('[data-team-scene-diorama] canvas')
    const row = panel.locator('[data-team-card="member"]').filter({ hasText: 'Bo · ORCA-402' })
    for (const look of [
      { name: 'illustrated', quality: 'high' },
      { name: 'low', quality: 'low' }
    ] as const) {
      for (const theme of THEMES) {
        await writeSettings(orcaPage, {
          pluginSystemEnabled: true,
          orchestratorGame: {
            scene: 'quest',
            panel: { look: 'game', style: 'figures', diorama: true, quality: look.quality }
          }
        })
        await setTheme(orcaPage, theme)
        await expect(canvas).toHaveAttribute('data-diorama-islands', /\d/)
        const paneKey = (await row.getAttribute('data-pane-key'))!
        const tag = `${look.name}-${theme}`

        await row.hover()
        // The row's figure is the one the stage lights: the canvas names it by its pane key.
        await expect(canvas).toHaveAttribute('data-diorama-lit', paneKey)
        await expect(row).toHaveAttribute('data-team-card-lit', '')
        await orcaPage.waitForTimeout(500)
        await canvas.screenshot({ path: testInfo.outputPath(`hover-ring-${tag}.png`) })

        await orcaPage.mouse.move(1, 1)
        await expect(canvas).toHaveAttribute('data-diorama-lit', '')
        await expect(row).not.toHaveAttribute('data-team-card-lit')
        await orcaPage.waitForTimeout(500)
        await canvas.screenshot({ path: testInfo.outputPath(`hover-clear-${tag}.png`) })
      }
    }
  } finally {
    dispose()
  }
})
