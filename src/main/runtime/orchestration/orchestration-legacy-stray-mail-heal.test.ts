import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from '../../sqlite/sync-database'
import { LEGACY_RUN_ID, OrchestrationDb } from './db'

const LEAD_HANDLE = 'term_lead'

describe('OrchestrationDb stray legacy mail (ORCA-726)', () => {
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

  // A DB that already went through a legacy adoption, so a later stray re-triggers it.
  function openAdoptedDb(): { dbPath: string; first: OrchestrationDb } {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-stray-legacy-'))
    const dbPath = join(tempDir, 'orchestration.db')
    const seed = new OrchestrationDb(dbPath)
    seed.insertMessage({ from: 'term_old', to: 'term_old_coord', subject: 'pre-run mail' })
    seed.close()
    const first = new OrchestrationDb(dbPath)
    expect(first.getLegacyAdoption()).toBeDefined()
    return { dbPath, first }
  }

  function createLeadRun(target: OrchestrationDb, paneSuffix: string) {
    return target.createRun({
      objective: 'lead',
      coordinatorHandle: LEAD_HANDLE,
      coordinatorPaneKey: `tab_${paneSuffix}:11111111-1111-4111-8111-11111111111${paneSuffix}`
    })
  }

  function insertStray(target: OrchestrationDb, runId: string, subject: string): string {
    const message = target.insertMessage({
      runId,
      from: 'term_worker',
      to: LEAD_HANDLE,
      subject
    })
    return message.id
  }

  function moveToLegacyRun(dbPath: string, ids: string[]): void {
    const raw = new Database(dbPath)
    const move = raw.prepare('UPDATE messages SET run_id = ? WHERE id = ?')
    for (const id of ids) {
      move.run(LEGACY_RUN_ID, id)
    }
    raw.close()
  }

  it('opens the 2026-10-21 shape and moves each stray into the Run of its Delivery', () => {
    const { dbPath, first } = openAdoptedDb()
    const lead = createLeadRun(first, '1')
    const strays = [
      insertStray(first, lead.id, 'status after ctx_028ddbf112a7'),
      insertStray(first, lead.id, 'status after ctx_1e4ce481939e')
    ]
    first.close()
    moveToLegacyRun(dbPath, strays)
    const delivering = new Database(dbPath)
    delivering
      .prepare(
        'INSERT INTO deliveries (id, run_id, consumer_generation, message_ids) VALUES (?, ?, ?, ?)'
      )
      .run('delivery_lead', lead.id, lead.consumer_generation, JSON.stringify(strays))
    delivering.close()

    db = new OrchestrationDb(dbPath)

    for (const id of strays) {
      expect(db.getMessageById(id)).toMatchObject({
        run_id: lead.id,
        delivery_contract: 'current_delivery'
      })
    }
  })

  it('leaves a stray no Delivery references to the adopted Run', () => {
    const { dbPath, first } = openAdoptedDb()
    const adoptedRunId = first.getLegacyAdoption()?.adopted_run_id
    const lead = createLeadRun(first, '2')
    const stray = insertStray(first, lead.id, 'never delivered')
    first.close()
    moveToLegacyRun(dbPath, [stray])

    db = new OrchestrationDb(dbPath)

    expect(db.getMessageById(stray)?.run_id).toBe(adoptedRunId)
  })

  it('still refuses a stray carried by Deliveries of two different Runs', () => {
    const { dbPath, first } = openAdoptedDb()
    const lead = createLeadRun(first, '3')
    const other = createLeadRun(first, '4')
    const stray = insertStray(first, lead.id, 'carried twice')
    first.close()
    moveToLegacyRun(dbPath, [stray])
    const raw = new Database(dbPath)
    const insert = raw.prepare(
      "INSERT INTO deliveries (id, run_id, consumer_generation, message_ids, status) VALUES (?, ?, ?, ?, 'acknowledged')"
    )
    insert.run('delivery_a', lead.id, lead.consumer_generation, JSON.stringify([stray]))
    insert.run('delivery_b', other.id, other.consumer_generation, JSON.stringify([stray]))
    raw.close()

    const close = vi.spyOn(Database.prototype, 'close')

    expect(() => new OrchestrationDb(dbPath)).toThrow(
      'Legacy orchestration adoption produced inconsistent Run ownership.'
    )
    // Why: getOrchestrationDb retries the open on every call, so a failed open must not leak its handle.
    expect(close).toHaveBeenCalledTimes(1)
    close.mockRestore()
  })

  it('refuses new mail without a Run once a legacy adoption exists', () => {
    const { dbPath, first } = openAdoptedDb()
    db = first

    expect(() =>
      db!.insertMessage({ from: 'term_worker', to: LEAD_HANDLE, subject: 'late' })
    ).toThrow(/requires a Run/)
    const raw = new Database(dbPath)
    const legacyRows = raw
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE run_id = ?')
      .get(LEGACY_RUN_ID) as { n: number }
    raw.close()
    expect(legacyRows.n).toBe(0)
  })

  it('keeps the legacy fallback for a database that was never adopted', () => {
    db = new OrchestrationDb(':memory:')

    expect(db.insertMessage({ from: 'term_a', to: 'term_b', subject: 'pre-run' }).run_id).toBe(
      LEGACY_RUN_ID
    )
  })
})
