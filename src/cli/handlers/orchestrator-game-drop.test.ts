import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { ORCHESTRATOR_GAME_DROP_HANDLERS } from './orchestrator-game-drop'

const LEAD = {
  paneKey: 'lead',
  displayName: 'Lead',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: true,
  terminalHandle: 'term_lead'
}

const agent = (over: Record<string, unknown>) => ({
  paneKey: 'tab-7:leaf-7',
  displayName: 'orca-907',
  agentType: 'claude',
  state: 'idle',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_local_7',
  worktree: { id: 'repo1::/wt/orca-907', branch: 'fabolivark/orca-907', displayName: 'orca-907' },
  ...over
})

const remoteMember = agent({
  paneKey: 'remote:ctx_915',
  displayName: 'orca-915',
  terminalHandle: undefined,
  remote: { host: 'm1', environmentId: 'env_m1', stateKnown: true },
  worktree: { id: 'wt-915', branch: 'fabolivark/orca-915', displayName: 'orca-915' }
})

function clientWith(state: Record<string, unknown>, workers: unknown[] = []) {
  const calls: [string, unknown][] = []
  const all: Record<string, unknown> = {
    'game.state': {
      config: { mode: 'on' },
      role: 'lead',
      worktree: { id: 'repo1::/repo', path: '/repo', branch: 'main', displayName: 'repo' },
      ...state
    },
    'orchestration.workerList': { workers },
    'game.fleetDrop': { dropped: true, count: 1 }
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: all[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const drop = (client: RuntimeClient, name: string) =>
  ORCHESTRATOR_GAME_DROP_HANDLERS['game drop']({
    flags: new Map<string, string | boolean>([['name', name]]),
    client,
    cwd: '/repo',
    json: true
  })

const output = () => JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])).result
const drops = (calls: [string, unknown][]) =>
  calls.filter(([method]) => method === 'game.fleetDrop')

// Why: the lead decides which agents are in its fleet, and dropping one never kills it (ORCA-943).
describe('orca game drop (ORCA-943)', () => {
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

  it('drops a found agent by its worktree, and touches neither its terminal nor its worktree', async () => {
    const { client, calls } = clientWith({ agents: [LEAD, agent({ found: true })] })

    await drop(client, 'ORCA-907')

    expect(drops(calls)).toEqual([
      [
        'game.fleetDrop',
        {
          worktreeId: 'repo1::/repo',
          terminalHandle: 'term_lead',
          agent: {
            worktreeId: 'repo1::/wt/orca-907',
            environmentId: null,
            name: 'ORCA-907',
            ticket: 'ORCA-907'
          },
          dropped: true
        }
      ]
    ])
    expect(calls.map(([method]) => method)).not.toContain('terminal.close')
    expect(calls.map(([method]) => method)).not.toContain('orchestration.workerStop')
    expect(output()).toMatchObject({ name: 'ORCA-907', dropped: true })
  })

  it('drops a remote member whose dispatch is settled, keyed by its host', async () => {
    const { client, calls } = clientWith({ agents: [LEAD, remoteMember] }, [
      { dispatchId: 'ctx_915', workerState: 'completed', agentTerminalHandle: null }
    ])

    await drop(client, 'orca-915')

    expect(drops(calls)[0]?.[1]).toMatchObject({
      agent: { worktreeId: 'wt-915', environmentId: 'env_m1', ticket: 'ORCA-915' }
    })
    expect(output()).toMatchObject({ dropped: true, host: 'm1' })
  })

  it('refuses a member with a live dispatch, naming it', async () => {
    const { client, calls } = clientWith({ agents: [LEAD, agent({})] }, [
      {
        dispatchId: 'ctx_907',
        workerState: 'ready',
        agentTerminalHandle: 'term_local_7',
        resource: { worktreeId: 'repo1::/wt/orca-907' }
      }
    ])

    await drop(client, 'ORCA-907')

    expect(drops(calls)).toEqual([])
    expect(output()).toMatchObject({
      dropped: false,
      dispatchId: 'ctx_907',
      refusal: expect.stringMatching(/live dispatch ctx_907/)
    })
    expect(process.exitCode).toBe(1)
  })

  it('answers an agent already dropped without writing again', async () => {
    const { client, calls } = clientWith({
      agents: [LEAD],
      droppedAgents: [agent({ found: true })]
    })

    await drop(client, 'ORCA-907')

    expect(drops(calls)).toEqual([])
    expect(output()).toMatchObject({ dropped: true, already: true })
  })

  it("never drops the lead or another project's agent", async () => {
    const other = agent({
      found: true,
      worktree: { id: 'repo2::/wt/x', branch: 'x', displayName: 'x' }
    })
    const { client } = clientWith({ agents: [LEAD, other] })

    await expect(drop(client, 'ORCA-907')).rejects.toThrow(/No agent named ORCA-907/)
    await expect(drop(client, 'Lead')).rejects.toThrow(/No agent named Lead/)
  })

  it('refuses outside a lead', async () => {
    const { client } = clientWith({ role: 'member', agents: [LEAD, agent({ found: true })] })

    await expect(drop(client, 'ORCA-907')).rejects.toThrow(/Only the lead/)
  })
})
