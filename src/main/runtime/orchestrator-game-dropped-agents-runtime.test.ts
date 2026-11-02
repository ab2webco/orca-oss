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

userData.dir = mkdtempSync(join(tmpdir(), 'orca-dropped-runtime-'))
afterAll(() => rmSync(userData.dir, { recursive: true, force: true }))

const agentRow = (paneKey: string) => ({
  paneKey,
  parentPaneKey: null,
  state: 'idle' as const,
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

const HANDLES: Record<string, string> = { 'tab-1:lead': 'term_lead', 'tab-2:found': 'term_found' }

// Why the casts: these lookups are private, and real ones need live PTYs.
function runtimeWith(): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService(null)
  vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
    worktrees: [
      {
        worktreeId: 'wt-lead',
        repoId: 'repo-1',
        branch: 'main',
        displayName: 'lead',
        agents: [agentRow('tab-1:lead')]
      },
      {
        worktreeId: 'wt-914',
        repoId: 'repo-1',
        branch: 'fabolivark/orca-914',
        displayName: 'orca-914',
        agents: [agentRow('tab-2:found')]
      }
    ]
  } as never)
  const internals = runtime as unknown as {
    getResolvedWorktreeMap: () => Promise<Map<string, unknown>>
    getTerminalHandleForPaneKey: (paneKey: string) => string | null
  }
  vi.spyOn(internals, 'getResolvedWorktreeMap').mockResolvedValue(
    new Map([
      ['wt-lead', { id: 'wt-lead', repoId: 'repo-1', path: userData.dir, branch: 'main' }],
      ['wt-914', { id: 'wt-914', repoId: 'repo-1', path: userData.dir, branch: 'orca-914' }]
    ])
  )
  vi.spyOn(internals, 'getTerminalHandleForPaneKey').mockImplementation(
    (paneKey) => HANDLES[paneKey] ?? null
  )
  return runtime
}

const leadState = (runtime: OrcaRuntimeService) =>
  runtime.getOrchestratorGameState({ worktreeId: 'wt-lead', paneKey: 'tab-1:lead' })

const paneKeys = (agents: readonly { paneKey: string }[] | undefined) =>
  (agents ?? []).map((agent) => agent.paneKey)

describe('a lead drops an agent from its fleet, through the runtime (ORCA-943)', () => {
  it('hides it from the fleet, also after a restart, until it is restored', async () => {
    expect(paneKeys((await leadState(runtimeWith())).agents)).toContain('tab-2:found')
    const target = { worktreeId: 'wt-914', environmentId: null, name: 'orca-914', ticket: null }

    await runtimeWith().setGameAgentDropped({ worktreeId: 'wt-lead', agent: target, dropped: true })

    const restarted = await leadState(runtimeWith())
    expect(paneKeys(restarted.agents)).not.toContain('tab-2:found')
    expect(paneKeys(restarted.droppedAgents)).toEqual(['tab-2:found'])

    await runtimeWith().setGameAgentDropped({
      worktreeId: 'wt-lead',
      agent: target,
      dropped: false
    })

    const restored = await leadState(runtimeWith())
    expect(paneKeys(restored.agents)).toContain('tab-2:found')
    expect(restored.droppedAgents).toBeUndefined()
  })
})
