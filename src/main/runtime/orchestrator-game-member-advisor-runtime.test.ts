import { describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import { OrcaRuntimeService } from './orca-runtime'
import { GAME_MEMBER_ADVISOR_TTL_MS } from './orchestrator-game-member-advisors'

const agentRow = (paneKey: string, parentPaneKey: string | null) => ({
  paneKey,
  parentPaneKey,
  state: 'working' as const,
  agentType: 'claude',
  prompt: '',
  taskTitle: paneKey === 'tab-4:member' ? 'CIN-5' : null,
  displayName: null,
  lastAssistantMessage: null,
  toolName: null,
  toolInput: null,
  interrupted: false,
  stateStartedAt: 0,
  updatedAt: 0
})

const runtimeWithMember = () => {
  const runtime = new OrcaRuntimeService(null)
  const worktree = (id: string, agents: ReturnType<typeof agentRow>[]) => ({
    worktreeId: id,
    branch: `feat/${id}`,
    displayName: id,
    agents
  })
  vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
    worktrees: [
      worktree('wt-lead', [agentRow('tab-1:lead', null)]),
      worktree('wt-member', [agentRow('tab-4:member', 'tab-1:lead')])
    ]
  } as never)
  return runtime
}

describe("a member pane's Jev report through the runtime", () => {
  it("is kept from the member's own state read and shown on its lead's member row", async () => {
    const runtime = runtimeWithMember()
    const report = {
      version: 1,
      model: 'Sonnet 5.5',
      effort: 'high',
      pinned: { model: true, effort: false }
    }

    await runtime.getOrchestratorGameState({ paneKey: 'tab-4:member', advisor: report })
    const lead = await runtime.getOrchestratorGameState({ paneKey: 'tab-1:lead' })

    expect(lead.agents.find((agent) => agent.paneKey === 'tab-4:member')?.advisor).toEqual({
      model: 'Sonnet 5.5',
      effort: 'high',
      pinned: { model: true, effort: false }
    })
  })

  it('still shows on the lead row once the member stopped reporting, from the dispatch it ran on', async () => {
    const runtime = runtimeWithMember()
    const db = new OrchestrationDb(':memory:')
    Object.assign(runtime, { _orchestrationDb: db })
    vi.spyOn(
      runtime as unknown as { getTerminalHandleForPaneKey(paneKey: string): string | null },
      'getTerminalHandleForPaneKey'
    ).mockReturnValue('term_member')
    const task = db.createTask({ spec: 'work a ticket' })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { topology: 'current', agent: 'claude', launch: null }
    })
    db.recordWorkerStage({
      dispatchId: started.dispatch.id,
      stage: 'terminal_created',
      terminalHandle: 'term_member'
    })
    const report = {
      version: 1,
      model: 'Opus 5.5',
      effort: 'high',
      pinned: { model: false, effort: false }
    }

    await runtime.getOrchestratorGameState({ paneKey: 'tab-4:member', advisor: report })
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + GAME_MEMBER_ADVISOR_TTL_MS)
    const lead = await runtime.getOrchestratorGameState({ paneKey: 'tab-1:lead' })
    vi.restoreAllMocks()
    db.close()

    expect(lead.agents.find((agent) => agent.paneKey === 'tab-4:member')?.advisor).toEqual({
      model: 'Opus 5.5',
      effort: 'high',
      pinned: { model: false, effort: false }
    })
  })
})
