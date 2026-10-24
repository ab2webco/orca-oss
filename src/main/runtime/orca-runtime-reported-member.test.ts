import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { makePaneKey } from '../../shared/stable-pane-id'

const WORKTREE_ID = 'repo-1::/tmp/worktree'
const WORKER_LEAF = '33333333-3333-4333-8333-333333333333'
const LEAD_LEAF = '44444444-4444-4444-8444-444444444444'
const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString()

// ORCA-779: a member that reported keeps working on the lead's follow-up, so while its dispatched
// agent process is still the one in the pane it stays the lead's member past the settled window.
describe("a reported member's link to its lead", () => {
  function contextAfter(completed: { completed_at: string; sameProcess: boolean }) {
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
              status: 'completed',
              completed_at: completed.completed_at,
              last_activity_at: null,
              process_incarnation: completed.sameProcess
                ? runtime.getTerminalProcessIncarnation(workerHandle)
                : 'pty-worker:an-earlier-process'
            }
          : undefined
      ),
      getTask: vi.fn(() => ({
        id: 'task-1',
        run_id: 'run-1',
        task_title: 'ORCA-779',
        display_name: 'ORCA-779',
        spec: 'Work on ORCA-779',
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

  it('keeps it past the settled window while the dispatched process is still in the pane', () => {
    expect(contextAfter({ completed_at: minutesAgo(40), sameProcess: true })).toMatchObject({
      dispatchStatus: 'completed',
      parentPaneKey: makePaneKey('tab-l', LEAD_LEAF)
    })
  })

  // THE control: a pane reused by a different process is later work, not the member.
  it('drops it after the window once another process holds the pane', () => {
    expect(contextAfter({ completed_at: minutesAgo(40), sameProcess: false })).toBeUndefined()
  })

  it('keeps it inside the window either way', () => {
    expect(contextAfter({ completed_at: minutesAgo(5), sameProcess: false })).toMatchObject({
      parentPaneKey: makePaneKey('tab-l', LEAD_LEAF)
    })
  })
})
