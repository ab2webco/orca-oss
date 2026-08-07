import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from './db'
import { expireDueDispatchDeadlines } from './dispatch-deadline-monitor'
import { DISPATCH_FIRST_SIGNAL_DEADLINE_MS } from './dispatch-lifecycle-deadline'

const WORKER_PANE = 'tab_worker:22222222-2222-4222-8222-222222222222'

describe('dispatch first-signal deadline (ORCA-191)', () => {
  let db: OrchestrationDb | undefined
  const tempDirs: string[] = []

  afterEach(() => {
    db?.close()
    db = undefined
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function createDb(path = ':memory:'): OrchestrationDb {
    db = new OrchestrationDb(path)
    return db
  }

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'orca-191-'))
    tempDirs.push(dir)
    return join(dir, 'orchestration.db')
  }

  function createRun(d: OrchestrationDb) {
    return d.createRun({
      objective: 'first-signal deadline',
      coordinatorHandle: 'term_coord',
      coordinatorPaneKey: 'tab_coord:11111111-1111-4111-8111-111111111111'
    })
  }

  /** Local/SSH worker-start through its real transitions, up to input_accepted. */
  function startReadyWorker(
    d: OrchestrationDb,
    options: { runId: string; hostScope?: string | null } = { runId: '' }
  ) {
    const task = d.createTask({ spec: 'deliver the preamble', runId: options.runId })
    const started = d.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { topology: 'current', agent: 'codex' }
    })
    const capability = d.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: 'term_worker',
      paneKey: WORKER_PANE,
      processIncarnation: 'runtime:pty:1',
      worktreeId: 'repo::worktree',
      setupState: 'not_applicable',
      effects: [{ kind: 'terminal', action: 'created', id: 'term_worker' }],
      hostScope: options.hostScope ?? null,
      terminalOwnership: 'created'
    })
    d.markWorkerDispatchReady(started.dispatch.id)
    return { task, dispatchId: started.dispatch.id, capability }
  }

  /** Federated worker-start through its real transitions, up to remote_input_accepted. */
  function startFederatedReadyWorker(d: OrchestrationDb, runId: string) {
    const task = d.createTask({ spec: 'federated worker', runId })
    const started = d.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { topology: 'current', agent: 'codex' },
      federation: {
        environmentId: 'env_remote',
        environmentName: 'build-box',
        peerFingerprint: 'fp_peer',
        protocolVersion: 3
      }
    })
    d.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: 'term_remote',
      paneKey: WORKER_PANE,
      processIncarnation: 'runtime:pty:9',
      worktreeId: 'repo::worktree',
      setupState: 'not_applicable',
      effects: [],
      terminalOwnership: 'created'
    })
    d.reconcileFederatedWorkerStart({
      dispatchId: started.dispatch.id,
      state: 'ready',
      stage: 'remote_input_accepted'
    })
    expect(d.getDispatchContextById(started.dispatch.id)?.monitor_deadline_at).not.toBeNull()
    return { task, dispatchId: started.dispatch.id }
  }

  function fakeNotifier() {
    return { notifyMessageArrived: vi.fn() }
  }

  function pastDeadline(): Date {
    return new Date(Date.now() + DISPATCH_FIRST_SIGNAL_DEADLINE_MS + 60_000)
  }

  it('arms only once the capability-bearing attempt is dispatched, not while topology is pending', () => {
    const d = createDb()
    const run = createRun(d)
    const task = d.createTask({ spec: 'pending topology', runId: run.id })
    const started = d.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { topology: 'current', agent: 'codex' }
    })

    expect(d.getDispatchContextById(started.dispatch.id)?.status).toBe('pending')
    expect(d.armDispatchLifecycleDeadline(started.dispatch.id)).toBe(false)
    expect(d.getDispatchContextById(started.dispatch.id)?.monitor_deadline_at).toBeNull()

    d.prepareStartingWorkerAuthority({
      dispatchId: started.dispatch.id,
      handle: 'term_worker',
      paneKey: WORKER_PANE,
      processIncarnation: 'runtime:pty:1',
      worktreeId: 'repo::worktree',
      setupState: 'not_applicable',
      effects: [],
      terminalOwnership: 'created'
    })
    d.markWorkerDispatchReady(started.dispatch.id)
    expect(d.getDispatchContextById(started.dispatch.id)?.monitor_deadline_at).not.toBeNull()
  })

  it('never arms a manual dispatch that carries no capability', () => {
    const d = createDb()
    const run = createRun(d)
    const task = d.createTask({ spec: 'tracking only', runId: run.id })
    const ctx = d.createDispatchContext(task.id, 'term_manual', WORKER_PANE)

    expect(ctx.status).toBe('dispatched')
    expect(d.armDispatchLifecycleDeadline(ctx.id)).toBe(false)
    expect(d.listExpiredDispatchDeadlines(pastDeadline().toISOString())).toEqual([])
    expect(expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())).toEqual([])
    expect(d.getDispatchContextById(ctx.id)?.status).toBe('dispatched')
  })

  it('grandfathers a capability-bearing row an older runtime left dispatched without a deadline', () => {
    const d = createDb()
    const run = createRun(d)
    const task = d.createTask({ spec: 'legacy row', runId: run.id })
    const ctx = d.createDispatchContext(task.id, 'term_legacy', WORKER_PANE)
    d.mintDispatchCapability({
      dispatchId: ctx.id,
      paneKey: WORKER_PANE,
      processIncarnation: 'runtime:pty:legacy'
    })

    expect(d.getDispatchContextById(ctx.id)).toMatchObject({
      status: 'dispatched',
      monitor_deadline_at: null
    })
    expect(expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())).toEqual([])
    expect(d.getDispatchContextById(ctx.id)?.status).toBe('dispatched')
  })

  it('fails the expired attempt, revokes its capability, blocks the task and mails the Run', () => {
    const d = createDb()
    const run = createRun(d)
    const { task, dispatchId } = startReadyWorker(d, { runId: run.id })
    const notifier = fakeNotifier()

    const expired = expireDueDispatchDeadlines(d, notifier, pastDeadline())

    expect(expired).toEqual([
      expect.objectContaining({ dispatchId, taskId: task.id, runId: run.id })
    ])
    const dispatch = d.getDispatchContextById(dispatchId)
    expect(dispatch?.status).toBe('failed')
    expect(dispatch?.capability_revoked_at).not.toBeNull()
    // Why: not failDispatch() — the circuit-breaker budget must not be burned by
    // an ambiguous delivery, and the Task must not return to 'ready'.
    expect(dispatch?.failure_count).toBe(0)
    expect(d.getTask(task.id)?.status).toBe('blocked')
    expect(d.getWorkerDispatch(dispatchId)).toMatchObject({
      state: 'failed',
      stage: 'first_signal_deadline_expired'
    })

    const mailbox = d.getRunMailboxHistory(run.id, 100)
    const mail = mailbox.find((message) => message.to_handle === `run:${run.id}`)
    expect(mail).toMatchObject({ priority: 'high', read: 0 })
    expect(mail?.body).toContain(dispatchId)
    expect(mail?.body).toContain('term_worker')
    expect(notifier.notifyMessageArrived).toHaveBeenCalledWith(`run:${run.id}`, 'status')

    const delivery = d.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: run.consumer_generation
    })
    expect(delivery?.messages.map((message) => message.id)).toContain(mail?.id)
  })

  it('names the SSH host scope in the failure reason', () => {
    const d = createDb()
    const run = createRun(d)
    const { dispatchId } = startReadyWorker(d, { runId: run.id, hostScope: 'ssh:build-box' })

    const [expired] = expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())

    expect(expired.reason).toContain('ssh:build-box')
    expect(d.getDispatchContextById(dispatchId)?.last_failure).toContain('ssh:build-box')
  })

  it('does not fail a worker that asked a question before its first heartbeat', () => {
    const d = createDb()
    const run = createRun(d)
    const { dispatchId } = startReadyWorker(d, { runId: run.id })

    d.createQuestion({
      runId: run.id,
      dispatchId,
      askerHandle: 'term_worker',
      question: 'Which base branch?'
    })

    expect(d.getDispatchContextById(dispatchId)?.first_lifecycle_signal_at).not.toBeNull()
    expect(expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())).toEqual([])
    expect(d.getDispatchContextById(dispatchId)?.status).toBe('dispatched')
  })

  it('does not fail a worker whose heartbeat arrived before the deadline', () => {
    const d = createDb()
    const run = createRun(d)
    const { dispatchId } = startReadyWorker(d, { runId: run.id })

    const beat = new Date().toISOString()
    d.recordHeartbeat(dispatchId, beat)

    expect(d.getDispatchContextById(dispatchId)?.first_lifecycle_signal_at).toBe(beat)
    expect(expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())).toEqual([])
    expect(d.getDispatchContextById(dispatchId)?.status).toBe('dispatched')
  })

  it('accepts a federated first signal imported from the worker host', () => {
    const d = createDb()
    const run = createRun(d)
    const { dispatchId } = startFederatedReadyWorker(d, run.id)

    d.importFederatedRelayItem({
      dispatchId,
      sequence: 1,
      message: {
        id: 'msg_remote_beat',
        runId: run.id,
        from: `dispatch:${dispatchId}`,
        to: `run:${run.id}`,
        subject: 'alive',
        body: '',
        type: 'heartbeat',
        priority: 'normal'
      },
      lifecycle: { kind: 'heartbeat', at: new Date().toISOString() }
    })

    expect(expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())).toEqual([])
    expect(d.getDispatchContextById(dispatchId)?.status).toBe('dispatched')
  })

  it('names the federated environment in the failure reason', () => {
    const d = createDb()
    const run = createRun(d)
    const { dispatchId } = startFederatedReadyWorker(d, run.id)

    const [expired] = expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())

    expect(expired.dispatchId).toBe(dispatchId)
    expect(expired.reason).toContain('build-box')
  })

  it('accepts a federated escalation as the first lifecycle signal', () => {
    const d = createDb()
    const run = createRun(d)
    const { dispatchId } = startFederatedReadyWorker(d, run.id)

    d.importFederatedRelayItem({
      dispatchId,
      sequence: 1,
      message: {
        id: 'msg_remote_escalation',
        runId: run.id,
        from: `dispatch:${dispatchId}`,
        to: `run:${run.id}`,
        subject: 'blocked on credentials',
        body: '',
        type: 'escalation',
        priority: 'high'
      },
      lifecycle: { kind: 'none' }
    })

    expect(d.getDispatchContextById(dispatchId)?.first_lifecycle_signal_at).not.toBeNull()
    expect(expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())).toEqual([])
  })

  it('ignores a late heartbeat for an already-expired dispatch', () => {
    const d = createDb()
    const run = createRun(d)
    const { dispatchId } = startReadyWorker(d, { runId: run.id })
    expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())

    d.recordHeartbeat(dispatchId, new Date().toISOString())

    const dispatch = d.getDispatchContextById(dispatchId)
    expect(dispatch?.status).toBe('failed')
    expect(dispatch?.last_heartbeat_at).toBeNull()
    expect(dispatch?.first_lifecycle_signal_at).toBeNull()
  })

  it('expires exactly once even if the scan runs again', () => {
    const d = createDb()
    const run = createRun(d)
    const { dispatchId } = startReadyWorker(d, { runId: run.id })

    expect(expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())).toHaveLength(1)
    expect(expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())).toEqual([])
    expect(
      d.getRunMailboxHistory(run.id, 100).filter((message) => message.priority === 'high')
    ).toHaveLength(1)
    expect(d.getDispatchContextById(dispatchId)?.status).toBe('failed')
  })

  it('re-arms an armed deadline after a runtime restart', () => {
    const path = tempDbPath()
    const first = createDb(path)
    const run = createRun(first)
    const { dispatchId } = startReadyWorker(first, { runId: run.id })
    expect(first.countArmedDispatchDeadlines()).toBe(1)
    first.close()

    const restarted = createDb(path)
    expect(restarted.countArmedDispatchDeadlines()).toBe(1)
    expect(expireDueDispatchDeadlines(restarted, fakeNotifier(), pastDeadline())).toHaveLength(1)
    expect(restarted.getDispatchContextById(dispatchId)?.status).toBe('failed')
    expect(restarted.countArmedDispatchDeadlines()).toBe(0)
  })

  it('leaves the worker terminal alive and never reinjects', () => {
    const d = createDb()
    const run = createRun(d)
    const { dispatchId } = startReadyWorker(d, { runId: run.id })

    expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())

    const resource = d.getWorkerTerminalResourceByOwner(dispatchId)
    // Why: the pane stays open and unreleased — retry is explicit and human-initiated.
    expect(resource).toMatchObject({
      release_state: 'not_requested',
      ownership_state: 'owned',
      terminal_handle: 'term_worker'
    })
    expect(d.listWorkerTerminalReleaseBacklog()).toEqual([])
  })

  it('leaves the accepted Dispatch receipt intact so --retry-of can replace it', () => {
    const d = createDb()
    const run = createRun(d)
    const { task, dispatchId } = startReadyWorker(d, { runId: run.id })
    expireDueDispatchDeadlines(d, fakeNotifier(), pastDeadline())

    const replacement = d.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { topology: 'current', agent: 'codex' },
      retryOf: dispatchId
    })

    expect(replacement.dispatch.id).not.toBe(dispatchId)
    expect(replacement.worker.state).toBe('starting')
  })
})
