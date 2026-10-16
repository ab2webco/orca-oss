import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import type { RuntimeClient } from '../runtime-client'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../shared/protocol-version'

const TODO_ITEM = {
  id: 'CIN-12',
  title: 'Cartelera page',
  url: 'https://jira.example/browse/CIN-12',
  status: 'To Do'
}

function stateWith(overrides: Record<string, unknown> = {}) {
  return {
    config: { mode: 'on' },
    agents: [],
    worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
    project: { reviews: null, todo: { provider: 'jira', total: 1, url: null, items: [TODO_ITEM] } },
    lead: { autostart: false, cap: 2, agent: 'claude', launchPrompt: 'Implement {id}: {title}' },
    ...overrides
  }
}

function fakeClient(state: unknown, run: { id: string } | null = { id: 'run_1' }) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'terminal.show': { terminal: { handle: 'h1' } },
    'status.get': { capabilities: [ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY] },
    'orchestration.runCurrent': { run },
    'orchestration.runCreate': { run: { id: 'run_new', objective: 'x' } },
    'orchestration.taskCreate': { task: { id: 'task_1', status: 'ready' } },
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'dispatch_1',
      state: 'ready',
      effects: [],
      residualResources: []
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

const launch = (client: RuntimeClient, ticket = 'cin-12') =>
  ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
    flags: new Map([['ticket', ticket]]),
    client,
    cwd: '/repo',
    json: true
  })

describe('orca game launch', () => {
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

  it('starts one member for a To Do ticket in its own child worktree, with the project prompt', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launch(client)

    expect(calls.map(([method]) => method)).toEqual([
      'game.state',
      'terminal.show',
      'orchestration.runCurrent',
      'orchestration.taskCreate',
      'orchestration.workerStart'
    ])
    expect(calls[3]?.[1]).toEqual({
      spec: 'Implement CIN-12: Cartelera page',
      taskTitle: 'CIN-12 Cartelera page',
      callerTerminalHandle: 'h1'
    })
    expect(calls[4]?.[1]).toEqual(
      expect.objectContaining({
        task: 'task_1',
        worktree: 'new-child',
        name: 'cin-12',
        displayName: 'CIN-12 Cartelera page',
        agent: 'claude',
        run: 'run_1',
        from: 'h1'
      })
    )
    expect(JSON.parse(output.join(''))).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          ticket: 'CIN-12',
          dispatchId: 'dispatch_1',
          state: 'ready'
        })
      })
    )
  })

  it('binds a new Run named after the lead when the terminal has none', async () => {
    const { client, calls } = fakeClient(stateWith(), null)

    await launch(client)

    expect(calls.find(([method]) => method === 'orchestration.runCreate')?.[1]).toEqual({
      objective: 'Lead of cineco: one member per ticket',
      from: 'h1'
    })
    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ run: 'run_new' })
    )
  })

  it('passes the model and effort only after the runtime says it supports them', async () => {
    const { client, calls } = fakeClient(
      stateWith({
        lead: { autostart: false, cap: 2, agent: 'claude', model: 'opus', effort: 'high' }
      })
    )

    await launch(client)

    expect(calls.map(([method]) => method)).toContain('status.get')
    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ model: 'opus', effort: 'high' })
    )
  })

  it('refuses a launch past the cap without touching orchestration', async () => {
    const member = { paneKey: 'm', state: 'working', isMember: true }
    const { client, calls } = fakeClient(
      stateWith({ agents: [member, { ...member, paneKey: 'n' }, { paneKey: 'l', state: 'idle' }] })
    )

    await expect(launch(client)).rejects.toThrow(/2 of 2 members are running/)
    expect(calls.map(([method]) => method)).toEqual(['game.state'])
  })

  it('launches a ticket that is not in the To Do with its id alone', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launch(client, 'CIN-99')

    expect(calls.find(([method]) => method === 'orchestration.taskCreate')?.[1]).toEqual(
      expect.objectContaining({ spec: 'Work on CIN-99', taskTitle: 'CIN-99' })
    )
  })
})
