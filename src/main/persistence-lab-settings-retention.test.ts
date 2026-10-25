import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { testState, createStore, writeDataFile, readDataFile } from './persistence-test-harness'

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('./telemetry/client', () => ({
  track: vi.fn()
}))

vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 2 })
}))

type PersistedSettings = { settings: Record<string, unknown> }

describe('Store: settings and PTY ownership the Lab keeps', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-test-'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('keeps the GitHub attribution setting through load and save', async () => {
    writeDataFile({ schemaVersion: 1, settings: { enableGitHubAttribution: false } })
    const store = await createStore()

    expect(store.getSettings().enableGitHubAttribution).toBe(false)
    store.updateSettings({ enableGitHubAttribution: true })
    store.flush()

    expect((readDataFile() as PersistedSettings).settings.enableGitHubAttribution).toBe(true)
  })

  it('stamps the Plane default flag when the user edits the visible providers', async () => {
    const store = await createStore()

    store.updateSettings({ visibleTaskProviders: ['github'] })

    expect(store.getSettings().visibleTaskProvidersDefaultedForPlane).toBe(true)
  })

  it('lets a resolved launch overwrite an unknown owner on a live Claude PTY', async () => {
    const store = await createStore()

    store.addClaudeLivePtySessionId('claude-session-1')
    store.addClaudeLivePtySessionId('claude-session-1', 'account-a')

    expect(store.getClaudeLiveSharedPtyAccountBindings()).toEqual([
      { sessionId: 'claude-session-1', accountId: 'account-a', accountResolved: true }
    ])
  })
})
