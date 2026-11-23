import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { writeSettings } from './helpers/settings-write'
import { setTheme, setWindowWidth, THEMES } from './helpers/settings-window'
import { openOfficeTeam, seedOfficeTeam, type SeededMember } from './helpers/team-office-seed'

// Why @ondemand: ORCA-1336 item 5 asks for recordings of every movement before any fix; these
// frames are watched by a person, not asserted, so the suite shards never run them. Run with
// ORCA_E2E_FORCE_HEADFUL=1 --project electron-ondemand on a host whose WebGL draws; elsewhere,
// including the PR's changed-specs job on Linux, each test skips with that reason.

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

/**
 * Waits for the 3D scene. Where WebGL is off (Linux CI, the iMac) the frames would show only the 2D
 * building, so the recording is skipped with that reason instead of saving frames nobody can use.
 */
async function webglScene(page: Page, selector: string): Promise<Locator> {
  const panel = page.getByTestId('team-panel')
  const scene = panel.locator('[data-team-scene-webgl]')
  await expect(scene).toHaveAttribute('data-team-scene-webgl', /on|off/, { timeout: 30_000 })
  const webgl = await scene.getAttribute('data-team-scene-webgl')
  test.info().annotations.push({ type: 'webgl', description: String(webgl) })
  test.skip(webgl !== 'on', `WebGL is ${webgl} on this host: no 3D frames to record`)
  const canvas = panel.locator(`${selector} canvas`)
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.__store!.getState().setRightSidebarWidth(420))
  return canvas
}

/** The lift's highest floor from now on, and how many machine floors the building draws. */
const readLift = async (canvas: Locator) => ({
  top: Number(await canvas.getAttribute('data-office3d-lift-top')),
  floors: Number(await canvas.getAttribute('data-office3d-floors'))
})

const follow = async (page: Page, mode: 'Follow the lead' | 'Show all') => {
  await page.getByTestId('team-panel').getByRole('button', { name: mode }).click()
  await page.waitForTimeout(1500)
}

test.describe('@ondemand ORCA-1336 movement recordings', () => {
  test.describe.configure({ timeout: 600_000 })

  test('Office: the lead rides the lift to a member who joins upstairs, and back', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team, jev: JEV })
    try {
      await writeSettings(orcaPage, office)
      const canvas = await webglScene(orcaPage, '[data-team-scene-office3d]')
      await follow(orcaPage, 'Follow the lead')
      // Why a join: the Office lead moves only for events (a join, a red CI), never for an asker.
      const ho = { name: 'Ho · ORCA-408 Build', state: 'working', host: 'm2' }
      await seedOfficeTeam(electronApp, { members: [...team, ho], jev: JEV })
      await record(canvas, (f) => testInfo.outputPath(f), 'office-lead-lift-out', 30)
      await record(canvas, (f) => testInfo.outputPath(f), 'office-lead-lift-back', 30)
    } finally {
      dispose()
    }
  })

  // ORCA-1374: the cab rose past the top floor with the lead in it, and riders walked into it
  // before its doors opened. These frames are the owner's videos; the floor changes are asserted.
  test('Office: the lift serves the top floor at 1440 and 390, light and dark', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team, jev: JEV })
    try {
      await writeSettings(orcaPage, office)
      const canvas = await webglScene(orcaPage, '[data-team-scene-office3d]')
      await follow(orcaPage, 'Follow the lead')
      const io = { name: 'Io · ORCA-409 Build', state: 'working', host: 'gpu-box' }
      for (const theme of THEMES) {
        for (const width of [1440, 390]) {
          await setTheme(orcaPage, theme)
          await setWindowWidth(electronApp, orcaPage, width)
          await orcaPage.evaluate(
            (w) => window.__store!.getState().setRightSidebarWidth(Math.min(420, w - 40)),
            width
          )
          // A join on gpu-box, the top floor, sends the lead up with a folder, then back.
          await seedOfficeTeam(electronApp, { members: [...team, io], jev: JEV })
          await record(canvas, (f) => testInfo.outputPath(f), `lift-top-${theme}-${width}`, 36)
          const lift = await readLift(canvas)
          expect(lift.floors).toBe(3)
          expect(lift.top).toBeLessThanOrEqual(lift.floors)
          await seedOfficeTeam(electronApp, { members: team, jev: JEV })
          await orcaPage.waitForTimeout(20_000)
        }
      }
    } finally {
      dispose()
    }
  })

  test('Office: the lift stays inside the building when a floor goes away or appears mid-ride', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    const { dispose } = await openOfficeTeam(electronApp, orcaPage, { members: team, jev: JEV })
    try {
      await writeSettings(orcaPage, office)
      const canvas = await webglScene(orcaPage, '[data-team-scene-office3d]')
      await follow(orcaPage, 'Follow the lead')
      const io = { name: 'Io · ORCA-409 Build', state: 'working', host: 'gpu-box' }
      await seedOfficeTeam(electronApp, { members: [...team, io], jev: JEV })
      // About when the lead rides up (~25.5 to 28.5 s on m1): it walks to the lift and waits first.
      await orcaPage.waitForTimeout(27_000)
      // Gu and Io finish: gpu-box, the floor it rides to, is no longer drawn.
      const left = team.filter((m) => m.host !== 'gpu-box')
      await seedOfficeTeam(electronApp, { members: left, jev: JEV })
      await expect.poll(() => readLift(canvas)).toMatchObject({ floors: 2 })
      expect((await readLift(canvas)).top).toBeLessThanOrEqual(2)
      await record(canvas, (f) => testInfo.outputPath(f), 'lift-floor-gone', 30)
      expect((await readLift(canvas)).top).toBeLessThanOrEqual(2)

      await seedOfficeTeam(electronApp, { members: [...team, io], jev: JEV })
      await orcaPage.waitForTimeout(24_000)
      // A new machine sorts below gpu-box mid-ride, so gpu-box moves up one.
      const ny = { name: 'Ny · ORCA-410 Build', state: 'working', host: 'nube' }
      await seedOfficeTeam(electronApp, { members: [...left, ny, ...team.slice(4), io], jev: JEV })
      await expect.poll(() => readLift(canvas)).toMatchObject({ floors: 4 })
      expect((await readLift(canvas)).top).toBeLessThanOrEqual(4)
      await record(canvas, (f) => testInfo.outputPath(f), 'lift-floor-appears', 30)
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
      await record(canvas, (f) => testInfo.outputPath(f), 'office-join-and-sit', 25)
      await seedOfficeTeam(electronApp, { members: [...team, { ...ho, state: 'idle' }], jev: JEV })
      await record(canvas, (f) => testInfo.outputPath(f), 'office-stand-to-lobby', 25)
      await seedOfficeTeam(electronApp, { members: team, jev: JEV })
      await record(canvas, (f) => testInfo.outputPath(f), 'office-leave', 20)
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
      await record(canvas, (f) => testInfo.outputPath(f), 'figures-lead-crossing-out', 30)
      await seedOfficeTeam(electronApp, { members: team, jev: JEV })
      await record(canvas, (f) => testInfo.outputPath(f), 'figures-lead-crossing-back', 30)
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
      await record(canvas, (f) => testInfo.outputPath(f), 'figures-arrive', 15)
      await seedOfficeTeam(electronApp, { members: [...withState('Bo', 'waiting'), ho], jev: JEV })
      await record(canvas, (f) => testInfo.outputPath(f), 'figures-lead-to-asker-home', 25)
    } finally {
      dispose()
    }
  })
})
