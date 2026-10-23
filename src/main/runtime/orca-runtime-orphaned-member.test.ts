import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { makePaneKey } from '../../shared/stable-pane-id'

const WORKTREE_ID = 'repo-1::/tmp/worktree'
const WORKER_LEAF = '11111111-1111-4111-8111-111111111111'
const LEAD_LEAF = '22222222-2222-4222-8222-222222222222'
const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString()

// ORCA-658: a member failed for silence that keeps working stays its lead's member, marked orphaned.
describe("a silence-failed member's link to its lead", () => {
  function contextAfter(failed: {
    failure_provenance: 'inferred_silence' | 'evidence'
    completed_at: string
    last_activity_at: string | null
  }) {
    const runtime = new OrcaRuntimeService(null)
    const workerHandle = runtime.preAllocateHandleForPty('pty-worker')
    const leadHandle = runtime.preAllocateHandleForPty('pty-lead')
    runtime.setOrchestrationDb({
      getActiveDispatchForTerminal: vi.fn(() => undefined),
      getLatestDispatchForTerminal: vi.fn((handle: string) =>
        handle === workerHandle
          ? {
              id: 'ctx-1',
              run_id: 'run-1',
              task_id: 'task-1',
              assignee_handle: workerHandle,
              status: 'failed',
              ...failed
            }
          : undefined
      ),
      getTask: vi.fn(() => ({
        id: 'task-1',
        run_id: 'run-1',
        task_title: 'ORCA-658',
        display_name: 'ORCA-658',
        spec: 'Work on ORCA-658',
        created_by_terminal_handle: leadHandle
      })),
      getRun: vi.fn(() => ({ id: 'run-1', coordinator_handle: leadHandle, legacy: 0 }))
    } as never)
    runtime.attachWindow(1)
    const result = runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: 'tab-w',
          worktreeId: WORKTREE_ID,
          title: 'w',
          activeLeafId: WORKER_LEAF,
          layout: null
        },
        {
          tabId: 'tab-l',
          worktreeId: WORKTREE_ID,
          title: 'l',
          activeLeafId: LEAD_LEAF,
          layout: null
        }
      ],
      leaves: [
        {
          tabId: 'tab-w',
          worktreeId: WORKTREE_ID,
          leafId: WORKER_LEAF,
          paneRuntimeId: 1,
          ptyId: 'pty-worker',
          paneTitle: null
        },
        {
          tabId: 'tab-l',
          worktreeId: WORKTREE_ID,
          leafId: LEAD_LEAF,
          paneRuntimeId: 2,
          ptyId: 'pty-lead',
          paneTitle: null
        }
      ]
    })
    return result.agentOrchestrationByPaneKey?.[makePaneKey('tab-w', WORKER_LEAF)]
  }

  it('keeps it past the settled window while it keeps working, marked orphaned', () => {
    const lastActivityAt = minutesAgo(2)

    expect(
      contextAfter({
        failure_provenance: 'inferred_silence',
        completed_at: minutesAgo(40),
        last_activity_at: lastActivityAt
      })
    ).toMatchObject({
      dispatchStatus: 'failed',
      parentPaneKey: makePaneKey('tab-l', LEAD_LEAF),
      orphaned: true,
      lastActivityAt
    })
  })

  it('drops it after the window when it failed on evidence or went quiet', () => {
    expect(
      contextAfter({
        failure_provenance: 'evidence',
        completed_at: minutesAgo(40),
        last_activity_at: minutesAgo(2)
      })
    ).toBeUndefined()
    expect(
      contextAfter({
        failure_provenance: 'inferred_silence',
        completed_at: minutesAgo(70),
        last_activity_at: minutesAgo(40)
      })
    ).toBeUndefined()
  })

  it('does not call a silence failure orphaned before it shows activity after the failure', () => {
    const context = contextAfter({
      failure_provenance: 'inferred_silence',
      completed_at: minutesAgo(5),
      last_activity_at: minutesAgo(8)
    })

    expect(context).toMatchObject({ dispatchStatus: 'failed' })
    expect(context).not.toHaveProperty('orphaned')
  })
})
