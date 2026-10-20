import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

import { OrcaRuntimeService } from './orca-runtime'

userData.dir = mkdtempSync(join(tmpdir(), 'orca-paused-runtime-'))
afterAll(() => rmSync(userData.dir, { recursive: true, force: true }))

const agentRow = (paneKey: string, parentPaneKey: string | null) => ({
  paneKey,
  parentPaneKey,
  state: 'working' as const,
  agentType: 'claude',
  prompt: '',
  taskTitle: parentPaneKey ? 'ORCA-609' : null,
  displayName: parentPaneKey ? 'Merlin · ORCA-609 Cartelera' : null,
  lastAssistantMessage: null,
  toolName: null,
  toolInput: null,
  interrupted: false,
  stateStartedAt: 0,
  updatedAt: 0
})

const leadWorktree = {
  worktreeId: 'wt-lead',
  branch: 'main',
  displayName: 'lead',
  agents: [agentRow('tab-1:lead', null)]
}
const memberWorktree = {
  worktreeId: 'wt-member',
  branch: 'fabolivark/orca-609',
  displayName: 'orca-609',
  agents: [agentRow('tab-4:member', 'tab-1:lead')]
}

// Why the casts: these lookups are private, and real ones need live PTYs and hook events.
function runtimeWith(worktrees: (typeof leadWorktree)[]): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService(null)
  vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({ worktrees } as never)
  const internals = runtime as unknown as {
    getResolvedWorktreeMap: () => Promise<Map<string, unknown>>
    getTerminalHandleForPaneKey: (paneKey: string) => string | null
    getAgentStatusOrchestrationContextForHandle: (handle: string) => unknown
  }
  vi.spyOn(internals, 'getResolvedWorktreeMap').mockResolvedValue(
    new Map([
      ['wt-lead', { id: 'wt-lead', repoId: 'repo-1', path: userData.dir, branch: 'main' }],
      ['wt-member', { id: 'wt-member', repoId: 'repo-1', path: userData.dir, branch: 'orca-609' }]
    ])
  )
  vi.spyOn(internals, 'getTerminalHandleForPaneKey').mockImplementation((paneKey) =>
    paneKey === 'tab-4:member' ? 'term_member' : null
  )
  vi.spyOn(internals, 'getAgentStatusOrchestrationContextForHandle').mockImplementation((handle) =>
    handle === 'term_member'
      ? {
          taskId: 'task_609',
          dispatchId: 'ctx_609',
          dispatchStatus: 'dispatched',
          orchestrationRunId: 'run_1'
        }
      : undefined
  )
  vi.spyOn(runtime, 'getExactWorkerProviderSessionIdentity').mockImplementation((handle) =>
    handle === 'term_member'
      ? ({ providerSession: { key: 'session_id', id: 'sess-609' } } as never)
      : null
  )
  return runtime
}

describe("a lead's members across a restart, through the runtime", () => {
  it('saves a live member, then shows it paused once Orca comes back without it', async () => {
    const before = await runtimeWith([leadWorktree, memberWorktree]).getOrchestratorGameState({
      worktreeId: 'wt-lead',
      paneKey: 'tab-1:lead'
    })
    expect(before.pausedMembers).toEqual([])

    const after = await runtimeWith([leadWorktree]).getOrchestratorGameState({
      worktreeId: 'wt-lead',
      paneKey: 'tab-1:lead'
    })

    expect(after.pausedMembers).toEqual([
      expect.objectContaining({
        ticket: 'ORCA-609',
        name: 'Merlin · ORCA-609 Cartelera',
        branch: 'fabolivark/orca-609',
        resumable: true,
        lastState: 'working'
      })
    ])
    expect(after.pausedMembersError).toBeUndefined()
  })

  it('shows nothing paused to a member pane', async () => {
    const member = await runtimeWith([leadWorktree, memberWorktree]).getOrchestratorGameState({
      worktreeId: 'wt-member',
      paneKey: 'tab-4:member'
    })
    expect(member.pausedMembers).toBeUndefined()
  })
})
