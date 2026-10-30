import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GameMemberSessionStore } from './orchestrator-game-member-session-store'
import { GameMemberResume } from './orchestrator-game-member-resume'
import type {
  GameMemberSession,
  GameMemberSessionPatch
} from '../../shared/orchestrator-game-member-sessions'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

const saved = (ticket: string, extra: Partial<GameMemberSessionPatch> = {}) => ({
  ticket,
  name: `Merlin · ${ticket}`,
  runId: 'run_1',
  taskId: `task_${ticket}`,
  dispatchId: `ctx_${ticket}`,
  worktreeId: `wt-${ticket}`,
  branch: ticket.toLowerCase(),
  agent: 'claude',
  accountId: 'acct-1',
  account: 'ana@example.com',
  sessionId: `sess-${ticket}`,
  lastState: 'working',
  ...extra
})

function setup(
  over: {
    taskStatus?: string | null
    dispatchStatus?: string | null
    worktrees?: string[]
    taskWorktree?: string
    resume?: (member: GameMemberSession) => Promise<string>
    now?: () => number
  } = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-resume-'))
  dirs.push(dir)
  const store = new GameMemberSessionStore(() => dir)
  const resumed: GameMemberSession[] = []
  const resume = new GameMemberResume({
    store,
    statusOf: (taskId) => ({
      task: over.taskStatus === undefined ? 'ready' : over.taskStatus,
      latestDispatch: over.dispatchStatus ?? 'failed',
      latestDispatchId: `ctx_last_${taskId}`
    }),
    worktreeOfTask: () => over.taskWorktree ?? null,
    worktreeExists: async (id) => (over.worktrees ?? ['wt-ORCA-1']).includes(id),
    resumeSession:
      over.resume ??
      (async (member) => {
        resumed.push(member)
        return `term-${member.ticket}`
      }),
    ...(over.now ? { now: over.now } : {})
  })
  return { dir, store, resume, resumed }
}

const target = {
  ticket: 'ORCA-1',
  name: 'Merlin · ORCA-1',
  runId: 'run_1',
  taskId: 'task_ORCA-1',
  worktreeId: 'wt-ORCA-1',
  agent: 'claude',
  accountId: 'acct-1',
  account: 'ana@example.com'
}

describe('GameMemberResume.resume', () => {
  it('resumes a ticket once when two leads ask at the same time', async () => {
    let finish: (terminal: string) => void = () => undefined
    let entered: () => void = () => undefined
    const reached = new Promise<void>((resolve) => (entered = resolve))
    const { store, resume } = setup({
      resume: async () => {
        entered()
        return await new Promise<string>((resolve) => (finish = resolve))
      }
    })
    await store.upsert('repo:a', saved('ORCA-1'))
    const first = resume.resume('repo:a', 'ORCA-1')
    await reached
    expect(await resume.resume('repo:a', 'orca-1')).toEqual({
      outcome: 'missing',
      ticket: 'ORCA-1',
      reason: 'ORCA-1 is already being resumed by another call; run game fleet in a minute'
    })
    finish('term-ORCA-1')
    expect((await first).outcome).toBe('resumed')
  })

  it('keeps a resumed ticket claimed while its dispatch is bound, then frees it', async () => {
    let clock = 1_000
    const { store, resume, resumed } = setup({ now: () => clock })
    await store.upsert('repo:a', saved('ORCA-1'))
    expect((await resume.resume('repo:a', 'ORCA-1')).outcome).toBe('resumed')
    clock += 119_000
    expect((await resume.resume('repo:a', 'ORCA-1')).outcome).toBe('missing')
    clock += 2_000
    expect((await resume.resume('repo:a', 'ORCA-1')).outcome).toBe('resumed')
    expect(resumed).toHaveLength(2)
  })

  it("reopens a Claude member's own conversation in its worktree on its account", async () => {
    const { store, resume, resumed } = setup()
    await store.upsert('repo:a', saved('ORCA-1'))
    expect(await resume.resume('repo:a', 'orca-1')).toEqual({
      outcome: 'resumed',
      terminal: 'term-ORCA-1',
      member: target
    })
    expect(resumed.map((one) => [one.sessionId, one.worktreeId, one.accountId])).toEqual([
      ['sess-ORCA-1', 'wt-ORCA-1', 'acct-1']
    ])
  })

  it('never resumes a member whose task completed, and forgets it', async () => {
    const { store, resume, resumed } = setup({ taskStatus: 'completed' })
    await store.upsert('repo:a', saved('ORCA-1'))
    expect(await resume.resume('repo:a', 'ORCA-1')).toEqual({
      outcome: 'finished',
      ticket: 'ORCA-1'
    })
    expect(resumed).toEqual([])
    expect(await store.read('repo:a')).toEqual({ ok: true, members: [] })
  })

  it('never resumes a member whose last dispatch reported success', async () => {
    const { store, resume } = setup({ dispatchStatus: 'completed' })
    await store.upsert('repo:a', saved('ORCA-1'))
    expect((await resume.resume('repo:a', 'ORCA-1')).outcome).toBe('finished')
  })

  it('says so when the worktree was deleted while Orca was closed, keeping the record', async () => {
    const { store, resume, resumed } = setup({ worktrees: [] })
    await store.upsert('repo:a', saved('ORCA-1'))
    expect(await resume.resume('repo:a', 'ORCA-1')).toEqual({
      outcome: 'missing',
      ticket: 'ORCA-1',
      reason: 'its worktree orca-1 is gone; `orca game resume-members ORCA-1 --discard` frees it'
    })
    expect(resumed).toEqual([])
    const kept = await store.read('repo:a')
    expect(kept.ok && kept.members.map((one) => one.ticket)).toEqual(['ORCA-1'])
  })

  it('says so when its task is gone from orchestration', async () => {
    const { store, resume } = setup({ taskStatus: null })
    await store.upsert('repo:a', saved('ORCA-1'))
    expect(await resume.resume('repo:a', 'ORCA-1')).toEqual({
      outcome: 'missing',
      ticket: 'ORCA-1',
      reason: 'its orchestration task task_ORCA-1 is gone'
    })
  })

  it('relaunches a half launch, a non-Claude agent, or one with no conversation yet', async () => {
    const { store, resume, resumed } = setup({ worktrees: ['wt-ORCA-2'] })
    await store.upsert('repo:a', [
      saved('ORCA-1', { worktreeId: undefined, sessionId: undefined }),
      saved('ORCA-2', { agent: 'codex' })
    ])
    const [first, second] = await Promise.all([
      resume.resume('repo:a', 'ORCA-1'),
      resume.resume('repo:a', 'ORCA-2')
    ])
    expect(first).toEqual({ outcome: 'relaunch', member: { ...target, worktreeId: null } })
    expect(second).toEqual(
      expect.objectContaining({
        outcome: 'relaunch',
        member: expect.objectContaining({ worktreeId: 'wt-ORCA-2', agent: 'codex' })
      })
    )
    expect(resumed).toEqual([])
  })

  it('relaunches a member a restart caught queued behind a setup, with no dispatch to retry (ORCA-746)', async () => {
    const { store, resume } = setup({ taskStatus: 'ready' })
    await store.upsert('repo:a', [
      saved('ORCA-1', {
        dispatchId: undefined,
        worktreeId: undefined,
        sessionId: undefined,
        lastState: 'queued'
      })
    ])

    expect(await resume.resume('repo:a', 'ORCA-1')).toEqual({
      outcome: 'relaunch',
      member: { ...target, worktreeId: null }
    })
  })

  it('relaunches in its worktree when Claude cannot reopen the conversation, saying why', async () => {
    const { store, resume } = setup({
      resume: async () => {
        throw new Error('Claude exited instead of reopening the conversation')
      }
    })
    await store.upsert('repo:a', saved('ORCA-1'))
    expect(await resume.resume('repo:a', 'ORCA-1')).toEqual({
      outcome: 'relaunch',
      member: target,
      note: 'Claude exited instead of reopening the conversation'
    })
  })

  it('starts nothing for a task still marked dispatched from before the restart', async () => {
    const { store, resume, resumed } = setup({ taskStatus: 'dispatched' })
    await store.upsert('repo:a', saved('ORCA-1'))
    expect(await resume.resume('repo:a', 'ORCA-1')).toEqual({
      outcome: 'missing',
      ticket: 'ORCA-1',
      reason:
        'its task task_ORCA-1 is still marked dispatched by ctx_last_task_ORCA-1, so no new member can take it'
    })
    expect(resumed).toEqual([])
  })

  it('retries a task that failed or was blocked from its latest dispatch', async () => {
    const { store, resume } = setup({ taskStatus: 'failed' })
    await store.upsert('repo:a', saved('ORCA-1'))
    expect(await resume.resume('repo:a', 'ORCA-1')).toEqual({
      outcome: 'resumed',
      terminal: 'term-ORCA-1',
      member: { ...target, retryOf: 'ctx_last_task_ORCA-1' }
    })
  })

  it('finds the worktree a launch cut short created, so it is reused and never orphaned', async () => {
    const { store, resume } = setup({ taskWorktree: 'wt-ORCA-1' })
    await store.upsert('repo:a', saved('ORCA-1', { worktreeId: undefined, sessionId: undefined }))
    expect(await resume.resume('repo:a', 'ORCA-1')).toEqual({
      outcome: 'relaunch',
      member: target
    })
  })

  it('names a ticket it holds no member for', async () => {
    const { resume } = setup()
    expect(await resume.resume('repo:a', 'ORCA-9')).toEqual({
      outcome: 'missing',
      ticket: 'ORCA-9',
      reason: 'no saved member holds ORCA-9'
    })
  })
})

describe('GameMemberResume.discard', () => {
  it('frees the named members, or all of them', async () => {
    const { store, resume } = setup()
    await store.upsert('repo:a', [saved('ORCA-1'), saved('ORCA-2'), saved('ORCA-3')])
    expect(await resume.discard('repo:a', ['orca-1'])).toEqual({
      discarded: ['ORCA-1'],
      setAside: null
    })
    expect(await resume.discard('repo:a', 'all')).toEqual({
      discarded: ['ORCA-2', 'ORCA-3'],
      setAside: null
    })
    expect(await store.read('repo:a')).toEqual({ ok: true, members: [] })
  })

  it('sets an unreadable file aside, never deleting it, when the person discards all', async () => {
    const { dir, store, resume } = setup()
    await store.upsert('repo:a', saved('ORCA-1'))
    writeFileSync(join(dir, readdirSync(dir)[0] as string), 'broken')
    await expect(resume.discard('repo:a', ['ORCA-1'])).rejects.toThrow('damaged')
    const result = await resume.discard('repo:a', 'all')
    expect(result.discarded).toEqual([])
    expect(result.setAside).toMatch(/\.unreadable-\d+\.json$/)
    expect(readdirSync(dir)).toHaveLength(1)
  })
})
