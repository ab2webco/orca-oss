import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { LEGACY_RUN_ID, OrchestrationDb } from './db'

describe('OrchestrationDb schema migration from v1 → v2', () => {
  let db: OrchestrationDb | undefined
  let dbPath: string
  let tempDir: string

  afterEach(() => {
    // Why: Windows keeps the SQLite file locked until the DB handle closes,
    // so migration temp directories must close before recursive cleanup.
    db?.close()
    db = undefined
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  function createV1Snapshot(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-db-migrate-'))
    dbPath = join(tempDir, 'test.db')
    const raw = new Database(dbPath)
    // v1 schema: pre-heartbeat CHECK, no last_heartbeat_at column.
    raw.exec(`
      CREATE TABLE messages (
        id            TEXT NOT NULL,
        from_handle   TEXT NOT NULL,
        to_handle     TEXT NOT NULL,
        subject       TEXT NOT NULL,
        body          TEXT NOT NULL DEFAULT '',
        type          TEXT NOT NULL DEFAULT 'status'
          CHECK(type IN (
            'status', 'dispatch', 'worker_done', 'merge_ready',
            'escalation', 'handoff', 'decision_gate'
          )),
        priority      TEXT NOT NULL DEFAULT 'normal'
          CHECK(priority IN ('normal', 'high', 'urgent')),
        thread_id     TEXT,
        payload       TEXT,
        read          INTEGER NOT NULL DEFAULT 0,
        sequence      INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX idx_messages_id ON messages(id);
      CREATE INDEX idx_inbox ON messages(to_handle, read);
      CREATE INDEX idx_thread ON messages(thread_id);

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, parent_id TEXT, spec TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','ready','dispatched','completed','failed','blocked')),
        deps TEXT NOT NULL DEFAULT '[]', result TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE dispatch_contexts (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, assignee_handle TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','dispatched','completed','failed','circuit_broken')),
        failure_count INTEGER NOT NULL DEFAULT 0, last_failure TEXT,
        dispatched_at TEXT, completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE decision_gates (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, question TEXT NOT NULL,
        options TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','resolved','timeout')),
        resolution TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      );

      CREATE TABLE coordinator_runs (
        id TEXT PRIMARY KEY, spec TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle'
          CHECK(status IN ('idle','running','completed','failed')),
        coordinator_handle TEXT NOT NULL,
        poll_interval_ms INTEGER NOT NULL DEFAULT 2000,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
    `)
    // Seed a pre-existing v1 message so migration must preserve data.
    raw
      .prepare(
        `INSERT INTO messages (id, from_handle, to_handle, subject, type) VALUES ('msg_v1', 'a', 'b', 'pre-migration', 'status')`
      )
      .run()
    raw.pragma('user_version = 0')
    raw.close()
    return dbPath
  }

  it('migrates a v1 snapshot to v2, accepts heartbeat, preserves indexes', () => {
    const path = createV1Snapshot()
    const d = new OrchestrationDb(path)
    db = d

    // (a) INSERT type='heartbeat' now succeeds
    expect(() =>
      d.insertMessage({
        runId: d.getLegacyAdoption()?.adopted_run_id,
        from: 'w',
        to: 'c',
        subject: 'alive',
        type: 'heartbeat',
        payload: '{"taskId":"t","dispatchId":"ctx"}'
      })
    ).not.toThrow()

    // (b) last_heartbeat_at column exists on dispatch_contexts
    const task = d.createTask({ spec: 'work' })
    const ctx = d.createDispatchContext(task.id, 'term_a')
    d.recordHeartbeat(ctx.id, '2026-05-04T00:00:00.000Z')
    expect(d.getDispatchContext(task.id)?.last_heartbeat_at).toBe('2026-05-04T00:00:00.000Z')
    expect(d.getTask(task.id)?.task_title).toBe('work')
    expect(d.getTask(task.id)?.display_name).toBe('work')

    // (c) Indexes still attached to messages post-rebuild.
    const sqlite = (d as unknown as { db: Database.Database }).db
    const indexes = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'messages' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as { name: string }[]
    const names = new Set(indexes.map((r) => r.name))
    expect(names.has('idx_messages_id')).toBe(true)
    expect(names.has('idx_inbox')).toBe(true)
    expect(names.has('idx_messages_undelivered_inbox')).toBe(true)
    expect(names.has('idx_thread')).toBe(true)

    // v1 data preserved
    expect(d.getMessageById('msg_v1')?.subject).toBe('pre-migration')
    expect(d.getMessageById('msg_v1')?.run_id).toBe(d.getLegacyAdoption()?.adopted_run_id)
    expect(d.getRun(LEGACY_RUN_ID)).toMatchObject({ legacy: 1 })
  })

  it('adds pane-identity columns (v6) and persists them', () => {
    const path = createV1Snapshot()
    const d = new OrchestrationDb(path)
    db = d

    const task = d.createTask({ spec: 'work' })
    const ctx = d.createDispatchContext(task.id, 'term_a', 'tab_1:leaf_1')
    expect(d.getDispatchContextById(ctx.id)?.assignee_pane_key).toBe('tab_1:leaf_1')

    const msg = d.insertMessage({
      runId: d.getLegacyAdoption()?.adopted_run_id,
      from: 'w',
      to: 'c',
      subject: 'done',
      type: 'worker_done',
      senderPaneKey: 'tab_1:leaf_1'
    })
    expect(d.getMessageById(msg.id)?.sender_pane_key).toBe('tab_1:leaf_1')
  })

  it('is idempotent: opening an already-migrated DB is a no-op', () => {
    const path = createV1Snapshot()
    const first = new OrchestrationDb(path)
    first.insertMessage({
      runId: first.getLegacyAdoption()?.adopted_run_id,
      from: 'w',
      to: 'c',
      subject: 'alive',
      type: 'heartbeat',
      payload: '{}'
    })
    first.close()

    const second = new OrchestrationDb(path)
    db = second
    expect(() =>
      second.insertMessage({
        runId: second.getLegacyAdoption()?.adopted_run_id,
        from: 'w',
        to: 'c',
        subject: 'again',
        type: 'heartbeat',
        payload: '{}'
      })
    ).not.toThrow()
    const inbox = second.getInbox(10)
    expect(inbox.length).toBeGreaterThanOrEqual(2)
  })
})
