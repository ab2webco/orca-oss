import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { ORCHESTRATOR_GAME_REMOVE_HANDLERS } from './orchestrator-game-remove'

const LEAD = {
  paneKey: 'lead',
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true,
  terminalHandle: 'term_lead'
}

const WORKTREE = {
  id: 'repo1::/wt/orca-907',
  branch: 'fabolivark/orca-907',
  displayName: 'orca-907'
}

const member = (over: Record<string, unknown>) => ({
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  worktree: WORKTREE,
  ...over
})

// Why the same ticket and worktree: the user's old member and the one they had just launched (ORCA-1473).
const stale = member({ paneKey: 'tab-1:leaf-1', displayName: 'Ginebra' })
const fresh = member({ paneKey: 'tab-2:leaf-2', displayName: 'Arturo', terminalHandle: 'term_new' })
const FRESH_DISPATCH = {
  dispatchId: 'ctx_new',
  agentTerminalHandle: 'term_new',
  workerState: 'ready',
  terminalState: 'live',
  resource: { worktreeId: WORKTREE.id }
}

const remote = (over: Record<string, unknown>) =>
  member({
    paneKey: 'remote:ctx_1177',
    displayName: 'orca-1177',
    worktree: undefined,
    remote: { host: 'koombea', environmentId: 'env_k', stateKnown: true },
    ...over
  })

function clientWith(agents: unknown[], overrides: Record<string, unknown> = {}) {
  const calls: [string, unknown][] = []
  const all: Record<string, unknown> = {
    'game.state': { config: { mode: 'on' }, role: 'lead', agents: [LEAD, ...agents] },
    'orchestration.workerList': { workers: [FRESH_DISPATCH] },
    'orchestration.workerStop': { state: 'stopped', processAction: 'closed_agent_terminal' },
    'orchestration.workerRelease': { state: 'released' },
    'terminal.close': {},
    'game.fleetForget': { forgotten: true, count: 1 },
    ...overrides
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: all[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const remove = (client: RuntimeClient, key: string) =>
  ORCHESTRATOR_GAME_REMOVE_HANDLERS['game remove']({
    flags: new Map<string, string | boolean>([['member', key]]),
    client,
    cwd: '/repo',
    json: true
  })

const output = () => JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])).result
const methods = (calls: [string, unknown][]) => calls.map(([method]) => method)
const forgotten = (calls: [string, unknown][]) =>
  calls.flatMap(([method, params]) =>
    method === 'game.fleetForget' ? [(params as { agent: unknown }).agent] : []
  )

describe('orca game remove (ORCA-1476)', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.ORCA_WORKTREE_ID = 'repo1::/repo'
    process.env.ORCA_TERMINAL_HANDLE = 'term_lead'
  })

  afterEach(() => {
    process.env = { ...saved }
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('forgets a stale member and never stops the live one in its worktree', async () => {
    const { client, calls } = clientWith([stale, fresh])

    await remove(client, 'Ginebra')

    expect(methods(calls)).not.toContain('orchestration.workerStop')
    expect(methods(calls)).not.toContain('terminal.close')
    expect(forgotten(calls)).toEqual([{ paneKey: 'tab-1:leaf-1', name: 'Ginebra' }])
    expect(output()).toMatchObject({ name: 'Ginebra', removed: true })
    expect(process.exitCode).toBeUndefined()
  })

  it('stops a live member by its dispatch id and forgets only it', async () => {
    const { client, calls } = clientWith([stale, fresh])

    await remove(client, 'ctx_new')

    expect(calls.filter(([method]) => method === 'orchestration.workerStop')).toEqual([
      ['orchestration.workerStop', { dispatch: 'ctx_new' }]
    ])
    expect(forgotten(calls)).toEqual([{ paneKey: 'tab-2:leaf-2', name: 'Arturo' }])
    expect(output().stop).toMatchObject({ outcome: 'stopped', dispatchId: 'ctx_new' })
  })

  it('closes only its own terminal for a folder lead whose sessions share no worktree', async () => {
    const one = member({
      paneKey: 'f:1',
      displayName: 'Uno',
      terminalHandle: 'term_1',
      worktree: undefined,
      found: true
    })
    const two = member({
      paneKey: 'f:2',
      displayName: 'Dos',
      terminalHandle: 'term_2',
      worktree: undefined,
      found: true
    })
    const { client, calls } = clientWith([one, two], {
      'orchestration.workerList': { workers: [] }
    })

    await remove(client, 'Uno')

    expect(calls.filter(([method]) => method === 'terminal.close')).toEqual([
      ['terminal.close', { terminal: 'term_1' }]
    ])
    expect(forgotten(calls)).toEqual([{ paneKey: 'f:1', name: 'Uno' }])
  })

  it('forgets a member its host no longer has even when the host keeps the dispatch (ORCA-1177)', async () => {
    const gone = remote({
      remote: { host: 'koombea', environmentId: 'env_k', stateKnown: true, gone: true }
    })
    const { client, calls } = clientWith([gone], {
      'orchestration.workerRelease': { state: 'not_settled', reason: 'not_settled' }
    })

    await remove(client, 'ctx_1177')

    expect(forgotten(calls)).toEqual([{ paneKey: 'remote:ctx_1177', name: 'orca-1177' }])
    expect(output()).toMatchObject({ removed: true, host: 'koombea', stop: { outcome: 'failed' } })
  })

  it('forgets a member whose host does not answer without sending it a stop, and says so', async () => {
    const silent = remote({
      remote: { host: 'koombea', environmentId: 'env_k', stateKnown: false }
    })
    const { client, calls } = clientWith([silent])

    await remove(client, 'ctx_1177')

    expect(methods(calls)).not.toContain('orchestration.workerStop')
    expect(methods(calls)).not.toContain('orchestration.workerRelease')
    expect(output()).toMatchObject({ removed: true, unproven: true })
  })

  it('keeps a live remote member its host would not release', async () => {
    const { client, calls } = clientWith([remote({})], {
      'orchestration.workerRelease': { state: 'retained', reason: 'mid_turn' }
    })

    await remove(client, 'ctx_1177')

    expect(forgotten(calls)).toEqual([])
    expect(output()).toMatchObject({
      removed: false,
      refusal: expect.stringContaining('still runs')
    })
    expect(process.exitCode).toBe(1)
  })

  it('refuses a name two members share and lists the key that removes each', async () => {
    const twin = member({
      paneKey: 'remote:ctx_2',
      displayName: 'Ginebra',
      remote: { host: 'm1', stateKnown: true }
    })
    const { client, calls } = clientWith([stale, twin])

    await remove(client, 'Ginebra')

    expect(methods(calls)).not.toContain('orchestration.workerStop')
    expect(forgotten(calls)).toEqual([])
    expect(output().matches).toEqual([
      { name: 'Ginebra', key: 'tab-1:leaf-1', host: null },
      { name: 'Ginebra', key: 'ctx_2', host: 'm1' }
    ])
    expect(process.exitCode).toBe(1)
  })
})
