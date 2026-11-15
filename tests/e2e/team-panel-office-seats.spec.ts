import { writeFile } from 'node:fs/promises'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES } from './helpers/settings-window'
import {
  openOfficeTeam,
  readSceneNumber,
  sceneStrip,
  seedOfficeTeam,
  type SeededMember
} from './helpers/team-office-seed'

// Why opt-in: the frame strips at every width and theme outrun the CI budget.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'

// Why six: one more than Office's row of five, the QA case where the sixth member had no desk.
// Why a PR waiting on review: a working member's desk then shows its review, not code (ORCA-1204).
const MEMBERS: SeededMember[] = [
  { name: 'Mario · ORCA-301 Code', state: 'working', review: 'open' },
  { name: 'Luigi · ORCA-302 Code', state: 'idle' },
  { name: 'Toad · ORCA-303 Docs', state: 'done' },
  { name: 'Peach · ORCA-304 Code', state: 'working' },
  { name: 'Daisy · ORCA-305 Code', state: 'waiting' },
  { name: 'Yoshi · ORCA-306 Code', state: 'working' }
]

const working = (...names: string[]): SeededMember[] =>
  MEMBERS.map((one) =>
    names.some((name) => one.name.startsWith(name)) ? { ...one, state: 'working' } : one
  )

const readSeats = (page: Page): Promise<string | null> =>
  page
    .locator('[data-team-scene] [data-scene-seats]')
    .first()
    .getAttribute('data-scene-seats', { timeout: 1000 })
    .catch(() => null)

// Why test.use: a never-shown window paints about once a second on CI, too sparse for any walk.
test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

test('Office keeps each member at its desk while others change state, and the lead walks out and back', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const { scene, dispose } = await openOfficeTeam(electronApp, orcaPage, { members: MEMBERS })
  try {
    const out = (name: string) => testInfo.outputPath(name)
    const leadX = () => readSceneNumber(scene, 'data-scene-lead-x')
    const track = async (name: string, frames: number, everyMs: number): Promise<number[]> => {
      if (CAPTURE_EVIDENCE) {
        const path = (n: number) => out(`${name}-${String(n).padStart(2, '0')}.png`)
        return sceneStrip(orcaPage, scene, path, frames, everyMs, leadX)
      }
      const xs: number[] = []
      for (let n = 0; n < frames; n++) {
        xs.push(await leadX())
        await orcaPage.waitForTimeout(everyMs)
      }
      return xs
    }
    // Why a wait: the members walked in when they joined; by now every one is seated.
    await orcaPage.waitForTimeout(8000)

    // Daisy asks: the lead walks to her desk.
    const toAsker = await track('office-attend', 6, 300)
    testInfo.annotations.push({ type: 'lead-x at asker', description: toAsker.join(' ') })
    expect
      .soft(Math.min(...toAsker), 'the lead never left its spot for the asker')
      .toBeLessThan(0.8)

    // Only Luigi changes, idle to working: no other member may change desk.
    const seatsBefore = await readSeats(orcaPage)
    await scene.screenshot({ path: out('office-seats-before.png') })
    await seedOfficeTeam(electronApp, { members: working('Luigi') })
    await orcaPage.waitForTimeout(5000)
    const seatsAfter = await readSeats(orcaPage)
    await scene.screenshot({ path: out('office-seats-after-luigi-works.png') })
    testInfo.annotations.push({
      type: 'seats',
      description: `before ${seatsBefore} | after ${seatsAfter}`
    })
    expect.soft(seatsBefore, 'the scene does not expose its seats').not.toBeNull()
    expect.soft(seatsAfter, 'a member changed desk when only Luigi changed state').toBe(seatsBefore)

    // Daisy is answered and back at work: the lead walks home, in front of the desks; at ~35 px/s
    // from the row's first desk that takes up to 15 s.
    await seedOfficeTeam(electronApp, { members: working('Luigi', 'Daisy') })
    await expect(
      orcaPage.locator('[data-team-scene] [data-scene-speaker="office:4"]'),
      'Daisy still asks after going back to work'
    ).toHaveCount(0, { timeout: 30_000 })
    const home = await track('office-return', 40, 400)
    testInfo.annotations.push({ type: 'lead-x home and rounds', description: home.join(' ') })
    expect.soft(Math.max(...home), 'the lead never came back to its spot').toBeGreaterThan(0.8)
    expect
      .soft(await readSeats(orcaPage), 'a member changed desk when Daisy went back to work')
      .toBe(seatsBefore)

    await writeFile(out('track.json'), JSON.stringify(testInfo.annotations, null, 1))
    if (!CAPTURE_EVIDENCE) {
      return
    }
    // Working screens frame by frame, for the monitor animation.
    await sceneStrip(orcaPage, scene, (n) => out(`office-screens-0${n}.png`), 6, 150, leadX)
    // Wide and narrow panels in both themes.
    for (const [windowWidth, panel] of [
      [1440, 640],
      [1440, 1120],
      [390, 0]
    ] as const) {
      await setWindowWidth(electronApp, orcaPage, windowWidth)
      if (panel) {
        await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), panel)
      }
      for (const theme of THEMES) {
        await setTheme(orcaPage, theme)
        await orcaPage.waitForTimeout(1200)
        const name = `office-${windowWidth}-${panel || 'min'}-${theme}`
        await sceneStrip(orcaPage, scene, (n) => out(`${name}-0${n}.png`), 3, 400, leadX)
      }
    }
  } finally {
    dispose()
  }
})
