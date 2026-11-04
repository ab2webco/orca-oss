import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { getTerminalContent } from './helpers/terminal'
import { claudeVersionOk, clickTerminalText, startGameBand } from './helpers/orchestrator-game-band'

// Each built-in scene in the band, the Panel and the hd scene of a lead's turn, with invented
// members, plus clips of what moves: the walk, a pet, Jev's advisor and the demo's every phase.
// ORCA_E2E_ORCA_GAME_DIR loads another build of the mod (a "before" for the same captures).
const WIDTH = 1440
const HEIGHT = 900
const HOLD_MS = 1_200
// Why one step per 4 s: an advisor gesture plays about that long, so each is seen whole.
const JEV_STEP_MS = 4_000
const TURN_PROMPT = 'Walk the scene'

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

/** An API that takes every request and never answers, so a turn stays on its spinner, unbannered. */
async function heldApi(): Promise<{ url: string; close: () => void }> {
  const held = new Set<ServerResponse>()
  const server = createServer((request, response) => {
    request.resume()
    held.add(response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      held.forEach((response) => response.destroy())
      server.closeAllConnections()
      server.close()
    }
  }
}

// Jev's advisor value, one new decision, CI run or block per step: the advisor's every pose but
// the hand up, which only Jev's gate on a real tool call plays.
const JEV_REGISTER = `
const ADVISOR = { plugin: 'orca-jev-mod-skills', key: 'advisor' }
const BASE = { version: 1, locale: 'en', line: 'jev · e2e', model: 'Opus 5.5', effort: 'high', subagents: [], ci: [], notices: [] }
const agent = (id, why, model, verdict) => ({ id, title: 'Task ' + id, model, effort: 'medium', why, verdict })
const stepOf = (n) => {
  const id = 'e2e-' + n
  switch (n % 6) {
    case 0: return { ...BASE, subagents: [agent(id, 'lowered', 'Haiku 5.5', 'Haiku is enough')] }
    case 1: return { ...BASE, ci: [{ id, status: 'watching', text: 'CI running' }] }
    case 2: return { ...BASE, ci: [{ id, status: 'success', text: 'CI green' }] }
    case 3: return { ...BASE, subagents: [agent(id, 'explicit', 'Opus 5.5', 'as asked')] }
    case 4: return { ...BASE, ci: [{ id, status: 'failure', text: 'CI red' }] }
    default: return { ...BASE, notices: [{ id, level: 'block', text: 'Needs a person' }] }
  }
}
export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    let n = 0
    await $.state.set(ADVISOR, BASE).catch(() => undefined)
    $.clock.every(${JEV_STEP_MS}, () => {
      void $.state.set(ADVISOR, stepOf(n)).catch(() => undefined)
      n += 1
    })
    return started
  })
}
`

async function jevStub(root: string): Promise<string> {
  const dir = join(root, 'jev-stub')
  await mkdir(join(dir, '.claude-plugin'), { recursive: true })
  await mkdir(join(dir, 'hooks'), { recursive: true })
  await writeFile(
    join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'orca-jev-mod-skills', version: '0.0.0', description: 'E2E Jev' })
  )
  await writeFile(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./register.ts'] }))
  await writeFile(join(dir, 'hooks', 'register.ts'), JEV_REGISTER)
  return dir
}

for (const scene of SCENES) {
  for (const theme of ['dark', 'light'] as const) {
    test(`${scene.id} draws its current cast in the band and Panel (${theme})`, async ({
      electronApp,
      orcaPage,
      testRepoPath
    }, testInfo) => {
      test.skip(!claudeVersionOk(), 'needs Claude Code 2.1.287 or newer on PATH')
      test.setTimeout(300_000)
      await waitForSessionReady(orcaPage)
      await electronApp.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
        },
        { width: WIDTH, height: HEIGHT }
      )
      await orcaPage.setViewportSize({ width: WIDTH, height: HEIGHT })
      const api = await heldApi()
      const stubRoot = testInfo.outputPath('stub')
      const band = await startGameBand(orcaPage, testRepoPath, {
        state: gameState(scene.id, scene.cast),
        theme,
        locale: 'en',
        scene: scene.id,
        timezone: noonZone(),
        showcase: { apiUrl: api.url },
        pluginDir: process.env.ORCA_E2E_ORCA_GAME_DIR || undefined,
        extraPluginDirs: [await jevStub(stubRoot)]
      })
      const shown = () => getTerminalContent(orcaPage, 20_000)
      const shot = async (name: string): Promise<void> => {
        await orcaPage.waitForTimeout(HOLD_MS)
        await orcaPage.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' })
      }
      const clip = async (name: string, frames: number, everyMs: number): Promise<void> => {
        if (theme !== 'dark') {
          return
        }
        for (let frame = 0; frame < frames; frame += 1) {
          await orcaPage.waitForTimeout(everyMs)
          const file = `clip-${name}-${String(frame).padStart(3, '0')}.png`
          await orcaPage.screenshot({ path: testInfo.outputPath(file) })
        }
      }
      // A turn draws the hd scene under the spinner; the held API keeps it there.
      const startTurn = async (): Promise<void> => {
        await orcaPage.keyboard.type(TURN_PROMPT)
        await orcaPage.keyboard.press('Enter')
        await orcaPage.waitForTimeout(3_000)
      }
      // Why the backspaces: Claude puts an interrupted prompt back in the input.
      const interrupt = async (): Promise<void> => {
        await orcaPage.keyboard.press('Escape')
        await orcaPage.waitForTimeout(HOLD_MS)
        for (let i = 0; i < TURN_PROMPT.length + 2; i += 1) {
          await orcaPage.keyboard.press('Backspace')
        }
      }
      try {
        await expect
          .poll(shown, { timeout: 60_000, message: 'the band never drew the seeded party' })
          .toContain('Panel')
        const petChip = (await shown()).includes(`Pet ${scene.pet}`)
        await shot(`${scene.id}-band-${theme}.png`)
        await clickTerminalText(orcaPage, 'Panel')
        await expect.poll(shown, { timeout: 20_000 }).toContain('LUM-14')
        await shot(`${scene.id}-panel-${theme}.png`)
        // Why its key: Jev's card pushes the Panel's Close chip below the fold.
        await orcaPage.keyboard.press('q')
        await expect.poll(shown, { timeout: 20_000 }).not.toContain('FLEET')
        await startTurn()
        await shot(`${scene.id}-scene-${theme}.png`)
        await clip('walk', 48, 250)
        await clickTerminalText(orcaPage, petChip ? `Pet ${scene.pet}` : 'Pet')
        await clip('pet', 16, 200)
        await interrupt()
        // The scripted demo walks every phase: red CI, the merge's finale, the rest by the fire.
        await orcaPage.keyboard.type('/orca-game:demo')
        await orcaPage.keyboard.press('Enter')
        await expect.poll(shown, { timeout: 20_000 }).toContain('DEMO')
        await startTurn()
        await shot(`${scene.id}-demo-${theme}.png`)
        await clip('demo', 110, 400)
        await interrupt()
        await clickTerminalText(orcaPage, 'Panel')
        await clip('panel', 24, 300)
        // Checked last so a run against an older mod still leaves its captures behind.
        expect(petChip, `the band offers no "Pet ${scene.pet}"`).toBe(true)
      } finally {
        // Why: a held turn outlives the app; stop it and leave Claude before teardown.
        await interrupt().catch(() => undefined)
        await orcaPage.keyboard.type('/exit\n').catch(() => undefined)
        await orcaPage.waitForTimeout(1_000)
        api.close()
        await rm(band.root, { recursive: true, force: true })
        await rm(stubRoot, { recursive: true, force: true })
      }
    })
  }
}
