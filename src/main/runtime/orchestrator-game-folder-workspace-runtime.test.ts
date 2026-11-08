import { describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import { OrcaRuntimeService } from './orca-runtime'

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

const WORKSPACE: FolderWorkspace = {
  id: 'ws-1',
  projectGroupId: 'group-1',
  name: 'Notes',
  folderPath: '/srv/notes',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
}

function runtimeWith(group: { connectionId?: string } = {}) {
  const runtime = new OrcaRuntimeService({
    getFolderWorkspaces: () => [WORKSPACE],
    getProjectGroups: () => [{ id: 'group-1', name: 'Notes', parentPath: '/srv/notes', ...group }],
    getAllWorktreeMeta: () => ({}),
    getRepo: () => undefined,
    getRepos: () => [],
    getSettings: () => ({})
  } as never)
  // Why the lead has no row: a Claude lead that has not reported yet is not in worktree.ps.
  vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
    worktrees: [
      {
        worktreeId: 'folder:ws-1',
        repoId: 'folder-workspace:group-1',
        branch: '',
        displayName: 'Notes',
        agents: [agentRow('tab-2:other')]
      }
    ]
  } as never)
  const handles = runtime as unknown as {
    getTerminalHandleForPaneKey: (paneKey: string) => string | null
  }
  vi.spyOn(handles, 'getTerminalHandleForPaneKey').mockImplementation((paneKey) =>
    paneKey === 'tab-2:other' ? 'term_other' : paneKey === 'tab-1:lead' ? 'term_lead' : null
  )
  return runtime
}

describe('a lead in a folder workspace (ORCA-1135)', () => {
  it("finds the folder's other session and names the folder as its worktree", async () => {
    const lead = await runtimeWith().getOrchestratorGameState({
      worktreeId: 'folder:ws-1',
      paneKey: 'tab-1:lead'
    })

    expect(lead.role).toBe('lead')
    expect(lead.worktree).toEqual({
      id: 'folder:ws-1',
      path: '/srv/notes',
      branch: '',
      displayName: 'Notes',
      folder: true
    })
    expect(lead.agents.filter((agent) => agent.found).map((agent) => agent.paneKey)).toEqual([
      'tab-2:other'
    ])
  })

  it('keeps another session in the same folder found once the lead reported, and its member a member', async () => {
    const runtime = runtimeWith({ connectionId: 'ssh-1' })
    vi.mocked(runtime.getWorktreePs).mockResolvedValue({
      worktrees: [
        {
          worktreeId: 'folder:ws-1',
          repoId: 'folder-workspace:group-1',
          branch: '',
          displayName: 'Notes',
          agents: [
            agentRow('tab-1:lead'),
            agentRow('tab-2:other'),
            { ...agentRow('tab-3:member'), parentPaneKey: 'tab-1:lead' }
          ]
        }
      ]
    } as never)

    const lead = await runtime.getOrchestratorGameState({
      worktreeId: 'folder:ws-1',
      paneKey: 'tab-1:lead'
    })

    expect(
      lead.agents.map((agent) => [agent.paneKey, agent.isMember ?? false, agent.found ?? false])
    ).toEqual([
      ['tab-1:lead', false, false],
      ['tab-3:member', true, false],
      ['tab-2:other', true, true]
    ])
  })
})
