import { rm } from 'node:fs/promises'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, startGameBand } from './helpers/orchestrator-game-band'
import { clickOnceRedrawn, screenText } from './helpers/orchestrator-game-panel-capture'
import {
  demoHost,
  demoLeadState,
  demoMember,
  showcaseFrame,
  sizeWindow
} from './helpers/game-showcase-demo-party'

// Source frames for the README multi-host GIF: one lead, members here and on two paired hosts.
const members = (step: 1 | 2) => [
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
    tool: 'Bash',
    pr: { number: 42, ci: step === 1 ? 'pending' : 'success', state: 'open' },
    host: 'studio',
    account: 'build@example.com'
  }),
  demoMember({
    name: 'Juno',
    ticket: 'LUM-15',
    title: 'Onboarding copy',
    state: 'done',
    pr: { number: 39, ci: 'success', state: step === 1 ? 'open' : 'merged' },
    host: 'studio',
    account: 'build@example.com'
  }),
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

const state = (step: 1 | 2) =>
  demoLeadState(members(step), {
    hostCapacity: [
      demoHost('local', 1, 3, { cores: 10, totalGb: 16, freeGb: 7.5, load: 2.4 }),
      demoHost('studio', 2, 6, { cores: 12, totalGb: 64, freeGb: 38, load: 3.1 }),
      demoHost('linux-box', 1, 4, { cores: 8, totalGb: 32, freeGb: 21, load: 1.2 })
    ]
  })

test('the Panel shows one fleet across the local machine and two paired hosts', async ({
  electronApp,
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(240_000)
  await waitForSessionReady(orcaPage)
  await sizeWindow(electronApp, 1440, 900)
  const band = await startGameBand(orcaPage, testRepoPath, {
    state: state(1),
    theme: 'dark',
    locale: 'en'
  })
  try {
    await expect
      .poll(async () => screenText(orcaPage), {
        timeout: 60_000,
        message: 'the band never drew the seeded party'
      })
      .toContain('Orla')
    await showcaseFrame(orcaPage, testInfo, '01-band.png')

    await clickOnceRedrawn(orcaPage, 'Panel')
    // Why /i: the hd render draws section headings in capitals.
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toMatch(/▾ team/i)
    const panel = await screenText(orcaPage)
    expect(panel).toMatch(/⌂ studio 2\/6 running · 12 cores/)
    expect(panel).toMatch(/⌂ linux-box 1\/4 running · 8 cores/)
    expect(panel).toContain('on studio')
    await showcaseFrame(orcaPage, testInfo, '02-hosts.png')

    // A remote member's CI goes green and another remote PR merges: XP counts the same as local.
    await band.setState(state(2))
    await clickOnceRedrawn(orcaPage, 'Refresh')
    await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('merged')
    await showcaseFrame(orcaPage, testInfo, '03-remote-xp.png')
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
