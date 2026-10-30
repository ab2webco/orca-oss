import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { OrchestrationDb } from './db'
import { ORCHESTRATION_SCHEMA_VERSION } from './orchestration-schema-migration-ledger'

describe('remote attachment game scene migration (ORCA-794)', () => {
  let db: OrchestrationDb | undefined
  let tempDir: string | undefined

  afterEach(() => {
    db?.close()
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('keeps a v36 remote member attached, with no scene', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-attachment-scene-migration-'))
    const dbPath = join(tempDir, 'orchestration.db')
    db = new OrchestrationDb(dbPath)
    db.close()
    db = undefined

    const oldDb = new Database(dbPath)
    oldDb.exec('ALTER TABLE remote_dispatch_attachments DROP COLUMN game_scene')
    oldDb.pragma('user_version = 36')
    oldDb
      .prepare(
        `INSERT INTO remote_dispatch_attachments (
           dispatch_id, task_id, home_peer_fingerprint, protocol_version, runtime_epoch,
           state, worktree_id
         ) VALUES ('ctx_migrated', 'task', 'peer', 3, 'epoch', 'ready', 'wt-member')`
      )
      .run()
    oldDb.close()

    db = new OrchestrationDb(dbPath)
    const sqlite = (db as unknown as { db: Database.Database }).db

    expect(sqlite.pragma('user_version', { simple: true })).toBe(ORCHESTRATION_SCHEMA_VERSION)
    expect(db.getRemoteDispatchAttachment('ctx_migrated')).toMatchObject({
      state: 'ready',
      worktree_id: 'wt-member',
      game_scene: null
    })
    expect(db.getGameSceneForWorktree('wt-member')).toBeNull()
  })
})
