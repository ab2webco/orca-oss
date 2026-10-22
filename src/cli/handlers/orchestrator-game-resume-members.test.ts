import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_RESUME_MEMBERS_HANDLERS } from './orchestrator-game-resume-members'
import type { RuntimeClient } from '../runtime-client'
import type { GameMemberResumeOutcome } from '../../shared/orchestrator-game-member-sessions'
import { ORCHESTRATION_WORKER_SETUP_QUEUE_RUNTIME_CAPABILITY } from '../../shared/protocol-version'

const QUEUE = { position: 1, waitingOn: 'Ford · CIN-9' }

const paused = (ticket: string, extra: Record<string, unknown> = {}) => ({
  ticket,
  name: `Merlin · ${ticket}`,
  agent: 'claude',
  account: 'ana@example.com',
  branch: ticket.toLowerCase(),
  lastState: 'working',
  resumable: true,
  runId: 'run_1',
  since: '2026-10-20T10:00:00.000Z',
  ...extra
})

const target = (ticket: string, extra: Record<string, unknown> = {}) => ({
  ticket,
  name: `Merlin · ${ticket}`,
  runId: 'run_1',
  taskId: `task_${ticket}`,
  worktreeId: `wt-${ticket}`,
  agent: 'claude',
  accountId: 'acct_ana',
  account: 'ana@example.com',
  ...extra
})

const LEAD = { paneKey: 'tab:lead', state: 'idle', isLeader: true, displayName: 'Lead' }

function fakeClient(args: {
  pausedMembers?: unknown[]
  pausedMembersError?: string
  agents?: unknown[]
  cap?: number
  run?: { id: string } | null
  outcomes?: Record<string, GameMemberResumeOutcome>
  capabilities?: string[]
  start?: Record<string, unknown>
}) {
  const calls: [string, Record<string, unknown>][] = []
  const client = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push([method, params])
      const results: Record<string, unknown> = {
        'game.state': {
          config: { mode: 'on' },
          agents: args.agents ?? [LEAD],
          lead: { autostart: false, cap: args.cap ?? 4, agent: 'claude' },
          ...(args.pausedMembers ? { pausedMembers: args.pausedMembers } : {}),
          ...(args.pausedMembersError ? { pausedMembersError: args.pausedMembersError } : {})
        },
        'terminal.show': { terminal: { handle: 'h1' } },
        'orchestration.runCurrent': { run: args.run === undefined ? { id: 'run_1' } : args.run },
        'orchestration.runUse': { run: { id: params.id } },
        'game.memberResume': args.outcomes?.[String(params.ticket)],
        'game.memberDiscard': {
          discarded: params.tickets === 'all' ? ['CIN-1', 'CIN-2'] : params.tickets,
          setAside: null
        },
        'status.get': { capabilities: args.capabilities ?? [] },
        'orchestration.workerStart': args.start ?? {
          runId: 'run_1',
          taskId: `task_${String(params.task).replace('task_', '')}`,
          dispatchId: `ctx_new_${String(params.task)}`,
          state: 'ready'
        }
      }
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const run = (client: RuntimeClient, flags: [string, string | boolean][] = [], json = true) =>
  ORCHESTRATOR_GAME_RESUME_MEMBERS_HANDLERS['game resume-members']({
    flags: new Map(flags),
    client,
    cwd: '/repo',
    json
  })

describe('orca game resume-members', () => {
  const saved = { ...process.env }
  let output: string[] = []
  const printed = () => JSON.parse(output.join('')).result

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:lead'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it("binds a fresh dispatch on each member's own task to its reopened conversation", async () => {
    const { client, calls } = fakeClient({
      pausedMembers: [paused('CIN-1')],
      outcomes: {
        'CIN-1': { outcome: 'resumed', terminal: 'term_cin1', member: target('CIN-1') }
      }
    })

    await run(client)

    expect(calls.find(([m]) => m === 'game.memberResume')?.[1]).toEqual({
      worktreeId: 'wt1',
      terminalHandle: 'h1',
      ticket: 'CIN-1'
    })
    expect(calls.find(([m]) => m === 'orchestration.workerStart')?.[1]).toEqual({
      task: 'task_CIN-1',
      worktree: 'id:wt-CIN-1',
      terminal: 'term_cin1',
      run: 'run_1',
      from: 'h1',
      devMode: false
    })
    expect(calls.filter(([m]) => m === 'game.memberRecord').map(([, p]) => p.member)).toEqual([
      { ticket: 'CIN-1', dispatchId: 'ctx_new_task_CIN-1', lastState: 'ready' }
    ])
    expect(printed().members).toEqual([
      { ticket: 'CIN-1', result: 'resumed', dispatchId: 'ctx_new_task_CIN-1' }
    ])
  })

  it('queues a relaunch that needs a new worktree behind the setup already running', async () => {
    const { client, calls } = fakeClient({
      pausedMembers: [paused('CIN-1', { resumable: false })],
      outcomes: {
        'CIN-1': { outcome: 'relaunch', member: target('CIN-1', { worktreeId: null }) }
      },
      capabilities: [ORCHESTRATION_WORKER_SETUP_QUEUE_RUNTIME_CAPABILITY],
      start: { runId: 'run_1', taskId: 'task_CIN-1', state: 'queued', setupQueue: QUEUE }
    })

    await run(client)

    expect(calls.find(([m]) => m === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ worktree: 'new-child', setupAdmission: 'queue' })
    )
    expect(calls.findLast(([m]) => m === 'game.memberRecord')?.[1]).toEqual(
      expect.objectContaining({ member: { ticket: 'CIN-1', lastState: 'queued' } })
    )
    expect(process.exitCode).toBeUndefined()
    expect(printed().members).toEqual([
      { ticket: 'CIN-1', result: 'relaunched', setupQueue: QUEUE }
    ])
  })

  it('starts a new agent on the same task in its worktree when the conversation cannot reopen', async () => {
    const { client, calls } = fakeClient({
      pausedMembers: [paused('CIN-1', { resumable: false }), paused('CIN-2')],
      outcomes: {
        'CIN-1': { outcome: 'relaunch', member: target('CIN-1', { worktreeId: null }) },
        'CIN-2': {
          outcome: 'relaunch',
          member: target('CIN-2', { agent: 'codex', accountId: 'acct_bo' }),
          note: 'Claude exited'
        }
      }
    })

    await run(client)

    const starts = calls.filter(([m]) => m === 'orchestration.workerStart').map(([, p]) => p)
    expect(starts).toEqual([
      expect.objectContaining({
        task: 'task_CIN-1',
        worktree: 'new-child',
        name: 'cin-1',
        displayName: 'Merlin · CIN-1',
        agent: 'claude',
        claudeAccountId: 'acct_ana'
      }),
      expect.objectContaining({
        task: 'task_CIN-2',
        worktree: 'id:wt-CIN-2',
        agent: 'codex',
        codexAccountId: 'acct_bo'
      })
    ])
    // Why: worker-start refuses creation options such as name on an existing worktree.
    expect(starts[1]).not.toHaveProperty('name')
    expect(printed().members).toEqual([
      { ticket: 'CIN-1', result: 'relaunched', dispatchId: 'ctx_new_task_CIN-1' },
      {
        ticket: 'CIN-2',
        result: 'relaunched',
        dispatchId: 'ctx_new_task_CIN-2',
        note: 'Claude exited'
      }
    ])
  })

  it('retries a failed task from its latest dispatch', async () => {
    const { client, calls } = fakeClient({
      pausedMembers: [paused('CIN-1')],
      outcomes: {
        'CIN-1': {
          outcome: 'resumed',
          terminal: 'term_cin1',
          member: target('CIN-1', { retryOf: 'ctx_old' })
        }
      }
    })

    await run(client)

    expect(calls.find(([m]) => m === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ task: 'task_CIN-1', terminal: 'term_cin1', retryOf: 'ctx_old' })
    )
  })

  it('closes a reopened conversation no dispatch could take, so no agent runs unowned', async () => {
    const { client, calls } = fakeClient({
      pausedMembers: [paused('CIN-1')],
      outcomes: {
        'CIN-1': { outcome: 'resumed', terminal: 'term_cin1', member: target('CIN-1') }
      }
    })
    const answer = client.call.bind(client)
    client.call = (async (method: string, params: Record<string, unknown>) => {
      if (method === 'orchestration.workerStart') {
        calls.push([method, params])
        throw new Error('task_not_ready')
      }
      return answer(method, params)
    }) as RuntimeClient['call']

    await run(client)

    expect(calls.find(([m]) => m === 'terminal.close')?.[1]).toEqual({ terminal: 'term_cin1' })
    expect(printed().members).toEqual([
      { ticket: 'CIN-1', result: 'failed', reason: 'task_not_ready' }
    ])
    expect(process.exitCode).toBe(1)
  })

  it('reports finished and missing members without starting anything for them', async () => {
    const { client, calls } = fakeClient({
      pausedMembers: [paused('CIN-1'), paused('CIN-2')],
      outcomes: {
        'CIN-1': { outcome: 'finished', ticket: 'CIN-1' },
        'CIN-2': { outcome: 'missing', ticket: 'CIN-2', reason: 'its worktree cin-2 is gone' }
      }
    })

    await run(client)

    expect(calls.map(([m]) => m)).not.toContain('orchestration.workerStart')
    expect(printed().members).toEqual([
      { ticket: 'CIN-1', result: 'finished' },
      { ticket: 'CIN-2', result: 'skipped', reason: 'its worktree cin-2 is gone' }
    ])
  })

  it('resumes one at a time and never past the cap', async () => {
    const live = { paneKey: 'm', state: 'working', isMember: true, displayName: 'CIN-9 Busy' }
    const { client, calls } = fakeClient({
      cap: 2,
      agents: [LEAD, live],
      pausedMembers: [paused('CIN-1'), paused('CIN-2')],
      outcomes: {
        'CIN-1': { outcome: 'resumed', terminal: 'term_cin1', member: target('CIN-1') }
      }
    })

    await run(client)

    expect(calls.filter(([m]) => m === 'game.memberResume').map(([, p]) => p.ticket)).toEqual([
      'CIN-1'
    ])
    expect(printed().members).toEqual([
      { ticket: 'CIN-1', result: 'resumed', dispatchId: 'ctx_new_task_CIN-1' },
      { ticket: 'CIN-2', result: 'skipped', reason: 'cap: 2 members already run' }
    ])
  })

  it("binds the members' run first when the lead came back without one", async () => {
    const { client, calls } = fakeClient({
      run: null,
      pausedMembers: [paused('CIN-1')],
      outcomes: {
        'CIN-1': { outcome: 'resumed', terminal: 'term_cin1', member: target('CIN-1') }
      }
    })

    await run(client)

    const methods = calls.map(([m]) => m)
    expect(methods.indexOf('orchestration.runUse')).toBeLessThan(
      methods.indexOf('game.memberResume')
    )
    expect(calls.find(([m]) => m === 'orchestration.runUse')?.[1]).toEqual({
      id: 'run_1',
      from: 'h1'
    })
  })

  it('never takes over a run that still has live members of the lead', async () => {
    const live = { paneKey: 'm', state: 'working', isMember: true, displayName: 'CIN-9 Busy' }
    const { client, calls } = fakeClient({
      run: { id: 'run_2' },
      agents: [LEAD, live],
      pausedMembers: [paused('CIN-1')]
    })

    await run(client)

    expect(calls.map(([m]) => m)).not.toContain('orchestration.runUse')
    expect(calls.map(([m]) => m)).not.toContain('game.memberResume')
    expect(printed().members).toEqual([
      {
        ticket: 'CIN-1',
        result: 'skipped',
        reason: 'its task is in run run_1, and this lead now runs run_2 with live members'
      }
    ])
  })

  it('resumes only the named tickets', async () => {
    const { client, calls } = fakeClient({
      pausedMembers: [paused('CIN-1'), paused('CIN-2')],
      outcomes: { 'CIN-2': { outcome: 'finished', ticket: 'CIN-2' } }
    })

    await run(client, [['tickets', 'cin-2']])

    expect(calls.filter(([m]) => m === 'game.memberResume').map(([, p]) => p.ticket)).toEqual([
      'CIN-2'
    ])
  })

  it('frees the named members, or all of them, with --discard', async () => {
    const { client, calls } = fakeClient({ pausedMembers: [paused('CIN-1'), paused('CIN-2')] })

    await run(client, [['discard', true]])
    await run(client, [
      ['discard', true],
      ['tickets', 'CIN-1']
    ])

    expect(calls.filter(([m]) => m === 'game.memberDiscard').map(([, p]) => p.tickets)).toEqual([
      'all',
      ['CIN-1']
    ])
    expect(calls.map(([m]) => m)).not.toContain('game.memberResume')
  })

  it('says why saved members cannot be read and how to start over, with exit code 1', async () => {
    const { client, calls } = fakeClient({
      pausedMembersError: 'the saved members file is damaged'
    })

    await run(client, [], false)

    expect(output.join('\n')).toContain(
      'Could not resume members: the saved members file is damaged. If a newer Orca wrote it, update Orca; this one leaves it as it is. If it is damaged, `orca game resume-members --discard` sets it aside, kept, and starts a new record.'
    )
    expect(process.exitCode).toBe(1)
    expect(calls.map(([m]) => m)).toEqual(['game.state'])
  })

  it('plans without touching anything on --dry-run', async () => {
    const { client, calls } = fakeClient({ pausedMembers: [paused('CIN-1')] })

    await run(client, [['dry-run', true]])

    expect(calls.map(([m]) => m)).toEqual(['game.state'])
    expect(printed()).toEqual(expect.objectContaining({ dryRun: true, resume: ['CIN-1'] }))
  })

  it('says to update Orca when the host keeps no members', async () => {
    const { client } = fakeClient({})
    await expect(run(client)).rejects.toThrow('does not keep game members yet')
  })
})
