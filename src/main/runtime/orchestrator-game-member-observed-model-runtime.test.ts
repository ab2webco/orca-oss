import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from './orchestration/db'
import { OrcaRuntimeService } from './orca-runtime'

const agentRow = (paneKey: string, parentPaneKey: string | null) => ({
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
  updatedAt: 0
})

type HookStatus = { paneKey: string; state: 'working'; model?: string; effort?: string }

const runtimeWithMember = (launch: Record<string, unknown> | null) => {
  const runtime = new OrcaRuntimeService(null)
  vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
    worktrees: [
      {
        worktreeId: 'wt-lead',
        branch: 'b',
        displayName: 'l',
        agents: [agentRow('tab-1:lead', null)]
      },
      {
        worktreeId: 'wt-member',
        branch: 'm',
        displayName: 'm',
        agents: [agentRow('tab-4:member', 'tab-1:lead')]
      }
    ]
  } as never)
  vi.spyOn(
    runtime as unknown as { getTerminalHandleForPaneKey(paneKey: string): string | null },
    'getTerminalHandleForPaneKey'
  ).mockImplementation((paneKey) => (paneKey === 'tab-4:member' ? 'term_member' : null))
  const db = new OrchestrationDb(':memory:')
  const task = db.createTask({ spec: 'work a ticket' })
  const started = db.createStartingWorkerDispatch({
    taskId: task.id,
    startOptions: { topology: 'current', agent: 'claude', launch }
  })
  db.recordWorkerStage({
    dispatchId: started.dispatch.id,
    stage: 'terminal_created',
    terminalHandle: 'term_member'
  })
  const hookStatuses: HookStatus[] = []
  Object.assign(runtime, {
    _orchestrationDb: db,
    getAgentStatusSnapshotFn: () => hookStatuses
  })
  const memberLaunch = async () =>
    (await runtime.getOrchestratorGameState({ paneKey: 'tab-1:lead' })).agents.find(
      (agent) => agent.paneKey === 'tab-4:member'
    )?.launch
  return { db, hookStatuses, memberLaunch }
}

describe("a member's model from its own hooks", () => {
  const dbs: OrchestrationDb[] = []
  afterEach(() => {
    vi.restoreAllMocks()
    for (const db of dbs.splice(0)) {
      db.close()
    }
  })

  it('shows on a member launched without --model, and stays after its hook status is gone', async () => {
    const member = runtimeWithMember(null)
    dbs.push(member.db)
    expect(await member.memberLaunch()).toBeUndefined()

    member.hookStatuses.push({
      paneKey: 'tab-4:member',
      state: 'working',
      model: 'claude-opus-5-5',
      effort: 'high'
    })
    expect(await member.memberLaunch()).toEqual({
      model: 'Opus 5.5',
      effort: 'high',
      source: 'session'
    })

    member.hookStatuses.length = 0
    expect(await member.memberLaunch()).toEqual({
      model: 'Opus 5.5',
      effort: 'high',
      source: 'session'
    })
  })

  it('wins over the model the dispatch asked for, and keeps the launch effort when hooks name none', async () => {
    const member = runtimeWithMember({
      requested: { agent: 'claude', model: 'claude-sonnet-5-5', effort: 'low' },
      effective: { agent: 'claude', model: 'claude-sonnet-5-5', effort: 'low' }
    })
    dbs.push(member.db)
    expect(await member.memberLaunch()).toEqual({
      model: 'Sonnet 5.5',
      effort: 'low',
      source: 'launch'
    })

    member.hookStatuses.push({
      paneKey: 'tab-4:member',
      state: 'working',
      model: 'claude-opus-5-5'
    })
    expect(await member.memberLaunch()).toEqual({
      model: 'Opus 5.5',
      effort: 'low',
      source: 'session'
    })
  })
})
