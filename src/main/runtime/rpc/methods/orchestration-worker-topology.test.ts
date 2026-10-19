import { describe, expect, it, vi } from 'vitest'
import {
  createExistingWorktreeWorkerTerminal,
  createWorkerWorktree
} from './orchestration-worker-topology'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'

type Args = Parameters<typeof createWorkerWorktree>[0]

describe('orchestration worker terminals', () => {
  it('marks an existing-worktree member terminal as an orchestration worker', async () => {
    const createTerminal = vi.fn(async () => ({ handle: 'term-1', surface: 'split' }))
    const runtime = { createTerminal } as unknown as OrcaRuntimeService

    await createExistingWorktreeWorkerTerminal({
      runtime,
      worktreeId: 'wt-1',
      agent: 'claude',
      taskId: 'task-1',
      effects: []
    })

    expect(createTerminal).toHaveBeenCalledWith(
      'id:wt-1',
      expect.objectContaining({ startupAgent: 'claude', orchestrationWorker: true })
    )
  })

  it('marks the startup terminal of a new member worktree as an orchestration worker', async () => {
    const createManagedWorktree = vi.fn(async () => ({
      worktree: { id: 'wt-2' },
      startupTerminal: { handle: 'term-2' },
      setupReceipt: undefined,
      warning: undefined
    }))
    const runtime = {
      createManagedWorktree,
      listTerminals: vi.fn(async () => ({ terminals: [] }))
    } as unknown as OrcaRuntimeService
    const db = { recordWorkerStage: vi.fn() } as unknown as OrchestrationDb

    await createWorkerWorktree({
      runtime,
      db,
      dispatchId: 'ctx-1',
      requestedWorktree: 'new-child',
      coordinatorWorktree: { id: 'wt-0', repoId: 'repo-1' },
      params: { name: 'orca-657', from: 'term-0' },
      agent: 'claude',
      effects: []
    } as unknown as Args)

    expect(createManagedWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ startupAgent: 'claude', orchestrationWorker: true })
    )
  })
})
