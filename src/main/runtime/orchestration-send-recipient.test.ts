import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import { ORCHESTRATION_METHODS } from './rpc/methods/orchestration'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false },
  BrowserWindow: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: vi.fn(() => null) }
}))

const TAB_ID = '11111111-1111-4111-8111-111111111111'
const LEAF_ID = '22222222-2222-4222-8222-222222222222'
const PTY_ID = 'pty-orca-1492'
const MEMBER_HANDLE = 'term_orca_1492_member'
const LEAD_HANDLE = 'term_orca_1492_lead'
const WORKTREE_ID = 'repo-orca-1492::/tmp/orca-1492'

const sendMethod = ORCHESTRATION_METHODS.find((method) => method.name === 'orchestration.send')!

describe('orchestration.send refuses a recipient no one reads (ORCA-1492)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  function createRuntime(options: { graph: boolean }) {
    db = new OrchestrationDb(':memory:')
    const runtime = new OrcaRuntimeService(null)
    runtime.setOrchestrationDb(db)
    runtime.setPtyController({
      write: vi.fn(() => true),
      kill: vi.fn(),
      getForegroundProcess: async () => null
    })
    const run = db.createRun({
      objective: 'recipient check',
      coordinatorHandle: LEAD_HANDLE,
      coordinatorPaneKey: 'tab_lead:33333333-3333-4333-8333-333333333333'
    })
    if (options.graph) {
      runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
        tabId: TAB_ID,
        leafId: LEAF_ID,
        incarnationId: 'orca-1492-incarnation'
      })
      runtime.registerPreAllocatedHandleForPty(PTY_ID, MEMBER_HANDLE)
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
          {
            tabId: TAB_ID,
            worktreeId: WORKTREE_ID,
            leafId: LEAF_ID,
            paneRuntimeId: 1,
            ptyId: PTY_ID
          }
        ]
      })
    }
    return { db, runtime, run }
  }

  function send(runtime: OrcaRuntimeService, to: string) {
    const params = sendMethod.params!.parse({ from: LEAD_HANDLE, to, subject: 'next step' })
    return sendMethod.handler(params, { runtime } as never) as Promise<{
      message: { to_handle: string }
    }>
  }

  function messageCount(target: OrchestrationDb): number {
    const sqlite = (target as unknown as { db: { prepare(sql: string): { get(): unknown } } }).db
    return (sqlite.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n
  }

  it('refuses a handle that names nothing and queues nothing', async () => {
    const { db, runtime } = createRuntime({ graph: true })

    await expect(send(runtime, 'nobody')).rejects.toMatchObject({
      code: 'recipient_not_found',
      data: { recipient: 'nobody' }
    })
    expect(messageCount(db)).toBe(0)
  })

  it('delivers to a live member pane', async () => {
    const { runtime } = createRuntime({ graph: true })
    await runtime.listTerminals()

    await expect(send(runtime, MEMBER_HANDLE)).resolves.toMatchObject({
      message: { to_handle: MEMBER_HANDLE }
    })
  })

  it('refuses a pane whose terminal exited and says so', async () => {
    const { db, runtime } = createRuntime({ graph: true })
    await runtime.listTerminals()
    const before = messageCount(db)
    runtime.onPtyExit(PTY_ID, 0)
    const afterExit = messageCount(db)

    await expect(send(runtime, MEMBER_HANDLE)).rejects.toMatchObject({
      code: 'recipient_gone',
      data: { recipient: MEMBER_HANDLE, found: 'its terminal exited' }
    })
    expect(afterExit).toBeGreaterThanOrEqual(before)
    expect(messageCount(db)).toBe(afterExit)
  })

  it('refuses the handle of a released Dispatch with a distinct code naming it', async () => {
    const { db, runtime, run } = createRuntime({ graph: true })
    const task = db.createTask({ spec: 'settled work', runId: run.id })
    const dispatch = db.createDispatchContext(task.id, 'term_released_member')
    db.completeDispatch(dispatch.id)

    await expect(send(runtime, 'term_released_member')).rejects.toMatchObject({
      code: 'recipient_gone',
      data: { found: `its Dispatch ${dispatch.id} is completed` }
    })
    expect(messageCount(db)).toBe(0)
  })

  it('refuses a handle that only ever sent mail, now held by no pane', async () => {
    const { db, runtime, run } = createRuntime({ graph: true })
    db.insertMessage({ from: 'term_closed_peer', to: LEAD_HANDLE, subject: 'hi', runId: run.id })

    await expect(send(runtime, 'term_closed_peer')).rejects.toMatchObject({
      code: 'recipient_gone'
    })
    expect(messageCount(db)).toBe(1)
  })

  it('keeps mail to an active Dispatch assignee, which that Dispatch reads after a remint', async () => {
    const { db, runtime, run } = createRuntime({ graph: true })
    const task = db.createTask({ spec: 'active work', runId: run.id })
    db.createDispatchContext(task.id, 'term_reminted_member')

    await expect(send(runtime, 'term_reminted_member')).resolves.toMatchObject({
      message: { to_handle: 'term_reminted_member' }
    })
  })

  it("keeps mail to a Run's coordinator, filed to that Run", async () => {
    const { runtime } = createRuntime({ graph: true })

    await expect(send(runtime, LEAD_HANDLE)).resolves.toMatchObject({
      message: { to_handle: LEAD_HANDLE }
    })
  })

  it('refuses as retryable while no window graph can prove the handle', async () => {
    const { db, runtime } = createRuntime({ graph: false })

    await expect(send(runtime, 'nobody')).rejects.toMatchObject({ code: 'runtime_unavailable' })
    expect(messageCount(db)).toBe(0)
  })
})
