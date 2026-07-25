import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appMock } = vi.hoisted(() => ({
  appMock: { userDataPath: '', getPath: vi.fn(() => appMock.userDataPath) }
}))

vi.mock('electron', () => ({ app: appMock }))

const PROJECT_SLUG = '-Users-dev-Projects-repo'
let userDataDir: string

/** Creates an account auth dir owning one session transcript. */
function seedAccount(accountId: string, sessionId: string, body: string): string {
  const authPath = join(userDataDir, 'claude-accounts', accountId, 'auth')
  const projectPath = join(authPath, 'projects', PROJECT_SLUG)
  mkdirSync(projectPath, { recursive: true })
  writeFileSync(join(projectPath, `${sessionId}.jsonl`), body, 'utf-8')
  return authPath
}

function sharedSession(sessionId: string): string {
  return join(userDataDir, 'claude-transcripts', 'projects', PROJECT_SLUG, `${sessionId}.jsonl`)
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'orca-transcripts-'))
  appMock.userDataPath = userDataDir
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('linkAccountTranscriptsToSharedStore', () => {
  it('makes every account see the same project history', async () => {
    const { linkAccountTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authA = seedAccount('account-a', 'session-a', '{"m":"from A"}\n')
    const authB = seedAccount('account-b', 'session-b', '{"m":"from B"}\n')

    expect(linkAccountTranscriptsToSharedStore(authA)).toBe('migrated-and-linked')
    expect(linkAccountTranscriptsToSharedStore(authB)).toBe('migrated-and-linked')

    // Why: this is the reported bug — /resume under either account must list both.
    for (const authPath of [authA, authB]) {
      const visible = readdirSync(join(authPath, 'projects', PROJECT_SLUG)).sort()
      expect(visible).toEqual(['session-a.jsonl', 'session-b.jsonl'])
    }
  })

  it('keeps the longer transcript when the same session exists in two accounts', async () => {
    const { linkAccountTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const full = '{"m":"turn 1"}\n{"m":"turn 2"}\n{"m":"turn 3"}\n'
    const authA = seedAccount('account-a', 'shared-session', full)
    // A failover copies a transcript across universes, so the same id can exist
    // twice; the stub must not win just by being migrated later.
    const authB = seedAccount('account-b', 'shared-session', '{"m":"turn 1"}\n')

    linkAccountTranscriptsToSharedStore(authA)
    linkAccountTranscriptsToSharedStore(authB)

    expect(readFileSync(sharedSession('shared-session'), 'utf-8')).toBe(full)
  })

  it('adopts the longer copy even when the stub migrates first', async () => {
    const { linkAccountTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authStub = seedAccount('account-stub', 'shared-session', '{"m":"turn 1"}\n')
    const full = '{"m":"turn 1"}\n{"m":"turn 2"}\n'
    const authFull = seedAccount('account-full', 'shared-session', full)

    linkAccountTranscriptsToSharedStore(authStub)
    linkAccountTranscriptsToSharedStore(authFull)

    expect(readFileSync(sharedSession('shared-session'), 'utf-8')).toBe(full)
  })

  it('is idempotent — a second call leaves the link alone', async () => {
    const { linkAccountTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authPath = seedAccount('account-a', 'session-a', '{"m":"A"}\n')

    expect(linkAccountTranscriptsToSharedStore(authPath)).toBe('migrated-and-linked')
    expect(linkAccountTranscriptsToSharedStore(authPath)).toBe('already-linked')

    expect(lstatSync(join(authPath, 'projects')).isSymbolicLink()).toBe(true)
    expect(readFileSync(sharedSession('session-a'), 'utf-8')).toBe('{"m":"A"}\n')
  })

  it('links a brand new account that has no transcripts yet', async () => {
    const { linkAccountTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authPath = join(userDataDir, 'claude-accounts', 'fresh', 'auth')
    mkdirSync(authPath, { recursive: true })

    expect(linkAccountTranscriptsToSharedStore(authPath)).toBe('linked')
    expect(lstatSync(join(authPath, 'projects')).isSymbolicLink()).toBe(true)
  })

  it('a session written through the link is visible to the other account', async () => {
    const { linkAccountTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authA = seedAccount('account-a', 'session-a', '{"m":"A"}\n')
    const authB = seedAccount('account-b', 'session-b', '{"m":"B"}\n')
    linkAccountTranscriptsToSharedStore(authA)
    linkAccountTranscriptsToSharedStore(authB)

    // Stands in for the live CLI appending a new session under account A.
    writeFileSync(
      join(authA, 'projects', PROJECT_SLUG, 'session-new.jsonl'),
      '{"m":"new"}\n',
      'utf-8'
    )

    expect(existsSync(join(authB, 'projects', PROJECT_SLUG, 'session-new.jsonl'))).toBe(true)
  })

  it('still links when every session collided with a longer stored copy', async () => {
    const { linkAccountTranscriptsToSharedStore } = await import('./shared-transcript-store')
    // Found with real data: 2 of 3 accounts were skipped because all of their
    // sessions lost the size comparison, so the directory never emptied and those
    // accounts stayed blind to the shared history — the bug being fixed.
    const authPath = seedAccount('account-a', 'session-a', '{"m":"short"}\n')
    const sharedProject = join(userDataDir, 'claude-transcripts', 'projects', PROJECT_SLUG)
    mkdirSync(sharedProject, { recursive: true })
    const stored = '{"m":"turn 1"}\n{"m":"turn 2"}\n{"m":"turn 3"}\n'
    writeFileSync(join(sharedProject, 'session-a.jsonl'), stored, 'utf-8')

    expect(linkAccountTranscriptsToSharedStore(authPath)).toBe('migrated-and-linked')
    expect(lstatSync(join(authPath, 'projects')).isSymbolicLink()).toBe(true)
    // The winner is untouched and the superseded copy is retained, not deleted.
    expect(readFileSync(sharedSession('session-a'), 'utf-8')).toBe(stored)
    expect(readdirSync(sharedProject).some((entry) => entry.includes('session-a.superseded'))).toBe(
      true
    )
  })

  it('keeps both superseded copies when three accounts share one session id', async () => {
    const { linkAccountTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const full = '{"m":"1"}\n{"m":"2"}\n{"m":"3"}\n'
    linkAccountTranscriptsToSharedStore(seedAccount('account-full', 'dup', full))
    linkAccountTranscriptsToSharedStore(seedAccount('account-b', 'dup', '{"m":"1"}\n'))
    linkAccountTranscriptsToSharedStore(seedAccount('account-c', 'dup', '{"m":"1"}\n'))

    expect(readFileSync(sharedSession('dup'), 'utf-8')).toBe(full)
    const sharedProject = join(userDataDir, 'claude-transcripts', 'projects', PROJECT_SLUG)
    // Why unique names: a second collision must not overwrite the first sidecar.
    expect(readdirSync(sharedProject).filter((e) => e.includes('.superseded')).length).toBe(2)
  })
})
