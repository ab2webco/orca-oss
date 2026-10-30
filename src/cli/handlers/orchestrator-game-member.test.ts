import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_MEMBER_HANDLERS } from './orchestrator-game-member'
import type { RuntimeClient } from '../runtime-client'

const MEMBER = {
  paneKey: 'tab-2:m',
  displayName: 'CIN-5 Seats',
  agentType: 'claude',
  state: 'working',
  toolName: 'Edit',
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_m',
  worktree: { id: 'repo::/w/cin-5', branch: 'cin-5', displayName: 'cin-5' }
}

const STATE = {
  config: {},
  agents: [
    {
      paneKey: 'tab-1:l',
      displayName: 'Lead',
      agentType: 'claude',
      state: 'idle',
      toolName: null,
      isLeader: true,
      terminalHandle: 'term_lead'
    },
    MEMBER
  ],
  worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
  lead: { autostart: false, cap: 4, agent: 'claude' }
}

function fakeClient(failing: string[] = []) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': STATE,
    'terminal.read': {
      terminal: {
        handle: 'term_m',
        status: 'running',
        tail: ['\u001b[1mEditing seats.ts\u001b[0m'],
        truncated: false,
        nextCursor: null
      }
    },
    'orchestration.workerList': {
      workers: [
        {
          dispatchId: 'd1',
          taskId: 't5',
          workerState: 'stopped',
          agentTerminalHandle: 'term_old',
          terminalState: 'released',
          resource: { worktreeId: 'repo::/w/cin-5' }
        },
        {
          dispatchId: 'd2',
          taskId: 't5',
          workerState: 'ready',
          agentTerminalHandle: 'term_m',
          terminalState: 'retained',
          resource: { worktreeId: 'repo::/w/cin-5' }
        },
        {
          dispatchId: 'd9',
          taskId: 't9',
          workerState: 'ready',
          agentTerminalHandle: 'term_x',
          terminalState: 'retained',
          resource: null
        }
      ]
    },
    'orchestration.workerShow': {
      dispatch: { id: 'd2', task_id: 't5', status: 'dispatched' },
      worker: {
        state: 'ready',
        stage: 'agent_ready',
        last_error: null,
        created_at: '2026-10-16 10:00:00'
      }
    },
    'orchestration.inbox': {
      messages: [
        {
          from_handle: 'term_m',
          to_handle: 'term_lead',
          type: 'question',
          subject: 'API?',
          body: 'Which API?',
          created_at: '2026-10-16 10:30:00'
        }
      ],
      count: 1
    },
    'git.history': {
      items: [
        { id: 'aaaaaaa1111', subject: 'feat: seats', timestamp: 1_000, parentIds: [], message: '' },
        { id: 'bbbbbbb2222', subject: 'base commit', timestamp: 500, parentIds: [], message: '' }
      ],
      mergeBase: 'bbbbbbb2222',
      hasIncomingChanges: false,
      hasOutgoingChanges: true,
      hasMore: false,
      limit: 10
    }
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (failing.includes(method)) {
        throw new Error(`${method} is down`)
      }
      // Why: an inbox holds only the messages sent to that terminal.
      if (method === 'orchestration.inbox') {
        const to = (params as { terminal: string }).terminal
        const inbox = results[method] as { messages: { to_handle: string }[] }
        const messages = inbox.messages.filter((one) => one.to_handle === to)
        return { ok: true, result: { messages, count: messages.length } }
      }
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, member: string, json = true) =>
  ORCHESTRATOR_GAME_MEMBER_HANDLERS['game member']({
    flags: new Map([['member', member]]),
    client,
    cwd: '/repo',
    json
  })

describe('orca game member', () => {
  let output: string[] = []
  const printed = () => JSON.parse(output.join('')).result

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports one member, by ticket or terminal, now and since its launch', async () => {
    for (const selector of ['cin-5', 'term_m']) {
      output = []
      const { client, calls } = fakeClient()

      await run(client, selector)

      const report = printed()
      expect(report.ticket).toBe('CIN-5')
      expect(report.now).toEqual(
        expect.objectContaining({ phase: 'working', tool: 'Edit', terminal: ['Editing seats.ts'] })
      )
      expect(report.since.dispatches.map((one: { id: string }) => one.id)).toEqual(['d1', 'd2'])
      expect(report.since.messages).toEqual([
        expect.objectContaining({ from: 'member', type: 'question' })
      ])
      expect(report.since.commits).toEqual([
        { id: 'aaaaaaa', subject: 'feat: seats', at: new Date(1_000).toISOString() }
      ])
      expect(calls).toContainEqual(['terminal.read', { terminal: 'term_m', limit: 20 }])
      expect(calls).toContainEqual(['git.history', { worktree: 'id:repo::/w/cin-5', limit: 10 }])
    }
  })

  it('still answers when a part cannot be read, and says which', async () => {
    const { client } = fakeClient(['terminal.read', 'git.history'])

    await run(client, 'CIN-5')

    const report = printed()
    expect(report.now.terminal).toEqual([])
    expect(report.notes).toEqual([
      'terminal: terminal.read is down',
      'commits: git.history is down'
    ])
  })

  it('names no one it does not hold', async () => {
    const { client } = fakeClient()
    await expect(run(client, 'CIN-9')).rejects.toThrow(/No member is CIN-9/)
  })

  it('prints a short text report for the lead', async () => {
    const { client } = fakeClient()

    await run(client, 'CIN-5', false)

    const text = output.join('\n')
    expect(text).toContain('CIN-5 · working · claude')
    expect(text).toContain('Editing seats.ts')
    expect(text).toContain('member question: Which API?')
    expect(text).toContain('aaaaaaa feat: seats')
  })
})

describe('orca game member for a member on a remote host (ORCA-824)', () => {
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads its terminal and dispatch through the home dispatch, and names its host', async () => {
    const remote = {
      paneKey: 'remote:ctx_805',
      displayName: 'ORCA-805 regression gate',
      agentType: null,
      state: 'working',
      toolName: null,
      isLeader: false,
      isMember: true,
      terminalHandle: 'term_on_imac',
      remote: { host: 'imac', stateKnown: true },
      worktree: { id: 'repo::/home/me/orca-805', branch: 'orca-805', displayName: 'ORCA-805' }
    }
    const calls: [string, unknown][] = []
    const results: Record<string, unknown> = {
      'game.state': { ...STATE, agents: [STATE.agents[0], remote] },
      'orchestration.workerRead': {
        dispatchId: 'ctx_805',
        source: 'terminal',
        terminal: { handle: 'term_on_imac', tail: ['running the gate'] }
      },
      'orchestration.workerList': { workers: [] },
      'orchestration.workerShow': {
        worker: { state: 'ready', stage: 'agent_ready', last_error: null, created_at: 'x' }
      },
      'orchestration.inbox': { messages: [], count: 0 }
    }
    const client = {
      call: async (method: string, params: unknown) => {
        calls.push([method, params])
        return { ok: true, result: results[method] }
      }
    } as unknown as RuntimeClient

    await run(client, 'ORCA-805', false)

    const text = output.join('\n')
    expect(text).toContain('ORCA-805 · working · on imac')
    expect(text).toContain('  | running the gate')
    expect(calls).toContainEqual([
      'orchestration.workerRead',
      { dispatch: 'ctx_805', source: 'terminal', limit: 20 }
    ])
    expect(calls).toContainEqual(['orchestration.workerShow', { dispatch: 'ctx_805' }])
    expect(calls.map(([method]) => method)).not.toContain('terminal.read')
    expect(calls.map(([method]) => method)).not.toContain('git.history')
  })
})
