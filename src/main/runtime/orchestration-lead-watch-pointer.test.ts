import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import { RpcDispatcher } from './rpc/dispatcher'
import { ORCHESTRATION_METHODS } from './rpc/methods/orchestration'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false },
  BrowserWindow: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: vi.fn(() => null) }
}))

const TAB_ID = '33333333-3333-4333-8333-333333333333'
const LEAF_ID = '44444444-4444-4444-8444-444444444444'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const PTY_ID = 'pty-orca-824'
const TERMINAL_HANDLE = 'term_orca_824_lead'
const WORKTREE_ID = 'repo-orca-824::/tmp/orca-824'
const LAUNCH_TOKEN = 'orca-824-launch'
const LEAD_WATCH_TYPES = 'worker_done,escalation,question'
const temporaryDirectories: string[] = []

type CheckResult = {
  runId: string
  deliveryId: string | null
  messages: { id: string; type: string }[]
  count: number
}

function createDatabase(): OrchestrationDb {
  const directory = mkdtempSync(join(tmpdir(), 'orca-824-pointer-'))
  temporaryDirectories.push(directory)
  return new OrchestrationDb(join(directory, 'orchestration.db'))
}

function createLeadRuntime(db: OrchestrationDb): {
  runtime: OrcaRuntimeService
  write: ReturnType<typeof vi.fn>
} {
  const runtime = new OrcaRuntimeService(null, undefined, {
    attestAgentHookCompatibilityAuthority: ({ paneKey }) =>
      paneKey === PANE_KEY ? { paneKey, source: 'current_hook' } : null
  })
  const write = vi.fn(() => true)
  runtime.setOrchestrationDb(db)
  runtime.setPtyController({ write, kill: vi.fn(), getForegroundProcess: async () => null })
  runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
    tabId: TAB_ID,
    leafId: LEAF_ID,
    incarnationId: 'orca-824-incarnation',
    agentLaunchAuthority: { launchToken: LAUNCH_TOKEN, launchAgent: 'codex' }
  })
  runtime.registerPreAllocatedHandleForPty(PTY_ID, TERMINAL_HANDLE)
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: TAB_ID,
        worktreeId: WORKTREE_ID,
        title: 'Codex',
        activeLeafId: LEAF_ID,
        layout: null
      }
    ],
    leaves: [
      { tabId: TAB_ID, worktreeId: WORKTREE_ID, leafId: LEAF_ID, paneRuntimeId: 1, ptyId: PTY_ID }
    ]
  })
  return { runtime, write }
}

async function driveToLiveIdle(runtime: OrcaRuntimeService): Promise<void> {
  await runtime.listTerminals()
  runtime.onPtyData(PTY_ID, '\x1b]0;Codex working\x07', 1)
  runtime.onPtyData(PTY_ID, '\x1b]0;Codex done\x07', 2)
  await Promise.resolve()
}

async function check(
  runtime: OrcaRuntimeService,
  params: Record<string, unknown> = {}
): Promise<CheckResult> {
  const response = await new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS }).dispatch({
    id: `req-orca-824-${Math.random()}`,
    authToken: 'test-auth-token',
    method: 'orchestration.check',
    orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
    orchestrationCompatibilityEvidence: {
      terminalHandle: TERMINAL_HANDLE,
      paneKey: PANE_KEY,
      launchToken: LAUNCH_TOKEN
    },
    params: { terminal: TERMINAL_HANDLE, ...params }
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result as CheckResult
}

function pointerPayloads(write: ReturnType<typeof vi.fn>): string[] {
  return write.mock.calls
    .map(([, payload]) => String(payload))
    .filter((payload) => payload.includes('orca orchestration check'))
}

describe('lead watch and the mail pointer (ORCA-824)', () => {
  afterEach(() => {
    vi.useRealTimers()
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  // Why: the 2 s repoint fired while the lead was busy with the watch's own result and typed a pointer the next check found empty.
  it('does not point at a question the lead watch already took when the repoint fires', async () => {
    vi.useFakeTimers()
    const db = createDatabase()
    const { runtime, write } = createLeadRuntime(db)
    const run = db.createRun({
      objective: 'ORCA-824 watch',
      coordinatorHandle: TERMINAL_HANDLE,
      coordinatorPaneKey: PANE_KEY
    })
    await driveToLiveIdle(runtime)

    const watch = check(runtime, { wait: true, types: LEAD_WATCH_TYPES, timeoutMs: 900_000 })
    await vi.advanceTimersByTimeAsync(0)
    const question = db.insertMessage({
      from: 'dispatch:ctx_orca_824',
      to: `run:${run.id}`,
      subject: 'Question',
      type: 'question',
      runId: run.id,
      deliveryContract: 'current_delivery'
    })
    runtime.notifyMessageArrived(`run:${run.id}`, question.type)

    const taken = await watch
    expect(taken.messages.map((message) => message.id)).toEqual([question.id])
    await vi.advanceTimersByTimeAsync(3_000)
    expect(pointerPayloads(write)).toEqual([])
    db.close()
  })

  // Why: the watch is the lead's chosen channel; mail outside its types rides in the next batch instead of interrupting the person.
  it('does not point while the lead watch is pending, even for mail outside its types', async () => {
    vi.useFakeTimers()
    const db = createDatabase()
    const { runtime, write } = createLeadRuntime(db)
    const run = db.createRun({
      objective: 'ORCA-824 filtered watch',
      coordinatorHandle: TERMINAL_HANDLE,
      coordinatorPaneKey: PANE_KEY
    })
    // Why: only a member's status rides silently; mail from outside the Run wakes the watch (ORCA-861).
    db.createDispatchContext(db.createTask({ spec: 'work', runId: run.id }).id, 'term_member')
    await driveToLiveIdle(runtime)

    const watch = check(runtime, { wait: true, types: LEAD_WATCH_TYPES, timeoutMs: 60_000 })
    await vi.advanceTimersByTimeAsync(0)
    const status = db.insertMessage({
      from: 'term_member',
      to: `run:${run.id}`,
      subject: 'ORCA-824 progress',
      type: 'status',
      runId: run.id,
      deliveryContract: 'current_delivery'
    })
    runtime.notifyMessageArrived(`run:${run.id}`, status.type)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(pointerPayloads(write)).toEqual([])

    const done = db.insertMessage({
      from: 'term_member',
      to: `run:${run.id}`,
      subject: 'ORCA-824 done',
      type: 'worker_done',
      runId: run.id,
      deliveryContract: 'current_delivery'
    })
    runtime.notifyMessageArrived(`run:${run.id}`, done.type)
    const taken = await watch
    expect(taken.messages.map((message) => message.id)).toEqual([status.id, done.id])
    db.close()
  })

  it('still points at run mail when no watch is pending', async () => {
    vi.useFakeTimers()
    const db = createDatabase()
    const { runtime, write } = createLeadRuntime(db)
    const run = db.createRun({
      objective: 'ORCA-824 no watch',
      coordinatorHandle: TERMINAL_HANDLE,
      coordinatorPaneKey: PANE_KEY
    })
    await driveToLiveIdle(runtime)
    const status = db.insertMessage({
      from: 'term_member',
      to: `run:${run.id}`,
      subject: 'ORCA-824 progress',
      type: 'status',
      runId: run.id,
      deliveryContract: 'current_delivery'
    })
    runtime.notifyMessageArrived(`run:${run.id}`, status.type)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(pointerPayloads(write)).toEqual([expect.stringContaining('1 orchestration message')])
    db.close()
  })
})
