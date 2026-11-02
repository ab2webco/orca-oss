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
