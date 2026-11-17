import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

const agentRow = (paneKey: string, parentPaneKey: string | null) => ({
  paneKey,
  parentPaneKey,
  state: 'working' as const,
  agentType: 'claude',
  prompt: '',
  taskTitle: paneKey === 'tab-4:member' ? 'ORCA-12' : null,
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
  const internals = runtime as unknown as {
    gameBoardProjectOf(args: unknown): Promise<{ key: string }>
    gameStewardLog: { append(...args: unknown[]): Promise<number> }
  }
  vi.spyOn(internals, 'gameBoardProjectOf').mockResolvedValue({ key: 'repo:r1' })
  const append = vi.spyOn(internals.gameStewardLog, 'append').mockResolvedValue(1)
  return { runtime, append }
}

const decision = {
  at: 10,
  moment: 'edit',
  phase: 'implement',
  from: { model: 'claude-sonnet-5-5', effort: 'medium' },
  to: { model: 'claude-opus-5-5', effort: 'high' },
  applied: true,
  source: 'plan',
  why: 'editing code'
}

const report = (ticket: string | null, decisions: unknown[] = [decision]) => ({
  version: 1,
  session: 's1',
  ticket,
  model: 'claude-opus-5-5',
  effort: 'high',
  phase: 'implement',
  plan: 'plan',
  standDown: null,
  pinned: { model: false, effort: false },
  stepsSeen: 4,
  decisions
})

describe("a member pane's steward report through the runtime (ORCA-1242)", () => {
  it("shows on its lead's member row and goes to the ticket's durable log", async () => {
    const { runtime, append } = runtimeWithMember()

    await runtime.getOrchestratorGameState({
      paneKey: 'tab-4:member',
      terminalHandle: 'term_m',
      steward: report('ORCA-12')
    })
    const lead = await runtime.getOrchestratorGameState({ paneKey: 'tab-1:lead' })

    const member = lead.agents.find((agent) => agent.paneKey === 'tab-4:member')
    expect(member?.steward).toMatchObject({ model: 'claude-opus-5-5', phase: 'implement' })
    expect(lead.agents.find((agent) => agent.paneKey === 'tab-1:lead')?.steward).toBeUndefined()
    await vi.waitFor(() =>
      expect(append).toHaveBeenCalledWith(
        'repo:r1',
        expect.objectContaining({ ticket: 'ORCA-12', session: 's1', decisions: [decision] })
      )
    )
  })

  it('logs nothing without a ticket or a decision', async () => {
    const { runtime, append } = runtimeWithMember()

    await runtime.getOrchestratorGameState({ paneKey: 'tab-4:member', steward: report(null) })
    await runtime.getOrchestratorGameState({
      paneKey: 'tab-4:member',
      steward: report('ORCA-12', [])
    })

    expect(append).not.toHaveBeenCalled()
  })

  it('an old-shape poll without a steward leaves the member row without one', async () => {
    const { runtime } = runtimeWithMember()
    await runtime.getOrchestratorGameState({ paneKey: 'tab-4:member' })
    const lead = await runtime.getOrchestratorGameState({ paneKey: 'tab-1:lead' })
    expect(lead.agents.find((agent) => agent.paneKey === 'tab-4:member')).not.toHaveProperty(
      'steward'
    )
  })
})

describe('a steward pick the session does not serve (ORCA-1242 PR 3c, risk 4b)', () => {
  it("is flagged on the lead's member row two minutes after the decision", async () => {
    const { runtime } = runtimeWithMember()
    vi.spyOn(
      runtime as unknown as { gameMemberLaunchFor(paneKey: string): unknown },
      'gameMemberLaunchFor'
    ).mockReturnValue({ model: 'Sonnet 5.5', effort: 'medium', source: 'session' })
    const at = Date.now()
    const fresh = { ...decision, at }
    await runtime.getOrchestratorGameState({
      paneKey: 'tab-4:member',
      steward: report('ORCA-12', [fresh])
    })
    const memberOf = async () =>
      (await runtime.getOrchestratorGameState({ paneKey: 'tab-1:lead' })).agents.find(
        (agent) => agent.paneKey === 'tab-4:member'
      )?.steward
    expect((await memberOf())?.skipped).toBeUndefined()
    vi.spyOn(Date, 'now').mockReturnValue(at + 120_000)
    expect((await memberOf())?.skipped).toBe(true)
    vi.mocked(Date.now).mockRestore()
  })
})
