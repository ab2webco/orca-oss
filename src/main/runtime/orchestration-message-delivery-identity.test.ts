import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'
import { createLegacyStorageCutoverFixture } from './orchestration/orchestration-legacy-storage-test-fixture'
import { RpcDispatcher } from './rpc/dispatcher'
import { ORCHESTRATION_METHODS } from './rpc/methods/orchestration'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => tmpdir()), isPackaged: false },
  BrowserWindow: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  webContents: { fromId: vi.fn(() => null) }
}))

const TAB_ID = '11111111-1111-4111-8111-111111111111'
const LEAF_ID = '22222222-2222-4222-8222-222222222222'
const PANE_KEY = `${TAB_ID}:${LEAF_ID}`
const PTY_ID = 'pty-sta-4325'
const TERMINAL_HANDLE = 'term_sta_4325'
const REMINTED_TERMINAL_HANDLE = 'term_sta_4325_reminted'
const WORKTREE_ID = 'repo-sta-4325::/tmp/sta-4325'
const LAUNCH_TOKEN = 'sta-4325-launch'
const temporaryDirectories: string[] = []
type MessageResult = { id: string; type: string; read: number }
type CheckResult = {
  runId: string
  deliveryId: string | null
  messages: MessageResult[]
  count: number
  replayed?: boolean
  acknowledged?: string | null
}

type Sqlite = {
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[]
    run: (...params: unknown[]) => unknown
  }
}

function sqliteFor(db: OrchestrationDb): Sqlite {
  return (db as unknown as { db: Sqlite }).db
}

function createDatabase(prefix: string): { db: OrchestrationDb; path: string } {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  const path = join(directory, 'orchestration.db')
  return { db: new OrchestrationDb(path), path }
}

function createRuntime(
  db: OrchestrationDb,
  terminalHandle = TERMINAL_HANDLE
): {
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
    incarnationId: 'sta-4325-incarnation',
    agentLaunchAuthority: { launchToken: LAUNCH_TOKEN, launchAgent: 'codex' }
  })
  runtime.registerPreAllocatedHandleForPty(PTY_ID, terminalHandle)
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
      {
        tabId: TAB_ID,
        worktreeId: WORKTREE_ID,
        leafId: LEAF_ID,
        paneRuntimeId: 1,
        ptyId: PTY_ID
      }
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
  const terminal = typeof params.terminal === 'string' ? params.terminal : TERMINAL_HANDLE
  const response = await new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS }).dispatch({
    id: `req-sta-4325-${Math.random()}`,
    authToken: 'test-auth-token',
    method: 'orchestration.check',
    orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
    orchestrationCompatibilityEvidence: {
      terminalHandle: terminal,
      paneKey: PANE_KEY,
      launchToken: LAUNCH_TOKEN
    },
    params: { terminal, ...params }
  })
  expect(response.ok).toBe(true)
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

describe('STA-4325 message and delivery identity', () => {
  afterEach(() => {
    vi.useRealTimers()
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps pointer counts, filters, message IDs, and one fixed Delivery aligned through ack', async () => {
    vi.useFakeTimers()
    const { db } = createDatabase('orca-sta-4325-identity-')
    const { runtime, write } = createRuntime(db)
    const run = db.createRun({
      objective: 'STA-4325 identity',
      coordinatorHandle: TERMINAL_HANDLE,
      coordinatorPaneKey: PANE_KEY
    })
    const status = db.insertMessage({
      from: 'term_worker_a',
      to: `run:${run.id}`,
      subject: 'stale status',
      type: 'status',
      runId: run.id,
      deliveryContract: 'current_delivery'
    })
    const dispatch = db.insertMessage({
      from: 'term_worker_b',
      to: `run:${run.id}`,
      subject: 'dispatch receipt',
      type: 'dispatch',
      runId: run.id,
      deliveryContract: 'current_delivery'
    })
    const done = db.insertMessage({
      from: 'term_worker_c',
      to: `run:${run.id}`,
      subject: 'worker complete',
      type: 'worker_done',
      runId: run.id,
      deliveryContract: 'current_delivery'
    })

    await driveToLiveIdle(runtime)
    const [first, concurrent] = await Promise.all([check(runtime), check(runtime)])
    const expectedIds = [status.id, dispatch.id, done.id]

    expect(pointerPayloads(write)).toEqual([expect.stringContaining('3 orchestration messages')])
    expect(first).toMatchObject({ runId: run.id, count: 3, replayed: false })
    expect(concurrent).toMatchObject({ runId: run.id, count: 3, replayed: true })
    expect(first.deliveryId).toBeTruthy()
    expect(concurrent.deliveryId).toBe(first.deliveryId)
    expect(first.messages.map((message) => message.id)).toEqual(expectedIds)
    expect(concurrent.messages.map((message) => message.id)).toEqual(expectedIds)

    const peeked = await check(runtime, { peek: true, unread: false })
    const filtered = await check(runtime, { peek: true, unread: false, types: 'worker_done' })
    const all = await check(runtime, { all: true })
    expect(peeked.messages.map((message) => message.id)).toEqual(
      expect.arrayContaining(expectedIds)
    )
    expect(peeked.count).toBe(3)
    expect(filtered.messages.map((message) => message.id)).toEqual([done.id])
    expect(all.messages.map((message) => message.id)).toEqual(expect.arrayContaining(expectedIds))
    expect(all.count).toBe(3)

    const deliveryRowsBeforeAck = sqliteFor(db)
      .prepare('SELECT id, status, message_ids FROM deliveries ORDER BY rowid')
      .all() as { id: string; status: string; message_ids: string }[]
    expect(deliveryRowsBeforeAck).toEqual([
      { id: first.deliveryId, status: 'outstanding', message_ids: JSON.stringify(expectedIds) }
    ])
    for (const id of expectedIds) {
      expect(db.getMessageById(id)).toMatchObject({ to_handle: `run:${run.id}`, read: 0 })
    }

    const acknowledged = await check(runtime, { ack: first.deliveryId })
    expect(acknowledged).toMatchObject({
      count: 0,
      deliveryId: null,
      acknowledged: first.deliveryId
    })
    expect((await check(runtime, { unread: true })).count).toBe(0)
    const acknowledgedHistory = await check(runtime, { all: true })
    expect(acknowledgedHistory.messages.map((message) => message.id)).toEqual(
      expect.arrayContaining(expectedIds)
    )
    expect(acknowledgedHistory.count).toBe(3)
    expect(sqliteFor(db).prepare('SELECT id, status FROM deliveries ORDER BY rowid').all()).toEqual(
      [{ id: first.deliveryId, status: 'acknowledged' }]
    )
    for (const id of expectedIds) {
      expect(db.getMessageById(id)?.read).toBe(1)
    }
    db.close()
  })

  it('replays one outstanding Delivery across restart and wakes a filtered waiter once', async () => {
    vi.useFakeTimers()
    const fixture = createDatabase('orca-sta-4325-restart-')
    const firstRuntime = createRuntime(fixture.db)
    const run = fixture.db.createRun({
      objective: 'STA-4325 restart',
      coordinatorHandle: TERMINAL_HANDLE,
      coordinatorPaneKey: PANE_KEY
    })
    const status = fixture.db.insertMessage({
      from: 'term_worker',
      to: `run:${run.id}`,
      subject: 'survive restart',
      type: 'status',
      runId: run.id,
      deliveryContract: 'current_delivery'
    })
    await driveToLiveIdle(firstRuntime.runtime)
    const beforeRestart = await check(firstRuntime.runtime)
    expect(beforeRestart.messages.map((message) => message.id)).toEqual([status.id])
    fixture.db.close()

    const reopened = new OrchestrationDb(fixture.path)
    const restarted = createRuntime(reopened, REMINTED_TERMINAL_HANDLE)
    await driveToLiveIdle(restarted.runtime)
    const afterRestart = await check(restarted.runtime, { terminal: REMINTED_TERMINAL_HANDLE })
    expect(afterRestart).toMatchObject({ deliveryId: beforeRestart.deliveryId, replayed: true })
    expect(afterRestart.messages.map((message) => message.id)).toEqual([status.id])
    expect(sqliteFor(reopened).prepare('SELECT id FROM deliveries').all()).toEqual([
      { id: beforeRestart.deliveryId }
    ])

    await check(restarted.runtime, {
      terminal: REMINTED_TERMINAL_HANDLE,
      ack: afterRestart.deliveryId
    })
    const waiting = check(restarted.runtime, {
      terminal: REMINTED_TERMINAL_HANDLE,
      wait: true,
      types: 'worker_done',
      timeoutMs: 5_000
    })
    const internals = restarted.runtime as unknown as {
      messageWaitersByHandle: Map<string, Set<unknown>>
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (internals.messageWaitersByHandle.has(`run:${run.id}`)) {
        break
      }
      await Promise.resolve()
    }
    expect(internals.messageWaitersByHandle.has(`run:${run.id}`)).toBe(true)

    const done = reopened.insertMessage({
      from: 'term_worker',
      to: `run:${run.id}`,
      subject: 'done after restart',
      type: 'worker_done',
      runId: run.id,
      deliveryContract: 'current_delivery'
    })
    restarted.runtime.notifyMessageArrived(done.to_handle, done.type)
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(waiting).resolves.toMatchObject({
      runId: run.id,
      count: 1,
      messages: [expect.objectContaining({ id: done.id })]
    })
    expect(pointerPayloads(restarted.write)).toEqual([
      expect.stringContaining('1 orchestration message')
    ])
    reopened.close()
  })

  it('routes the complete legacy direct backlog when takeover forgets its old handle', () => {
    const created = createLegacyStorageCutoverFixture()
    temporaryDirectories.push(created.tempDir)
    const db = new OrchestrationDb(created.fixture.dbPath)
    const runId = db.getLegacyAdoption()!.adopted_run_id
    for (let index = 0; index < 125; index += 1) {
      db.insertMessage({
        from: 'term_legacy_worker',
        to: 'term_legacy_coord',
        subject: `backlog ${index}`,
        type: 'status',
        runId,
        deliveryContract: 'legacy_direct'
      })
    }
    const plan = sqliteFor(db)
      .prepare(
        `EXPLAIN QUERY PLAN UPDATE messages SET to_handle = ?
         WHERE run_id = ? AND to_handle = ? AND read = 0
           AND delivery_contract = 'legacy_direct'`
      )
      .all(`run:${runId}`, runId, 'term_legacy_coord') as { detail: string }[]
    expect(plan.map((row) => row.detail).join(' ')).toContain('idx_messages_delivery_contract')

    db.bindRun({
      runId,
      coordinatorHandle: REMINTED_TERMINAL_HANDLE,
      coordinatorPaneKey: PANE_KEY,
      takeoverLegacy: true
    })
    expect(
      sqliteFor(db)
        .prepare(
          `SELECT to_handle, COUNT(*) AS count FROM messages
           WHERE run_id = ? AND subject LIKE 'backlog %'
           GROUP BY to_handle ORDER BY to_handle`
        )
        .all(runId)
    ).toEqual([{ to_handle: `run:${runId}`, count: 125 }])
    db.close()
  })

  it('keeps repaired committed mail after takeover and restart', async () => {
    const created = createLegacyStorageCutoverFixture()
    temporaryDirectories.push(created.tempDir)
    const db = new OrchestrationDb(created.fixture.dbPath)
    const runId = db.getLegacyAdoption()!.adopted_run_id
    const done = db.insertMessage({
      from: 'term_legacy_worker',
      to: 'term_legacy_coord',
      subject: 'committed before rebind',
      type: 'worker_done',
      runId,
      deliveryContract: 'legacy_direct'
    })
    db.commitLegacyCompatibilityPrincipal({
      runId,
      role: 'coordinator',
      hostScope: JSON.stringify({ kind: 'local', hostId: 'local' }),
      terminalHandle: 'term_legacy_coord',
      paneKey: PANE_KEY,
      launchTokenHash: 'launch-hash',
      processIncarnation: 'process-1'
    })
    db.bindRun({
      runId,
      coordinatorHandle: REMINTED_TERMINAL_HANDLE,
      coordinatorPaneKey: PANE_KEY,
      takeoverLegacy: true
    })
    expect(db.getMessageById(done.id)?.to_handle).toBe(`run:${runId}`)
    sqliteFor(db)
      .prepare('UPDATE messages SET read = 1 WHERE run_id = ? AND id <> ?')
      .run(runId, done.id)
    db.close()

    const reopened = new OrchestrationDb(created.fixture.dbPath)
    const restarted = createRuntime(reopened, REMINTED_TERMINAL_HANDLE)
    await driveToLiveIdle(restarted.runtime)
    const checked = await check(restarted.runtime, { terminal: REMINTED_TERMINAL_HANDLE })

    expect(checked).toMatchObject({
      runId,
      count: 1,
      messages: [expect.objectContaining({ id: done.id })]
    })
    expect(reopened.getMessageById(done.id)?.to_handle).toBe(`run:${runId}`)
    reopened.close()
  })
})
