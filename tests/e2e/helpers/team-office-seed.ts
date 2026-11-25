import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './agent-hook-endpoint'
import { createStdinLoggingAgent } from './game-member-stdin-agent'
import { setWindowWidth } from './settings-window'
import { closeLeadStartTeamPanel } from './team-tab-auto-open'
import { writeSettings } from './settings-write'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './store'
import { waitForActivePaneHookDescriptor, waitForActivePanePtyId } from './terminal'
import { RuntimeClient } from '../../../src/cli/runtime-client'
import type { GameMemberSteward } from '../../../src/shared/orchestrator-game-member-steward'
import type { RuntimeTerminalListResult } from '../../../src/shared/runtime-types'

export type SeededDecision = { id: string; verdict: string; gesture: string | null }
export type SeededMember = {
  name: string
  state: string
  review?: 'open'
  /** Jev's latest decisions in this member's pane, newest last. */
  decisions?: SeededDecision[]
  /** A paired host's name; absent, this machine. */
  host?: string
  /** Its Orca steward's report, as the member's plugin sends it (ORCA-1242). */
  steward?: GameMemberSteward
}
/** The team as game.state carries it to the panel; `jev` gives the lead an advisor line. */
export type SeededTeam = { members: SeededMember[]; jev?: string }

type RuntimeCall = (event: unknown, args: { method: string }) => Promise<{ result?: object }>

const JEV = {
  version: 1,
  model: 'Opus 5.5',
  effort: 'high',
  pinned: { model: false, effort: false }
}

/**
 * Members cloned from the one real member into game.state on its way to the renderer, from a team a
 * test step can change; after the first call each change refreshes the panel at once.
 */
export async function seedOfficeTeam(app: ElectronApplication, team: SeededTeam): Promise<void> {
  await app.evaluate(
    ({ ipcMain, BrowserWindow }, { seeded, jev }) => {
      const scope = globalThis as unknown as { __officeTeam?: unknown }
      const first = scope.__officeTeam === undefined
      scope.__officeTeam = seeded
      if (!first) {
        // Why this event: the panel re-reads game.state on it now, not at its next 20 s poll.
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send('runtime:gameAdvisorChanged')
        )
        return
      }
      const { _invokeHandlers: handlers } = ipcMain as unknown as {
        _invokeHandlers: Map<string, RuntimeCall>
      }
      const real = handlers.get('runtime:call')!
      ipcMain.removeHandler('runtime:call')
      ipcMain.handle('runtime:call', async (event, args: { method: string }) => {
        const response = await real(event, args)
        const result = response.result as { agents?: Record<string, unknown>[] } | undefined
        if (args.method !== 'game.state' || !Array.isArray(result?.agents)) {
          return response
        }
        const leader = result.agents.find((one) => one.isLeader)
        const template = result.agents.find((one) => !one.isLeader)
        if (!leader || !template) {
          return response
        }
        const { members, jev: line } = scope.__officeTeam as SeededTeam
        const added = members.map((one, i) => ({
          ...template,
          paneKey: `office:${i}`,
          terminalHandle: null,
          displayName: one.name,
          state: one.state,
          toolName: 'Edit',
          ...(one.decisions ? { advisor: { ...jev, decisions: one.decisions } } : {}),
          ...(one.host ? { remote: { host: one.host, stateKnown: true } } : {}),
          ...(one.steward ? { steward: one.steward } : {}),
          ...(one.review
            ? {
                review: {
                  provider: 'github',
                  number: 900 + i,
                  title: one.name,
                  url: `https://github.com/example/repo/pull/${900 + i}`,
                  state: 'open',
                  ci: 'success',
                  verdict: 'review_required'
                }
              }
            : {})
        }))
        const lead = line ? { ...leader, advisor: { ...jev, line } } : leader
        return { ...response, result: { ...result, agents: [lead, ...added] } }
      })
    },
    { seeded: team, jev: JEV } as unknown as Parameters<typeof app.evaluate>[1]
  )
}

/**
 * A real lead with one real member, as a launch makes them, then `team` seeded over it and the
 * Team panel open in Office at a 1440 window. Returns the scene and the agent to dispose.
 */
export async function openOfficeTeam(
  electronApp: ElectronApplication,
  orcaPage: Page,
  team: SeededTeam
): Promise<{ scene: Locator; dispose: () => void }> {
  const agent = createStdinLoggingAgent()
  try {
    return {
      scene: await launchOfficeTeam(electronApp, orcaPage, team, agent.command),
      dispose: () => agent.dispose()
    }
  } catch (error) {
    agent.dispose()
    throw error
  }
}

async function launchOfficeTeam(
  electronApp: ElectronApplication,
  orcaPage: Page,
  team: SeededTeam,
  agentCommand: string
): Promise<Locator> {
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActivePanePtyId(orcaPage)
  const pane = await waitForActivePaneHookDescriptor(orcaPage)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const lead = (
    await client.call<{ terminal: { handle: string } }>('terminal.resolvePane', {
      paneKey: pane.paneKey
    })
  ).result.terminal.handle
  await writeSettings(orcaPage, {
    uiLanguage: 'en',
    defaultTuiAgent: 'codex',
    agentCmdOverrides: { codex: agentCommand },
    agentDefaultArgs: { codex: '' }
  })
  await client.call('terminal.send', {
    terminal: lead,
    text: 'node -e "setInterval(() => {}, 1e9)"',
    enter: true
  })
  await expect
    .poll(async () => {
      const registered = await client.call<{ registered: boolean }>('game.leadRegister', {
        terminalHandle: lead,
        project: 'e2e',
        label: 'Alfred'
      })
      return registered.result.registered
    })
    .toBe(true)
  await closeLeadStartTeamPanel(orcaPage)
  const endpoint = await readHookEndpoint(electronApp)
  await emitCodexHookStatus(endpoint, {
    paneKey: pane.paneKey,
    worktreeId,
    state: 'working',
    prompt: 'Lead the team'
  })
  const run = await client.call<{ run: { id: string } }>('orchestration.runCreate', {
    objective: 'Office',
    from: lead
  })
  await expect
    .poll(async () => {
      const listed = await client.call<{ worktrees: { id: string }[] }>('worktree.list', {})
      return listed.result.worktrees.some((one) => one.id === worktreeId)
    })
    .toBe(true)
  const task = await client.call<{ task: { id: string } }>('orchestration.taskCreate', {
    spec: 'Work on ORCA-300',
    taskTitle: 'Bowser · ORCA-300 Build',
    run: run.result.run.id,
    callerTerminalHandle: lead
  })
  const started = await client.call<{ effects: { kind: string; role?: string; id?: string }[] }>(
    'orchestration.workerStart',
    {
      task: task.result.task.id,
      from: lead,
      worktree: `id:${worktreeId}`,
      displayName: 'Bowser · ORCA-300 Build',
      agent: 'codex',
      timeoutMs: 20_000
    }
  )
  const handle = started.result.effects.find(
    (effect) => effect.kind === 'terminal' && effect.role === 'agent'
  )?.id
  const listed = await client.call<RuntimeTerminalListResult>('terminal.list')
  const terminal = listed.result.terminals.find((one) => one.handle === handle)
  expect(terminal, 'the member terminal is not listed').toBeTruthy()
  await emitCodexHookStatus(endpoint, {
    paneKey: `${terminal!.tabId}:${terminal!.leafId}`,
    worktreeId: terminal!.worktreeId,
    state: 'working',
    prompt: 'Work'
  })
  await seedOfficeTeam(electronApp, team)
  await setWindowWidth(electronApp, orcaPage, 1440)
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    const game = state.settings?.orchestratorGame
    void state.updateSettings({
      // Why Low resources: the Office specs drive the 2D Office's floors; Illustrated draws it in 3D.
      orchestratorGame: {
        ...game,
        panel: { ...game?.panel, look: 'game', style: 'office', quality: 'low' }
      }
    })
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('team')
    state.setRightSidebarWidth(640)
  })
  const scene = orcaPage.getByTestId('team-panel').locator('[data-team-scene="office"]')
  // Why the first: a team on several machines draws one stage per floor.
  await expect(scene.getByRole('img', { name: 'Live team scene' }).first()).toBeVisible({
    timeout: 90_000
  })
  return scene
}

/** Screenshots of `scene` `everyMs` apart, with `read`'s value at each, so motion can be read. */
export async function sceneStrip(
  page: Page,
  scene: Locator,
  path: (frame: number) => string,
  frames: number,
  everyMs: number,
  read: () => Promise<number>
): Promise<number[]> {
  const values: number[] = []
  for (let frame = 0; frame < frames; frame++) {
    values.push(await read())
    await scene.screenshot({ path: path(frame) })
    await page.waitForTimeout(everyMs)
  }
  return values
}

/** A number the scene's root element exposes, as `data-scene-lead-x`; NaN while it has none. */
export const readSceneNumber = (scene: Locator, attribute: string): Promise<number> =>
  scene
    .locator(`[${attribute}]`)
    .first()
    .getAttribute(attribute, { timeout: 1000 })
    .then(Number)
    .catch(() => Number.NaN)
