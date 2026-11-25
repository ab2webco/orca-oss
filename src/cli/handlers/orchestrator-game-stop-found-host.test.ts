import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  calls: [] as [string, string, unknown][],
  results: {} as Record<string, unknown>,
  failClose: null as Error | null
}))
vi.mock('./orchestrator-game-host-client', () => ({
  openHostRuntimeClient: async (environmentId: string) => ({
    call: async (method: string, params: unknown) => {
      host.calls.push([environmentId, method, params])
      if (method === 'terminal.close' && host.failClose) {
        throw host.failClose
      }
      return { ok: true, result: host.results[method] }
    }
  })
}))

import {
  LEAD,
  fakeClient,
  freeing,
  member,
  merged,
  methods,
  run,
  stateWith
} from './orchestrator-game-fleet-test-fixtures'
import { sweptDispatchOf } from './orchestrator-game-sweep-close'
import { gameStopTargetsOf } from '../../shared/orchestrator-game-stop-targets'
import type { GameAgent } from '../../shared/orchestrator-game-state'

const HOST_PANE = 'tab-1388:leaf-1388'

// Why: an earlier lead's finished member comes back as a found session on its paired host (ORCA-1424).
const leftover = (overrides: Record<string, unknown> = {}) =>
  member({
    paneKey: `remote-found:env_koombea:${HOST_PANE}`,
    displayName: 'ORCA-1388',
    state: 'done',
    found: true,
    terminalHandle: undefined,
    remote: { host: 'koombea', environmentId: 'env_koombea', stateKnown: true },
    worktree: { id: 'wt-1388', branch: 'fabolivark/orca-1388', displayName: 'orca-1388' },
    ...overrides
  })

const hostReads = (agentState = 'done') => ({
  'terminal.list': {
    terminals: [
      {
        handle: 'term_k_1388',
        worktreeId: 'wt-1388',
        tabId: 'tab-1388',
        leafId: 'leaf-1388',
        liveness: 'running',
        connected: true
      }
    ]
  },
  'worktree.ps': {
    worktrees: [{ worktreeId: 'wt-1388', agents: [{ paneKey: HOST_PANE, state: agentState }] }]
  },
  'terminal.close': { close: { handle: 'term_k_1388', tabId: 'tab-1388', ptyKilled: true } }
})

const DISPATCH_CALLS = ['orchestration.workerStop', 'orchestration.workerRelease']

describe('game stop and sweep on a session found on a paired host (ORCA-1396)', () => {
  const saved = { ...process.env }
  let output: string[] = []
  const printed = () => JSON.parse(output.join('')).result

  beforeEach(() => {
    output = []
    host.calls = []
    host.results = hostReads()
    host.failClose = null
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
    process.env.ORCA_PANE_KEY = 'tab:lead'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('never takes a found row key for a dispatch id', () => {
    const [target] = gameStopTargetsOf({ agents: [leftover() as GameAgent], lead: undefined }, [
      'ORCA-1388'
    ]).targets

    expect(target.remoteDispatchId).toBeNull()
    expect(target.hostPane).toEqual({
      paneKey: `remote-found:env_koombea:${HOST_PANE}`,
      hostPane: HOST_PANE,
      environmentId: 'env_koombea',
      host: 'koombea',
      worktreeId: 'wt-1388'
    })
    const entry = { row: { terminalHandle: null } } as Parameters<typeof sweptDispatchOf>[0]
    expect(sweptDispatchOf(entry, leftover() as GameAgent, [])).toBeUndefined()
  })

  it('game stop closes its pane on its host and asks this home for no dispatch', async () => {
    const { client, calls } = fakeClient(stateWith({ agents: [LEAD, leftover()] }), {
      'game.historyRecord': { recorded: true, count: 1 }
    })

    await run('game stop', client, [['tickets', 'ORCA-1388']])

    expect(methods(calls).some((method) => DISPATCH_CALLS.includes(method))).toBe(false)
    expect(host.calls).toEqual([
      ['env_koombea', 'terminal.list', { worktree: 'id:wt-1388' }],
      ['env_koombea', 'terminal.close', { terminal: 'term_k_1388' }]
    ])
    expect(printed().members).toEqual([
      expect.objectContaining({
        ticket: 'ORCA-1388',
        outcome: 'stopped',
        closedTerminal: 'term_k_1388',
        host: 'koombea'
      })
    ])
    expect(methods(calls)).toContain('game.historyRecord')
    expect(process.exitCode).toBeUndefined()
  })

  it('game stop says a pane already gone from its host is already stopped', async () => {
    host.results = { ...hostReads(), 'terminal.list': { terminals: [] } }
    const { client } = fakeClient(stateWith({ agents: [LEAD, leftover()] }))

    await run('game stop', client, [['tickets', 'ORCA-1388']])

    expect(host.calls.map(([, method]) => method)).toEqual(['terminal.list'])
    expect(printed().members[0]).toEqual(
      expect.objectContaining({
        outcome: 'already stopped',
        reason: 'its pane is no longer on koombea'
      })
    )
  })

  it('game stop writes no freed history when the close on its host fails', async () => {
    host.failClose = new Error('koombea did not answer')
    const { client, calls } = fakeClient(stateWith({ agents: [LEAD, leftover()] }))

    await run('game stop', client, [['tickets', 'ORCA-1388']])

    expect(printed().members[0]).toEqual(
      expect.objectContaining({
        outcome: 'failed',
        reason: 'closing its pane on koombea failed: koombea did not answer'
      })
    )
    expect(methods(calls)).not.toContain('game.historyRecord')
    expect(process.exitCode).toBe(1)
  })

  it('game stop writes no freed history when the host keeps a remote member', async () => {
    const agents = [
      LEAD,
      member({
        paneKey: 'remote:ctx_1388',
        displayName: 'ORCA-1388',
        state: 'done',
        terminalHandle: 'term_r_1388',
        remote: { host: 'koombea', stateKnown: true }
      })
    ]
    const { client, calls } = fakeClient(stateWith({ agents }), {
      'orchestration.workerRelease': {
        dispatchId: 'ctx_1388',
        state: 'retained',
        reason: 'not_settled'
      }
    })

    await run('game stop', client, [['tickets', 'ORCA-1388']])

    expect(printed().members[0]).toEqual(expect.objectContaining({ outcome: 'failed' }))
    expect(methods(calls)).not.toContain('game.historyRecord')
  })

  it('game sweep lists a leftover on a paired host, and --close closes its pane there', async () => {
    const { client, calls } = fakeClient(stateWith({ agents: [LEAD, leftover()] }), {
      'game.historyRecord': { recorded: true, count: 1 }
    })

    await run('game sweep', client, [['close', true]])

    expect(freeing(calls.slice(1))).toEqual([['orchestration.workerList', {}]])
    expect(host.calls.map(([env, method]) => [env, method])).toEqual([
      ['env_koombea', 'terminal.list'],
      ['env_koombea', 'worktree.ps'],
      ['env_koombea', 'terminal.close']
    ])
    expect(printed().finished).toEqual([
      expect.objectContaining({
        reason: 'leftover on koombea: no lead runs it; agent done',
        closed: { via: 'host', host: 'koombea', terminal: 'term_k_1388' }
      })
    ])
    expect(methods(calls)).toContain('game.historyRecord')
  })

  it('game sweep --close keeps a leftover whose agent took a turn since the fleet read', async () => {
    host.results = hostReads('working')
    const { client, calls } = fakeClient(stateWith({ agents: [LEAD, leftover()] }))

    await run('game sweep', client, [['close', true]])

    expect(host.calls.map(([, method]) => method)).not.toContain('terminal.close')
    expect(printed().finished[0].closed).toEqual({
      via: 'host',
      host: 'koombea',
      kept: 'its agent is working again'
    })
    expect(methods(calls)).not.toContain('game.historyRecord')
  })

  it('game sweep leaves a working found session and one on a host that does not answer', async () => {
    const agents = [
      LEAD,
      leftover({ state: 'working' }),
      leftover({
        paneKey: 'remote-found:env_imac:tab-2:leaf-2',
        displayName: 'ORCA-1391',
        remote: { host: 'imac', environmentId: 'env_imac', stateKnown: false }
      })
    ]
    const { client } = fakeClient(stateWith({ agents }))

    await run('game sweep', client, [['close', true]])

    expect(printed().finished).toEqual([])
    expect(host.calls).toEqual([])
  })

  it('game sweep writes no freed history when the host keeps a finished member', async () => {
    const agents = [
      LEAD,
      member({
        paneKey: 'remote:ctx_1395',
        displayName: 'ORCA-1395',
        state: 'done',
        review: merged,
        terminalHandle: 'term_r_1395',
        remote: { host: 'm1', stateKnown: true, ticketDone: true }
      })
    ]
    const { client, calls } = fakeClient(stateWith({ agents }), {
      'orchestration.workerRelease': {
        dispatchId: 'ctx_1395',
        state: 'retained',
        reason: 'not_settled'
      }
    })

    await run('game sweep', client, [['close', true]])

    expect(methods(calls)).toContain('orchestration.workerRelease')
    expect(methods(calls)).not.toContain('game.historyRecord')
  })
})
