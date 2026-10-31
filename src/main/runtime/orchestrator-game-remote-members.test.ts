import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import {
  listEarlierLeadRemoteMemberSources,
  listRemoteGameMemberSources,
  liveRemoteMemberTitlesOf,
  remoteGameMembersOf,
  type EarlierLeadRunLead,
  type EarlierLeadRunPanes,
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
    createdAt: '2026-10-27 13:00:00',
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
      // Why the id: View opens the member's terminal through this host's pairing (ORCA-839).
      remote: { host: 'imac', environmentId: 'env_imac', stateKnown: true },
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
          updatedAt: Date.parse('2026-10-27T14:12:00Z'),
          stateStartedAt: Date.parse('2026-10-27T14:10:00Z')
        }
      }),
      reviewOf: async () => null
    })

    expect(member).toMatchObject({
      state: 'working',
      agentType: 'claude',
      lastActivityAt: '2026-10-27T14:12:00.000Z',
      stateSince: Date.parse('2026-10-27T14:10:00Z')
    })
  })

  it('relays a waiting agent and one stopped by its usage limit (ORCA-837)', async () => {
    const other = { ...source, dispatchId: 'ctx_806', remoteWorktreeId: 'repo::/home/me/orca-806' }
    const members = await remoteGameMembersOf([source, other], {
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

  it('shows the account the host says its member runs on, keyed to that host (ORCA-798)', async () => {
    const [member] = await remoteGameMembersOf([source], {
      showOf: async () => ({
        branch: 'b',
        title: null,
        liveness: 'running',
        agent: {
          state: 'working',
          agentType: 'claude',
          updatedAt: 0,
          account: { provider: 'claude', email: 'ana@koombea.com' }
        }
      }),
      reviewOf: async () => null
    })

    expect(member.account).toEqual({
      provider: 'claude',
      id: `remote:${source.environmentId}:ana@koombea.com`,
      email: 'ana@koombea.com'
    })
  })

  it('flags a member its host runs on its global login (ORCA-891)', async () => {
    const [member] = await remoteGameMembersOf([source], {
      showOf: async () => ({
        branch: 'b',
        title: null,
        liveness: 'running',
        agent: { state: 'working', agentType: 'claude', updatedAt: 0, globalLogin: true }
      }),
      reviewOf: async () => null
    })

    expect(member.globalLogin).toBe(true)
    expect(member.account).toBeUndefined()
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
      remote: { host: 'imac', environmentId: 'env_imac', stateKnown: false }
    })
    expect(member.review).toBeUndefined()
  })

  // Why: View on such a member must say it is gone, not that its host is silent (ORCA-790).
  it('marks a member whose terminal is gone on an answering host', async () => {
    const [member] = await remoteGameMembersOf([source], {
      showOf: async () => ({ branch: '', title: null, liveness: 'gone' }),
      reviewOf: async () => null
    })

    expect(member.remote).toEqual({
      host: 'imac',
      environmentId: 'env_imac',
      stateKnown: true,
      gone: true
    })
  })

  // Why: a host answers `terminal: null` once the member's terminal closed; that is not silence (ORCA-854).
  it('shows a finished member whose terminal closed as finished on its answering host', async () => {
    const [member] = await remoteGameMembersOf([{ ...source, finished: true }], {
      showOf: async () => null,
      reviewOf: async () => null
    })

    expect(member).toMatchObject({
      state: 'done',
      remote: { host: 'imac', environmentId: 'env_imac', stateKnown: true, gone: true }
    })
  })

  it('marks an unfinished member whose terminal closed as gone, not its host as silent', async () => {
    const [member] = await remoteGameMembersOf([source], {
      showOf: async () => null,
      reviewOf: async () => null
    })

    expect(member.remote).toEqual({
      host: 'imac',
      environmentId: 'env_imac',
      stateKnown: true,
      gone: true
    })
  })

  // Why: a follow-up `worker-start --on --worktree` titled from its prompt listed the ticket twice (ORCA-854).
  it('lists two dispatches in one host worktree as one member, titled by the first', async () => {
    const reads: string[] = []
    const members = await remoteGameMembersOf(
      [
        {
          ...source,
          dispatchId: 'ctx_attach',
          taskTitle: "CIN-1294: you are now attached to the lead's team",
          remoteTerminalHandle: 'term_attach',
          createdAt: '2026-10-28 15:00:00'
        },
        { ...source, dispatchId: 'ctx_other', remoteWorktreeId: 'repo::/home/me/orca-806' },
        { ...source, taskTitle: 'CIN-1294 Cartelera', finished: true, earlierLead: true }
      ],
      {
        showOf: async ({ dispatchId }) => {
          reads.push(dispatchId)
          return { branch: 'b', title: null, liveness: 'running' }
        },
        reviewOf: async () => null
      }
    )

    expect(
      members.map(({ paneKey, displayName, terminalHandle, state, remote }) => ({
        paneKey,
        displayName,
        terminalHandle,
        state,
        earlierLead: remote?.earlierLead
      }))
    ).toEqual([
      {
        paneKey: 'remote:ctx_attach',
        displayName: 'CIN-1294 Cartelera',
        terminalHandle: 'term_attach',
        state: 'idle',
        earlierLead: undefined
      },
      {
        paneKey: 'remote:ctx_other',
        displayName: 'ORCA-805 regression gate',
        terminalHandle: 'term_805',
        state: 'idle',
        earlierLead: undefined
      }
    ])
    expect(reads.toSorted()).toEqual(['ctx_attach', 'ctx_other'])
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
    expect(
      listEarlierLeadRemoteMemberSources(db, { runId: run.id, projectKey: 'repo:orca' }, () => ({
        live: false,
        projectKey: 'repo:orca'
      }))
    ).toEqual([])
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

  const GONE_PANE = 'tab_gone:33333333-3333-4333-8333-333333333333'
  const OTHER_PANE = 'tab_other:22222222-2222-4222-9222-222222222222'
  const CINECO_PANE = 'tab_cineco:44444444-4444-4444-8444-444444444444'

  function leads(d: OrchestrationDb): {
    current: string
    earlier: string
    liveOther: string
    cineco: string
  } {
    const earlier = d.createRun({
      objective: 'earlier lead',
      coordinatorHandle: 'term_gone',
      coordinatorPaneKey: GONE_PANE
    })
    const liveOther = d.createRun({
      objective: 'other live lead',
      coordinatorHandle: 'term_other',
      coordinatorPaneKey: OTHER_PANE
    })
    const cineco = d.createRun({
      objective: 'another project lead',
      coordinatorHandle: 'term_cineco_gone',
      coordinatorPaneKey: CINECO_PANE
    })
    const current = d.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    return {
      current: current.id,
      earlier: earlier.id,
      liveOther: liveOther.id,
      cineco: cineco.id
    }
  }

  const liveLeads = new Set(['term_lead', 'term_other'])
  const projectOfPane: Record<string, string> = {
    [LEAD_PANE]: 'repo:orca',
    [GONE_PANE]: 'repo:orca',
    [OTHER_PANE]: 'repo:orca',
    [CINECO_PANE]: 'repo:cineco'
  }
  const leadOf = (run: EarlierLeadRunPanes): EarlierLeadRunLead => {
    const pane = run.coordinatorPaneKey ?? run.creatorPaneKey
    return {
      live: run.coordinatorHandle !== null && liveLeads.has(run.coordinatorHandle),
      projectKey: pane ? (projectOfPane[pane] ?? null) : null
    }
  }
  const leadIn = (runId: string, projectKey: string | null = 'repo:orca') => ({
    runId,
    projectKey
  })

  it("lists an unreleased member of a Run whose lead is gone, with its ticket's outcome", () => {
    db = new OrchestrationDb(':memory:')
    const runs = leads(db)
    const orphan = startRemote(db, runs.earlier, 'ORCA-829')
    settle(db, orphan, '2026-10-20 10:00:00')
    const stillWorking = startRemote(db, runs.earlier, 'ORCA-826')

    const sources = listEarlierLeadRemoteMemberSources(db, leadIn(runs.current), leadOf)

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
      listEarlierLeadRemoteMemberSources(db, leadIn(runs.current), leadOf).map(
        (one) => one.dispatchId
      )
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

    expect(listEarlierLeadRemoteMemberSources(db, leadIn(runs.current), leadOf)).toEqual([])
  })

  it("leaves out another project's members, even when their lead is gone (ORCA-848)", () => {
    db = new OrchestrationDb(':memory:')
    const runs = leads(db)
    startRemote(db, runs.cineco, 'CINE-12')
    const ours = startRemote(db, runs.earlier, 'ORCA-829')

    expect(
      listEarlierLeadRemoteMemberSources(db, leadIn(runs.current), leadOf).map(
        (one) => one.dispatchId
      )
    ).toEqual([ours])
  })

  it('keeps only its own Run when Orca cannot place the lead or the earlier Run (ORCA-848)', () => {
    db = new OrchestrationDb(':memory:')
    const runs = leads(db)
    const own = startRemote(db, runs.current, 'ORCA-700')
    settle(db, own, '2000-01-01 00:00:00')
    startRemote(db, runs.earlier, 'ORCA-829')
    const unplaced = db.createRun({
      objective: 'closed lead',
      coordinatorHandle: 'term_closed',
      coordinatorPaneKey: 'tab_closed:55555555-5555-4555-8555-555555555555'
    })
    startRemote(db, unplaced.id, 'ORCA-830')

    expect(
      listEarlierLeadRemoteMemberSources(db, leadIn(runs.current, null), leadOf).map(
        (one) => one.dispatchId
      )
    ).toEqual([own])
    expect(
      listEarlierLeadRemoteMemberSources(db, leadIn(runs.current), leadOf).map(
        (one) => one.taskTitle
      )
    ).toEqual(['ORCA-700', 'ORCA-829'])
  })

  it("holds the titles of every Run's unreleased remote members for the name pool (ORCA-794)", () => {
    db = new OrchestrationDb(':memory:')
    const runs = leads(db)
    startRemote(db, runs.current, 'Arthur · ORCA-805')
    startRemote(db, runs.liveOther, 'Merlin · ORCA-900')
    const finished = startRemote(db, runs.earlier, 'Gawain · ORCA-829')
    settle(db, finished, '2026-10-20 10:00:00')
    const released = startRemote(db, runs.earlier, 'Morgana · ORCA-701')
    settle(db, released, '2026-10-20 10:00:00')
    db.markFederatedWorkerReleased(released)
    const stopped = startRemote(db, runs.earlier, 'Percival · ORCA-702')
    sqliteOf(db)
      .prepare(`UPDATE worker_dispatches SET state = 'stopped' WHERE dispatch_id = '${stopped}'`)
      .run()

    expect(liveRemoteMemberTitlesOf(db)).toEqual([
      'Arthur · ORCA-805',
      'Merlin · ORCA-900',
      'Gawain · ORCA-829'
    ])
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
    createdAt: '2026-10-27 09:00:00',
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
          environmentId: 'env_imac',
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
        showOf: async () => {
          throw new Error('environment offline')
        },
        reviewOf: async () => null
      }
    )

    expect(member.remote).toEqual({ host: 'imac', environmentId: 'env_imac', stateKnown: false })
  })
})
