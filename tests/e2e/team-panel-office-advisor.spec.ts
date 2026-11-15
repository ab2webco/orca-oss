import { writeFile } from 'node:fs/promises'
import { test, expect } from './helpers/orca-app'
import { setTheme, setWindowWidth, THEMES } from './helpers/settings-window'
import { writeSettings } from './helpers/settings-write'
import {
  openOfficeTeam,
  readSceneNumber,
  sceneStrip,
  seedOfficeTeam,
  type SeededMember
} from './helpers/team-office-seed'

// Why opt-in: the frame strips at every width and theme outrun the CI budget.
const CAPTURE_EVIDENCE = process.env.ORCA_CAPTURE_EVIDENCE === '1'
const JEV = 'Watching the team'
// Px between Jev and its lead at home: a body, less the 4 px its anchor is read in.
const CLEAR_PX = 28

// Why idle members: the lead hands out no work to them, so it stays at its spot beside Jev.
const MEMBERS: SeededMember[] = [
  { name: 'Mario · ORCA-401 Code', state: 'idle' },
  { name: 'Luigi · ORCA-402 Code', state: 'idle' },
  { name: 'Peach · ORCA-403 Code', state: 'idle' },
  { name: 'Yoshi · ORCA-404 Code', state: 'idle' }
]
const judged = (decisions: SeededMember['decisions']): SeededMember[] =>
  MEMBERS.map((one) => (one.name.startsWith('Peach') ? { ...one, decisions } : one))

// Why test.use: a never-shown window paints about once a second on CI, too sparse for any walk.
test.use({ orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' } })

// ORCA-1218: Jev stood still over the lead; its decisions now fly to the judged member's desk.
test('Office Jev keeps clear of the lead, idles alive, and sends its decisions to the desk', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(600_000)
  const team = { members: judged([{ id: 'seen', verdict: 'allow', gesture: null }]), jev: JEV }
  const { scene, dispose } = await openOfficeTeam(electronApp, orcaPage, team)
  try {
    // Why: the panel shows Jev only while the plugin system it reaches panes through is on.
    await writeSettings(orcaPage, { pluginSystemEnabled: true })
    const out = (name: string) => testInfo.outputPath(name)
    const jevX = () => readSceneNumber(scene, 'data-scene-advisor-x')
    const leadX = () => readSceneNumber(scene, 'data-scene-lead-x')
    const stageWidth = () =>
      scene.getByRole('img', { name: 'Live team scene' }).evaluate((c) => c.clientWidth)
    await expect.poll(jevX, { timeout: 30_000, message: 'no Jev on the stage' }).not.toBeNaN()
    await orcaPage.waitForTimeout(6000)

    // At the widest and the narrowest panel: Jev moves at home, a body clear of the lead.
    for (const [windowWidth, panel] of [
      [1440, 640],
      [390, 0]
    ] as const) {
      await setWindowWidth(electronApp, orcaPage, windowWidth)
      if (panel) {
        await orcaPage.evaluate((w) => window.__store!.getState().setRightSidebarWidth(w), panel)
      }
      await orcaPage.waitForTimeout(1500)
      const width = await stageWidth()
      const samples: { jev: number; lead: number }[] = []
      for (let n = 0; n < 40; n++) {
        samples.push({ jev: await jevX(), lead: await leadX() })
        await orcaPage.waitForTimeout(250)
      }
      testInfo.annotations.push({
        type: `jev at ${width} px`,
        description: samples.map((s) => `${s.jev}/${s.lead}`).join(' ')
      })
      expect
        .soft(new Set(samples.map((s) => s.jev)).size, `Jev stood still at ${width} px`)
        .toBeGreaterThan(1)
      const closest = Math.min(...samples.map((s) => (s.lead - s.jev) * width))
      expect
        .soft(closest, `Jev came within ${closest} px of the lead at ${width} px`)
        .toBeGreaterThanOrEqual(CLEAR_PX)
      if (CAPTURE_EVIDENCE) {
        for (const theme of THEMES) {
          await setTheme(orcaPage, theme)
          await orcaPage.waitForTimeout(800)
          const name = `jev-idle-${windowWidth}-${panel || 'min'}-${theme}`
          await sceneStrip(orcaPage, scene, (n) => out(`${name}-0${n}.png`), 4, 650, jevX)
        }
      }
    }

    // A decision on Peach: the token flies to her desk, and Jev sets out after it.
    await setWindowWidth(electronApp, orcaPage, 1440)
    await orcaPage.evaluate(() => window.__store!.getState().setRightSidebarWidth(640))
    await orcaPage.waitForTimeout(2000)
    for (const [round, verdict] of (['allow', 'deny'] as const).entries()) {
      await seedOfficeTeam(electronApp, {
        jev: JEV,
        members: judged([
          { id: 'seen', verdict: 'allow', gesture: null },
          { id: `new-${round}`, verdict, gesture: null }
        ])
      })
      const xs = CAPTURE_EVIDENCE
        ? await sceneStrip(
            orcaPage,
            scene,
            (n) => out(`jev-decision-${verdict}-${String(n).padStart(2, '0')}.png`),
            14,
            90,
            jevX
          )
        : []
      const walked = await jevX()
      testInfo.annotations.push({
        type: `jev x after ${verdict}`,
        description: [...xs, walked].join(' ')
      })
      await orcaPage.waitForTimeout(6000)
    }
    await writeFile(out('track.json'), JSON.stringify(testInfo.annotations, null, 1))
  } finally {
    dispose()
  }
})
