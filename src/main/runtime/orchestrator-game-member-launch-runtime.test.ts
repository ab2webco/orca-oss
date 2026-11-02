import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'

const agentRow = (paneKey: string, parentPaneKey: string | null) => ({
  paneKey,
  parentPaneKey,
  state: 'working' as const,
  agentType: 'claude',
  prompt: '',
  taskTitle: paneKey === 'tab-4:member' ? 'ORCA-609' : null,
  displayName: null,
  lastAssistantMessage: null,
  toolName: null,
  toolInput: null,
  interrupted: false,
  stateStartedAt: 0,
  updatedAt: 0
})

describe("a dispatched member's launch model through the runtime", () => {
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const database of databases) {
      database.close()
    }
    databases.length = 0
  })

  it("is read from its dispatch's launch receipt and shown on its lead's member row", async () => {
    const runtime = new OrcaRuntimeService(null)
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
      worktrees: [
        {
          worktreeId: 'wt-lead',
          branch: 'main',
          displayName: 'lead',
          agents: [agentRow('tab-1:lead', null)]
        },
        {
          worktreeId: 'wt-member',
          branch: 'fabolivark/orca-609',
          displayName: 'orca-609',
          agents: [agentRow('tab-4:member', 'tab-1:lead')]
        }
      ]
    } as never)
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    const task = db.createTask({ spec: 'ORCA-609' })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: {
        topology: 'current',
        agent: 'claude',
        launch: {
          requested: { agent: 'claude', model: 'claude-opus-5-5', effort: 'high' },
          effective: { agent: 'claude', model: 'claude-opus-5-5', effort: 'high' }
        }
      }
    })
    db.recordWorkerStage({
      dispatchId: started.dispatch.id,
      stage: 'terminal_created',
      terminalHandle: 'term_member'
    })
    vi.spyOn(runtime, 'getOrchestrationDb').mockReturnValue(db)
    // Why the cast: the handle lookup is private, and a real one needs a live PTY.
    const handles = runtime as unknown as {
      getTerminalHandleForPaneKey: (paneKey: string) => string | null
    }
    vi.spyOn(handles, 'getTerminalHandleForPaneKey').mockImplementation((paneKey) =>
      paneKey === 'tab-4:member' ? 'term_member' : null
    )

    const lead = await runtime.getOrchestratorGameState({ paneKey: 'tab-1:lead' })

    expect(lead.agents.map((agent) => [agent.paneKey, agent.launch])).toEqual([
      ['tab-4:member', { model: 'Opus 5.5', effort: 'high', source: 'launch' }]
    ])
  })
})
