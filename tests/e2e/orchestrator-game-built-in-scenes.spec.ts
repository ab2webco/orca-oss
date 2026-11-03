import { rm } from 'node:fs/promises'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal'
import { claudeVersionOk, clickTerminalText, startGameBand } from './helpers/orchestrator-game-band'

// Each built-in scene in the band and the Panel with invented members, at every width and theme,
// plus a short clip; the pet chip proves the scene drew its ORCA-968 cast, not the v1 one.
const WIDTHS = [1440, 768, 390, 320] as const
const HEIGHT = 900
const HOLD_MS = 1_200
const CLIP_FRAMES = 24
const CLIP_EVERY_MS = 250

// Why noon: at night every world's palette sinks toward the same dark blue.
const noonZone = (): string => {
  const offset = ((12 - new Date().getUTCHours() + 36) % 24) - 12
  return offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
}

const SCENES = [
  { id: 'quest', pet: 'Hound', cast: ['Merlin', 'Lancelot', 'Guinevere', 'Gawain'] },
  { id: 'vigilante', pet: 'Alley Cat', cast: ['Raven', 'Lynx', 'Vesper', 'Specter'] },
  { id: 'jrpg', pet: 'Slime', cast: ['Kael', 'Lyra', 'Riven', 'Sora'] },
  { id: 'tamer', pet: 'Puffball', cast: ['Mochi', 'Bramble', 'Sprout', 'Pebble'] }
] as const

type Ci = 'pending' | 'success' | 'failure'

const member = (
  name: string,
  ticket: string,
  title: string,
  state: 'working' | 'waiting' | 'idle' | 'done',
  tool: string | null,
  ci: Ci | null
) => ({
  paneKey: `demo-${name.toLowerCase()}`,
  displayName: `${name} · ${ticket} ${title}`,
  agentType: 'claude',
  state,
  toolName: tool,
  isLeader: false,
  isMember: true,
  worktree: {
    id: `demo-wt-${ticket}`,
    branch: `feat/${ticket.toLowerCase()}`,
    displayName: ticket
  },
  workItem: {
    provider: 'plane',
    identifier: ticket,
    title,
    url: `https://plane.example.com/lumen/browse/${ticket}/`,
    status: 'In Progress',
    statusGroup: 'in_progress'
  },
  ...(ci
    ? {
        review: {
          provider: 'github',
          number: Number(ticket.split('-')[1]),
          title,
          url: `https://github.example.com/lumen/app/pull/${ticket.split('-')[1]}`,
          state: 'open',
          ci
        }
      }
    : {})
})

const gameState = (scene: string, cast: readonly string[]) => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene },
  warnings: [],
  worktree: {
    id: 'demo-wt-lead',
    path: '/work/lumen-app',
    branch: 'main',
    displayName: 'lumen-app'
  },
  agents: [
    {
      paneKey: 'demo-atlas',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'working',
      toolName: 'Read',
      isLeader: true
    },
    member(cast[0]!, 'LUM-12', 'Dark mode toggle', 'working', 'Edit', 'pending'),
    member(cast[1]!, 'LUM-14', 'Offline cache for the feed', 'waiting', null, null),
    member(cast[2]!, 'LUM-15', 'Onboarding copy', 'working', 'Bash', 'failure'),
    member(cast[3]!, 'LUM-16', 'Search filters', 'done', null, 'success')
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  role: 'lead',
  locale: 'en'
})

for (const scene of SCENES) {
  for (const theme of ['dark', 'light'] as const) {
    test(`${scene.id} draws its current cast in the band and Panel (${theme})`, async ({
      electronApp,
      orcaPage,
      testRepoPath
    }, testInfo) => {
      test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
      test.setTimeout(240_000)
      await waitForSessionReady(orcaPage)
      await electronApp.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
        },
        { width: WIDTHS[0], height: HEIGHT }
      )
      const band = await startGameBand(orcaPage, testRepoPath, {
        state: gameState(scene.id, scene.cast),
        theme,
        locale: 'en',
        scene: scene.id,
        timezone: noonZone()
      })
      const shown = () => getTerminalContent(orcaPage, 20_000)
      const shot = async (name: string): Promise<void> => {
        await orcaPage.waitForTimeout(HOLD_MS)
        await orcaPage.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' })
      }
      try {
        await expect
          .poll(shown, { timeout: 60_000, message: 'the band never drew the seeded party' })
          .toContain('Panel')
        const petChip = (await shown()).includes(`Pet ${scene.pet}`)
        for (const width of WIDTHS) {
          await orcaPage.setViewportSize({ width, height: HEIGHT })
          await shot(`${scene.id}-band-${width}-${theme}.png`)
        }
        await orcaPage.setViewportSize({ width: WIDTHS[0], height: HEIGHT })
        await orcaPage.waitForTimeout(HOLD_MS)
        await clickTerminalText(orcaPage, 'Panel')
        await expect.poll(shown, { timeout: 20_000 }).toContain('LUM-14')
        for (const width of WIDTHS) {
          await orcaPage.setViewportSize({ width, height: HEIGHT })
          await shot(`${scene.id}-panel-${width}-${theme}.png`)
        }
        await orcaPage.setViewportSize({ width: WIDTHS[0], height: HEIGHT })
        await orcaPage.waitForTimeout(HOLD_MS)
        await clickTerminalText(orcaPage, 'Close')
        // Pet plays the scene's own pet, then the scripted demo walks every phase of the scene.
        await clickTerminalText(orcaPage, petChip ? `Pet ${scene.pet}` : 'Pet')
        await shot(`${scene.id}-pet-1440-${theme}.png`)
        await orcaPage.keyboard.type('/orca-game:demo')
        await orcaPage.keyboard.press('Enter')
        await expect.poll(shown, { timeout: 20_000 }).toContain('DEMO')
        await shot(`${scene.id}-demo-1440-${theme}.png`)
        // A turn draws the hd scene under the spinner; the API points nowhere, so it keeps retrying.
        await orcaPage.keyboard.type('Walk the scene')
        await orcaPage.keyboard.press('Enter')
        await orcaPage.waitForTimeout(3_000)
        if (theme === 'dark') {
          for (let frame = 0; frame < CLIP_FRAMES; frame += 1) {
            await orcaPage.waitForTimeout(CLIP_EVERY_MS)
            const name = `clip-${String(frame).padStart(2, '0')}.png`
            await orcaPage.screenshot({ path: testInfo.outputPath(name) })
          }
        }
        for (const width of WIDTHS) {
          await orcaPage.setViewportSize({ width, height: HEIGHT })
          await shot(`${scene.id}-scene-${width}-${theme}.png`)
        }
        // Checked last so a run against older scenes still leaves its captures behind.
        expect(petChip, `the band offers no "Pet ${scene.pet}"`).toBe(true)
      } finally {
        // Why: a turn left retrying outlives the app; stop it and leave Claude before teardown.
        await orcaPage.keyboard.press('Escape').catch(() => undefined)
        await orcaPage.keyboard.type('/exit\n').catch(() => undefined)
        await orcaPage.waitForTimeout(1_000)
        await rm(band.root, { recursive: true, force: true })
      }
    })
  }
}
