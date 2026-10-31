import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'

const host = vi.hoisted(() => ({
  calls: [] as [string, string, unknown][],
  results: {} as Record<string, unknown>
}))
vi.mock('./orchestrator-game-host-client', () => ({
  hostClientOf: (environmentId: string) => ({
    call: async (method: string, params: unknown) => {
      host.calls.push([environmentId, method, params])
      return { ok: true, result: host.results[method] }
    }
  })
}))

import { ORCHESTRATOR_GAME_REBIND_HANDLERS } from './orchestrator-game-rebind'

const LEAD = {
  paneKey: 'lead',
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true,
  terminalHandle: 'term_lead'
}

const local = {
  paneKey: 'tab-4:member',
  displayName: 'Merlin · CIN-1297',
  agentType: 'codex',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_new',
  worktree: { id: 'wt-1297', branch: 'cin-1297', displayName: 'CIN-1297' }
}

const remote = {
  paneKey: 'remote:ctx_r',
  displayName: 'Arthur · CIN-1297',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_old_r',
  remote: { host: 'imac', stateKnown: true }
}

const running = (handle: string, worktreeId: string) => ({
  handle,
  worktreeId,
  tabId: `tab-${handle}`,
  leafId: `leaf-${handle}`,
  liveness: 'running',
  connected: true
})

const ps = (worktreeId: string, agents: readonly (readonly [string, string])[]) => ({
  worktrees: [
    {
      worktreeId,
      agents: agents.map(([handle, state]) => ({ paneKey: `tab-${handle}:leaf-${handle}`, state }))
    }
  ]
})

function clientWith(agents: unknown[], results: Record<string, unknown> = {}) {
  const calls: [string, unknown][] = []
  const all: Record<string, unknown> = {
    'game.state': { config: { mode: 'on' }, agents: [LEAD, ...agents], role: 'lead' },
    'terminal.show': { terminal: { handle: 'term_lead' } },
    'orchestration.workerStop': { state: 'stopped' },
    'orchestration.workerStart': { dispatchId: 'ctx_new', state: 'ready' },
    'game.stopSwitch': { stopped: null },
    ...results
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: all[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const rebind = (client: RuntimeClient, ticket = 'cin-1297') =>
  ORCHESTRATOR_GAME_REBIND_HANDLERS['game rebind']({
    flags: new Map([['ticket', ticket]]),
    client,
    cwd: '/repo',
    json: true
  })

const MUTATIONS = new Set([
  'orchestration.workerStop',
  'orchestration.workerAbandon',
  'orchestration.workerStart'
])
const mutations = (calls: [string, unknown][]) => calls.filter(([method]) => MUTATIONS.has(method))

// A member whose terminal something replaced takes a fresh dispatch on the one it runs in now (CIN-1297).
describe('orca game rebind (ORCA-914)', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    process.env.ORCA_PANE_KEY = 'lead'
    host.calls = []
    host.results = {}
  })

  afterEach(() => {
    process.env = { ...saved }
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  // Why abandon: with its terminal gone no stop is proven, and a retry needs a settled dispatch.
  it('settles the stale dispatch and starts its task again on the live terminal in its worktree', async () => {
    const { client, calls } = clientWith([local], {
      'orchestration.workerStop': { state: 'stop_unknown' },
      'orchestration.workerAbandon': { state: 'abandoned' },
      'orchestration.workerList': {
        workers: [
          {
            dispatchId: 'ctx_old',
            taskId: 'task_1297',
            runId: 'run_1',
            agentTerminalHandle: 'term_old',
            workerState: 'ready',
            resource: { worktreeId: 'wt-1297' }
          }
        ]
      },
      'terminal.list': {
        terminals: [running('term_shell', 'wt-1297'), running('term_new', 'wt-1297')]
      },
      'worktree.ps': ps('wt-1297', [['term_new', 'done']])
    })

    await rebind(client)

    expect(mutations(calls)).toEqual([
      ['orchestration.workerStop', { dispatch: 'ctx_old' }],
      ['orchestration.workerAbandon', { dispatch: 'ctx_old' }],
      [
        'orchestration.workerStart',
        expect.objectContaining({
          task: 'task_1297',
          retryOf: 'ctx_old',
          run: 'run_1',
          worktree: 'id:wt-1297',
          terminal: 'term_new',
          from: 'term_lead'
        })
      ]
    ])
    expect(calls).toContainEqual(['terminal.list', { worktree: 'id:wt-1297' }])
  })

  it('on a paired host, finds the live terminal there and starts the task on it with --on', async () => {
    host.results = {
      'terminal.list': { terminals: [running('term_new_r', 'repo::/home/me/cin-1297')] },
      'orchestration.workerList': { workers: [] },
      'worktree.ps': ps('repo::/home/me/cin-1297', [['term_new_r', 'waiting']])
    }
    const { client, calls } = clientWith([remote], {
      'orchestration.workerList': {
        workers: [
          {
            dispatchId: 'ctx_r',
            taskId: 'task_1297',
            runId: 'run_1',
            agentTerminalHandle: null,
            workerState: 'ready'
          }
        ]
      },
      'orchestration.workerShow': {
        dispatch: { task_id: 'task_1297', run_id: 'run_1' },
        worker: { worktree_id: 'repo::/home/me/cin-1297' },
        server: { environmentId: 'env_imac', name: 'imac' }
      }
    })

    await rebind(client)

    expect(host.calls.map(([environmentId, method]) => [environmentId, method])).toContainEqual([
      'env_imac',
      'terminal.list'
    ])
    expect(mutations(calls)).toEqual([
      ['orchestration.workerStop', { dispatch: 'ctx_r' }],
      [
        'orchestration.workerStart',
        expect.objectContaining({
          on: 'env_imac',
          task: 'task_1297',
          retryOf: 'ctx_r',
          terminal: 'term_new_r',
          worktree: 'id:repo::/home/me/cin-1297'
        })
      ]
    ])
  })

  it('changes nothing while its own terminal still runs, its agent is mid-turn, or it cannot tell which terminal', async () => {
    const worker = {
      dispatchId: 'ctx_old',
      taskId: 'task_1297',
      runId: 'run_1',
      agentTerminalHandle: 'term_old',
      workerState: 'ready',
      resource: { worktreeId: 'wt-1297' }
    }
    for (const [terminals, agents] of [
      [[running('term_old', 'wt-1297'), running('term_new', 'wt-1297')], [['term_new', 'done']]],
      [
        [running('term_a', 'wt-1297'), running('term_b', 'wt-1297')],
        [
          ['term_a', 'done'],
          ['term_b', 'done']
        ]
      ],
      [[running('term_new', 'wt-1297')], [['term_new', 'working']]]
    ] as const) {
      const { client, calls } = clientWith([local], {
        'orchestration.workerList': { workers: [worker] },
        'terminal.list': { terminals },
        'worktree.ps': ps('wt-1297', agents)
      })

      await rebind(client)

      expect(mutations(calls)).toEqual([])
      expect(process.exitCode).toBe(1)
      process.exitCode = undefined
    }
  })
})
