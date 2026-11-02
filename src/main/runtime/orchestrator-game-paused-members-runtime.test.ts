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
import { OrchestrationDb } from './orchestration/db'

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
function runtimeWith(worktrees: (typeof leadWorktree)[], taskId = 'task_609'): OrcaRuntimeService {
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
          taskId,
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

  // Why (ORCA-764): a live member the lead no longer lists was neither listed nor paused.
  // Why no terminal: one with a live terminal is found and taken back (ORCA-735).
  it('names a saved member whose worktree runs an agent this lead does not list', async () => {
    await runtimeWith([leadWorktree, memberWorktree]).getOrchestratorGameState({
      worktreeId: 'wt-lead',
      paneKey: 'tab-1:lead'
    })
    const orphaned = { ...memberWorktree, agents: [agentRow('tab-5:no-terminal', null)] }

    const after = await runtimeWith([leadWorktree, orphaned]).getOrchestratorGameState({
      worktreeId: 'wt-lead',
      paneKey: 'tab-1:lead'
    })

    expect(after.pausedMembers).toEqual([])
    expect(after.unlistedMembers).toEqual([
      {
        ticket: 'ORCA-609',
        name: 'Merlin · ORCA-609 Cartelera',
        branch: 'fabolivark/orca-609',
        worktreeId: 'wt-member'
      }
    ])
  })

  // Why (ORCA-735): a member whose dispatch ended kept its terminal open, and the lead lost it.
  it('takes back as its member a found session running in a saved member worktree', async () => {
    await runtimeWith([leadWorktree, memberWorktree]).getOrchestratorGameState({
      worktreeId: 'wt-lead',
      paneKey: 'tab-1:lead'
    })
    const orphaned = { ...memberWorktree, agents: [agentRow('tab-4:member', 'tab-0:gone-lead')] }

    const after = await runtimeWith([leadWorktree, orphaned]).getOrchestratorGameState({
      worktreeId: 'wt-lead',
      paneKey: 'tab-1:lead'
    })

    expect(after.unlistedMembers).toBeUndefined()
    expect(after.pausedMembers).toEqual([])
    expect(
      after.agents
        .filter((agent) => agent.isMember)
        .map((agent) => [agent.paneKey, agent.displayName, agent.found ?? false])
    ).toEqual([['tab-4:member', 'Merlin · ORCA-609 Cartelera', false]])
  })

  // Why (ORCA-864): live imac members showed again under "Paused since Orca restarted", each taking a slot.
  it('does not list a saved member as paused while it runs on a paired host', async () => {
    await runtimeWith([leadWorktree, memberWorktree]).getOrchestratorGameState({
      worktreeId: 'wt-lead',
      paneKey: 'tab-1:lead'
    })
    const db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'game',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: 'tab-1:lead'
    })
    const task = db.createTask({ spec: 'ORCA-609', taskTitle: 'Merlin · ORCA-609', runId: run.id })
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
      worktreeId: 'repo::/home/me/orca-609',
      terminalHandle: 'term_on_imac'
    })
    try {
      const runtime = runtimeWith([leadWorktree])
      runtime.setOrchestrationDb(db)
      vi.spyOn(runtime, 'callOrchestrationWorkerServer').mockResolvedValue({
        terminal: { branch: 'fabolivark/orca-609', title: null, liveness: 'running' }
      })

      const after = await runtime.getOrchestratorGameState({
        worktreeId: 'wt-lead',
        paneKey: 'tab-1:lead'
      })

      expect(after.agents.filter((agent) => agent.remote).map((agent) => agent.paneKey)).toEqual([
        `remote:${started.dispatch.id}`
      ])
      expect(after.pausedMembers).toEqual([])
    } finally {
      db.close()
    }
  })

  it('shows nothing paused to a member pane', async () => {
    const member = await runtimeWith([leadWorktree, memberWorktree]).getOrchestratorGameState({
      worktreeId: 'wt-member',
      paneKey: 'tab-4:member'
    })
    expect(member.pausedMembers).toBeUndefined()
  })

  // Why (ORCA-754): a member whose brief never started a turn reports no agent,
  // so it reads as not live, yet its terminal is still open.
  it('says a member with an open terminal and no first turn has an unsubmitted brief', async () => {
    const db = new OrchestrationDb(':memory:')
    const runId = db.createRun({
      objective: 'game',
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: 'tab-1:lead'
    }).id
    const task = db.createTask({ spec: 'ORCA-609', runId })
    db.createDispatchContext(task.id, 'term_member')
    try {
      await runtimeWith([leadWorktree, memberWorktree], task.id).getOrchestratorGameState({
        worktreeId: 'wt-lead',
        paneKey: 'tab-1:lead'
      })
      const runtime = runtimeWith([leadWorktree], task.id)
      runtime.setOrchestrationDb(db)
      const internals = runtime as unknown as {
        isTerminalOpenForHandle: (handle: string) => boolean
      }
      vi.spyOn(internals, 'isTerminalOpenForHandle').mockImplementation(
        (handle) => handle === 'term_member'
      )

      const after = await runtime.getOrchestratorGameState({
        worktreeId: 'wt-lead',
        paneKey: 'tab-1:lead'
      })

      expect(after.pausedMembers).toEqual([
        expect.objectContaining({
          ticket: 'ORCA-609',
          cause: 'unsubmitted',
          terminal: 'term_member'
        })
      ])
    } finally {
      db.close()
    }
  })
})
