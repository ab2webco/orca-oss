import { rm } from 'node:fs/promises'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { claudeVersionOk, screenRows, startGameBand } from './helpers/orchestrator-game-band'

// A member whose lead is on another host (ORCA-1044): an older host finds no parent pane for it, so
// it answers role lead with every session it found. The member's band must still draw only itself.
const BANNER_CELLS = 30
const hasBanner = (screen: string): boolean =>
  screen.split('\n').some((row) => (row.match(/[▀▄]/g) ?? []).length >= BANNER_CELLS)

const agent = (paneKey: string, displayName: string, patch: Record<string, unknown> = {}) => ({
  paneKey,
  displayName,
  agentType: 'claude',
  state: 'working',
  toolName: 'Edit',
  isLeader: false,
  ...patch
})

const olderHostState = {
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  warnings: [],
  worktree: { id: 'wt-1033', path: '/work/orca-1033', branch: 'orca-1033', displayName: 'd' },
  agents: [
    agent('tab:daisy', 'Daisy · ORCA-1033 Disconnect from upstream', { isLeader: true }),
    agent('tab:rex', 'Rex · ORCA-1034 Characters', { found: true }),
    agent('tab:ivy', 'Ivy · ORCA-1038 Hooks on Python', { found: true })
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  lead: { autostart: false, cap: 4, label: 'Atlas' },
  role: 'lead',
  locale: 'en'
}

test('a remote member draws only itself, with no crown, when its host answers it as a lead', async ({
  orcaPage,
  testRepoPath
}, testInfo) => {
  test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  const band = await startGameBand(orcaPage, testRepoPath, {
    state: olderHostState,
    theme: 'dark',
    locale: 'en',
    role: 'member'
  })
  const screen = async () => (await screenRows(orcaPage)).join('\n')
  try {
    await expect
      .poll(screen, { timeout: 60_000, message: 'the member band never drew' })
      .toContain('Daisy')
    // The API URL points nowhere, so the turn keeps retrying and its scene stays on screen.
    await orcaPage.keyboard.type('Say hi')
    await expect
      .poll(
        async () => {
          const drawn = await screen()
          if (!hasBanner(drawn)) {
            await orcaPage.keyboard.press('Enter')
          }
          return hasBanner(drawn)
        },
        { timeout: 60_000, intervals: [3_000], message: 'the turn never drew its scene' }
      )
      .toBe(true)
    // Why a pause: the party marches in over a few ticks.
    await orcaPage.waitForTimeout(3_000)
    await orcaPage.screenshot({ path: testInfo.outputPath('remote-member-scene.png') })
    // Why Atlas: the crowned lead carries the lead's label.
    expect(await screen()).not.toContain('Atlas')
  } finally {
    await rm(band.root, { recursive: true, force: true })
  }
})
