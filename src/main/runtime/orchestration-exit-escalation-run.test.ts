import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import { importFederatedControlMessage } from './orchestration/federation-control-message'
import { createLegacyStorageCutoverFixture } from './orchestration/orchestration-legacy-storage-test-fixture'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false },
  BrowserWindow: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: vi.fn(() => null) }
}))

const TAB_ID = '11111111-1111-4111-8111-111111111111'
const LEAF_ID = '22222222-2222-4222-8222-222222222222'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const PTY_ID = 'pty-orca-726'
const WORKER_HANDLE = 'term_orca_726_worker'
const WORKTREE_ID = 'repo-orca-726::/tmp/orca-726'

describe('orchestration mail on an adopted database (ORCA-726)', () => {
  let db: OrchestrationDb | undefined
  let tempDir: string | undefined

  afterEach(() => {
    db?.close()
    db = undefined
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  function openAdopted(): OrchestrationDb {
    const created = createLegacyStorageCutoverFixture()
    tempDir = created.tempDir
    db = new OrchestrationDb(created.fixture.dbPath)
    expect(db.getLegacyAdoption()).toBeDefined()
    return db
  }

  it('files the exit escalation under the exited Dispatch Run', async () => {
    const adopted = openAdopted()
    const run = adopted.createRun({
      objective: 'exit escalation',
      coordinatorHandle: 'term_orca_726_lead',
      coordinatorPaneKey: 'tab_lead:33333333-3333-4333-8333-333333333333'
    })
    const task = adopted.createTask({ spec: 'work', runId: run.id })
    adopted.createDispatchContext(task.id, WORKER_HANDLE, PANE_KEY)
    adopted.createCoordinatorRun({ spec: 'lead', coordinatorHandle: 'term_orca_726_lead' })
    const runtime = new OrcaRuntimeService(null)
    runtime.setOrchestrationDb(adopted)
    runtime.setPtyController({
      write: vi.fn(() => true),
      kill: vi.fn(),
      getForegroundProcess: async () => null
    })
    runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
      tabId: TAB_ID,
      leafId: LEAF_ID,
      incarnationId: 'orca-726-incarnation'
    })
    runtime.registerPreAllocatedHandleForPty(PTY_ID, WORKER_HANDLE)
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: TAB_ID,
          worktreeId: WORKTREE_ID,
          title: 'Claude',
          activeLeafId: LEAF_ID,
          layout: null
        }
      ],
      leaves: [
        { tabId: TAB_ID, worktreeId: WORKTREE_ID, leafId: LEAF_ID, paneRuntimeId: 1, ptyId: PTY_ID }
      ]
    })
    await runtime.listTerminals()

    runtime.onPtyExit(PTY_ID, 1)

    expect(adopted.getUnreadMessages('term_orca_726_lead')).toEqual([
      expect.objectContaining({ type: 'escalation', run_id: run.id })
    ])
  })

  it('imports federated control mail on an adopted worker host', () => {
    const adopted = openAdopted()

    const imported = importFederatedControlMessage(adopted, {
      dispatchId: 'ctx_remote_726',
      messageId: 'msg_remote_726',
      payload: JSON.stringify({
        from: 'run:run_home_726',
        subject: 'Continue',
        body: 'Run the focused follow-up.',
        type: 'status',
        priority: 'normal',
        threadId: null,
        payload: null
      })
    })

    expect(imported).toEqual({ imported: true, type: 'status' })
    expect(adopted.getUnreadMessages('dispatch:ctx_remote_726')).toHaveLength(1)
  })
})
