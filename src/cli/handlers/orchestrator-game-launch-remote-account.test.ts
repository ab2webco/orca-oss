import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import { formatGameLaunch } from './orchestrator-game-launch-result'
import { gameLaunchChoiceOf } from './orchestrator-game-launch-options'
import { globalLoginHolderOf } from './orchestrator-game-launch-account'
import type { RuntimeClient } from '../runtime-client'
import type { OrchestratorGameLead } from '../../shared/orchestrator-game-lead'
import type { GameAgent } from '../../shared/orchestrator-game-state'

const LEAD = { autostart: false, cap: 2, agent: 'claude', launchPrompt: 'Implement {id}' }

function stateWith(lead: Record<string, unknown> = {}) {
  return {
    config: { mode: 'on' },
    agents: [],
    worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
    project: { reviews: null, todo: null },
    lead: { ...LEAD, ...lead }
  }
}

function fakeClient(state: unknown, workerStart: Record<string, unknown> = {}) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'terminal.show': { terminal: { handle: 'h1' } },
    'status.get': { capabilities: [] },
    'orchestration.runCurrent': { run: { id: 'run_1' } },
    'orchestration.taskCreate': { task: { id: 'task_1', status: 'ready' } },
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'dispatch_1',
      state: 'ready',
      ...workerStart
    }
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const launchOn = (client: RuntimeClient, extra: [string, string][] = []) =>
  ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
    flags: new Map([['ticket', 'CIN-12'], ['on', 'm1'], ['repo', 'name:cineco'], ...extra]),
    client,
    cwd: '/repo',
    json: true
  })

const lead = (accounts?: 'auto' | 'default') =>
  ({ ...LEAD, ...(accounts ? { accounts } : {}) }) as OrchestratorGameLead

describe('a member placed with --on and no --account (ORCA-891)', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:leaf'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('hands the host auto when orchestrator.accounts is unset or auto, and nothing with default', () => {
    expect(gameLaunchChoiceOf({}, lead())).toMatchObject({
      remoteAccount: 'auto',
      remoteAccountByDefault: true
    })
    expect(gameLaunchChoiceOf({}, lead('auto'))).toMatchObject({
      remoteAccount: 'auto',
      remoteAccountByDefault: false
    })
    expect(gameLaunchChoiceOf({}, lead('default'))).toMatchObject({
      remoteAccount: null,
      remoteAccountByDefault: false
    })
    expect(gameLaunchChoiceOf({ account: 'ana@koombea.com' }, lead())).toMatchObject({
      remoteAccount: 'ana@koombea.com',
      remoteAccountByDefault: false
    })
  })

  it('hands nothing for an agent with no managed accounts unless one is typed', () => {
    expect(gameLaunchChoiceOf({ agent: 'gemini' }, lead()).remoteAccount).toBeNull()
  })

  it('sends the unset policy as auto, marked as the default', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launchOn(client)

    const started = calls.find(([method]) => method === 'orchestration.workerStart')?.[1]
    expect(started).toEqual(
      expect.objectContaining({ on: 'm1', remoteAccount: 'auto', remoteAccountByDefault: true })
    )
    expect(calls.map(([method]) => method)).not.toContain('accounts.snapshot')
  })

  it('does not mark a typed --account auto as the default', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launchOn(client, [['account', 'auto']])

    const started = calls.find(([method]) => method === 'orchestration.workerStart')?.[1]
    expect(started).toEqual(expect.objectContaining({ remoteAccount: 'auto' }))
    expect(started).not.toHaveProperty('remoteAccountByDefault')
  })

  it('sends no account with accounts: default', async () => {
    const { client, calls } = fakeClient(stateWith({ accounts: 'default' }))

    await launchOn(client)

    const started = calls.find(([method]) => method === 'orchestration.workerStart')?.[1]
    expect(started).not.toHaveProperty('remoteAccount')
  })

  it("says the member runs on the host's global login, and why", async () => {
    for (const [why, note] of [
      ['no_account', "no managed account on m1, so it runs on m1's global login"],
      ['older_host', "m1's Orca cannot pick a member account, so it runs on m1's global login"]
    ]) {
      output = []
      const { client } = fakeClient(stateWith(), { globalLogin: why })

      await launchOn(client)

      const result = JSON.parse(output.join('')).result
      expect(result).toEqual(expect.objectContaining({ globalLogin: true, globalLoginHost: 'm1' }))
      expect(formatGameLaunch(result)).toContain(note)
      expect(formatGameLaunch(result)).toContain('claude · global login')
    }
  })
})

describe('the global login one member at a time (ORCA-891)', () => {
  const member = (overrides: Partial<GameAgent>): GameAgent =>
    ({
      paneKey: 'tab:1',
      displayName: 'Ana · CIN-11',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: false,
      isMember: true,
      globalLogin: true,
      ...overrides
    }) as GameAgent

  it("does not count a paired host's member against this host's global login", () => {
    expect(
      globalLoginHolderOf([member({ remote: { host: 'm1', stateKnown: true } })], 'claude', [])
    ).toBeNull()
    expect(globalLoginHolderOf([member({})], 'claude', [])).not.toBeNull()
  })
})
