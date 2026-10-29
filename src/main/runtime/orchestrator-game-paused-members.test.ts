import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameMemberSessionStore } from './orchestrator-game-member-session-store'
import { GamePausedMembers } from './orchestrator-game-paused-members'
import type { AgentStatusOrchestrationContext } from '../../shared/agent-status-types'
import type { GameAgent } from '../../shared/orchestrator-game-state'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const member = (ticket: string, extra: Partial<GameAgent> = {}): GameAgent => ({
  paneKey: `pane-${ticket}`,
  displayName: `Merlin · ${ticket} Cartelera`,
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  terminalHandle: `term-${ticket}`,
  isMember: true,
  worktree: { id: `wt-${ticket}`, branch: ticket.toLowerCase(), displayName: ticket.toLowerCase() },
  account: { provider: 'claude', id: 'acct-1', email: 'ana@example.com' },
  ...extra
})

const context = (ticket: string): AgentStatusOrchestrationContext => ({
  taskId: `task_${ticket}`,
  dispatchId: `ctx_${ticket}`,
  dispatchStatus: 'dispatched',
  orchestrationRunId: 'run_1',
  taskTitle: ticket
})

function setup(contexts: Record<string, AgentStatusOrchestrationContext> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-paused-'))
  dirs.push(dir)
  const store = new GameMemberSessionStore(
    () => dir,
    () => '2026-10-20T10:00:00.000Z'
  )
  const sessions: Record<string, string> = {}
  const paused = new GamePausedMembers({
    store,
    contextOf: (handle) => contexts[handle],
    sessionIdOf: (handle) => sessions[handle] ?? null
  })
  return { dir, store, paused, sessions }
}

describe('GamePausedMembers.note', () => {
  it('saves what each live member needs to resume, with its conversation id', async () => {
    const { store, paused, sessions } = setup({ 'term-ORCA-1': context('ORCA-1') })
    sessions['term-ORCA-1'] = 'sess-1'
    expect(await paused.note('repo:a', [member('ORCA-1')])).toEqual({
      paused: [],
      queued: [],
      unlisted: [],
      error: null
    })
    expect(await store.read('repo:a')).toEqual({
      ok: true,
      members: [
        {
          ticket: 'ORCA-1',
          name: 'Merlin · ORCA-1 Cartelera',
          runId: 'run_1',
          taskId: 'task_ORCA-1',
          dispatchId: 'ctx_ORCA-1',
          worktreeId: 'wt-ORCA-1',
          branch: 'orca-1',
          agent: 'claude',
          accountId: 'acct-1',
          account: 'ana@example.com',
          sessionId: 'sess-1',
          lastState: 'working',
          launchedAt: '2026-10-20T10:00:00.000Z',
          updatedAt: '2026-10-20T10:00:00.000Z'
        }
      ]
    })
  })

  it('lists a saved member as paused once it is no longer live', async () => {
    const { paused, sessions } = setup({ 'term-ORCA-1': context('ORCA-1') })
    sessions['term-ORCA-1'] = 'sess-1'
    await paused.note('repo:a', [member('ORCA-1')])
    const after = await paused.note('repo:a', [])
    expect(after.paused.map((one) => [one.ticket, one.resumable, one.lastState])).toEqual([
      ['ORCA-1', true, 'working']
    ])
    expect((await paused.note('repo:a', [], new Set(['wt-ORCA-1']))).paused).toEqual([])
  })

  // ORCA-677: liveness comes from the pane, so a leftover heartbeat loop cannot keep a gone member listed as live.
  it('lists a member whose pane is gone as paused while its dispatch is still dispatched', async () => {
    const contexts = { 'term-ORCA-1': context('ORCA-1') }
    const { paused } = setup(contexts)
    await paused.note('repo:a', [member('ORCA-1')])

    const after = await paused.note('repo:a', [])

    expect(contexts['term-ORCA-1'].dispatchStatus).toBe('dispatched')
    expect(after.paused.map((one) => one.ticket)).toEqual(['ORCA-1'])
  })

  // Why: live imac members for ORCA-862 and ORCA-855 also showed as paused ready rows, each taking a slot.
  it('keeps a live remote member out of paused without saving it as a local session (ORCA-864)', async () => {
    const { paused, store } = setup()
    await paused.record('repo:a', {
      ticket: 'ORCA-862',
      name: 'Merlin · ORCA-862',
      runId: 'run_1',
      taskId: 'task_ORCA-862',
      lastState: 'ready'
    })
    const remote = member('ORCA-862', {
      paneKey: 'remote:ctx_862',
      terminalHandle: 'term-remote',
      worktree: { id: 'imac-wt', branch: 'orca-862', displayName: 'orca-862' },
      remote: { host: 'imac', stateKnown: true }
    })

    expect((await paused.note('repo:a', [remote])).paused).toEqual([])
    const saved = await store.read('repo:a')
    expect(saved.ok && saved.members.map((one) => [one.ticket, one.worktreeId])).toEqual([
      ['ORCA-862', null]
    ])
  })

  it('lists a member whose start waits for the setup in flight as queued, not paused', async () => {
    const { paused } = setup()
    await paused.record('repo:a', {
      ticket: 'ORCA-2',
      name: 'Merlin · ORCA-2',
      runId: 'run_1',
      taskId: 'task_ORCA-2',
      lastState: 'queued'
    })
    const queue = [{ taskId: 'task_ORCA-2', position: 1, waitingOn: 'Arthur · ORCA-1' }]

    expect(await paused.note('repo:a', [], new Set(), { queued: queue, starting: [] })).toEqual({
      paused: [],
      queued: [
        { ticket: 'ORCA-2', name: 'Merlin · ORCA-2', position: 1, waitingOn: 'Arthur · ORCA-1' }
      ],
      unlisted: [],
      error: null
    })
  })

  it('lists a member whose start holds the setup slot as neither paused nor queued', async () => {
    const { paused } = setup()
    await paused.record('repo:a', {
      ticket: 'ORCA-2',
      runId: 'run_1',
      taskId: 'task_ORCA-2',
      lastState: 'queued'
    })

    expect(
      await paused.note('repo:a', [], new Set(), { queued: [], starting: ['task_ORCA-2'] })
    ).toEqual({ paused: [], queued: [], unlisted: [], error: null })
  })

  it('never lists a member that finished: merged PR or a completed dispatch', async () => {
    const { paused } = setup({
      'term-ORCA-1': context('ORCA-1'),
      'term-ORCA-2': { ...context('ORCA-2'), dispatchStatus: 'completed' }
    })
    await paused.note('repo:a', [
      member('ORCA-1', {
        review: { provider: 'github', number: 41, title: 't', url: 'u', state: 'merged' }
      } as Partial<GameAgent>),
      member('ORCA-2')
    ])
    expect((await paused.note('repo:a', [])).paused).toEqual([])
  })

  it('skips a member it cannot tie to a task, and the lead itself', async () => {
    const { store, paused } = setup()
    await paused.note('repo:a', [member('ORCA-1'), member('ORCA-2', { isMember: false })])
    expect(await store.read('repo:a')).toEqual({ ok: true, members: [] })
  })

  it('reports an unreadable file as the reason and leaves it alone', async () => {
    const { dir, paused, store } = setup({ 'term-ORCA-1': context('ORCA-1') })
    await paused.note('repo:a', [member('ORCA-1')])
    const file = join(dir, readdirSync(dir)[0] as string)
    writeFileSync(file, 'broken')
    expect(await paused.note('repo:a', [member('ORCA-1')])).toEqual({
      paused: [],
      queued: [],
      unlisted: [],
      error: 'the saved members file is damaged (not JSON)'
    })
    expect((await store.read('repo:a')).ok).toBe(false)
  })
})

describe('GamePausedMembers.note on a host that cannot reach its folder', () => {
  it('reports why instead of failing the game state', async () => {
    const paused = new GamePausedMembers({
      store: new GameMemberSessionStore(() => {
        throw new Error('no userData')
      }),
      contextOf: () => context('ORCA-1'),
      sessionIdOf: () => null
    })
    expect(await paused.note('repo:a', [member('ORCA-1')])).toEqual({
      paused: [],
      queued: [],
      unlisted: [],
      error: 'the saved members file cannot be read (Error: no userData)'
    })
  })
})

describe('GamePausedMembers.record and forget', () => {
  it('records a launch before its agent runs, so a half launch is paused, then forgets it', async () => {
    const { paused } = setup()
    await paused.record('repo:a', { ticket: 'ORCA-9', taskId: 'task_9', runId: 'run_1' })
    expect((await paused.note('repo:a', [])).paused.map((one) => one.ticket)).toEqual(['ORCA-9'])
    await paused.forget('repo:a', ['ORCA-9'])
    expect((await paused.note('repo:a', [])).paused).toEqual([])
  })
})

describe('GamePausedMembers.note with an open terminal (ORCA-754)', () => {
  it('carries why each paused member is not live', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-game-paused-'))
    dirs.push(dir)
    const paused = new GamePausedMembers({
      store: new GameMemberSessionStore(() => dir),
      contextOf: () => undefined,
      sessionIdOf: () => null,
      causeOf: (one) =>
        one.taskId === 'task_9' ? { cause: 'unsubmitted', terminal: 'term_9' } : null
    })
    await paused.record('repo:a', { ticket: 'ORCA-9', taskId: 'task_9', runId: 'run_1' })
    await paused.record('repo:a', { ticket: 'ORCA-8', taskId: 'task_8', runId: 'run_1' })

    const view = await paused.note('repo:a', [])

    expect(view.paused.find((one) => one.ticket === 'ORCA-9')).toMatchObject({
      cause: 'unsubmitted',
      terminal: 'term_9'
    })
    expect(view.paused.find((one) => one.ticket === 'ORCA-8')).not.toHaveProperty('cause')
  })
})
