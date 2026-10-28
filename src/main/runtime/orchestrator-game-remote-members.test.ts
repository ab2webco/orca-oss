import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import {
  listEarlierLeadRemoteMemberSources,
  listRemoteGameMemberSources,
  remoteGameMembersOf,
  type RemoteGameMemberSource
} from './orchestrator-game-remote-members'

const LEAD_PANE = 'tab_lead:11111111-1111-4111-8111-111111111111'

function startRemote(d: OrchestrationDb, runId: string, title: string): string {
  const task = d.createTask({ spec: title, taskTitle: title, runId })
  const started = d.createStartingWorkerDispatch({
    taskId: task.id,
    startOptions: { on: 'env_imac', serverName: 'imac' },
    federation: {
      environmentId: 'env_imac',
      environmentName: 'imac',
      peerFingerprint: 'fp_imac',
      protocolVersion: 1
    }
  })
  d.updateFederatedDispatchResources({
    dispatchId: started.dispatch.id,
    remoteRuntimeEpoch: 'epoch_imac',
    worktreeId: `repo::/home/me/${title.toLowerCase()}`,
    terminalHandle: `term_${title}`
  })
  return started.dispatch.id
}

describe('remote members of a lead (ORCA-824)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  it("lists the live members the lead's Run placed on a remote host", () => {
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    const other = db.createRun({
      objective: 'other lead',
      coordinatorHandle: 'term_other',
      coordinatorPaneKey: 'tab_other:22222222-2222-4222-9222-222222222222'
    })
    const live = startRemote(db, run.id, 'ORCA-805')
    startRemote(db, other.id, 'ORCA-900')
    const local = db.createTask({ spec: 'local', runId: run.id })
    db.createStartingWorkerDispatch({ taskId: local.id, startOptions: {} })

    const sources = listRemoteGameMemberSources(db, run.id)

    expect(sources).toEqual([
      expect.objectContaining({
        dispatchId: live,
        taskTitle: 'ORCA-805',
        hostName: 'imac',
        environmentId: 'env_imac',
        remoteTerminalHandle: 'term_ORCA-805',
        remoteWorktreeId: 'repo::/home/me/orca-805',
        finished: false
      })
    ])
  })

  it('keeps a member that finished after the current lead claimed the Run, not one from before', () => {
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    const before = startRemote(db, run.id, 'ORCA-700')
    const after = startRemote(db, run.id, 'ORCA-805')
    const sqlite = (db as unknown as { db: { prepare: (sql: string) => { run: () => void } } }).db
    sqlite
      .prepare(
        `UPDATE dispatch_contexts SET status = 'completed', completed_at = '2026-10-26 10:00:00'
         WHERE id = '${before}'`
      )
      .run()
    sqlite
      .prepare(
        `UPDATE dispatch_contexts SET status = 'completed', completed_at = '2026-10-27 15:00:00'
         WHERE id = '${after}'`
      )
      .run()
    sqlite.prepare("UPDATE runs SET updated_at = '2026-10-27 13:00:00'").run()

    expect(listRemoteGameMemberSources(db, run.id).map((one) => one.dispatchId)).toEqual([after])
  })

  const source: RemoteGameMemberSource = {
    dispatchId: 'ctx_805',
    taskTitle: 'ORCA-805 regression gate',
    hostName: 'imac',
    environmentId: 'env_imac',
    remoteTerminalHandle: 'term_805',
    remoteWorktreeId: 'repo::/home/me/orca-805',
    stage: 'agent_started',
    lastActivityAt: '2026-10-27T14:00:00.000Z',
    finished: false,
    ticketDone: false,
    earlierLead: false
  }

  it('reads state, branch and PR from the host and the review provider', async () => {
    const [member] = await remoteGameMembersOf([source], {
      showOf: async () => ({
        branch: 'refs/heads/fabolivark/orca-805',
        title: '✳ Claude Code',
        liveness: 'running'
      }),
      reviewOf: async (branch) =>
        branch === 'refs/heads/fabolivark/orca-805'
          ? {
              provider: 'github',
              number: 701,
              title: 'ORCA-805',
              url: 'https://example.test/701',
              state: 'open',
              status: 'success'
            }
          : null
    })

    expect(member).toMatchObject({
      paneKey: 'remote:ctx_805',
      displayName: 'ORCA-805 regression gate',
      state: 'idle',
      isMember: true,
      terminalHandle: 'term_805',
      remote: { host: 'imac', stateKnown: true },
      worktree: { branch: 'refs/heads/fabolivark/orca-805' },
      review: { number: 701, state: 'open', ci: 'success' },
      lastActivityAt: '2026-10-27T14:00:00.000Z'
    })
  })

  it("shows the agent's hook state the host relays, not its settled dispatch (ORCA-837)", async () => {
    const [member] = await remoteGameMembersOf([{ ...source, finished: true }], {
      showOf: async () => ({
        branch: 'fabolivark/orca-817',
        title: '✳ Claude Code',
        liveness: 'running',
        agent: {
          state: 'working',
          agentType: 'claude',
          updatedAt: Date.parse('2026-10-27T14:12:00Z')
        }
      }),
      reviewOf: async () => null
    })

    expect(member).toMatchObject({
      state: 'working',
      agentType: 'claude',
      lastActivityAt: '2026-10-27T14:12:00.000Z'
    })
  })

  it('relays a waiting agent and one stopped by its usage limit (ORCA-837)', async () => {
    const members = await remoteGameMembersOf([source, { ...source, dispatchId: 'ctx_806' }], {
      showOf: async ({ dispatchId }) => ({
        branch: 'b',
        title: null,
        liveness: 'running',
        agent:
          dispatchId === 'ctx_805'
            ? { state: 'blocked', agentType: 'codex', updatedAt: 0 }
            : { state: 'done', agentType: 'claude', updatedAt: 0, limit: { resetsAt: 99 } }
      }),
      reviewOf: async () => null
    })

    expect(members.map(({ state, limit }) => ({ state, limit }))).toEqual([
      { state: 'waiting', limit: undefined },
      { state: 'done', limit: { resetsAt: 99 } }
    ])
    // Why: the dispatch's own reading is newer than the hook's.
    expect(members[0].lastActivityAt).toBe('2026-10-27T14:00:00.000Z')
  })

  it('keeps the dispatch and title reading for an older host that relays no agent (ORCA-837)', async () => {
    const [member] = await remoteGameMembersOf([{ ...source, finished: true }], {
      showOf: async () => ({ branch: 'b', title: '⠂ Claude Code', liveness: 'running' }),
      reviewOf: async () => null
    })

    expect(member).toMatchObject({ state: 'done', agentType: null })
    expect(member.limit).toBeUndefined()
  })

  it('still lists a member whose host does not answer, with its state unknown', async () => {
    const [member] = await remoteGameMembersOf([source], {
      showOf: async () => {
        throw new Error('environment offline')
      },
      reviewOf: async () => null
    })

    expect(member).toMatchObject({
      paneKey: 'remote:ctx_805',
      isMember: true,
      remote: { host: 'imac', stateKnown: false }
    })
    expect(member.review).toBeUndefined()
  })

  it('flags a member whose ticket the home Run completed', () => {
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    const done = startRemote(db, run.id, 'ORCA-829')
    settle(db, done, '2999-01-01 00:00:00')

    expect(listRemoteGameMemberSources(db, run.id)).toEqual([
      expect.objectContaining({
        dispatchId: done,
        finished: true,
        ticketDone: true
      })
    ])
  })

  it('a home with no federated dispatches has no remote sources', () => {
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })

    expect(listRemoteGameMemberSources(db, run.id)).toEqual([])
    expect(listEarlierLeadRemoteMemberSources(db, run.id, () => false)).toEqual([])
  })
})

function sqliteOf(d: OrchestrationDb): {
  prepare: (sql: string) => { run: () => void }
} {
  return (d as unknown as { db: { prepare: (sql: string) => { run: () => void } } }).db
}

function settle(d: OrchestrationDb, dispatchId: string, completedAt: string): void {
  const sqlite = sqliteOf(d)
  sqlite
    .prepare(
      `UPDATE dispatch_contexts SET status = 'completed', completed_at = '${completedAt}'
       WHERE id = '${dispatchId}'`
    )
    .run()
  sqlite
    .prepare(`UPDATE worker_dispatches SET state = 'succeeded' WHERE dispatch_id = '${dispatchId}'`)
    .run()
  sqlite
    .prepare(
      `UPDATE tasks SET status = 'completed'
       WHERE id = (SELECT task_id FROM dispatch_contexts WHERE id = '${dispatchId}')`
    )
    .run()
}

describe('remote members an earlier lead launched (ORCA-793)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  function leads(d: OrchestrationDb): {
    current: string
    earlier: string
    liveOther: string
  } {
    const earlier = d.createRun({
      objective: 'earlier lead',
      coordinatorHandle: 'term_gone',
      coordinatorPaneKey: 'tab_gone:33333333-3333-4333-8333-333333333333'
    })
    const liveOther = d.createRun({
      objective: 'other live lead',
      coordinatorHandle: 'term_other',
      coordinatorPaneKey: 'tab_other:22222222-2222-4222-9222-222222222222'
    })
    const current = d.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    return {
      current: current.id,
      earlier: earlier.id,
      liveOther: liveOther.id
    }
  }

  const liveLeads = new Set(['term_lead', 'term_other'])
  const leadIsLive = (handle: string): boolean => liveLeads.has(handle)

  it("lists an unreleased member of a Run whose lead is gone, with its ticket's outcome", () => {
    db = new OrchestrationDb(':memory:')
    const runs = leads(db)
    const orphan = startRemote(db, runs.earlier, 'ORCA-829')
    settle(db, orphan, '2026-10-20 10:00:00')
    const stillWorking = startRemote(db, runs.earlier, 'ORCA-826')

    const sources = listEarlierLeadRemoteMemberSources(db, runs.current, leadIsLive)

    expect(sources).toEqual([
      expect.objectContaining({
        dispatchId: orphan,
        taskTitle: 'ORCA-829',
        hostName: 'imac',
        remoteTerminalHandle: 'term_ORCA-829',
        finished: true,
        ticketDone: true,
        earlierLead: true
      }),
      expect.objectContaining({
        dispatchId: stillWorking,
        finished: false,
        ticketDone: false,
        earlierLead: true
      })
    ])
  })

  it("lists the current Run's members from before this lead claimed it, not the ones it already shows", () => {
    db = new OrchestrationDb(':memory:')
    const runs = leads(db)
    const before = startRemote(db, runs.current, 'ORCA-700')
    settle(db, before, '2000-01-01 00:00:00')
    startRemote(db, runs.current, 'ORCA-805')

    expect(
      listEarlierLeadRemoteMemberSources(db, runs.current, leadIsLive).map((one) => one.dispatchId)
    ).toEqual([before])
  })

  it("leaves out another live lead's members and members already released or stopped", () => {
    db = new OrchestrationDb(':memory:')
    const runs = leads(db)
    startRemote(db, runs.liveOther, 'ORCA-900')
    const released = startRemote(db, runs.earlier, 'ORCA-701')
    settle(db, released, '2026-10-20 10:00:00')
    db.markFederatedWorkerReleased(released)
    const stopped = startRemote(db, runs.earlier, 'ORCA-702')
    sqliteOf(db)
      .prepare(`UPDATE worker_dispatches SET state = 'stopped' WHERE dispatch_id = '${stopped}'`)
      .run()

    expect(listEarlierLeadRemoteMemberSources(db, runs.current, leadIsLive)).toEqual([])
  })

  const earlier: RemoteGameMemberSource = {
    dispatchId: 'ctx_829',
    taskTitle: 'ORCA-829 versionCode check',
    hostName: 'imac',
    environmentId: 'env_imac',
    remoteTerminalHandle: 'term_5c58ff4d',
    remoteWorktreeId: 'repo::/home/me/orca-829',
    stage: 'agent_started',
    lastActivityAt: null,
    finished: true,
    ticketDone: true,
    earlierLead: true
  }

  it("shows an earlier lead's member only while its host still runs its terminal", async () => {
    const reads = (liveness: 'running' | 'gone' | null) => ({
      showOf: async () =>
        liveness ? { branch: 'fabolivark/orca-829', title: '✳ Claude Code', liveness } : null,
      reviewOf: async () => null
    })

    expect(await remoteGameMembersOf([earlier], reads('gone'))).toEqual([])
    expect(await remoteGameMembersOf([earlier], reads(null))).toEqual([])
    expect(await remoteGameMembersOf([earlier], reads('running'))).toEqual([
      expect.objectContaining({
        paneKey: 'remote:ctx_829',
        state: 'done',
        terminalHandle: 'term_5c58ff4d',
        remote: {
          host: 'imac',
          stateKnown: true,
          earlierLead: true,
          ticketDone: true
        }
      })
    ])
  })

  it("keeps the current lead's remote host shape unchanged", async () => {
    const [member] = await remoteGameMembersOf(
      [{ ...earlier, earlierLead: false, ticketDone: false, finished: false }],
      {
        showOf: async () => null,
        reviewOf: async () => null
      }
    )

    expect(member.remote).toEqual({ host: 'imac', stateKnown: false })
  })
})
