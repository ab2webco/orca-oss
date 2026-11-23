import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import type { OrchestrationEnvironmentTransport } from './orchestration/environment-transport'

const LEAD_PANE = 'tab-1:11111111-1111-4111-8111-111111111111'

const agentRow = (paneKey: string) => ({
  paneKey,
  parentPaneKey: null,
  state: 'working' as const,
  agentType: 'claude',
  prompt: '',
  taskTitle: null,
  displayName: null,
  lastAssistantMessage: null,
  toolName: null,
  toolInput: null,
  interrupted: false,
  stateStartedAt: 0,
  updatedAt: 0
})

const hostWorktree = (id: string, repo: string) => ({
  worktreeId: id,
  repoId: 'm1-repo',
  repo,
  branch: `fabolivark/${id}`,
  isArchived: false,
  isMainWorktree: false,
  displayName: id,
  agents: [agentRow(`tab_${id}:22222222-2222-4222-8222-222222222222`)]
})

// Why: on 2026-11-01 two agents on m1 worked project tickets while the lead's fleet showed m1 0/5.
describe("a lead's game state lists its project's agents running on a paired host (ORCA-943)", () => {
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close()
    }
    vi.restoreAllMocks()
  })

  it('shows them as found members of their host, and leaves other projects out', async () => {
    const transport = {
      resolve: () => ({ environmentId: 'env_m1', name: 'm1', peerFingerprint: 'fp_m1' }),
      call: async () => ({ id: 'x', ok: true, result: {} }),
      list: () => [{ id: 'env_m1', name: 'm1' }]
    } as unknown as OrchestrationEnvironmentTransport
    const runtime = new OrcaRuntimeService(null, undefined, {
      orchestrationEnvironmentTransport: transport
    })
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    runtime.setOrchestrationDb(db)
    db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
      worktrees: [
        {
          worktreeId: 'wt-lead',
          branch: 'main',
          displayName: 'lead',
          agents: [agentRow(LEAD_PANE)]
        }
      ]
    } as never)
    const internals = runtime as unknown as {
      getResolvedWorktreeMap: () => Promise<Map<string, unknown>>
      gameRepoNameOf: (repoId: string) => string | null
    }
    vi.spyOn(internals, 'getResolvedWorktreeMap').mockResolvedValue(
      new Map([
        [
          'wt-lead',
          { id: 'wt-lead', repoId: 'repo-orca', path: '/tmp/orca-943-no-such-lead', branch: 'main' }
        ]
      ])
    )
    vi.spyOn(internals, 'gameRepoNameOf').mockReturnValue('orca-oss')
    vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockImplementation(async (_env, method) =>
      method === 'worktree.ps'
        ? {
            worktrees: [hostWorktree('orca-915', 'orca-oss'), hostWorktree('cine-40', 'cineco')]
          }
        : {}
    )

    const state = await runtime.getOrchestratorGameState({
      worktreeId: 'wt-lead',
      paneKey: LEAD_PANE
    })

    expect(
      state.agents.filter((agent) => agent.found).map((agent) => [agent.displayName, agent.remote])
    ).toEqual([['orca-915', { host: 'm1', environmentId: 'env_m1', stateKnown: true }]])
  })
})

// Why: Percival's review of ORCA-1374 on koombea showed twice, and an idle ghost stayed after release (ORCA-1377).
describe('a remote member is one fleet row, before and after its release (ORCA-1377)', () => {
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close()
    }
    vi.restoreAllMocks()
  })

  function leadWithDetachedMember(): {
    runtime: OrcaRuntimeService
    db: OrchestrationDb
    dispatchId: string
    hostReads: () => number
  } {
    const transport = {
      resolve: () => ({
        environmentId: 'env_kb',
        name: 'koombea',
        peerFingerprint: 'fp_kb'
      }),
      call: async () => ({ id: 'x', ok: true, result: {} }),
      list: () => [{ id: 'env_kb', name: 'koombea' }]
    } as unknown as OrchestrationEnvironmentTransport
    const runtime = new OrcaRuntimeService(null, undefined, {
      orchestrationEnvironmentTransport: transport
    })
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    runtime.setOrchestrationDb(db)
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    const task = db.createTask({
      spec: 'review',
      taskTitle: 'Percival · ORCA-1374',
      runId: run.id
    })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { on: 'env_kb', serverName: 'koombea' },
      federation: {
        environmentId: 'env_kb',
        environmentName: 'koombea',
        peerFingerprint: 'fp_kb',
        protocolVersion: 1
      }
    })
    db.updateFederatedDispatchResources({
      dispatchId: started.dispatch.id,
      remoteRuntimeEpoch: 'epoch_kb',
      worktreeId: 'orca-1374',
      terminalHandle: 'term_135284f5'
    })
    db.markWorkerDispatchReady(started.dispatch.id)
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
      worktrees: [
        {
          worktreeId: 'wt-lead',
          branch: 'main',
          displayName: 'lead',
          agents: [agentRow(LEAD_PANE)]
        }
      ]
    } as never)
    const internals = runtime as unknown as {
      getResolvedWorktreeMap: () => Promise<Map<string, unknown>>
      gameRepoNameOf: (repoId: string) => string | null
    }
    vi.spyOn(internals, 'getResolvedWorktreeMap').mockResolvedValue(
      new Map([
        [
          'wt-lead',
          {
            id: 'wt-lead',
            repoId: 'repo-orca',
            path: '/tmp/orca-1377-no-such-lead',
            branch: 'main'
          }
        ]
      ])
    )
    vi.spyOn(internals, 'gameRepoNameOf').mockReturnValue('orca-oss')
    let reads = 0
    // Why an empty branch: the review member checked out the PR detached, as `git checkout --detach` leaves it.
    vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockImplementation(async (_env, method) => {
      if (method === 'worktree.ps') {
        reads += 1
        return {
          worktrees: [{ ...hostWorktree('orca-1374', 'orca-oss'), branch: '' }]
        }
      }
      return method === 'orchestration.federationShow'
        ? {
            terminal: {
              branch: '',
              title: '✳ Claude Code',
              liveness: 'running'
            }
          }
        : {}
    })
    return {
      runtime,
      db,
      dispatchId: started.dispatch.id,
      hostReads: () => reads
    }
  }

  const membersOf = async (runtime: OrcaRuntimeService) =>
    (
      await runtime.getOrchestratorGameState({
        worktreeId: 'wt-lead',
        paneKey: LEAD_PANE
      })
    ).agents
      .filter((agent) => agent.isMember)
      .map((agent) => [agent.paneKey, agent.found === true])

  it('lists a member on a detached HEAD once, not again as a found agent', async () => {
    const { runtime, dispatchId } = leadWithDetachedMember()

    expect(await membersOf(runtime)).toEqual([[`remote:${dispatchId}`, false]])
  })

  it('leaves no found ghost once released, while the host read from before the release is served', async () => {
    const { runtime, db, dispatchId, hostReads } = leadWithDetachedMember()
    await membersOf(runtime)
    const sqlite = (db as unknown as { db: { prepare: (sql: string) => { run: () => void } } }).db
    sqlite
      .prepare(
        `UPDATE worker_dispatches SET state = 'succeeded', stage = 'released',
           updated_at = datetime('now') WHERE dispatch_id = '${dispatchId}'`
      )
      .run()

    expect(await membersOf(runtime)).toEqual([])
    expect(hostReads()).toBe(1)
  })
})
