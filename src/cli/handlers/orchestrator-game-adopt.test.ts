import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'

const host = vi.hoisted(() => ({
  calls: [] as [string, string, unknown][],
  results: {} as Record<string, unknown>
}))
vi.mock('./orchestrator-game-host-client', () => ({
  openHostRuntimeClient: async (environmentId: string) => ({
    call: async (method: string, params: unknown) => {
      host.calls.push([environmentId, method, params])
      return { ok: true, result: host.results[method] }
    }
  })
}))

import { ORCHESTRATOR_GAME_ADOPT_HANDLERS } from './orchestrator-game-adopt'

const HOST_PANE = 'tab-915:leaf-915'

const LEAD = {
  paneKey: 'lead',
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true,
  terminalHandle: 'term_lead'
}

const found = {
  paneKey: `remote-found:env_m1:${HOST_PANE}`,
  displayName: 'orca-915',
  agentType: 'claude',
  state: 'done',
  toolName: null,
  isLeader: false,
  isMember: true,
  found: true,
  remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true },
  worktree: {
    id: 'wt-915',
    branch: 'fabolivark/orca-915',
    displayName: 'orca-915'
  }
}

const hostReads = (state = 'done', runs: unknown[] = []) => ({
  'terminal.list': {
    terminals: [
      {
        handle: 'term_m1_915',
        worktreeId: 'wt-915',
        tabId: 'tab-915',
        leafId: 'leaf-915',
        liveness: 'running',
        connected: true
      }
    ]
  },
  'worktree.ps': {
    worktrees: [{ worktreeId: 'wt-915', agents: [{ paneKey: HOST_PANE, state }] }]
  },
  'orchestration.runList': { runs }
})

function clientWith(agents: unknown[]) {
  const calls: [string, unknown][] = []
  const all: Record<string, unknown> = {
    'game.state': {
      config: { mode: 'on' },
      agents: [LEAD, ...agents],
      role: 'lead',
      worktree: {
        id: 'repo1::/repo',
        path: '/repo',
        branch: 'main',
        displayName: 'repo'
      }
    },
    'game.stopSwitch': { stopped: null },
    'terminal.show': { terminal: { handle: 'term_lead' } },
    'orchestration.taskCreate': { task: { id: 'task_adopt' } },
    'orchestration.workerStart': { dispatchId: 'ctx_adopted', state: 'ready' }
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: all[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const adopt = (client: RuntimeClient, name = 'ORCA-915', force = false) =>
  ORCHESTRATOR_GAME_ADOPT_HANDLERS['game adopt']({
    flags: new Map<string, string | boolean>([
      ['name', name],
      ...(force ? [['force', true] as const] : [])
    ]),
    client,
    cwd: '/repo',
    json: true
  })

const output = () => JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])).result
const mutations = (calls: [string, unknown][]) =>
  calls.filter(
    ([method]) => method === 'orchestration.taskCreate' || method === 'orchestration.workerStart'
  )

// Why: an agent found on a paired host is listed but no mail reaches it until it has a dispatch (ORCA-943).
describe('orca game adopt (ORCA-943)', () => {
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

  it("starts a dispatch on the found agent's own host terminal, so mail flows both ways", async () => {
    host.results = hostReads()
    const { client, calls } = clientWith([found])

    await adopt(client)

    expect(mutations(calls)).toEqual([
      [
        'orchestration.taskCreate',
        expect.objectContaining({
          taskTitle: 'ORCA-915',
          callerTerminalHandle: 'term_lead'
        })
      ],
      [
        'orchestration.workerStart',
        expect.objectContaining({
          task: 'task_adopt',
          on: 'env_m1',
          worktree: 'id:wt-915',
          terminal: 'term_m1_915',
          from: 'term_lead'
        })
      ]
    ])
    expect(output()).toMatchObject({
      adopted: true,
      dispatchId: 'ctx_adopted',
      host: 'm1',
      terminal: 'term_m1_915'
    })
  })

  it('reuses the dispatch of an agent already adopted, without starting another', async () => {
    const adopted = {
      ...found,
      paneKey: 'remote:ctx_adopted',
      found: undefined,
      terminalHandle: 'term_m1_915'
    }
    const { client, calls } = clientWith([adopted])

    await adopt(client)

    expect(mutations(calls)).toEqual([])
    expect(output()).toMatchObject({
      adopted: true,
      reused: true,
      dispatchId: 'ctx_adopted'
    })
  })

  it('refuses while the agent is mid-turn, and adopts it with --force', async () => {
    host.results = hostReads('working')
    const first = clientWith([found])

    await adopt(first.client)

    expect(mutations(first.calls)).toEqual([])
    expect(output()).toMatchObject({
      adopted: false,
      refusal: expect.stringMatching(/mid-turn/)
    })
    expect(process.exitCode).toBe(1)

    const forced = clientWith([found])
    await adopt(forced.client, 'orca-915', true)
    expect(mutations(forced.calls)).toHaveLength(2)
  })

  it('refuses an agent that leads a Run on its host', async () => {
    host.results = hostReads('done', [{ id: 'run_m1', coordinator_pane_key: HOST_PANE }])
    const { client, calls } = clientWith([found])

    await adopt(client)

    expect(mutations(calls)).toEqual([])
    expect(output().refusal).toMatch(/leads a Run on m1/)
  })

  it('names no agent of another project, which is never listed as found', async () => {
    const { client } = clientWith([found])

    await expect(adopt(client, 'CINE-40')).rejects.toThrow(
      /No agent named CINE-40 runs on this machine or this project's paired hosts/
    )
  })

  describe('a found agent on this machine', () => {
    const local = (repo = 'repo1', state = 'idle') => ({
      paneKey: 'tab-7:leaf-7',
      displayName: 'orca-907',
      agentType: 'claude',
      state,
      toolName: null,
      isLeader: false,
      isMember: true,
      found: true,
      terminalHandle: 'term_local_7',
      worktree: {
        id: `${repo}::/wt/orca-907`,
        branch: 'fabolivark/orca-907',
        displayName: 'orca-907'
      }
    })

    it('starts a dispatch on its own local terminal, with no host', async () => {
      const { client, calls } = clientWith([local()])

      await adopt(client, 'ORCA-907')

      expect(mutations(calls)).toEqual([
        ['orchestration.taskCreate', expect.objectContaining({ taskTitle: 'ORCA-907' })],
        [
          'orchestration.workerStart',
          expect.objectContaining({
            task: 'task_adopt',
            worktree: 'id:repo1::/wt/orca-907',
            terminal: 'term_local_7',
            from: 'term_lead'
          })
        ]
      ])
      expect(mutations(calls)[1][1]).not.toHaveProperty('on')
      expect(host.calls).toEqual([])
      expect(output()).toMatchObject({
        adopted: true,
        terminal: 'term_local_7'
      })
    })

    it('refuses it while mid-turn unless --force', async () => {
      const { client, calls } = clientWith([local('repo1', 'working')])

      await adopt(client, 'ORCA-907')

      expect(mutations(calls)).toEqual([])
      expect(output().refusal).toMatch(/mid-turn/)
    })

    it("never adopts another project's local agent", async () => {
      const { client, calls } = clientWith([local('repo2')])

      await expect(adopt(client, 'ORCA-907')).rejects.toThrow(/No agent named ORCA-907/)
      expect(mutations(calls)).toEqual([])
    })

    it('says an already adopted local member is one, without a new dispatch', async () => {
      const { client, calls } = clientWith([{ ...local(), found: undefined }])

      await adopt(client, 'ORCA-907')

      expect(mutations(calls)).toEqual([])
      expect(output()).toMatchObject({ adopted: true, reused: true })
    })
  })
})
