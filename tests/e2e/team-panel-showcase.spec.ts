import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { createStdinLoggingAgent } from './helpers/game-member-stdin-agent'
import {
  demoLeadState,
  demoMember,
  sizeWindow,
  type DemoMember
} from './helpers/game-showcase-demo-party'
import { claudeVersionOk, startGameBand } from './helpers/orchestrator-game-band'
import { screenText } from './helpers/orchestrator-game-panel-capture'
import { attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { setTheme, setWindowWidth } from './helpers/settings-window'
import { writeSettings } from './helpers/settings-write'
import { CLIP_ARGS, showcaseClip } from './helpers/showcase-clip'
import { startMessagesApi } from './helpers/showcase-messages-api'
import { createShowcaseRepo } from './helpers/showcase-repo'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { postLeadAgentRow } from './helpers/team-panel-inbox'
import { closeLeadStartTeamPanel } from './helpers/team-tab-auto-open'
import {
  execInTerminal,
  sendToTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId
} from './helpers/terminal'
import { RuntimeClient } from '../../src/cli/runtime-client'
import {
  DEFAULT_GAME_REWARD_WEIGHTS,
  type GameRewardKind
} from '../../src/shared/orchestrator-game-reward-weights'
import type { RuntimeTerminalListResult } from '../../src/shared/runtime-types'
import { getRepoIdFromWorktreeId } from '../../src/shared/worktree/id'

// The README and site clips of the native Team panel: the Lumen demo team on four invented machines,
// in Office (a floor per machine, the lead riding the elevator), Figures and Pixel.
// Why shown: a never-shown window paints no animation frames, so the ride would never move (ORCA-760).
test.use({
  seedTestRepo: false,
  orcaAppExtraArgs: CLIP_ARGS,
  orcaAppExtraEnv: { ORCA_E2E_SHOW_INACTIVE: '1' }
})

const GB = 1024 ** 3
type Reading = {
  cores: number
  memory: [number, number]
  load: number
  cpu: number
  disk: [number, number]
}
// Why CPU and disk: the Machines board draws a gauge for each (ORCA-1252) and reads a missing one as unknown.
// Why launch: a paired host without one reads as an older Orca that cannot say whether members start (ORCA-1207).
const LUMEN_REPO = {
  id: 'lumen-app',
  displayName: 'lumen-app',
  path: '~/code/lumen-app',
  remoteKey: null
}
const machine = (host: string, running: number, cap: number, reading: Reading) => ({
  host,
  running,
  cap,
  ...(host === 'local' ? {} : { launch: { kind: 'ready', repo: LUMEN_REPO } }),
  status: 'ok',
  cpuCoreCount: reading.cores,
  totalMemory: reading.memory[1] * GB,
  availableMemory: reading.memory[0] * GB,
  loadAverage1m: reading.load,
  cpuUsagePercent: reading.cpu,
  workspaceDiskFree: reading.disk[0] * GB,
  workspaceDiskTotal: reading.disk[1] * GB
})
// The site's run map reads these same hosts: free memory of total, load, members of cap.
const HOSTS = [
  machine('local', 2, 4, { cores: 12, memory: [18, 32], load: 2.4, cpu: 34, disk: [212, 512] }),
  machine('studio', 2, 4, { cores: 24, memory: [41, 64], load: 3.1, cpu: 22, disk: [640, 1024] }),
  machine('render-01', 1, 3, { cores: 16, memory: [20, 32], load: 0.8, cpu: 9, disk: [380, 512] }),
  machine('ci-runner', 1, 2, { cores: 8, memory: [7, 16], load: 5.2, cpu: 71, disk: [41, 256] })
]
// Why Juno waits on another floor: in the 2D Office a member there who needs you sends the lead up the elevator.
const MEMBERS: DemoMember[] = [
  {
    name: 'Pico',
    ticket: 'LUM-14',
    title: 'Offline cache for the feed',
    state: 'working',
    tool: 'Edit',
    pr: { number: 42, ci: 'pending', state: 'open' }
  },
  {
    name: 'Kai',
    ticket: 'LUM-19',
    title: 'Onboarding copy refresh',
    state: 'working',
    tool: 'Read',
    pr: { number: 44, ci: 'success', state: 'open' }
  },
  {
    name: 'Juno',
    ticket: 'LUM-17',
    title: 'Share sheet on Android',
    state: 'waiting',
    host: 'studio'
  },
  {
    name: 'Vega',
    ticket: 'LUM-21',
    title: 'Dark mode tokens',
    state: 'working',
    tool: 'Edit',
    host: 'studio',
    pr: { number: 45, ci: 'success', state: 'open' }
  },
  {
    name: 'Orin',
    ticket: 'LUM-23',
    title: 'Push opt-in screen',
    state: 'working',
    tool: 'Bash',
    host: 'render-01'
  },
  {
    name: 'Nova',
    ticket: 'LUM-25',
    title: 'Retry failed photo uploads',
    state: 'working',
    tool: 'Bash',
    host: 'ci-runner',
    pr: { number: 47, ci: 'failure', state: 'open' }
  }
]
// Why 2,650: the merge story's awards (+10, +20, +50, +70, +100) cross Lv 8 at 2,800.
const TEAM_XP = 2650
const PR_URL = 'https://github.example.com/lumen/app/pull'
const CI_STATUS = { pending: 'pending', success: 'success', failure: 'failure' } as const
const STYLES = ['office', 'figures', 'pixel'] as const
// The lead's own pane in every clip: the owner asks, the scripted lead answers from the team's state.
const OWNER_PROMPT = 'Who needs me right now?'
const LEAD_STATUS =
  'Juno on studio has a permission prompt in its terminal. Nova has #47 in CI for LUM-25 ' +
  'on ci-runner; if it goes red I go up. Kai has #44 for LUM-19, and Pico is coding LUM-14 here.'
const HOLD_MS = 2_500
/** Long enough for the 3D Office's lead to leave its office, ride the lift and talk to Nova. */
const OFFICE3D_RIDE_MS = 16_000
// Why 18.5 s: at 16 s the lead is still at ci-runner's lift door, and the poster is the last second,
// so the take ends inside its 3.4 s talk beside Nova (team-office3d-walkers.ts TALK).
const OFFICE3D_TALK_MS = 18_500
// Why past 3.8 s: the level row plays each gain that long (use-team-xp-motion.ts), so both stills see it settled.
const XP_MOTION_MS = 4_200
const pick = (model: string, effort: string) => ({ model, effort })
const SONNET = pick('claude-sonnet-5-5', 'medium')
const OPUS = pick('claude-opus-5-5', 'high')
const decision = (minutesAgo: number, moment: string, phase: string, from: object, to: object) => ({
  at: Date.now() - minutesAgo * 60_000,
  moment,
  phase,
  from,
  to,
  applied: true,
  source: 'plan',
  why: moment
})
// Pico's steward, by its phase defaults (steward-rules.ts): Sonnet to map the ticket, Opus once it edits.
const PICO_STEWARD = {
  session: 'session-lum-14',
  ticket: 'LUM-14',
  ...OPUS,
  phase: 'implement',
  plan: 'plan',
  standDown: null,
  pinned: { model: false, effort: false },
  stepsSeen: 9,
  decisions: [
    decision(10, 'plan', 'map', OPUS, SONNET),
    decision(4, 'edit', 'implement', SONNET, OPUS)
  ]
}

type Award = { id: string; kind: GameRewardKind; xp: number; label: string }
type Demo = { members: DemoMember[]; awards: Award[]; queue: string[]; limited?: string }

// Why these labels: the ones the mod toasts (rewards.ts), at its default weights.
const award = (kind: GameRewardKind, label: string): Award => ({
  id: `${kind}:lum-19`,
  kind,
  xp: DEFAULT_GAME_REWARD_WEIGHTS[kind],
  label
})
const CLAIMED = [award('member-claimed', 'Kai launched')]
const GREEN = [...CLAIMED, award('ci-green', '#44 CI is green')]
const MERGED = [
  ...GREEN,
  award('work-item-review', 'LUM-19 In Review'),
  award('work-item-done', 'LUM-19 Done'),
  award('review-merged', '#44 merged')
]

// Kai's LUM-19 from a claimed ticket to a merged PR, one award at a time (ORCA-1264: each counts).
const KAI_STEPS: { kai: Partial<DemoMember>; awards: Award[]; queue: string[] }[] = [
  { kai: { state: 'working', tool: 'Edit', pr: null }, awards: CLAIMED, queue: [] },
  {
    kai: { state: 'working', tool: 'Bash', pr: { number: 44, ci: 'pending', state: 'open' } },
    awards: CLAIMED,
    queue: []
  },
  {
    kai: { state: 'working', tool: 'Read', pr: { number: 44, ci: 'success', state: 'open' } },
    awards: GREEN,
    queue: ['44']
  },
  {
    kai: { state: 'done', tool: null, pr: { number: 44, ci: 'success', state: 'merged' } },
    awards: MERGED,
    queue: []
  }
]

// The host's teamXp: the team total and its newest awards, newest first.
const teamXpOf = (awards: Award[]) => ({
  total: TEAM_XP + awards.reduce((sum, one) => sum + one.xp, 0),
  recent: awards
    .map((one, i) => ({ ...one, at: Date.now() - (awards.length - i) * 1_000 }))
    .toReversed()
})

// Why `asking`: the 2D Office's ride starts when Juno starts waiting, so its clip turns it on mid-take.
// Why `rooms`: the 3D Office fills its games room and cafeteria only with an idle and an out-of-quota
// member, and its lead rides only when CI turns red, so 'calm' holds Nova's CI pending until 'red'.
const demoOf = (step: number, asking = true, rooms?: 'calm' | 'red'): Demo => ({
  members: MEMBERS.map((one) =>
    one.name === 'Kai'
      ? { ...one, ...KAI_STEPS[step]!.kai }
      : one.name === 'Juno' && !asking
        ? { ...one, state: 'working', tool: 'Edit' }
        : one.name === 'Orin' && rooms
          ? { ...one, state: 'idle', tool: null }
          : one.name === 'Vega' && rooms
            ? { ...one, state: 'idle', tool: null }
            : one.name === 'Nova' && rooms === 'calm'
              ? { ...one, pr: { number: 47, ci: 'pending', state: 'open' } }
              : one
  ),
  awards: KAI_STEPS[step]!.awards,
  queue: KAI_STEPS[step]!.queue,
  ...(rooms ? { limited: 'Vega' } : {})
})

// What game.state carries for a demo: the cards, the PRs tab and its merge queue.
function payloadOf(demo: Demo) {
  const prs = demo.members.filter((one) => one.pr && one.pr.state === 'open')
  return {
    members: demo.members.map((one) => ({
      ...demoMember(one),
      ...(one.name === 'Pico' ? { steward: PICO_STEWARD } : {}),
      ...(one.name === demo.limited ? { limit: { resetsAt: Date.now() + 90 * 60_000 } } : {})
    })),
    teamXp: teamXpOf(demo.awards),
    project: {
      reviews: {
        provider: 'github',
        total: prs.length,
        url: 'https://github.example.com/lumen/app/pulls',
        items: prs.map((one) => ({
          id: `#${one.pr!.number}`,
          title: one.title,
          url: `${PR_URL}/${one.pr!.number}`,
          status: CI_STATUS[one.pr!.ci]
        }))
      },
      todo: null,
      queue: {
        provider: 'github',
        entries: demo.queue.map((number, i) => ({
          id: `#${number}`,
          title: demo.members.find((one) => one.pr?.number === Number(number))!.title,
          url: `${PR_URL}/${number}`,
          position: i + 1,
          state: 'checks',
          since: null
        }))
      }
    }
  }
}

type RuntimeCall = (event: unknown, args: { method: string }) => Promise<{ result?: object }>
type Served = ReturnType<typeof payloadOf> & { hosts: typeof HOSTS }

// Why cloned from the one real member: E2E has no paired hosts, so the demo members ride on the real
// game.state on its way to the renderer, each with its own ticket, PR and host.
async function serveDemoTeam(app: ElectronApplication, demo: Demo): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, served) => {
      const box = globalThis as unknown as { orcaShowcase: Served }
      box.orcaShowcase = served
      const { _invokeHandlers: handlers } = ipcMain as unknown as {
        _invokeHandlers: Map<string, RuntimeCall>
      }
      const real = handlers.get('runtime:call')!
      ipcMain.removeHandler('runtime:call')
      ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
        const response = await real(event, args)
        const { members, hosts, teamXp, project } = box.orcaShowcase
        const result = response.result as { agents?: Record<string, unknown>[] } | undefined
        if (args.method !== 'game.state' || !Array.isArray(result?.agents)) {
          return response
        }
        const leader = result.agents.find((one) => one.isLeader)
        const template = result.agents.find((one) => !one.isLeader)
        if (!leader || !template) {
          return response
        }
        const worktree = template.worktree as Record<string, unknown>
        const added = members.map((one, i) => ({
          ...template,
          ...one,
          paneKey: `showcase:${i}`,
          terminalHandle: null,
          worktree: { ...worktree, branch: one.worktree.branch }
        }))
        return {
          ...response,
          result: {
            ...result,
            agents: [leader, ...added],
            hostCapacity: hosts,
            teamXp,
            project: { ...(result as { project?: object }).project, ...project }
          }
        }
      })
    },
    { ...payloadOf(demo), hosts: HOSTS } as Served
  )
}

// Why the advisor event: the panel polls every 20 s, and that event makes it read game.state now.
async function stepDemo(app: ElectronApplication, demo: Demo): Promise<void> {
  await app.evaluate(({ BrowserWindow }, served) => {
    const box = globalThis as unknown as { orcaShowcase: object }
    box.orcaShowcase = { ...box.orcaShowcase, ...served }
    BrowserWindow.getAllWindows()[0]?.webContents.send('runtime:gameAdvisorChanged')
  }, payloadOf(demo))
}

async function setStyle(page: Page, style: (typeof STYLES)[number]): Promise<void> {
  await page.evaluate((style) => {
    const state = window.__store!.getState()
    const game = state.settings?.orchestratorGame
    void state.updateSettings({
      orchestratorGame: {
        ...game,
        panel: { ...game?.panel, look: 'game', style }
      }
    })
  }, style)
}

test('the Lumen team in the Team panel: Office across four machines, Figures and Pixel', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(420_000)
  const agent = createStdinLoggingAgent()
  const api = await startMessagesApi([{ match: /who needs me/i, text: LEAD_STATUS }])
  // Why a fallback: without Claude Code on PATH the panel still runs, over a parked shell.
  const live = claudeVersionOk()
  try {
    await waitForSessionReady(orcaPage)
    await sizeWindow(electronApp, 1440, 900)
    const repo = createShowcaseRepo()
    if (live) {
      await startGameBand(orcaPage, repo, {
        state: demoLeadState(MEMBERS.map(demoMember)),
        theme: 'dark',
        locale: 'en',
        showcase: { apiUrl: api.url }
      })
      await expect.poll(async () => screenText(orcaPage), { timeout: 60_000 }).toMatch(/❯/)
    } else {
      await attachRepoAndOpenTerminal(orcaPage, repo)
      await ensureTerminalVisible(orcaPage)
      // Why clear: the shell prompt names the machine and its user, which no clip may show.
      await execInTerminal(
        orcaPage,
        await waitForActivePanePtyId(orcaPage),
        'clear; node -e "setInterval(() => {}, 1e9)"'
      )
    }
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const pane = await waitForActivePaneHookDescriptor(orcaPage)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const client = new RuntimeClient(userDataDir, 30_000, null, null)
    const lead = (
      await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
        paneKey: pane.paneKey
      })
    ).result.terminal.handle
    await writeSettings(orcaPage, {
      defaultTuiAgent: 'codex',
      agentCmdOverrides: { codex: agent.command },
      agentDefaultArgs: { codex: '' },
      // Why the project's Lead name: without one the host names the lead after the scene roster.
      orchestratorGameProjects: {
        [getRepoIdFromWorktreeId(worktreeId)]: { orchestrator: { label: 'Atlas' } }
      }
    })
    await expect
      .poll(async () => {
        const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
          terminalHandle: lead,
          project: 'lumen',
          label: 'Atlas'
        })
        return registered.result.registered
      })
      .toBe(true)
    await closeLeadStartTeamPanel(orcaPage)
    await postLeadAgentRow(electronApp, { paneKey: pane.paneKey, worktreeId })
    if (live) {
      // Why before any take: the lead's pane is a third of every window clip, and it must not be empty.
      const ptyId = await waitForActivePanePtyId(orcaPage)
      await sendToTerminal(orcaPage, ptyId, OWNER_PROMPT)
      await sendToTerminal(orcaPage, ptyId, '\r')
      // Why the content, not a count: Claude Code may add its own side requests to the same API.
      await expect
        .poll(() => api.prompts.some((prompt) => prompt.includes(OWNER_PROMPT)), {
          timeout: 20_000
        })
        .toBe(true)
      await expect.poll(async () => screenText(orcaPage), { timeout: 20_000 }).toContain('LUM-25')
    }

    // One real member, as a launch makes it, so the panel reads a team; the demo members are its clones.
    const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
      objective: 'Lumen 2.3',
      from: lead
    })
    // Why: workerStart resolves `id:` against the runtime's worktree list, which trails the window.
    await expect
      .poll(async () => {
        const listed = await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
        return listed.result.worktrees.some((one) => one.id === worktreeId)
      })
      .toBe(true)
    const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
      spec: 'Work on LUM-14',
      taskTitle: 'Pico · LUM-14',
      run: run.result.run.id,
      callerTerminalHandle: lead
    })
    const started = await client.call<{
      effects: { kind: string; role?: string; id?: string }[]
    }>('orchestration.workerStart', {
      task: task.result.task.id,
      from: lead,
      worktree: `id:${worktreeId}`,
      displayName: 'Pico · LUM-14',
      agent: 'codex',
      timeoutMs: 20_000
    })
    const handle = started.result.effects.find(
      (effect) => effect.kind === 'terminal' && effect.role === 'agent'
    )?.id
    const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
    const member = listed.result.terminals.find((one) => one.handle === handle)
    expect(member, 'the member terminal is not listed').toBeTruthy()
    const endpoint = await readHookEndpoint(electronApp)
    await emitCodexHookStatus(endpoint, {
      paneKey: `${member!.tabId}:${member!.leafId}`,
      worktreeId: member!.worktreeId,
      state: 'working',
      prompt: 'Work'
    })
    await serveDemoTeam(electronApp, demoOf(2, false, 'calm'))
    // Why back to the lead's tab: the member's pane shows a shell line with the machine's name.
    await orcaPage.evaluate(
      (tabId) => window.__store!.getState().setActiveTab(tabId),
      pane.paneKey.split(':')[0]!
    )
    await setTheme(orcaPage, 'dark')
    // Why before Office mounts: the building reads its height once, and a tall one shows every floor.
    await orcaPage.evaluate(() => window.localStorage.setItem('orca.teamBuilding.height', '4000'))
    await setStyle(orcaPage, 'office')
    // Why 560: the desks and the shaft keep their size at any width, so a wider panel only adds empty floor.
    await orcaPage.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('team')
      state.setRightSidebarWidth(560)
    })

    const panel = orcaPage.getByTestId('team-panel')
    const building = panel.locator('[data-team-building]')
    const floors = building.locator('[data-team-floor]')
    const cards = panel.locator('[data-team-card="member"]')
    // Why both paths: Illustrated draws the Office in 3D where WebGL opens (the macOS recording);
    // Linux CI runs with the GPU off, so it draws today's 2D building there.
    const office3d = panel.locator('[data-team-scene-office3d] canvas')
    await expect(panel.locator('[data-team-scene-webgl]')).toHaveAttribute(
      'data-team-scene-webgl',
      /on|off/,
      { timeout: 90_000 }
    )
    const threeD =
      (await panel.locator('[data-team-scene-webgl]').getAttribute('data-team-scene-webgl')) ===
      'on'
    await expect(cards).toHaveCount(MEMBERS.length)
    await expect(panel).toContainText('Atlas')
    await expect(panel).toContainText('XP')
    await expect(panel).not.toContainText(/orca-e2e|ORCA-\d/)
    // Why: the sidebar's one-time 'Workspace board moved' tip would sit in every frame for 12 s.
    await expect(orcaPage.getByText('Workspace board moved to the bottom bar')).toBeHidden({
      timeout: 20_000
    })
    if (threeD) {
      await expect(office3d).toHaveAttribute('data-office3d-floors', String(HOSTS.length), {
        timeout: 30_000
      })
      // Orin plays in the games room and Vega waits out its quota in the cafeteria, in the Lobby.
      await expect(office3d).toHaveAttribute('data-office3d-places', /:games/, { timeout: 30_000 })
      await expect(office3d).toHaveAttribute('data-office3d-places', /:cafe/)
      await expect(office3d).toHaveAttribute('data-office3d-camera', 'lead')
      const ride = await showcaseClip(electronApp, testInfo, 'team-office-building')
      await orcaPage.waitForTimeout(1_500)
      await stepDemo(electronApp, demoOf(2, true, 'red'))
      await emitCodexHookStatus(endpoint, {
        paneKey: pane.paneKey,
        worktreeId,
        state: 'working',
        tool: 'PushNotification'
      })
      // Nova's CI turns red: the lead leaves its office, rides the glass lift and talks to Nova.
      await orcaPage.waitForTimeout(OFFICE3D_TALK_MS)
      await ride.stop()
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.waitForTimeout(800)
        await orcaPage.screenshot({ path: testInfo.outputPath(`window-office-${theme}.png`) })
        await office3d.screenshot({ path: testInfo.outputPath(`building-${theme}.png`) })
      }
    } else {
      await expect(building).toBeVisible({ timeout: 90_000 })
      await expect(floors).toHaveCount(HOSTS.length)
      // Every floor in view, This computer's included: the bottom floor sits inside the building's box.
      const [lowest, box] = await Promise.all([
        floors.last().boundingBox(),
        building.locator('[data-team-floors-scroll]').boundingBox()
      ])
      expect(lowest!.y + lowest!.height, 'the lowest floor is cut').toBeLessThanOrEqual(
        box!.y + box!.height + 1
      )

      await expect(building.locator('[data-team-elevator-car]')).toHaveAttribute(
        'data-team-elevator-car',
        ''
      )
      const ride = await showcaseClip(electronApp, testInfo, 'team-office-building')
      await orcaPage.waitForTimeout(1_500)
      await stepDemo(electronApp, demoOf(2))
      // The lead's step as the owner sees it: it notifies you, its line riding with it to Juno's floor.
      await emitCodexHookStatus(endpoint, {
        paneKey: pane.paneKey,
        worktreeId,
        state: 'working',
        tool: 'PushNotification'
      })
      // The lead walks to the shaft, boards and rides to Juno's floor; the car moves only once it boards.
      await expect
        .poll(() => building.getAttribute('data-team-ride'), { timeout: 60_000 })
        .toMatch(/^there\|/)
      await expect(building.locator('[data-team-elevator-car]')).toHaveAttribute(
        'data-team-elevator-car',
        'studio'
      )
      await orcaPage.waitForTimeout(HOLD_MS)
      await ride.stop()
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.waitForTimeout(800)
        await orcaPage.screenshot({ path: testInfo.outputPath(`window-office-${theme}.png`) })
        await building.screenshot({ path: testInfo.outputPath(`building-${theme}.png`) })
      }
    }
    // A phone-width window: the panel is a drawer and the building keeps every floor.
    await setWindowWidth(electronApp, orcaPage, 390)
    if (!threeD) {
      await expect(floors).toHaveCount(HOSTS.length)
    }
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      await orcaPage.waitForTimeout(1_500)
      await orcaPage.screenshot({ path: testInfo.outputPath(`window-office-390-${theme}.png`) })
    }
    await setWindowWidth(electronApp, orcaPage, 1440)

    // One clip per style, the same team in each, for the site's style switcher.
    await setTheme(orcaPage, 'dark')
    for (const style of STYLES) {
      await setStyle(orcaPage, style)
      const scene =
        style !== 'office'
          ? panel.locator(`[data-team-scene="${style}"]`)
          : threeD
            ? office3d
            : building
      await expect(scene).toBeVisible({ timeout: 30_000 })
      // Why the wait: by now the lead is back at its desk, its floor over the Lobby and both rooms.
      await orcaPage.waitForTimeout(style === 'office' && threeD ? OFFICE3D_RIDE_MS : 1_500)
      if (style === 'office' && threeD) {
        await expect(office3d).toHaveAttribute('data-office3d-camera', 'lead')
      }
      const clip = await showcaseClip(electronApp, testInfo, `team-style-${style}`)
      await orcaPage.waitForTimeout(HOLD_MS * 2)
      await clip.stop()
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.waitForTimeout(1_500)
        await panel.screenshot({ path: testInfo.outputPath(`panel-${style}-${theme}.png`) })
      }
      await setTheme(orcaPage, 'dark')
    }

    // Kai's LUM-19 from a claimed ticket to a merged PR, its card open, the level moving with each award.
    await setStyle(orcaPage, 'figures')
    const kai = cards.filter({ hasText: 'LUM-19' })
    const chip = kai.locator('[data-team-pr-chip] [data-status-tone]')
    await stepDemo(electronApp, demoOf(0))
    await expect(chip).toHaveCount(0)
    await kai.locator('button[aria-expanded]').click()
    await expect(kai.locator('button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true')
    await orcaPage.waitForTimeout(800)
    // Why: opening a demo card tries its terminal, which a clone has not, and the toast must leave first.
    await expect(orcaPage.getByText(/Could not open/)).toBeHidden({ timeout: 20_000 })
    const tones = [null, 'info', 'success', 'success']
    const playMerge = async (theme: 'dark' | 'light') => {
      for (const [step, tone] of tones.entries()) {
        await stepDemo(electronApp, demoOf(step))
        await (tone
          ? expect(chip).toHaveAttribute('data-status-tone', tone, { timeout: 10_000 })
          : expect(chip).toHaveCount(0, { timeout: 10_000 }))
        await orcaPage.waitForTimeout(XP_MOTION_MS)
        await panel.screenshot({ path: testInfo.outputPath(`merge-${step}-${theme}.png`) })
      }
      await expect(panel.locator('[data-team-xp-level]')).toHaveAttribute('data-team-xp-level', '8')
    }
    const merge = await showcaseClip(electronApp, testInfo, 'team-merge')
    await playMerge('dark')
    await merge.stop()
    // Why the light stills after the take: a theme switch inside it would flash and end the poster light.
    await setTheme(orcaPage, 'light')
    await playMerge('light')
    await setTheme(orcaPage, 'dark')

    // The steward on Pico's card: Sonnet to map the ticket, Opus once it edits.
    // Why no click on Kai: one card opens at a time, and a merged member may have left the list.
    const pico = cards.filter({ hasText: 'LUM-14' })
    await pico.locator('button[aria-expanded]').click()
    await expect(orcaPage.getByText(/Could not open/)).toBeHidden({ timeout: 20_000 })
    await expect(pico.locator('[data-team-steward-step]')).toHaveCount(2)
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(orcaPage, theme)
      await orcaPage.waitForTimeout(800)
      await panel.screenshot({ path: testInfo.outputPath(`panel-steward-${theme}.png`) })
    }

    // The Inbox with an open owner question, the PRs tab with Kai's merge queue entry, and the Machines
    // tab: each recorded dark from the Team tab, then its stills in both themes.
    await stepDemo(electronApp, demoOf(2))
    await client.call('game.ownerAsk', {
      worktreeId,
      ticket: 'LUM-25',
      question: 'Retry uploads on cellular?',
      options: ['Yes', 'Wi-Fi only'],
      context: `${PR_URL}/47`
    })
    for (const tab of ['Inbox', 'PRs', 'Machines'] as const) {
      await setTheme(orcaPage, 'dark')
      await panel.getByRole('tab', { name: 'Team' }).click()
      await orcaPage.waitForTimeout(800)
      const take = await showcaseClip(electronApp, testInfo, `team-${tab.toLowerCase()}`)
      await orcaPage.waitForTimeout(HOLD_MS)
      await panel.getByRole('tab', { name: tab }).click()
      await orcaPage.waitForTimeout(HOLD_MS * 2)
      await take.stop()
      await expect(panel.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
      await expect(panel).not.toContainText('Could not read')
      if (tab === 'Inbox') {
        await expect(panel).toContainText('Retry uploads on cellular?')
      }
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(orcaPage, theme)
        await orcaPage.waitForTimeout(800)
        await panel.screenshot({
          path: testInfo.outputPath(`panel-${tab.toLowerCase()}-${theme}.png`)
        })
      }
    }
  } finally {
    agent.dispose()
    await api.close()
  }
})
