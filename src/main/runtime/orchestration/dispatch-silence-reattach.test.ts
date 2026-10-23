import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'
import { expireDueDispatchDeadlines } from './dispatch-deadline-monitor'
import type { DispatchActivityObservation } from './dispatch-activity-observation'
import { reattachSilentFailures } from './dispatch-silence-reattach'

const PANE = 'tab_w:33333333-3333-4333-8333-333333333333'
const quiet = { notifyMessageArrived: () => {} }

// ORCA-658: the deadline guessed the worker dead; a pane still working proves otherwise.
describe('reattachSilentFailures (ORCA-658)', () => {
  let db: OrchestrationDb | undefined

  afterEach(() => {
    db?.close()
    db = undefined
  })

  function open(): OrchestrationDb {
    db ??= new OrchestrationDb(':memory:')
    return db
  }

  function liveDispatch(spec: string, handle: string): { taskId: string; dispatchId: string } {
    const d = open()
    const task = d.createTask({ spec })
    const dispatch = d.createDispatchContext(task.id, handle, PANE)
    d.mintDispatchCapability({ dispatchId: dispatch.id, paneKey: PANE, processIncarnation: 'inc' })
    return { taskId: task.id, dispatchId: dispatch.id }
  }

  function failedBySilence(spec: string, handle = 'term_worker') {
    const live = liveDispatch(spec, handle)
    const d = open()
    d.armDispatchLifecycleDeadline(live.dispatchId, 0)
    expect(
      d.expireDispatchLifecycleDeadline({
        dispatchId: live.dispatchId,
        nowIso: new Date(Date.now() + 60_000).toISOString(),
        reason: 'no lifecycle signal',
        subject: 'Dispatch failed: no lifecycle signal'
      }).expired
    ).toBe(true)
    return live
  }

  const workingAfterFailure: DispatchActivityObservation = {
    hook: null,
    lastOutputAt: Date.now() + 5_000
  }

  function run(
    observations: Record<string, DispatchActivityObservation>,
    now = new Date(Date.now() + 10_000)
  ) {
    return reattachSilentFailures(
      open(),
      (handle) => observations[handle] ?? { hook: null, lastOutputAt: null },
      quiet,
      now
    )
  }

  function runMail(dispatchId: string) {
    const runId = open().getDispatchContextById(dispatchId)?.run_id
    return open().getAllMessages(`run:${runId}`, 100)
  }

  function notices(dispatchId: string, reason: string) {
    return runMail(dispatchId).filter((message) => {
      const payload = message.payload ? JSON.parse(message.payload) : null
      return payload?.dispatchId === dispatchId && payload?.reason === reason
    })
  }

  it('reattaches a worker that keeps working, and the spent deadline does not fail it again', () => {
    const { taskId, dispatchId } = failedBySilence('Work on ORCA-658')

    expect(run({ term_worker: workingAfterFailure })).toEqual([
      { dispatchId, action: 'reattached' }
    ])
    expireDueDispatchDeadlines(open(), quiet, new Date(Date.now() + 120_000))

    const row = open().getDispatchContextById(dispatchId)
    expect(row).toMatchObject({ status: 'dispatched', capability_revoked_at: null })
    expect(open().getTask(taskId)?.status).toBe('dispatched')
    expect(notices(dispatchId, 'reattached_by_activity')).toHaveLength(1)
  })

  // The ticket's case: a turn running for minutes prints nothing, and only its working hook shows it.
  it('reattaches a member mid-turn whose hook says working while its terminal stayed quiet', () => {
    const { taskId, dispatchId } = failedBySilence('Work on ORCA-658')
    const midTurn: DispatchActivityObservation = {
      hook: { status: 'working', updatedAt: Date.now() - 12 * 60_000 },
      lastOutputAt: null
    }

    expect(run({ term_worker: midTurn })).toEqual([{ dispatchId, action: 'reattached' }])
    expect(open().getDispatchContextById(dispatchId)?.status).toBe('dispatched')
    expect(open().getTask(taskId)?.status).toBe('dispatched')
  })

  it('never reattaches a dispatch failed on evidence', () => {
    const { dispatchId } = liveDispatch('Work on ORCA-658', 'term_worker')
    open().failDispatch(dispatchId, 'worker exited with code 1')

    expect(run({ term_worker: workingAfterFailure })).toEqual([])
    expect(open().getDispatchContextById(dispatchId)?.status).toBe('failed')
  })

  it('keeps a failure with no activity after it, or an unknown terminal, failed and quiet', () => {
    const before = failedBySilence('Work on ORCA-1', 'term_before')
    const unknown = failedBySilence('Work on ORCA-2', 'term_gone')

    expect(run({ term_before: { hook: null, lastOutputAt: Date.now() - 120_000 } })).toEqual([])
    expect(open().getDispatchContextById(before.dispatchId)?.status).toBe('failed')
    expect(open().getDispatchContextById(unknown.dispatchId)?.status).toBe('failed')
    // Only the two deadline failures, nothing this pass added.
    expect(runMail(before.dispatchId)).toHaveLength(2)
  })

  it('reports a relaunched task as orphaned, once, instead of giving it two live members', () => {
    const { taskId, dispatchId } = failedBySilence('Work on ORCA-658')
    // A retry: the blocked task goes back to ready and gets a new dispatch.
    open().updateTaskStatus(taskId, 'ready')
    const relaunch = open().createDispatchContext(taskId, 'term_relaunch', PANE)

    expect(run({ term_worker: workingAfterFailure })).toEqual([{ dispatchId, action: 'orphaned' }])
    expect(run({ term_worker: workingAfterFailure })).toEqual([])

    expect(open().getDispatchContextById(dispatchId)?.status).toBe('failed')
    expect(open().getDispatchContextById(relaunch.id)?.status).toBe('dispatched')
    expect(notices(dispatchId, 'orphaned_still_working')).toHaveLength(1)
    expect(notices(dispatchId, 'reattached_by_activity')).toHaveLength(0)
  })

  it('reports it orphaned when another live member already holds the same ticket', () => {
    const { dispatchId } = failedBySilence('Work on ORCA-658')
    liveDispatch('Work on ORCA-658 again', 'term_other')

    expect(run({ term_worker: workingAfterFailure })).toEqual([{ dispatchId, action: 'orphaned' }])
    expect(open().getDispatchContextById(dispatchId)?.status).toBe('failed')
  })

  it('stops watching a failure whose terminal showed nothing for 30 minutes', () => {
    const { dispatchId } = failedBySilence('Work on ORCA-658')

    expect(
      run({ term_worker: workingAfterFailure }, new Date(Date.now() + 31 * 60_000)).length
    ).toBe(0)
    expect(open().getDispatchContextById(dispatchId)?.status).toBe('failed')
  })
})
