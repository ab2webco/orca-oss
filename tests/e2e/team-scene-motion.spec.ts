import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { writeSettings } from './helpers/settings-write'
import { openOfficeTeam, seedOfficeTeam, type SeededMember } from './helpers/team-office-seed'

// Why @ondemand: ORCA-1336 item 5 asks for recordings of every movement before any fix; these
// frames are watched by a person, not asserted, so the suite shards never run them. Run with
// ORCA_E2E_FORCE_HEADFUL=1 --project electron-ondemand on a host whose WebGL draws.

test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

const JEV = 'Jev · approves Ada’s Edit'
const team: SeededMember[] = [
  { name: 'Ada · ORCA-401 Build', state: 'working' },
  { name: 'Bo · ORCA-402 Build', state: 'working' },
  { name: 'Cy · ORCA-403 Build', state: 'working' },
  { name: 'Fi · ORCA-406 Build', state: 'working', host: 'm2' },
  { name: 'Gu · ORCA-407 Build', state: 'working', host: 'gpu-box' }
]
const withState = (name: string, state: string) =>
  team.map((m) => (m.name.startsWith(name) ? { ...m, state } : m))

const office = {
  pluginSystemEnabled: true,
  orchestratorGame: {
    scene: 'quest',
    panel: { look: 'game' as const, style: 'office' as const, quality: 'high' as const }
  }
}
const figures = {
  pluginSystemEnabled: true,
  orchestratorGame: {
    scene: 'quest',
    panel: { look: 'game' as const, style: 'figures' as const, diorama: true }
  }
}

/** Saves the canvas about every 100 ms for `seconds`, each frame named by its time in ms. */
async function record(canvas: Locator, out: (f: string) => string, name: string, seconds: number) {
  const start = Date.now()
  let n = 0
  while (Date.now() - start < seconds * 1000) {
    const t = Date.now() - start
    await canvas.screenshot({ path: out(`${name}/${String(n).padStart(3, '0')}-${t}ms.png`) })
    n += 1
    const next = start + n * 100
    if (next > Date.now()) {
      await new Promise((r) => setTimeout(r, next - Date.now()))
    }
  }
  return n
}

/** Waits for the 3D scene and fails loudly where WebGL is off: the frames would show nothing. */
async function webglScene(page: Page, selector: string): Promise<Locator> {
  const panel = page.getByTestId('team-panel')
  const scene = panel.locator('[data-team-scene-webgl]')
  await expect(scene).toHaveAttribute('data-team-scene-webgl', /on|off/, { timeout: 30_000 })
  expect(await scene.getAttribute('data-team-scene-webgl'), 'WebGL is off on this host').toBe('on')
  const canvas = panel.locator(`${selector} canvas`)
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.__store!.getState().setRightSidebarWidth(420))
  return canvas
}

const follow = async (page: Page, mode: 'Follow the lead' | 'Show all') => {
  await page.getByTestId('team-panel').getByRole('button', { name: mode }).click()
  await page.waitForTimeout(1500)
}

test.describe('@ondemand ORCA-1336 movement recordings', () => {
  test.describe.configure({ timeout: 600_000 })

  test('Office: the lead rides the lift to a member upstairs who needs the user, and back', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team, jev: JEV })
    try {
      await writeSettings(orcaPage, office)
      const canvas = await webglScene(orcaPage, '[data-team-scene-office3d]')
      await follow(orcaPage, 'Follow the lead')
      await seedOfficeTeam(electronApp, { members: withState('Fi', 'waiting'), jev: JEV })
      await record(canvas, testInfo.outputPath, 'office-lead-lift-out', 30)
      await seedOfficeTeam(electronApp, { members: team, jev: JEV })
      await record(canvas, testInfo.outputPath, 'office-lead-lift-back', 30)
    } finally {
      dispose()
    }
  })

  test('Office: a member joins, walks in, rides up, sits; then stands, goes to the lobby, leaves', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team, jev: JEV })
    try {
      await writeSettings(orcaPage, office)
      const canvas = await webglScene(orcaPage, '[data-team-scene-office3d]')
      await follow(orcaPage, 'Show all')
      const ho = { name: 'Ho · ORCA-408 Build', state: 'working', host: 'm2' }
      await seedOfficeTeam(electronApp, { members: [...team, ho], jev: JEV })
      await record(canvas, testInfo.outputPath, 'office-join-and-sit', 25)
      await seedOfficeTeam(electronApp, { members: [...team, { ...ho, state: 'idle' }], jev: JEV })
      await record(canvas, testInfo.outputPath, 'office-stand-to-lobby', 25)
      await seedOfficeTeam(electronApp, { members: team, jev: JEV })
      await record(canvas, testInfo.outputPath, 'office-leave', 20)
    } finally {
      dispose()
    }
  })

  test('Figures: the lead crosses to a member on another island who needs the user, and back', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team, jev: JEV })
    try {
      await writeSettings(orcaPage, figures)
      const canvas = await webglScene(orcaPage, '[data-team-scene-diorama]')
      await follow(orcaPage, 'Follow the lead')
      await seedOfficeTeam(electronApp, { members: withState('Fi', 'waiting'), jev: JEV })
      await record(canvas, testInfo.outputPath, 'figures-lead-crossing-out', 30)
      await seedOfficeTeam(electronApp, { members: team, jev: JEV })
      await record(canvas, testInfo.outputPath, 'figures-lead-crossing-back', 30)
    } finally {
      dispose()
    }
  })

  test('Figures: a member arrives at its plot, and an asker on home island brings the lead out', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team, jev: JEV })
    try {
      await writeSettings(orcaPage, figures)
      const canvas = await webglScene(orcaPage, '[data-team-scene-diorama]')
      await follow(orcaPage, 'Show all')
      const ho = { name: 'Ho · ORCA-408 Build', state: 'working' }
      await seedOfficeTeam(electronApp, { members: [...team, ho], jev: JEV })
      await record(canvas, testInfo.outputPath, 'figures-arrive', 15)
      await seedOfficeTeam(electronApp, { members: [...withState('Bo', 'waiting'), ho], jev: JEV })
      await record(canvas, testInfo.outputPath, 'figures-lead-to-asker-home', 25)
    } finally {
      dispose()
    }
  })
})
