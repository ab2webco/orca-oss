import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationDb } from '../../orchestration/db'
import { expireDueDispatchDeadlines } from '../../orchestration/dispatch-deadline-monitor'
import { DISPATCH_FIRST_SIGNAL_DEADLINE_MS } from '../../orchestration/dispatch-lifecycle-deadline'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../shared/protocol-version'
import { RpcDispatcher } from '../dispatcher'
import { ORCHESTRATION_METHODS } from './orchestration'

const COORDINATOR_HANDLE = 'term_coord'
const COORDINATOR_PANE = 'tab_coord:11111111-1111-4111-8111-111111111111'
const WORKER_HANDLE = 'term_worker'
const WORKER_PANE = 'tab_worker:22222222-2222-4222-8222-222222222222'

describe('dispatch first-signal deadline over RPC (ORCA-191)', () => {
  const tempDirs: string[] = []
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const database of databases.splice(0)) {
      database.close()
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function createHarness() {
    const dir = mkdtempSync(join(tmpdir(), 'orca-191-rpc-'))
    tempDirs.push(dir)
    const db = new OrchestrationDb(join(dir, 'orchestration.db'))
    databases.push(db)
    const runtime = new OrcaRuntimeService()
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === WORKER_HANDLE
        ? WORKER_PANE
        : handle === COORDINATOR_HANDLE
          ? COORDINATOR_PANE
          : null
    )
    vi.spyOn(runtime, 'getTerminalProcessIncarnation').mockImplementation((handle) =>
      handle === WORKER_HANDLE ? 'runtime:pty:1' : null
    )
    vi.spyOn(runtime, 'authenticateOrchestrationSender').mockImplementation((claim) => ({
      handle: claim.claimedHandle as string,
      paneKey: claim.claimedHandle === WORKER_HANDLE ? WORKER_PANE : COORDINATOR_PANE
    }))
    const notify = vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
    const run = db.createRun({
      objective: 'escalation before heartbeat',
      coordinatorHandle: COORDINATOR_HANDLE,
      coordinatorPaneKey: COORDINATOR_PANE
    })
    const task = db.createTask({ spec: 'escalate first', runId: run.id })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { topology: 'current', agent: 'codex' }
    })
    db.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: WORKER_HANDLE,
      paneKey: WORKER_PANE,
      processIncarnation: 'runtime:pty:1',
      worktreeId: 'repo::worktree',
      setupState: 'not_applicable',
      effects: [],
      terminalOwnership: 'created'
    })
    db.markWorkerDispatchReady(started.dispatch.id)
    return {
      db,
      runtime,
      notify,
      run,
      task,
      dispatchId: started.dispatch.id,
      dispatcher: new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS })
    }
  }

  function pastDeadline(): Date {
    return new Date(Date.now() + DISPATCH_FIRST_SIGNAL_DEADLINE_MS + 60_000)
  }

  it('treats an escalation from the assignee pane as the first lifecycle signal', async () => {
    const harness = createHarness()

    const response = await harness.dispatcher.dispatch({
      id: 'escalate-1',
      authToken: 'caller-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      method: 'orchestration.send',
      params: {
        from: WORKER_HANDLE,
        senderPaneKey: WORKER_PANE,
        to: `run:${harness.run.id}`,
        subject: 'blocked on credentials',
        type: 'escalation',
        payload: JSON.stringify({ taskId: harness.task.id, dispatchId: harness.dispatchId })
      }
    })

    expect(response).toMatchObject({ ok: true })
    expect(
      harness.db.getDispatchContextById(harness.dispatchId)?.first_lifecycle_signal_at
    ).not.toBeNull()
    expect(expireDueDispatchDeadlines(harness.db, harness.runtime, pastDeadline())).toEqual([])
    expect(harness.db.getDispatchContextById(harness.dispatchId)?.status).toBe('dispatched')
  })

  it('ignores an escalation sent from another pane', async () => {
    const harness = createHarness()

    const response = await harness.dispatcher.dispatch({
      id: 'escalate-2',
      authToken: 'caller-token',
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      method: 'orchestration.send',
      params: {
        from: COORDINATOR_HANDLE,
        senderPaneKey: COORDINATOR_PANE,
        to: `run:${harness.run.id}`,
        subject: 'not the worker',
        type: 'escalation',
        payload: JSON.stringify({ taskId: harness.task.id, dispatchId: harness.dispatchId })
      }
    })

    expect(response).toMatchObject({ ok: true })
    expect(
      harness.db.getDispatchContextById(harness.dispatchId)?.first_lifecycle_signal_at
    ).toBeNull()
    expect(expireDueDispatchDeadlines(harness.db, harness.runtime, pastDeadline())).toHaveLength(1)
  })
})
