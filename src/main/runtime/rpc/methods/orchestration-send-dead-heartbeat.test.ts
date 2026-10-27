import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { OrchestrationDb } from '../../orchestration/db'
import type { RpcContext } from '../core'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'

describe('orchestration.send heartbeats from a dead member (ORCA-677)', () => {
  const h = createOrchestrationRpcHarness()
  let db: OrchestrationDb
  let runtime: OrcaRuntimeService
  let ctx: RpcContext

  function setup(): void {
    ;({ db, runtime, ctx } = h.setup())
  }

  afterEach(() => {
    h.cleanup()
    vi.restoreAllMocks()
  })

  async function call(name: string, params: Record<string, unknown>) {
    return h.call(name, params, ctx)
  }

  // ORCA-677: a shell loop that outlived its member kept beating for dead dispatches.
  const PANE = 'tab_worker:leaf_worker'

  function backdateDispatch(dispatchId: string, minutesAgo: number): void {
    const sqlite = (
      db as unknown as { db: { prepare: (q: string) => { run: (...a: unknown[]) => void } } }
    ).db
    sqlite
      .prepare('UPDATE dispatch_contexts SET dispatched_at = ? WHERE id = ?')
      .run(new Date(Date.now() - minutesAgo * 60_000).toISOString(), dispatchId)
  }

  function staleIds(): string[] {
    return db
      .getStaleDispatches(new Date(Date.now() - 10 * 60_000).toISOString())
      .map((row) => row.id)
  }

  async function beat(dispatchId: string) {
    return (await call('orchestration.send', {
      from: 'term_worker',
      to: 'term_coord',
      subject: 'alive',
      type: 'heartbeat',
      senderPaneKey: PANE,
      payload: JSON.stringify({ dispatchId })
    })) as { message: { id: string }; lifecycle?: { action: string; code: string } }
  }

  it('rejects and logs a heartbeat for a failed dispatch, leaving the rows unchanged', async () => {
    setup()
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', PANE)
    db.failDispatch(dispatch.id, 'worker exited with code 1')
    const before = db.getDispatchContextById(dispatch.id)
    const taskBefore = db.getTask(task.id)
    const notify = vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await beat(dispatch.id)

    expect(result.lifecycle).toMatchObject({ action: 'rejected', code: 'inactive_dispatch' })
    expect(db.getDispatchContextById(dispatch.id)).toEqual(before)
    expect(db.getTask(task.id)).toEqual(taskBefore)
    expect(notify).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[orchestration] heartbeat rejected'),
      expect.objectContaining({ dispatchId: dispatch.id })
    )
  })

  it('rejects a heartbeat whose terminal is gone, so the stale detector still flags it', async () => {
    setup()
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', PANE)
    backdateDispatch(dispatch.id, 20)
    const notify = vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const liveIncarnation = vi.mocked(runtime.getTerminalProcessIncarnation)
    liveIncarnation.mockReturnValue(null)

    const ghost = await beat(dispatch.id)

    expect(ghost.lifecycle).toMatchObject({ action: 'rejected', code: 'sender_not_assignee' })
    expect(db.getDispatchContextById(dispatch.id)?.last_heartbeat_at).toBeNull()
    expect(db.getMessageById(ghost.message.id)).toMatchObject({ read: 1 })
    expect(notify).not.toHaveBeenCalled()
    expect(staleIds()).toContain(dispatch.id)

    // Control: the same beat from the live pane is recorded and clears the stale flag.
    liveIncarnation.mockReturnValue('runtime_test:term_worker:1')
    const live = await beat(dispatch.id)
    expect(live.lifecycle).toBeUndefined()
    expect(db.getDispatchContextById(dispatch.id)?.last_heartbeat_at).not.toBeNull()
    expect(staleIds()).not.toContain(dispatch.id)
  })

  it('does not reopen a silence-failed dispatch for a remounted process on the same pane', async () => {
    setup()
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker', PANE)
    db.mintDispatchCapability({
      dispatchId: dispatch.id,
      paneKey: PANE,
      processIncarnation: 'runtime_test:term_worker:1'
    })
    db.armDispatchLifecycleDeadline(dispatch.id, 0)
    db.expireDispatchLifecycleDeadline({
      dispatchId: dispatch.id,
      nowIso: new Date(Date.now() + 60_000).toISOString(),
      reason: 'no lifecycle signal',
      subject: 'Dispatch failed: no lifecycle signal'
    })
    vi.spyOn(runtime, 'notifyMessageArrived').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(runtime.getTerminalProcessIncarnation).mockReturnValue('runtime_test:term_worker:2')

    const result = await beat(dispatch.id)

    expect(result.lifecycle).toMatchObject({ action: 'rejected' })
    expect(db.getDispatchContextById(dispatch.id)?.status).toBe('failed')
  })

  it('records a live worker whose handle was reminted, judged by its pane, not the stale claim', async () => {
    setup()
    const task = db.createTask({ spec: 'work' })
    const dispatch = db.createDispatchContext(task.id, 'term_worker_before', PANE)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(runtime, 'getAgentStatusTerminalHandleForPaneKey').mockImplementation((paneKey) =>
      paneKey === PANE ? 'term_worker_after' : undefined
    )
    vi.mocked(runtime.getTerminalProcessIncarnation).mockImplementation((handle) =>
      handle === 'term_worker_after' ? 'runtime_test:term_worker_after:1' : null
    )

    const result = (await call('orchestration.send', {
      from: 'term_worker_before',
      to: 'term_coord',
      subject: 'alive',
      type: 'heartbeat',
      senderPaneKey: PANE,
      payload: JSON.stringify({ dispatchId: dispatch.id })
    })) as { lifecycle?: { action: string } }

    expect(result.lifecycle).toBeUndefined()
    expect(db.getDispatchContextById(dispatch.id)?.last_heartbeat_at).not.toBeNull()
  })
})
