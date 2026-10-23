import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '') }
}))

import { makePaneKey } from '../../shared/stable-pane-id'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'

const WORKTREE_ID = 'repo-1::/tmp/orca-764'

// Why (ORCA-764): after a restart the lead's pane keeps its run, but the handle the run saved is gone.
describe('a member of a run whose saved coordinator handle went stale', () => {
  const terminals = [
    { name: 'lead', leafId: '11111111-1111-4111-8111-111111111111' },
    { name: 'member', leafId: '22222222-2222-4222-8222-222222222222' }
  ].map((terminal, index) => ({
    ...terminal,
    tabId: `tab-${terminal.name}`,
    ptyId: `pty-${terminal.name}`,
    paneRuntimeId: index + 1
  }))
  const paneKey = (name: string): string => {
    const terminal = terminals.find((one) => one.name === name)!
    return makePaneKey(terminal.tabId, terminal.leafId)
  }
  const graph = () => ({
    tabs: terminals.map((terminal) => ({
      tabId: terminal.tabId,
      worktreeId: WORKTREE_ID,
      title: terminal.name,
      activeLeafId: terminal.leafId,
      layout: null
    })),
    leaves: terminals.map((terminal) => ({
      tabId: terminal.tabId,
      worktreeId: WORKTREE_ID,
      leafId: terminal.leafId,
      paneRuntimeId: terminal.paneRuntimeId,
      ptyId: terminal.ptyId,
      paneTitle: null
    }))
  })

  function seed(coordinatorHandle: string, coordinatorPaneKey = paneKey('lead')) {
    const runtime = new OrcaRuntimeService(null)
    const handles = Object.fromEntries(
      terminals.map((terminal) => [terminal.name, runtime.preAllocateHandleForPty(terminal.ptyId)])
    )
    const db = new OrchestrationDb(':memory:')
    runtime.setOrchestrationDb(db)
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, graph())
    // Why a dead creator pane: the members were dispatched by the lead before the restart.
    const run = db.createRun({
      objective: 'game',
      coordinatorHandle: 'term_dead-lead',
      coordinatorPaneKey: 'tab-dead:99999999-9999-4999-8999-999999999999'
    })
    const task = db.createTask({
      spec: 'Daisy · ORCA-746',
      runId: run.id,
      createdByTerminalHandle: 'term_dead-lead',
      createdByPaneKey: 'tab-dead:99999999-9999-4999-8999-999999999999',
      createdByProcessIncarnation: 'incarnation-before-restart',
      createdByRunGeneration: run.consumer_generation
    })
    const dispatch = db.createDispatchContext(task.id, handles.member, paneKey('member'))
    db.bindRun({
      runId: run.id,
      coordinatorHandle,
      coordinatorPaneKey
    })
    return { runtime, db, handles, run, task, dispatch }
  }

  it("parents the member to the lead now on the run's pane", () => {
    const { runtime, db, handles, run, task, dispatch } = seed('term_before-restart')
    try {
      const context = runtime.syncWindowGraph(1, graph()).agentOrchestrationByPaneKey?.[
        paneKey('member')
      ]

      expect(db.getRun(run.id)).toMatchObject({ coordinator_handle: 'term_before-restart' })
      expect(context).toMatchObject({
        taskId: task.id,
        dispatchId: dispatch.id,
        parentTerminalHandle: handles.lead,
        parentPaneKey: paneKey('lead'),
        coordinatorHandle: handles.lead,
        orchestrationRunId: run.id
      })
    } finally {
      db.close()
    }
  })

  it('keeps a saved coordinator handle that is still open', () => {
    const { runtime, db, handles, run } = seed('placeholder')
    try {
      db.bindRun({
        runId: run.id,
        coordinatorHandle: handles.lead,
        coordinatorPaneKey: paneKey('lead')
      })
      const context = runtime.syncWindowGraph(1, graph()).agentOrchestrationByPaneKey?.[
        paneKey('member')
      ]
      expect(context).toMatchObject({
        parentTerminalHandle: handles.lead,
        parentPaneKey: paneKey('lead')
      })
    } finally {
      db.close()
    }
  })

  it("keeps the saved handle when nothing is open on the run's pane", () => {
    const { runtime, db, run } = seed(
      'term_before-restart',
      'tab-closed:88888888-8888-4888-8888-888888888888'
    )
    try {
      const context = runtime.syncWindowGraph(1, graph()).agentOrchestrationByPaneKey?.[
        paneKey('member')
      ]
      expect(db.getRun(run.id)).toMatchObject({ coordinator_handle: 'term_before-restart' })
      expect(context).toMatchObject({ parentTerminalHandle: 'term_before-restart' })
      expect(context).not.toHaveProperty('parentPaneKey')
    } finally {
      db.close()
    }
  })
})
