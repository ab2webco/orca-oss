import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'

const LEAD_PANE = 'tab-1:11111111-1111-4111-8111-111111111111'

const leadRow = {
  paneKey: LEAD_PANE,
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
}

describe("a lead's game state with a member on a paired host (ORCA-824)", () => {
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const database of databases) {
      database.close()
    }
    databases.length = 0
  })

  function leadWithRemoteMember(): { runtime: OrcaRuntimeService; dispatchId: string } {
    const runtime = new OrcaRuntimeService(null)
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
      worktrees: [{ worktreeId: 'wt-lead', branch: 'main', displayName: 'lead', agents: [leadRow] }]
    } as never)
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    runtime.setOrchestrationDb(db)
    const run = db.createRun({
      objective: 'lead',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: LEAD_PANE
    })
    const task = db.createTask({ spec: 'gate', taskTitle: 'ORCA-805 gate', runId: run.id })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { on: 'env_imac', serverName: 'imac' },
      federation: {
        environmentId: 'env_imac',
        environmentName: 'imac',
        peerFingerprint: 'fp_imac',
        protocolVersion: 1
      }
    })
    db.updateFederatedDispatchResources({
      dispatchId: started.dispatch.id,
      remoteRuntimeEpoch: 'epoch_imac',
      worktreeId: 'repo::/home/me/orca-805',
      terminalHandle: 'term_on_imac'
    })
    return { runtime, dispatchId: started.dispatch.id }
  }

  it('lists the remote member with its host and the state its host reports', async () => {
    const { runtime, dispatchId } = leadWithRemoteMember()
    const show = vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockResolvedValue({
      terminal: { branch: 'fabolivark/orca-805', title: '✳ Claude Code', liveness: 'running' }
    })

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(show).toHaveBeenCalledWith(
      'env_imac',
      'orchestration.federationShow',
      { dispatchId },
      3_000
    )
    expect(state.agents.filter((agent) => agent.isMember)).toEqual([
      expect.objectContaining({
        paneKey: `remote:${dispatchId}`,
        displayName: 'ORCA-805 gate',
        state: 'idle',
        terminalHandle: 'term_on_imac',
        remote: { host: 'imac', stateKnown: true },
        worktree: expect.objectContaining({ branch: 'fabolivark/orca-805' })
      })
    ])
  })

  it('keeps the member when its host is offline, state unknown', async () => {
    const { runtime, dispatchId } = leadWithRemoteMember()
    vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockRejectedValue(
      new Error('environment_unavailable')
    )

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(state.agents.filter((agent) => agent.isMember)).toEqual([
      expect.objectContaining({
        paneKey: `remote:${dispatchId}`,
        remote: { host: 'imac', stateKnown: false }
      })
    ])
  })
})
