import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

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
})
