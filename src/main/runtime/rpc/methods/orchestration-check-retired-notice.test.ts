import { afterEach, describe, expect, it } from 'vitest'
import type Database from '../../../sqlite/sync-database'
import { createOrchestrationRpcHarness } from './orchestration-rpc-test-harness'

type CheckResult = {
  count: number
  messages: { id: string }[]
  retired?: { count: number; unverified: { ticket: string; pr: string | null }[] }
}

describe('orchestration.check after a lead change (ORCA-824)', () => {
  const h = createOrchestrationRpcHarness()

  afterEach(() => {
    h.cleanup()
  })

  it('tells the new lead how much it retired instead of replaying it', async () => {
    const { db, ctx, activeRunId } = h.setup()
    const task = db.createTask({ spec: 'member work' })
    const dispatch = db.createDispatchContext(task.id, 'term_member')
    db.insertMessage({
      from: 'term_member',
      to: `run:${activeRunId}`,
      subject: 'PR merged',
      type: 'worker_done',
      payload: JSON.stringify({ dispatchId: dispatch.id })
    })
    db.completeDispatch(dispatch.id)
    const sqlite = (db as unknown as { db: Database.Database }).db
    // Why: the previous lead's era ends when the current one claims the Run.
    sqlite.prepare("UPDATE messages SET created_at = '2026-10-26 16:00:00'").run()
    sqlite.prepare("UPDATE runs SET updated_at = '2026-10-27 13:32:02'").run()

    const first = (await h.call(
      'orchestration.check',
      { terminal: 'term_coord' },
      ctx
    )) as CheckResult
    const second = (await h.call(
      'orchestration.check',
      { terminal: 'term_coord' },
      ctx
    )) as CheckResult

    expect(first).toMatchObject({ count: 0, retired: { count: 1, unverified: [] } })
    expect(second.count).toBe(0)
    expect(second.retired).toBeUndefined()
  })
})
