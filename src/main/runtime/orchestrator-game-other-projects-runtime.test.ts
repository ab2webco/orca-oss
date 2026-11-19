import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'

const agentRow = (paneKey: string, parentPaneKey: string | null, dispatched: boolean) => ({
  paneKey,
  parentPaneKey,
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
  updatedAt: 0,
  ...(dispatched ? { dispatched: true as const } : {})
})

const worktree = (worktreeId: string, repo: string, agents: ReturnType<typeof agentRow>[]) => ({
  worktreeId,
  repoId: `repo-${repo}`,
  repo,
  branch: worktreeId,
  displayName: worktreeId,
  agents
})

describe("a lead's game state counts other projects' members on its machine (ORCA-1284)", () => {
  it('lists them by project, leaving out its own members and sessions no lead launched', async () => {
    const runtime = new OrcaRuntimeService(null)
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
      worktrees: [
        worktree('wt-lead', 'orca-oss', [agentRow('tab-1:lead', null, false)]),
        worktree('wt-own', 'orca-oss', [agentRow('tab-2:own', 'tab-1:lead', true)]),
        worktree('wt-cin-1', 'cineco', [agentRow('tab-3:cin', 'tab-9:cineco-lead', true)]),
        worktree('wt-cin-2', 'cineco', [agentRow('tab-4:cin', null, true)]),
        worktree('wt-cin-3', 'cineco', [agentRow('tab-5:by-hand', null, false)])
      ]
    } as never)

    const lead = await runtime.getOrchestratorGameState({ paneKey: 'tab-1:lead' })
    const member = await runtime.getOrchestratorGameState({ paneKey: 'tab-2:own' })

    expect(lead.otherProjectMembers).toEqual([{ host: 'local', repo: 'cineco', running: 2 }])
    expect(member).not.toHaveProperty('otherProjectMembers')
  })

  it('counts what another project’s lead in this Orca placed on m1 while it runs there, which m1 never marks', async () => {
    const runtime = new OrcaRuntimeService(null)
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
      worktrees: [worktree('wt-lead', 'orca-oss', [agentRow('tab-1:lead', null, false)])]
    } as never)
    const db = new OrchestrationDb(':memory:')
    const cineco = db.createRun({
      objective: 'cineco lead',
      coordinatorHandle: 'term_cin',
      coordinatorPaneKey: 'tab_cin:22222222-2222-4222-9222-222222222222'
    })
    for (const ticket of ['CIN-1', 'CIN-2']) {
      const task = db.createTask({ spec: ticket, taskTitle: ticket, runId: cineco.id })
      const { dispatch } = db.createStartingWorkerDispatch({
        taskId: task.id,
        startOptions: { on: 'env_m1', leadWorktreeId: 'wt-cineco-lead' },
        federation: {
          environmentId: 'env_m1',
          environmentName: 'm1',
          peerFingerprint: 'fp_m1',
          protocolVersion: 1
        }
      })
      db.updateFederatedDispatchResources({
        dispatchId: dispatch.id,
        remoteRuntimeEpoch: 'epoch_m1',
        worktreeId: `wt-${ticket}`,
        terminalHandle: `term_${ticket}`
      })
    }
    runtime.setOrchestrationDb(db)
    // Why: only CIN-1's worktree runs an agent on m1 now; CIN-2's open dispatch is a stale row.
    const sessions = runtime as unknown as { gameRemoteSessions: { read: () => Promise<unknown> } }
    vi.spyOn(sessions.gameRemoteSessions, 'read').mockResolvedValue([
      {
        environmentId: 'env_m1',
        host: 'm1',
        worktrees: [worktree('wt-CIN-1', 'cineco', [agentRow('m1-pane', null, false)])]
      }
    ])

    const lead = await runtime.getOrchestratorGameState({ paneKey: 'tab-1:lead' })

    expect(lead.otherProjectMembers).toEqual([{ host: 'm1', repo: 'another project', running: 1 }])
    db.close()
  })
})
