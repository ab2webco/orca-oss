import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from '../sqlite/sync-database'
import { OrcaRuntimeService } from './orca-runtime'
import { LEGACY_RUN_ID, OrchestrationDb } from './orchestration/db'

const userData = { dir: '' }

// A dispatch filed under the legacy Run whose task lives in another Run: a real ownership mismatch
// the heal never touches, so every open throws.
function seedUnadoptableDb(dir: string): void {
  const dbPath = join(dir, 'orchestration.db')
  const seed = new OrchestrationDb(dbPath)
  seed.insertMessage({ from: 'term_old', to: 'term_old_coord', subject: 'pre-run mail' })
  seed.close()
  const adopted = new OrchestrationDb(dbPath)
  const run = adopted.createRun({
    objective: 'lead',
    coordinatorHandle: 'term_lead',
    coordinatorPaneKey: 'tab_1:11111111-1111-4111-8111-111111111111'
  })
  const task = adopted.createTask({ spec: 'work', runId: run.id })
  const dispatch = adopted.createDispatchContext(task.id, 'term_worker')
  adopted.close()
  const raw = new Database(dbPath)
  raw
    .prepare('UPDATE dispatch_contexts SET run_id = ? WHERE id = ?')
    .run(LEGACY_RUN_ID, dispatch.id)
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
