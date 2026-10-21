import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from '../sqlite/sync-database'
import { OrcaRuntimeService } from './orca-runtime'
import { LEGACY_RUN_ID, OrchestrationDb } from './orchestration/db'

const userData = { dir: '' }

// A stray legacy message carried by Deliveries of two Runs: no heal can own it, so every open throws.
function seedUnadoptableDb(dir: string): void {
  const dbPath = join(dir, 'orchestration.db')
  const seed = new OrchestrationDb(dbPath)
  seed.insertMessage({ from: 'term_old', to: 'term_old_coord', subject: 'pre-run mail' })
  seed.close()
  const adopted = new OrchestrationDb(dbPath)
  const runs = ['1', '2'].map((suffix) =>
    adopted.createRun({
      objective: `lead ${suffix}`,
      coordinatorHandle: 'term_lead',
      coordinatorPaneKey: `tab_${suffix}:11111111-1111-4111-8111-11111111111${suffix}`
    })
  )
  const stray = adopted.insertMessage({
    runId: runs[0].id,
    from: 'term_worker',
    to: 'term_lead',
    subject: 'stray'
  })
  adopted.close()
  const raw = new Database(dbPath)
  raw.prepare('UPDATE messages SET run_id = ? WHERE id = ?').run(LEGACY_RUN_ID, stray.id)
  const deliver = raw.prepare(
    "INSERT INTO deliveries (id, run_id, consumer_generation, message_ids, status) VALUES (?, ?, 1, ?, 'acknowledged')"
  )
  for (const run of runs) {
    deliver.run(`delivery_${run.id}`, run.id, JSON.stringify([stray.id]))
  }
  raw.close()
}

describe('OrcaRuntimeService orchestration DB open failure (ORCA-726)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (userData.dir) {
      rmSync(userData.dir, { recursive: true, force: true })
      userData.dir = ''
    }
  })

  it('does not rerun the migration on every call after an open fails', () => {
    vi.useFakeTimers({ now: new Date('2026-10-21T12:00:00Z') })
    userData.dir = mkdtempSync(join(tmpdir(), 'orca-db-open-backoff-'))
    seedUnadoptableDb(userData.dir)
    const runtime = new OrcaRuntimeService()
    vi.spyOn(
      runtime as unknown as { resolveOrchestrationDbPath: () => string },
      'resolveOrchestrationDbPath'
    ).mockReturnValue(join(userData.dir, 'orchestration.db'))
    const close = vi.spyOn(Database.prototype, 'close')

    for (let call = 0; call < 5; call++) {
      expect(() => runtime.getOrchestrationDb()).toThrow('inconsistent Run ownership')
    }
    expect(close).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_000)
    expect(() => runtime.getOrchestrationDb()).toThrow('inconsistent Run ownership')
    expect(close).toHaveBeenCalledTimes(2)
  })
})
