import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import { escalateAgentExit } from './orchestration/agent-exit-escalation'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false },
  BrowserWindow: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: vi.fn(() => null) }
}))

const TAB_ID = '11111111-1111-4111-8111-111111111989'
const LEAF_ID = '22222222-2222-4222-8222-222222222989'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const PTY_ID = 'pty-orca-989'
const MEMBER = 'term_orca_989_member'
const LEAD = 'term_orca_989_lead'
const WORKTREE_ID = 'repo-orca-989::/tmp/orca-989'
const SESSION_ID = '97d18016-ac75-4dbf-b24d-3e1888a80b0a'

describe('a member whose agent exits before worker_done (ORCA-989)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  // Why no coordinator_runs row: a game lead only owns the Dispatch's Run.
  function dispatched() {
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'CIN-1741',
      coordinatorHandle: LEAD,
      coordinatorPaneKey: 'tab_lead:33333333-3333-4333-8333-333333333989'
    })
    const task = db.createTask({ spec: 'implement CIN-1741', runId: run.id })
    const dispatch = db.createDispatchContext(task.id, MEMBER, PANE_KEY)
    return { db, run, task, dispatch }
  }

  it('fails the Dispatch, mails the lead the resume command and wakes it', () => {
    const { db, run, task, dispatch } = dispatched()
    const notify = vi.fn()

    expect(
      escalateAgentExit(db, notify, { handle: MEMBER, exitCode: 1, sessionId: SESSION_ID })
    ).toBe(true)

    expect(db.getActiveDispatchForTerminal(MEMBER)).toBeUndefined()
    const [mail] = db.getUnreadMessages(LEAD)
    expect(mail).toMatchObject({
      type: 'escalation',
      priority: 'high',
      run_id: run.id,
      from_handle: MEMBER
    })
    expect(mail?.body).toContain(`claude --resume ${SESSION_ID}`)
    expect(JSON.parse(mail?.payload ?? '{}')).toMatchObject({
      taskId: task.id,
      dispatchId: dispatch.id,
      exitCode: 1,
      resumeCommand: `claude --resume ${SESSION_ID}`
    })
    expect(notify).toHaveBeenCalledWith(LEAD, 'escalation')
  })

  it('says the session is unknown instead of inventing a command', () => {
    const { db } = dispatched()

    escalateAgentExit(db, vi.fn(), { handle: MEMBER, exitCode: null, sessionId: null })

    const [mail] = db.getUnreadMessages(LEAD)
    expect(mail?.subject).toBe('Agent exited unexpectedly (no exit code)')
    expect(mail?.body).toContain('session id is unknown')
  })

  it('stays quiet for a terminal with no open Dispatch', () => {
    const { db } = dispatched()
    const notify = vi.fn()

    expect(
      escalateAgentExit(db, notify, { handle: 'term_other', exitCode: 1, sessionId: null })
    ).toBe(false)
    expect(db.getUnreadMessages(LEAD)).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })

  async function memberRuntime(withAgent: boolean) {
    const runtime = new OrcaRuntimeService(null)
    runtime.setOrchestrationDb(db as OrchestrationDb)
    runtime.setPtyController({
      write: vi.fn(() => true),
      kill: vi.fn(),
      getForegroundProcess: async () => null
    })
    runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
      tabId: TAB_ID,
      leafId: LEAF_ID,
      incarnationId: 'orca-989-incarnation',
      ...(withAgent
        ? { agentLaunchAuthority: { launchToken: 'launch-989', launchAgent: 'claude' as const } }
        : {})
    })
    runtime.registerPreAllocatedHandleForPty(PTY_ID, MEMBER)
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
    vi.spyOn(runtime, 'getExactWorkerProviderSessionIdentity').mockReturnValue({
      providerSession: { key: 'session_id', id: SESSION_ID }
    } as never)
    return runtime
  }

  it('escalates when the agent exits and its shell stays alive', async () => {
    const { run } = dispatched()
    const runtime = await memberRuntime(true)

    runtime.emitDaemonPtyTransientFact(PTY_ID, { kind: 'command-finished', exitCode: 1 })

    expect(db?.getActiveDispatchForTerminal(MEMBER)).toBeUndefined()
    expect(db?.getUnreadMessages(LEAD)).toEqual([
      expect.objectContaining({
        type: 'escalation',
        run_id: run.id,
        body: expect.stringContaining(`claude --resume ${SESSION_ID}`)
      })
    ])
  })

  it('leaves the Dispatch alone when a plain shell command finishes', async () => {
    dispatched()
    const runtime = await memberRuntime(false)

    runtime.emitDaemonPtyTransientFact(PTY_ID, { kind: 'command-finished', exitCode: 0 })

    expect(db?.getActiveDispatchForTerminal(MEMBER)).toBeDefined()
    expect(db?.getUnreadMessages(LEAD)).toEqual([])
  })
})
