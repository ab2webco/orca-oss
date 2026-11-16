import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PersistedState } from '../shared/persisted-state-types'
import { testState, createStore, writeDataFile, readDataFile } from './persistence-test-harness'

vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: vi.fn(),
  sshConfigHostsToTargets: vi.fn(() => [])
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8')
  }
}))

vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))

// ORCA-1216 lead decision: a stored 'recent' becomes Needs you first once; later choices stand.
describe('Store project order migration', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('moves a stored recent order to needs-you and records the migration', async () => {
    writeDataFile({ schemaVersion: 1, ui: { projectOrderBy: 'recent' } })
    const store = await createStore()
    expect(store.getUI().projectOrderBy).toBe('needs-you')
    store.flush()
    const saved = (readDataFile() as PersistedState).ui
    expect(saved.projectOrderBy).toBe('needs-you')
    expect(saved._projectOrderNeedsYouMigrated).toBe(true)
  })

  it('keeps a stored manual order', async () => {
    writeDataFile({ schemaVersion: 1, ui: { projectOrderBy: 'manual' } })
    const store = await createStore()
    expect(store.getUI().projectOrderBy).toBe('manual')
  })

  it('runs once: a recent order chosen after the migration survives the next launch', async () => {
    writeDataFile({ schemaVersion: 1, ui: { projectOrderBy: 'recent' } })
    const first = await createStore()
    expect(first.getUI().projectOrderBy).toBe('needs-you')
    first.updateUI({ projectOrderBy: 'recent' })
    first.flush()

    const second = await createStore()
    expect(second.getUI().projectOrderBy).toBe('recent')
  })

  it('gives a fresh install needs-you and the flag, so a later recent choice is never migrated', async () => {
    const fresh = await createStore()
    expect(fresh.getUI().projectOrderBy).toBe('needs-you')
    fresh.updateUI({ projectOrderBy: 'recent' })
    fresh.flush()
    expect((readDataFile() as PersistedState).ui._projectOrderNeedsYouMigrated).toBe(true)

    const next = await createStore()
    expect(next.getUI().projectOrderBy).toBe('recent')
  })
})
