import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import { TERMINAL_WAKE_RUNTIME_CAPABILITY } from '../../shared/protocol-version'

// Why: after a paired host restarted, its members' panes slept and the lead could not
// resume them from Orca Game; only a click in that host's window woke them (ORCA-915).

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

const ASLEEP_SHOW = {
  terminal: null,
  asleep: { terminal: 'term_sleeping', branch: 'fabolivark/orca-915', title: 'Nova · ORCA-915' }
}

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
  const task = db.createTask({ spec: 'wake', taskTitle: 'ORCA-915 wake', runId: run.id })
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
    remoteRuntimeEpoch: 'epoch_before_restart',
    worktreeId: 'repo::/home/me/orca-915',
    terminalHandle: 'term_before_restart'
  })
  return { runtime, dispatchId: started.dispatch.id }
}

/** The paired host: its federationShow, status and terminal.wake answers. */
function hostAnswering(
  runtime: OrcaRuntimeService,
  answers: { show: unknown; capabilities: string[] }
): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(runtime, 'callOrchestrationWorkerServer')
    .mockImplementation(async (_environment, method) => {
      if (method === 'orchestration.federationShow') {
        return answers.show
      }
      if (method === 'status.get') {
        return { capabilities: answers.capabilities }
      }
      if (method === 'terminal.wake') {
        return { wake: { handle: 'term_woken', status: 'woken', paneKey: 'tab:leaf' } }
      }
      throw new Error(`unexpected ${method}`)
    })
}

describe('a member its paired host slept on restart', () => {
  it('reads as asleep in its worktree, not gone', async () => {
    const { runtime } = leadWithRemoteMember()
    hostAnswering(runtime, { show: ASLEEP_SHOW, capabilities: [] })

    const state = await runtime.getOrchestratorGameState({ paneKey: LEAD_PANE })

    expect(state.agents.find((agent) => agent.isMember)).toMatchObject({
      remote: { host: 'imac', stateKnown: true, asleep: true },
      worktree: { branch: 'fabolivark/orca-915' }
    })
  })

  it('wakes through its host, which resumes the same conversation in the same pane', async () => {
    const { runtime, dispatchId } = leadWithRemoteMember()
    const host = hostAnswering(runtime, {
      show: ASLEEP_SHOW,
      capabilities: [TERMINAL_WAKE_RUNTIME_CAPABILITY]
    })

    await expect(runtime.wakeRemoteGameMember(dispatchId)).resolves.toMatchObject({
      handle: 'term_woken',
      status: 'woken'
    })
    expect(host).toHaveBeenCalledWith(
      'env_imac',
      'terminal.wake',
      { terminal: 'term_sleeping' },
      expect.any(Number)
    )
    // View opens the woken terminal, not the one from before the restart.
    expect(
      runtime.getOrchestrationDb().getFederatedDispatch(dispatchId)?.remote_terminal_handle
    ).toBe('term_woken')
  })

  it('refuses a host too old to wake terminals instead of calling a method it lacks', async () => {
    const { runtime, dispatchId } = leadWithRemoteMember()
    const host = hostAnswering(runtime, { show: ASLEEP_SHOW, capabilities: [] })

    await expect(runtime.wakeRemoteGameMember(dispatchId)).rejects.toThrow(
      /imac cannot wake terminals/
    )
    expect(host).not.toHaveBeenCalledWith(
      'env_imac',
      'terminal.wake',
      expect.anything(),
      expect.anything()
    )
  })

  it('answers a member whose terminal still runs as awake', async () => {
    const { runtime, dispatchId } = leadWithRemoteMember()
    hostAnswering(runtime, {
      show: { terminal: { handle: 'term_running', liveness: 'running' } },
      capabilities: [TERMINAL_WAKE_RUNTIME_CAPABILITY]
    })

    await expect(runtime.wakeRemoteGameMember(dispatchId)).resolves.toEqual({
      handle: 'term_running',
      status: 'awake'
    })
  })
})
