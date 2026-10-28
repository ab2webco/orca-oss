import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import {
  listRemoteGameMemberSources,
  remoteGameMembersOf,
  type RemoteGameMemberSource
} from './orchestrator-game-remote-members'

const LEAD_PANE = 'tab_lead:11111111-1111-4111-8111-111111111111'

describe('remote members of a lead (ORCA-824)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

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
      worktreeId: 'repo::/home/me/orca-805',
      terminalHandle: `term_${title}`
    })
    return started.dispatch.id
  }

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
    finished: false
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

  // Why: View on such a member must say it is gone, not that its host is silent (ORCA-790).
  it('marks a member whose terminal is gone on an answering host', async () => {
    const [member] = await remoteGameMembersOf([source], {
      showOf: async () => ({ branch: '', title: null, liveness: 'gone' }),
      reviewOf: async () => null
    })

    expect(member.remote).toEqual({ host: 'imac', stateKnown: false, gone: true })
  })
})
