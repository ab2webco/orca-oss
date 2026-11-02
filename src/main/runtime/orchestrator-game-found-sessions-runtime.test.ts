import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

const agentRow = (paneKey: string, parentPaneKey: string | null, agentType = 'claude') => ({
  paneKey,
  parentPaneKey,
  state: 'working' as const,
  agentType,
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

const HANDLES: Record<string, string> = {
  'tab-1:lead': 'term_lead',
  'tab-2:plain': 'term_plain',
  'tab-3:codex': 'term_codex',
  'tab-4:member': 'term_member',
  'tab-10:cineco': 'term_cineco',
  'tab-11:folder': 'term_folder'
}

function runtimeWith() {
  const runtime = new OrcaRuntimeService(null)
  vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
    worktrees: [
      {
        worktreeId: 'wt-lead',
        repoId: 'repo-orca',
        branch: 'main',
        displayName: 'lead',
        agents: [agentRow('tab-1:lead', null)]
      },
      {
        worktreeId: 'wt-member',
        repoId: 'repo-orca',
        branch: 'cin-1',
        displayName: 'CIN-1',
        agents: [agentRow('tab-4:member', 'tab-1:lead')]
      },
      {
        worktreeId: 'wt-914',
        repoId: 'repo-orca',
        branch: 'refs/heads/fabolivark/orca-914',
        displayName: 'orca-914',
        agents: [agentRow('tab-2:plain', null)]
      },
      {
        worktreeId: 'wt-x',
        repoId: 'repo-orca',
        branch: 'feat/x',
        displayName: 'x',
        agents: [agentRow('tab-3:codex', null, 'codex')]
      },
      {
        worktreeId: 'wt-cin-1390',
        repoId: 'repo-cineco',
        branch: 'cin-1390',
        displayName: 'Daisy',
        agents: [agentRow('tab-10:cineco', null)]
      },
      {
        worktreeId: 'folder:orchestrator',
        repoId: 'folder-workspace:cineco',
        branch: '',
        displayName: 'main',
        agents: [agentRow('tab-11:folder', null)]
      }
    ]
  } as never)
  // Why the cast: the handle lookup is private, and a real one needs a live PTY.
  const handles = runtime as unknown as {
    getTerminalHandleForPaneKey: (paneKey: string) => string | null
  }
  vi.spyOn(handles, 'getTerminalHandleForPaneKey').mockImplementation(
    (paneKey) => HANDLES[paneKey] ?? null
  )
  return runtime
}

describe("a lead's game state lists this machine's sessions it did not launch (ORCA-914)", () => {
  it('adds each live session of any agent as a found member, after the launched ones', async () => {
    const lead = await runtimeWith().getOrchestratorGameState({
      paneKey: 'tab-1:lead'
    })

    expect(
      lead.agents.map((agent) => [
        agent.paneKey,
        agent.displayName,
        agent.agentType,
        agent.terminalHandle,
        agent.found ?? false
      ])
    ).toEqual([
      ['tab-4:member', null, 'claude', 'term_member', false],
      ['tab-2:plain', 'orca-914', 'claude', 'term_plain', true],
      ['tab-3:codex', 'x', 'codex', 'term_codex', true]
    ])
    expect(lead.agents[1]?.worktree).toEqual({
      id: 'wt-914',
      branch: 'fabolivark/orca-914',
      displayName: 'orca-914'
    })
  })

  it("leaves out live sessions in another project's repo or folder group (ORCA-948)", async () => {
    const lead = await runtimeWith().getOrchestratorGameState({
      paneKey: 'tab-1:lead'
    })

    expect(lead.agents.map((agent) => agent.paneKey)).not.toContain('tab-10:cineco')
    expect(lead.agents.map((agent) => agent.paneKey)).not.toContain('tab-11:folder')
  })

  it('lists none to a member pane', async () => {
    const member = await runtimeWith().getOrchestratorGameState({
      paneKey: 'tab-4:member'
    })

    expect(member.agents.some((agent) => agent.found)).toBe(false)
  })
})
