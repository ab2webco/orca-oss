import { rm } from 'node:fs/promises'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, startGameBand } from './helpers/orchestrator-game-band'
import { clickOnceRedrawn, screenText } from './helpers/orchestrator-game-panel-capture'
import {
  demoHost,
  demoLeadState,
  demoMember,
  sizeWindow,
  statePusher
} from './helpers/game-showcase-demo-party'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { createShowcaseRepo } from './helpers/showcase-repo'

test.use({ seedTestRepo: false, orcaAppExtraArgs: CLIP_ARGS })

// The README and site multi-host clip: one lead, members here and on two paired hosts, a new
// member placed on the host with room, remote CI turning green and a remote merge paying XP.
type Step = { picoTool: string; picoCi: 'pending' | 'success'; junoMerged: boolean; orla: boolean }

const members = (step: Step) => [
  demoMember({
    name: 'Wren',
    ticket: 'LUM-12',
    title: 'Dark mode toggle',
    state: 'working',
    tool: 'Edit',
    pr: { number: 41, ci: 'pending', state: 'open' },
    account: 'lead@example.com'
  }),
  demoMember({
    name: 'Pico',
    ticket: 'LUM-14',
    title: 'Offline cache for the feed',
    state: 'working',
    tool: step.picoTool,
    pr: { number: 42, ci: step.picoCi, state: 'open' },
    host: 'studio',
    account: 'build@example.com'
  }),
  demoMember({
    name: 'Juno',
    ticket: 'LUM-15',
    title: 'Onboarding copy',
    state: 'done',
    pr: { number: 39, ci: 'success', state: step.junoMerged ? 'merged' : 'open' },
    host: 'studio',
    account: 'build@example.com'
  }),
  ...(step.orla
    ? [
        demoMember({
          name: 'Orla',
          ticket: 'LUM-16',
          title: 'Crash report upload',
          state: 'working',
          tool: 'Read',
          host: 'linux-box',
          account: 'ci@example.com'
        })
      ]
    : [])
]

const state = (step: Step) =>
  demoLeadState(members(step), {
    hostCapacity: [
      demoHost('local', 1, 3, { cores: 10, totalGb: 16, freeGb: 7.5, load: 2.4 }),
      demoHost('studio', 2, 6, { cores: 12, totalGb: 64, freeGb: 38, load: 3.1 }),
      demoHost('linux-box', step.orla ? 1 : 0, 4, {
        cores: 8,
        totalGb: 32,
        freeGb: step.orla ? 21 : 24,
        load: step.orla ? 1.2 : 0.3
      })
    ]
  })

const first: Step = { picoTool: 'Read', picoCi: 'pending', junoMerged: false, orla: false }

test('the Panel shows one fleet across the local machine and two paired hosts', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  await sizeWindow(electronApp, 1440, 900)
  const band = await startGameBand(orcaPage, createShowcaseRepo(), {
    state: state(first),
    theme: 'dark',
    locale: 'en',
    showcase: {}
  })
  const push = statePusher(band)
  try {
    await expect
      .poll(async () => screenText(orcaPage), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('Juno')

    await clickOnceRedrawn(orcaPage, 'Panel')
    // Why /i: the hd render draws section headings in capitals.
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toMatch(/▾ team/i)
    const panel = await screenText(orcaPage)
    expect(panel).toMatch(/⌂ studio 2\/6 running · 12 cores/)
    expect(panel).toContain('on studio')
    await orcaPage.waitForTimeout(1_000)

    const clip = await showcaseClip(electronApp, testInfo, 'multi-host-fleet')
    await orcaPage.waitForTimeout(1_500)
    // A launch lands on the host with room; Orca pushes the fleet change.
    await push(state({ ...first, orla: true }))
    await expect
      .poll(async () => screenText(orcaPage), { timeout: 20_000 })
      .toMatch(/⌂ linux-box 1\/4 running · 8 cores/)
    await orcaPage.waitForTimeout(1_800)
    await push(state({ ...first, orla: true, picoTool: 'Edit' }))
    await orcaPage.waitForTimeout(1_500)
    await push(state({ ...first, orla: true, picoTool: 'Bash' }))
    await orcaPage.waitForTimeout(1_500)
    // A remote member's CI goes green and another remote PR merges: XP counts the same as local.
    await push(state({ orla: true, picoTool: 'Bash', picoCi: 'success', junoMerged: false }))
    await orcaPage.waitForTimeout(2_000)
    await push(state({ orla: true, picoTool: 'Bash', picoCi: 'success', junoMerged: true }))
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('merged')
    await orcaPage.waitForTimeout(3_000)
    await clip.stop()
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
